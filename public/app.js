/* =========================================================================
   WussPuss — app.js
   A black cat lives on this page. This file is the entire nervous system:
   idle life (breathing, blinking, eye tracking, tail twitches), a mood
   system for pokes, a simple long-term memory of the person (name,
   interests, preferences) persisted to localStorage, and the two API
   calls that let WussPuss actually speak.

   Every poke and every typed message always gets a real reply from
   Gemini — there is no random chance of skipping the call.
   ========================================================================= */

(() => {
  'use strict';

  // -----------------------------------------------------------------------
  // DOM references
  // -----------------------------------------------------------------------
  const catWrap = document.getElementById('catWrap');
  const catBody = document.getElementById('catBody');
  const catImg = document.getElementById('catImg');
  const pupilLeft = document.getElementById('pupilLeft');
  const pupilRight = document.getElementById('pupilRight');
  const responseLine = document.getElementById('responseLine');
  const inputForm = document.getElementById('inputForm');
  const textInput = document.getElementById('textInput');

  // -----------------------------------------------------------------------
  // Eye geometry, derived from the source image's actual pixel layout
  // (cat.png is 1024x1024; silhouette bbox x:[276,770] y:[147,841];
  //  left eye-white centroid (347,322), right eye-white centroid (490,322),
  //  each eye-white roughly 67x65px). Expressed as fractions of the image
  //  so it scales cleanly with the rendered <img>.
  // -----------------------------------------------------------------------
  const EYES = {
    left:  { cx: 347 / 1024, cy: 322 / 1024, rx: 30 / 1024, ry: 28 / 1024 },
    right: { cx: 490 / 1024, cy: 322 / 1024, rx: 30 / 1024, ry: 28 / 1024 },
  };

  // -----------------------------------------------------------------------
  // Persisted state: just long-term memory of the person. No bond level,
  // no visit counting, no relationship-stage gating — only what WussPuss
  // has learned about you (name, interests, preferences, meaningful
  // moments), kept small and human-readable in localStorage.
  // -----------------------------------------------------------------------
  const STORE_KEY = 'wusspuss.v1';

  const defaultState = () => ({
    memories: [], // short factual strings, deduped
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — WussPuss simply won't remember this time */
    }
  }

  const state = loadState();

  // -----------------------------------------------------------------------
  // Mood engine — purely about pokes-in-quick-succession, unrelated to any
  // long-term relationship state. Unpredictable, like a real cat.
  // -----------------------------------------------------------------------
  let mood = 'neutral'; // neutral | happy | annoyed | affectionate
  let recentPokeTimestamps = [];
  let pokeCooldown = false;

  function recordPoke() {
    const t = Date.now();
    recentPokeTimestamps.push(t);
    // keep only pokes from the last 12 seconds for irritation math
    recentPokeTimestamps = recentPokeTimestamps.filter((p) => t - p < 12000);
    return recentPokeTimestamps.length;
  }

  function chooseMoodForPoke(recentCount) {
    // Irritation probability rises with poke frequency but is never
    // certain — never fully predictable, like a real cat.
    const irritationChance = Math.min(0.85, Math.max(0, (recentCount - 1) * 0.25));
    const roll = Math.random();

    if (roll < irritationChance) return 'annoyed';
    if (Math.random() < 0.45) return 'affectionate';
    return 'happy';
  }

  function applyMoodVisual(nextMood) {
    catBody.classList.remove('annoyed', 'affectionate', 'bounce');
    // restart animation reliably even if same class is reapplied
    void catBody.offsetWidth;

    if (nextMood === 'annoyed') {
      catBody.classList.add('annoyed');
      setTimeout(() => catBody.classList.remove('annoyed'), 600);
    } else if (nextMood === 'affectionate') {
      catBody.classList.add('affectionate');
      setTimeout(() => catBody.classList.remove('affectionate'), 1800);
    } else if (nextMood === 'happy') {
      catBody.classList.add('bounce');
      setTimeout(() => catBody.classList.remove('bounce'), 550);
    }
    mood = nextMood;
  }

  // -----------------------------------------------------------------------
  // Response rendering — only ever one line. Old fades out, new fades in
  // with a slight upward motion. Supports a leading *action* and/or speech.
  // -----------------------------------------------------------------------
  let responseTimer = null;

  function showResponse(text) {
    responseLine.classList.remove('visible');

    clearTimeout(responseTimer);
    responseTimer = setTimeout(() => {
      responseLine.innerHTML = formatResponse(text);
      // force reflow so the transition re-triggers
      void responseLine.offsetWidth;
      responseLine.classList.add('visible');
    }, 220);
  }

  function formatResponse(text) {
    // Wrap *action* segments distinctly from spoken text for subtle styling.
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(/\*(.+?)\*/g, '<span class="action">*$1*</span>');
  }

  // -----------------------------------------------------------------------
  // API calls
  // -----------------------------------------------------------------------
  async function askWussPuss({ message, eventType }) {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          eventType,
          mood,
          memories: state.memories,
          recentPokes: recentPokeTimestamps.length,
        }),
      });
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      return data.reply || "Oh, now you want my attention.";
    } catch {
      return "Hold on, I'm not in the mood to think right now.";
    }
  }

  // Token-saver: only run memory extraction roughly every 3rd real message.
  // Most short exchanges have nothing new worth remembering anyway, so
  // calling Gemini a second time after every single message wastes tokens
  // for little gain.
  let messageCountSinceExtraction = 0;

  async function extractMemoryFrom(userText, catReply) {
    if (!userText || userText.trim().length < 3) return;
    messageCountSinceExtraction += 1;
    if (messageCountSinceExtraction < 3) return;
    messageCountSinceExtraction = 0;

    try {
      const res = await fetch('/api/extract-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText,
          catReply,
          existingMemories: state.memories,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.memories) && data.memories.length) {
        mergeMemories(data.memories);
      }
    } catch {
      /* silent — memory extraction is a nice-to-have, never blocks the UX */
    }
  }

  function mergeMemories(newOnes) {
    const normalize = (s) => s.trim().toLowerCase();
    const existingSet = new Set(state.memories.map(normalize));
    for (const m of newOnes) {
      const clean = m.trim();
      if (!clean) continue;
      if (existingSet.has(normalize(clean))) continue;
      state.memories.push(clean);
      existingSet.add(normalize(clean));
    }
    // Keep memory list bounded so prompts stay small and signal stays high.
    if (state.memories.length > 40) {
      state.memories = state.memories.slice(state.memories.length - 40);
    }
    saveState();
  }

  // -----------------------------------------------------------------------
  // Poke reaction phrase banks — fully local, no API call. Pokes happen too
  // often and too casually to justify a model round-trip; these read as
  // instant reflexes, which is also just more honest to how a cat reacts.
  // -----------------------------------------------------------------------
  const POKE_LINES = {
    happy: [
      "Oh, hi.",
      "That's the spot. Don't tell anyone I said that.",
      "Keep going, I won't admit I like it.",
      "Fine. You're forgiven for existing.",
      "Mm. More of that.",
      "I'll allow it.",
      "Don't get used to this.",
      "You're alright, you know that?",
    ],
    affectionate: [
      "...okay, that one was nice.",
      "Don't stop on my account.",
      "I guess I missed you a little.",
      "You came back. Good.",
      "Stay a while, I don't mind.",
      "This is acceptable. Barely.",
      "I'm not purring. You're imagining it.",
    ],
    annoyed: [
      "Enough.",
      "Watch it.",
      "I will remember this.",
      "That's poke number too many.",
      "Rude.",
      "Do that again and see what happens.",
      "I was relaxing. Was.",
      "Bold of you.",
      "Excuse you.",
    ],
  };

  // -----------------------------------------------------------------------
  // Poke handling — fully local reaction, no network call, no tokens spent.
  // -----------------------------------------------------------------------
  catWrap.addEventListener('click', (e) => {
    e.preventDefault();
    if (pokeCooldown) return;
    pokeCooldown = true;
    setTimeout(() => (pokeCooldown = false), 180);

    const recentCount = recordPoke();
    const nextMood = chooseMoodForPoke(recentCount);
    applyMoodVisual(nextMood);

    showResponse(randomFrom(POKE_LINES[nextMood] || POKE_LINES.happy));
  });

  // -----------------------------------------------------------------------
  // Text input handling — every message always gets a real reply.
  // -----------------------------------------------------------------------
  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = '';
    textInput.blur();

    showResponse('…');

    const reply = await askWussPuss({ message: text, eventType: 'message' });
    showResponse(reply);

    extractMemoryFrom(text, reply);
  });

  // -----------------------------------------------------------------------
  // Idle life: breathing (CSS-driven, just toggled on), blinking,
  // and occasional autonomous lines/model calls.
  // -----------------------------------------------------------------------
  catBody.classList.add('breathing');

  function scheduleBlink() {
    const delay = 2200 + Math.random() * 4200;
    setTimeout(() => {
      blink();
      scheduleBlink();
    }, delay);
  }

  function blink(slow = false) {
    const duration = slow ? 260 : 110;
    pupilLeft.style.transition = `opacity ${duration}ms ease`;
    pupilRight.style.transition = `opacity ${duration}ms ease`;
    pupilLeft.style.opacity = '0';
    pupilRight.style.opacity = '0';
    setTimeout(() => {
      pupilLeft.style.opacity = '1';
      pupilRight.style.opacity = '1';
    }, duration + (slow ? 180 : 70));
  }

  // Occasional unprompted lines — rare, so they feel like a genuine glimpse
  // of a private inner life rather than a notification. Fully local, no
  // network call — idle moments are ambient flavor, not real conversation.
  const IDLE_LINES = [
    "Don't mind me, just existing.",
    "Still here. Riveting, I know.",
    "Nothing to report. Try again later.",
    "You can talk to me, you know. I don't bite. Often.",
    "Just thinking. Don't ask about what.",
    "I heard something. Probably nothing.",
    "This is me, doing absolutely nothing.",
  ];

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function scheduleIdleMoment() {
    // Token-saver: longer interval, and skip entirely while the tab isn't
    // visible — no point reacting for a tab nobody is looking at.
    const delay = 150000 + Math.random() * 210000; // roughly 2.5–6 min
    setTimeout(() => {
      const userIsAway = document.activeElement === textInput || document.hidden;
      if (!userIsAway) {
        showResponse(randomFrom(IDLE_LINES));
      }
      scheduleIdleMoment();
    }, delay);
  }

  // Occasional autonomous slow blink, separate from the regular blink cycle.
  function scheduleSlowBlink() {
    const delay = 9000 + Math.random() * 16000;
    setTimeout(() => {
      blink(true);
      scheduleSlowBlink();
    }, delay);
  }

  // -----------------------------------------------------------------------
  // Eye tracking + lean-toward-cursor, via requestAnimationFrame.
  // Pupils move within their eye-white bound; the whole body leans a
  // very small amount toward the cursor, both easing back to center
  // when idle. All distances are tiny — this is a cat being aware of you,
  // not a cartoon following you around.
  // -----------------------------------------------------------------------
  let targetX = 0.5; // normalized pointer position within viewport, 0..1
  let targetY = 0.5;
  let pointerActive = false;
  let lastPointerMove = 0;

  let curPupilOffsetX = 0; // current eased pupil offset, -1..1 within eye bound
  let curPupilOffsetY = 0;
  let curLeanX = 0; // current eased body lean, in degrees-ish small units
  let curLeanY = 0;

  window.addEventListener('pointermove', (e) => {
    targetX = e.clientX / window.innerWidth;
    targetY = e.clientY / window.innerHeight;
    pointerActive = true;
    lastPointerMove = performance.now();
  });

  window.addEventListener('pointerleave', () => {
    pointerActive = false;
  });

  function placePupil(el, eye, offsetX, offsetY, imgRect) {
    const cx = eye.cx * imgRect.width;
    const cy = eye.cy * imgRect.height;
    const rx = eye.rx * imgRect.width;
    const ry = eye.ry * imgRect.height;
    const px = cx + offsetX * rx;
    const py = cy + offsetY * ry;
    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
  }

  function animationLoop() {
    const idleFor = performance.now() - lastPointerMove;
    const isIdle = !pointerActive || idleFor > 5000;

    // When idle, ease pupils/lean back toward center rather than snapping.
    const wantX = isIdle ? 0.5 : targetX;
    const wantY = isIdle ? 0.5 : targetY;

    // Convert pointer position to a -1..1 offset relative to viewport center.
    const desiredOffsetX = clamp((wantX - 0.5) * 2.4, -1, 1);
    const desiredOffsetY = clamp((wantY - 0.5) * 2.4, -1, 1);

    const ease = 0.06;
    curPupilOffsetX += (desiredOffsetX - curPupilOffsetX) * ease;
    curPupilOffsetY += (desiredOffsetY - curPupilOffsetY) * ease;

    // Body lean is a much smaller fraction of the same signal, and only
    // engages meaningfully when the pointer is reasonably close to the cat
    // (otherwise WussPuss would visibly track you across the whole screen,
    // which reads as needy rather than aware).
    const rect = catWrap.getBoundingClientRect();
    const catCx = (rect.left + rect.right) / 2;
    const catCy = (rect.top + rect.bottom) / 2;
    const dx = (wantX * window.innerWidth - catCx) / window.innerWidth;
    const dy = (wantY * window.innerHeight - catCy) / window.innerHeight;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const proximity = isIdle ? 0 : clamp(1 - dist / 0.5, 0, 1);

    const desiredLeanX = clamp(dx, -1, 1) * proximity * 1.6; // degrees
    const desiredLeanY = clamp(dy, -1, 1) * proximity * 1.0;

    curLeanX += (desiredLeanX - curLeanX) * 0.04;
    curLeanY += (desiredLeanY - curLeanY) * 0.04;

    catWrap.classList.toggle('leaning', proximity > 0.3);
    catImg.style.transform = `rotate(${curLeanX}deg) translateY(${curLeanY * 2}px)`;

    const imgRect = catImg.getBoundingClientRect();
    placePupil(pupilLeft, EYES.left, curPupilOffsetX, curPupilOffsetY, imgRect);
    placePupil(pupilRight, EYES.right, curPupilOffsetX, curPupilOffsetY, imgRect);

    requestAnimationFrame(animationLoop);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // -----------------------------------------------------------------------
  // Boot — opening line always comes from the model itself, using whatever
  // memories already exist (e.g. it may use your name if it knows it).
  // -----------------------------------------------------------------------
  function init() {
    // Place pupils once layout settles, before the loop takes over.
    requestAnimationFrame(() => {
      const imgRect = catImg.getBoundingClientRect();
      placePupil(pupilLeft, EYES.left, 0, 0, imgRect);
      placePupil(pupilRight, EYES.right, 0, 0, imgRect);
    });

    showResponse('…');
    askWussPuss({ message: '', eventType: 'greeting' }).then(showResponse);

    scheduleBlink();
    scheduleSlowBlink();
    scheduleIdleMoment();
    requestAnimationFrame(animationLoop);

    window.addEventListener('resize', () => {
      const imgRect = catImg.getBoundingClientRect();
      placePupil(pupilLeft, EYES.left, curPupilOffsetX, curPupilOffsetY, imgRect);
      placePupil(pupilRight, EYES.right, curPupilOffsetX, curPupilOffsetY, imgRect);
    });
  }

  init();
})();
