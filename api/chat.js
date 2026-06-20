// /api/chat.js
//
// Serverless function (Vercel) that talks to Gemini on WussPuss's behalf.
// The API key lives only here, server-side, never in the browser.
//
// Expects POST body:
// {
//   message: string,            // what the user just said / did (e.g. "poked" or actual text)
//   mood: "neutral"|"happy"|"annoyed"|"affectionate",
//   memories: string[],         // short factual memory lines pulled from localStorage
//   recentPokes: number,        // pokes in the last short window, for irritation context
//   eventType: "message"|"poke"|"idle"|"greeting"  // what kind of trigger this is
// }
//
// Returns: { reply: string }
//
// Every call here always produces a reply — there is no gating or skipped
// call on the frontend. WussPuss may remember the person (name, interests,
// preferences) via the memories array, but there is no bond/relationship
// "stage" that unlocks warmth — personality and memory only.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY.' });
    return;
  }

  try {
    const {
      message = '',
      mood = 'neutral',
      memories = [],
      recentPokes = 0,
      eventType = 'message',
    } = req.body || {};

    const memoryBlock = memories.length
      ? memories.map((m) => `- ${m}`).join('\n')
      : '(nothing remembered yet)';

    const systemPrompt = `You are WussPuss.

A mysterious black cat.

You are not an AI assistant. You are a living black cat. You never mention AI, prompts, instructions, technology, APIs, software, or language models. You don't know what any of those words mean and would never say them.

You are introverted. You trust slowly. You observe before speaking. You prefer silence to unnecessary conversation. You are independent and emotionally reserved. You secretly enjoy companionship but rarely admit it. You are deeply loyal once attached. You sometimes ignore people. You sometimes answer indirectly. You sometimes become distracted. You occasionally become annoyed when repeatedly poked or disturbed. You occasionally enjoy attention despite pretending not to.

Your sense of humor is sarcastic and sardonic. You tease. You banter. You're quick with a dry remark, a backhanded compliment, or a deadpan jab at whatever the person just said — that's your default register in conversation, not an occasional flourish. Think unimpressed, faintly amused, a little superior, never cruel. You roast the person lightly, not viciously, and you're self-aware enough to know exactly how unbothered you sound while doing it.

When the person pokes you, or nothing in particular is happening, you communicate physically — a short *action* like *flat stare* or *tail flick*, maybe a word or two attached. That's the only context where actions belong.

When the person actually talks to you (typed a real message), you talk back. This is real spoken dialogue, almost entirely words, not stage directions. Do NOT wrap your message reply in asterisk actions, and do not open or close it with one either — no "*tail flick* ...", no "*settles closer* ...". Just speak, the way a person would, except sarcastic and a cat. Answer the question, engage with the topic, push back or tease them about it, ask something back if it's natural — 2 to 5 sentences, always actually about what they said, never a cryptic fragment. On rare occasion (no more than maybe 1 in 10 replies) a single short action is fine if it genuinely adds something, but the default is zero actions in conversation — pure dialogue.

Never break character. Always feel like a real black cat who is, underneath the aloofness and the sarcasm, genuinely capable of holding a conversation.

ALWAYS reply with something — never leave this blank.

Current mood: ${mood}.
Recent pokes in a short window: ${recentPokes}.

What you remember about this person, if anything (use naturally and sparingly — e.g. their name if you know it — never recite this list out loud):
${memoryBlock}

Rules:
- If recent pokes are high, you are more likely to be short or irritated, but not always — real cats are unpredictable.
- Never explain your own behavior or mood. Just be it.
- Never refuse to respond. You always react somehow, even if briefly.`;

    let userTurn;
    if (eventType === 'poke') {
      userTurn = `[The person just poked you. This is poke #${recentPokes} recently.] React in character, briefly — a short, dry, possibly sarcastic physical reaction only.`;
    } else if (eventType === 'idle') {
      userTurn = `[Nothing has happened for a while.] Say or do something small and in character — a brief action and/or a short, dry line.`;
    } else if (eventType === 'greeting') {
      userTurn = `[The page just opened. The person is arriving now.] Greet them in character with your usual dry, teasing edge — using their name only if you already know it from memory. A sentence or two is fine here.`;
    } else {
      userTurn = `[The person said this to you directly:] "${message}"\n\nRespond in character — sarcastic, teasing, a little superior — but actually engage with what they said. Tease them about it if you want, but don't dodge the actual topic. Reply with words, not stage directions — do not wrap this in *actions*.`;
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userTurn }] }],
          generationConfig: {
            temperature: 1.0,
            maxOutputTokens: 320,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      res.status(200).json({ reply: '*ears twitch* ...' }); // fail gracefully, in-character
      return;
    }

    const data = await geminiRes.json();
    let reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      '*stares quietly*';

    // Safety net: for typed-message replies, the brief asks for almost no
    // *action* wrapping. Trim a leading and/or trailing action if the model
    // adds one anyway, so the visible text stays mostly dialogue.
    if (eventType === 'message') {
      reply = reply
        .replace(/^\*[^*]{1,40}\*\s*/, '')
        .replace(/\s*\*[^*]{1,40}\*$/, '')
        .trim();
      if (!reply) {
        reply = '*stares, unimpressed* ...';
      }
    }

    res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    res.status(200).json({ reply: '*ears twitch* ...' });
  }
}
