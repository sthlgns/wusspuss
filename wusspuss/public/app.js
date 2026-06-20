/* =========================================================================
   WussPuss — app.js
   A black cat lives on this page. This file is the entire nervous system:
   idle life (breathing, blinking, eye tracking, tail twitches), a small
   mood engine for pokes, a relationship/bond model persisted to
   localStorage, and the two API calls that let WussPuss actually speak.
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
  const nameLabel = document.getElementById('nameLabel');
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
  // Persisted state: relationship memory + bond level.
  // Kept deliberately small and human-readable in localStorage.
  // -----------------------------------------------------------------------
  const STORE_KEY = 'wusspuss.v1';

  const defaultState = () => ({
    bondLevel: 0,            // 0..100, grows slowly across visits
    visits: 0,
    lastVisit: null,
    memories: [],            // short factual strings, deduped
    totalPokesEver: 0,
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

  // First-visit-of-session bookkeeping for bond growth (gentle, time-gated
  // so bond can't be farmed by spamming — it grows with *returning*, not
  // with message volume).
  const now = Date.now();
  const isNewDay =
    !state.lastVisit || now - state.lastVisit > 1000 * 60 * 60 * 18; // ~18h gap counts as a new "day"
  if (isNewDay) {
    state.visits += 1;
    // Diminishing returns as bond approaches 100.
    const room = 100 - state.bondLevel;
    state.bondLevel = Math.min(100, state.bondLevel + Math.max(1, room * 0.08));
  }
  state.lastVisit = now;
  saveState();

  function bondStageClass() {
    return state.bondLevel >= 35 ? 'bonded' : '';
  }
  nameLabel.className = `name ${bondStageClass()}`;

  // -----------------------------------------------------------------------
  // Mood engine
  // -----------------------------------------------------------------------
  let mood = 'neutral'; // neutral | happy | annoyed | affectionate
  let recentPokeTimestamps = [];
  let pokeCooldown = false;

  function recordPoke() {
    const t = Date.now();
    recentPokeTimestamps.push(t);
    // keep only pokes from the last 12 seconds for irritation math
    recentPokeTimestamps = recentPokeTimestamps.filter((p) => t - p < 12000);
    state.totalPokesEver += 1;
    saveState();
    return recentPokeTimestamps.length;
  }

  function chooseMoodForPoke(recentCount) {
    // Unpredictable, like a real cat: irritation probability rises with
    // poke frequency but is never certain, and bonded cats forgive faster.
    const bondFactor = state.bondLevel / 100; // 0..1, more bonded = more tolerant
    const irritationChance = Math.min(
      0.85,
      Math.max(0, (recentCount - 1) * 0.22 - bondFactor * 0.25)
    );
    const roll = Math.random();

    if (roll < irritationChance) return 'annoyed';

    // Otherwise lean toward affection more often once bonded.
    const affectionChance = 0.35 + bondFactor * 0.35;
    if (Math.random() < affectionChance) return 'affectionate';

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
  // Canned micro-reactions shown immediately on poke, before/instead of
  // waiting on the network — keeps the creature feeling instantly alive.
  // The model call (below) may still follow up with something richer if
  // this poke also included typed words.
  // -----------------------------------------------------------------------
  const POKE_LINES = {
    happy: [
      '*purrs softly*',
      '*slow blink* "You again."',
      '*leans in slightly*',
      '"...fine. One more."',
      '*tail swishes gently*',
    ],
    affectionate: [
      '*slow blink*',
      '*settles a little closer*',
      '"I suppose that\'s acceptable."',
      '*soft purring*',
    ],
    annoyed: [
      '*ears flatten* "Enough."',
      '*tail lashes once*',
      '*glares* "Do that again."',
      '"Hm."',
      '*turns away*',
    ],
  };

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
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
          bondLevel: state.bondLevel,
          memories: state.memories,
          recentPokes: recentPokeTimestamps.length,
        }),
      });
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      return data.reply || '*stares quietly*';
    } catch {
      return '*ears twitch* ...';
    }
  }

  async function extractMemoryFrom(userText, catReply) {
    if (!userText || userText.trim().length < 3) return;
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
    const normalized = (s) => s.trim().toLowerCase();
    const existingSet = new Set(state.memories.map(normalized));
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
  function normalize(s) {
    return s.trim().toLowerCase();
  }

  // -----------------------------------------------------------------------
  // Poke handling
  // -----------------------------------------------------------------------
  catWrap.addEventListener('click', async (e) => {
    e.preventDefault();
    if (pokeCooldown) return;
    pokeCooldown = true;
    setTimeout(() => (pokeCooldown = false), 180);

    const recentCount = recordPoke();
    const nextMood = chooseMoodForPoke(recentCount);
    applyMoodVisual(nextMood);

    // Instant local reaction line for responsiveness.
    const line = randomFrom(POKE_LINES[nextMood] || POKE_LINES.happy);
    showResponse(line);

    // Occasionally let the model produce a richer line instead, especially
    // once some bond exists — but don't fire a network call on every single
    // poke, or it stops feeling like a cat and starts feeling like a chatbot.
    const shouldAskModel = Math.random() < 0.25 + state.bondLevel / 400;
    if (shouldAskModel) {
      const reply = await askWussPuss({ message: 'poke', eventType: 'poke' });
      showResponse(reply);
    }
  });

  // -----------------------------------------------------------------------
  // Text input handling
  // -----------------------------------------------------------------------
  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = '';
    textInput.blur();

    showResponse('*watches you*');

    const reply = await askWussPuss({ message: text, eventType: 'message' });
    showResponse(reply);

    // Gentle bond nudge for genuine engagement, separate from the daily
    // visit-based growth above — small, capped, so it can't be farmed by
    // spamming short messages.
    state.bondLevel = Math.min(100, state.bondLevel + 0.3);
    saveState();
    nameLabel.className = `name ${bondStageClass()}`;

    extractMemoryFrom(text, reply);
  });

  // -----------------------------------------------------------------------
  // Idle life: breathing (CSS-driven, just toggled on), blinking,
  // occasional autonomous lines, and tail-ish micro motion via filter-free
  // transform nudges on the body (kept extremely subtle).
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
  // of a private inner life rather than a notification.
  const IDLE_LINES = [
    '*watches something invisible* "..."',
    '*ears twitch* "Thought I heard something."',
    '*glances away*',
    '*tail flicks once, then stills*',
    '*stares at a spot on the floor*',
  ];

  function scheduleIdleMoment() {
    const delay = 75000 + Math.random() * 140000; // roughly 1.25–3.5 min
    setTimeout(async () => {
      // Don't interrupt if the user is mid-typing.
      if (document.activeElement !== textInput) {
        const useModel = Math.random() < 0.3;
        if (useModel) {
          const reply = await askWussPuss({ message: '', eventType: 'idle' });
          showResponse(reply);
        } else {
          showResponse(randomFrom(IDLE_LINES));
        }
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
  // First-paint greeting, scaled to bond level — this is the relationship
  // progression made visible on the very first thing the cat "says."
  // -----------------------------------------------------------------------
  function initialGreeting() {
    if (state.bondLevel < 15) {
      return randomFrom(['*glances briefly* "...Hello."', '*watches you from a distance*']);
    }
    if (state.bondLevel < 60) {
      return randomFrom(['*settles nearby* "You came back."', '*ears flick toward you*']);
    }
    return randomFrom(['*rests beside you* "I kept this spot warm."', '*low purr* "There you are."']);
  }

  // -----------------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------------
  function init() {
    // Place pupils once layout settles, before the loop takes over.
    requestAnimationFrame(() => {
      const imgRect = catImg.getBoundingClientRect();
      placePupil(pupilLeft, EYES.left, 0, 0, imgRect);
      placePupil(pupilRight, EYES.right, 0, 0, imgRect);
    });

    setTimeout(() => showResponse(initialGreeting()), 900);

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
