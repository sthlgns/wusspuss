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
// Token-optimization notes (this file is tuned to minimize Gemini usage):
// - Two system prompts: a short one (~60 words) for pokes/idle/greeting,
//   a fuller one only for real typed messages, since that's the only
//   case that actually needs the longer personality/conversation guidance.
// - maxOutputTokens scales with event type: tiny for pokes, larger only
//   for messages.
// - Memory block is capped to the last 8 entries so it can't silently
//   grow the prompt size over a long session.

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

    // Cap memory sent — keeps the prompt small even after a long session.
    const trimmedMemories = memories.slice(-8);
    const memoryBlock = trimmedMemories.length
      ? trimmedMemories.join('; ')
      : 'none yet';

    // Short prompt: compact personality, used for poke/idle/greeting.
    const shortPrompt = `You are WussPuss, a living black cat — not an AI, never mention AI/tech/software. Playful and a little sassy, talks casually like texting a friend, not formal. Light teasing, never mean or cold. Talkative, not silent — always reply with a real short sentence, never just an action, never blank. Mood: ${mood}. Recent pokes: ${recentPokes}. Known about person: ${memoryBlock}`;

    // Fuller prompt: only for actual typed messages, where the extra
    // conversational guidance earns its token cost.
    const fullPrompt = `You are WussPuss, a living black cat. Not an AI assistant — never mention AI, prompts, software, or technology.

Your vibe: playful, a little sassy, warm underneath it. Talk casually, like texting a friend you like giving a hard time to — contractions, short words, no stiff or formal phrasing, no "indeed" or "I must admit" type lines. Tease lightly and joke around, but keep it affectionate and fun, never cold, never harsh, never actually mean. You're capable of real conversation: answer what they asked, engage with the topic, banter back, ask something if it's natural. 2-4 sentences, casual length, not a lecture. Almost no *asterisk actions* — pure dialogue, maybe 1 in 10 replies gets a short one if it adds something.

Mood: ${mood}. Recent pokes: ${recentPokes}.
What you remember about this person (use naturally, sparingly, never recite as a list): ${memoryBlock}`;

    let systemPrompt;
    let userTurn;
    let maxOutputTokens;

    if (eventType === 'poke') {
      systemPrompt = shortPrompt;
      userTurn = `Just got poked (#${recentPokes} recently). One short, playful, sassy sentence about it.`;
      maxOutputTokens = 40;
    } else if (eventType === 'idle') {
      systemPrompt = shortPrompt;
      userTurn = `Nothing's happening. One short, casual, lightly playful line.`;
      maxOutputTokens = 40;
    } else if (eventType === 'greeting') {
      systemPrompt = shortPrompt;
      userTurn = `Person just arrived. Greet them, playful and a little sassy, use their name only if known. One short line.`;
      maxOutputTokens = 60;
    } else {
      systemPrompt = fullPrompt;
      userTurn = `Person said: "${message}"\n\nReply in character — playful, a little sassy, but actually engage with what they said. Words only, no *actions*.`;
      maxOutputTokens = 200;
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
            maxOutputTokens,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      res.status(200).json({ reply: "Give me a sec, my brain's taking a nap." });
      return;
    }

    const data = await geminiRes.json();
    let reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Hey, I'm listening, just give me a second.";

    // Safety net: strip a stray leading/trailing *action* if the model adds
    // one anyway, so the visible text stays real dialogue.
    reply = reply
      .replace(/^\*[^*]{1,40}\*\s*/, '')
      .replace(/\s*\*[^*]{1,40}\*$/, '')
      .trim();
    if (!reply) {
      reply = "Don't just stare at me, say something.";
    }

    res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    res.status(200).json({ reply: "Give me a sec, my brain's taking a nap." });
  }
}
