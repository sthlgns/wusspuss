// /api/extract-memory.js
//
// Secondary Gemini call. Given a short exchange, decide whether it contains
// anything worth remembering long-term (name, hobbies, favorite games,
// recurring interests, personal preferences, meaningful moments).
// Trivial small talk should yield nothing.
//
// Expects POST body:
// {
//   userText: string,
//   catReply: string,
//   existingMemories: string[]
// }
//
// Returns: { memories: string[] }  -- new memory lines to merge in, or [] if nothing meaningful.

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
    const { userText = '', catReply = '', existingMemories = [] } = req.body || {};

    // Skip the call entirely for very short / low-signal turns to save quota.
    if (!userText || userText.trim().length < 3) {
      res.status(200).json({ memories: [] });
      return;
    }

    const prompt = `You extract long-term memories for a cat companion app from one exchange.

The person said: "${userText}"
The cat (WussPuss) replied: "${catReply}"

Already known about this person:
${existingMemories.length ? existingMemories.map((m) => `- ${m}`).join('\n') : '(nothing yet)'}

Decide if this exchange contains anything genuinely worth remembering long-term:
- their name
- hobbies, favorite games, recurring interests
- personal preferences
- a meaningful or emotional moment worth recalling later

Ignore trivial small talk, greetings, or anything already known.

Respond with ONLY a JSON array of short factual strings (no more than 3 items, each under 12 words), with no markdown formatting, no code fences, and no extra text. If nothing is worth remembering, respond with exactly: []`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 150,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      res.status(200).json({ memories: [] });
      return;
    }

    const data = await geminiRes.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '[]';
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let memories = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        memories = parsed.filter((m) => typeof m === 'string' && m.trim().length > 0).slice(0, 3);
      }
    } catch {
      memories = [];
    }

    res.status(200).json({ memories });
  } catch (err) {
    console.error('extract-memory handler error:', err);
    res.status(200).json({ memories: [] });
  }
}
