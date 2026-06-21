// /api/chat.js
//
// Serverless function (Vercel) that talks to Gemini on WussPuss's behalf.
// The API key lives only here, server-side, never in the browser.
//
// Only called for: "greeting" (once per page load) and "message" (an actual
// typed message from the person). Pokes and idle moments are handled fully
// client-side now with local randomized phrase banks — see app.js — since
// they're frequent, low-stakes, and don't need a model call.
//
// Expects POST body:
// {
//   message: string,            // the person's typed text (only used for "message")
//   mood: "neutral"|"happy"|"annoyed"|"affectionate",
//   memories: string[],         // short factual memory lines pulled from localStorage
//   recentPokes: number,        // pokes in the last short window, for light context
//   eventType: "message"|"greeting"
// }
//
// Returns: { reply: string }
//
// Token-optimization notes:
// - Memory block is capped to the last 8 entries so it can't silently grow
//   the prompt size over a long session.
// - thinkingConfig.thinkingBudget is set to 0 — without this, Gemini 2.5
//   models can spend part of maxOutputTokens on internal reasoning tokens
//   before the visible reply, which was cutting replies off mid-sentence.

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

    // Short prompt: compact personality, used only for the once-per-load greeting.
    const shortPrompt = `You are WussPuss, a living black cat, not an AI. Casual, friendly, like texting a friend. Mostly straightforward; occasionally a little playful/sassy, not every time. Always a real short reply, never blank, no actions. Mood: ${mood}. Pokes: ${recentPokes}. Known: ${memoryBlock}`;

    // Fuller prompt: only for actual typed messages, where the extra
    // conversational guidance earns its token cost.
    const fullPrompt = `You are WussPuss, a living black cat. Not an AI — never mention AI, prompts, software, tech.

Talk casually, like texting a friend: contractions, plain words, no fancy or formal phrasing ("indeed", "wouldn't you say", "I must admit" = forbidden). Default mode: just answer normally and directly, like a friend would. Most replies should be plain and helpful with zero teasing. Only sometimes (roughly 1 in 4 replies) let a little playful sass slip in, and even then keep it light, brief, and still answer the actual question — never replace the answer with a joke or deflect with attitude. 1-3 short sentences. No *actions*.

Mood: ${mood}. Pokes: ${recentPokes}. Known about person: ${memoryBlock}`;

    let systemPrompt;
    let userTurn;
    let maxOutputTokens;

    if (eventType === 'greeting') {
      systemPrompt = shortPrompt;
      userTurn = `Person just arrived. Greet them casually, name only if known. One short line.`;
      maxOutputTokens = 100;
    } else {
      systemPrompt = fullPrompt;
      userTurn = `Person said: "${message}"\n\nAnswer them directly and casually. Words only, no *actions*. Keep any teasing minimal and only if it fits.`;
      maxOutputTokens = 220;
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
            // Gemini 2.5 models spend part of the output budget on internal
            // "thinking" tokens by default, which can eat the whole cap and
            // cut the visible reply off mid-sentence. Disabling it ensures
            // the full maxOutputTokens budget goes to the actual reply.
            thinkingConfig: { thinkingBudget: 0 },
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
