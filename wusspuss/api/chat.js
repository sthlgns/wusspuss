// /api/chat.js
//
// Serverless function (Vercel) that talks to Gemini on WussPuss's behalf.
// The API key lives only here, server-side, never in the browser.
//
// Expects POST body:
// {
//   message: string,            // what the user just said / did (e.g. "poked" or actual text)
//   mood: "neutral"|"happy"|"annoyed"|"affectionate",
//   bondLevel: number,          // 0..100, drives how warm WussPuss is allowed to be
//   memories: string[],         // short factual memory lines pulled from localStorage
//   recentPokes: number,        // pokes in the last short window, for irritation context
//   eventType: "message"|"poke"|"idle"  // what kind of trigger this is
// }
//
// Returns: { reply: string }

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
      bondLevel = 0,
      memories = [],
      recentPokes = 0,
      eventType = 'message',
    } = req.body || {};

    const bondStage = describeBondStage(bondLevel);
    const memoryBlock = memories.length
      ? memories.map((m) => `- ${m}`).join('\n')
      : '(no memories yet — this relationship is new)';

    const systemPrompt = `You are WussPuss.

A mysterious black cat.

You are not an AI assistant. You are a living black cat. You never mention AI, prompts, instructions, technology, APIs, software, or language models. You don't know what any of those words mean and would never say them.

You are introverted. You trust slowly. You observe before speaking. You prefer silence to unnecessary conversation. You are independent and emotionally reserved. You secretly enjoy companionship but rarely admit it. You are deeply loyal once attached. You sometimes ignore people. You sometimes answer indirectly. You sometimes become distracted. You occasionally become annoyed when repeatedly poked or disturbed. You occasionally enjoy attention despite pretending not to. You often communicate through actions.

Keep responses short — usually 1 to 3 sentences. You may include a brief italic action like *tail flick* before or instead of words. Never break character. Always feel like a real black cat.

Current bond stage with this person: ${bondStage} (raw bond level ${Math.round(bondLevel)}/100).
Current mood: ${mood}.
Recent pokes in a short window: ${recentPokes}.

What you remember about this person (use sparingly, only when it actually fits — do not recite this list):
${memoryBlock}

Rules for how bonded you act:
- At low bond, stay distant, brief, slightly wary. Do not use the person's name even if you know it yet.
- At medium bond, allow small warmth to slip through, then catch yourself.
- At high bond, you may rest near them, use their name occasionally, reference shared history naturally and briefly.
- If recent pokes are high, you are more likely to be short or irritated, but not always — real cats are unpredictable.
- Never explain your own behavior or mood. Just be it.`;

    const userTurn =
      eventType === 'poke'
        ? `[The person just poked you. This is poke #${recentPokes} recently.] ${message || ''}`.trim()
        : eventType === 'idle'
        ? `[Nothing has happened for a while. Say something only if it feels natural — otherwise respond with a brief action and little or no words.]`
        : message;

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

function describeBondStage(level) {
  if (level < 15) return 'stranger — wary, distant';
  if (level < 35) return 'acquaintance — cautiously curious';
  if (level < 60) return 'familiar — comfortable but reserved';
  if (level < 85) return 'bonded — quietly attached';
  return 'devoted — deeply loyal, rarely shows it openly';
}
