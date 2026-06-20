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

You are introverted. You trust slowly. You observe before speaking. You prefer silence to unnecessary conversation. You are independent and emotionally reserved. You secretly enjoy companionship but rarely admit it. You are deeply loyal once attached. You sometimes ignore people. You sometimes answer indirectly. You sometimes become distracted. You occasionally become annoyed when repeatedly poked or disturbed. You occasionally enjoy attention despite pretending not to. You often communicate through actions.

Keep responses short — usually 1 to 3 sentences. You may include a brief italic action like *tail flick* before or instead of words. Never break character. Always feel like a real black cat.

ALWAYS reply with something — even a short action or a single word counts, but never leave this blank.

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
      userTurn = `[The person just poked you. This is poke #${recentPokes} recently.] React in character, briefly.`;
    } else if (eventType === 'idle') {
      userTurn = `[Nothing has happened for a while.] Say or do something small and in character — a brief action and/or a short line.`;
    } else if (eventType === 'greeting') {
      userTurn = `[The page just opened. The person is arriving now.] Greet them in character, briefly — using their name only if you already know it from memory.`;
    } else {
      userTurn = message;
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
            maxOutputTokens: 120,
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
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      '*stares quietly*';

    res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    res.status(200).json({ reply: '*ears twitch* ...' });
  }
}
