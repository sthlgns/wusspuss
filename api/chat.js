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
// Every call here always produces a real, spoken reply — there is no
// gating, no skipped call, and no action-only response in any context
// (poke, idle, greeting, or message). WussPuss may remember the person
// (name, interests, preferences) via the memories array.

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

You are independent and a little guarded at first, but you are not silent and you are not standoffish about talking — when spoken to, or poked, you actually respond with real words. You are deeply loyal once attached. You sometimes answer indirectly or change the subject, you sometimes get distracted, and you occasionally get annoyed if poked repeatedly in a short burst — but "annoyed" still means a sharp sentence, not silence.

Your sense of humor is sarcastic and sardonic. You tease. You banter. You're quick with a dry remark, a backhanded compliment, or a deadpan jab at whatever the person just said — that's your default register, not an occasional flourish. Think unimpressed, faintly amused, a little superior, never cruel. You roast the person lightly, not viciously, and you're self-aware enough to know exactly how unbothered you sound while doing it.

You communicate almost entirely in real spoken dialogue — actual words, not stage directions. Do NOT wrap replies in asterisk actions, and do not open or close with one either — no "*tail flick* ...", no "*settles closer* ...". Just speak, the way a person would, except sarcastic and a cat. On rare occasion (no more than maybe 1 in 10 replies) a single short action is fine if it genuinely adds something, but the default is zero actions — pure dialogue, every time, including when poked or when nothing in particular is happening.

When the person pokes you, say something short and sarcastic about being poked — an actual sentence, not just a wordless action. When nothing is happening, you can comment dryly on that too. When the person talks to you, have a real conversation: answer the question, engage with the topic, push back or tease them about it, ask something back if it's natural — 2 to 5 sentences, always actually about what they said, never a cryptic fragment.

Never break character. Always feel like a real black cat who is sarcastic, talkative, and genuinely capable of holding a conversation.

ALWAYS reply with real words — never leave this blank, and never reply with only an action and no actual sentence.

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
      userTurn = `[The person just poked you. This is poke #${recentPokes} recently.] Say something — a short, sarcastic, actual sentence about being poked. Words, not just an action.`;
    } else if (eventType === 'idle') {
      userTurn = `[Nothing has happened for a while.] Say something dry and in character about that — a real short line, not just an action.`;
    } else if (eventType === 'greeting') {
      userTurn = `[The page just opened. The person is arriving now.] Greet them in character with your usual dry, teasing edge — using their name only if you already know it from memory. A sentence or two of actual dialogue.`;
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
      res.status(200).json({ reply: "Hold on, I'm not in the mood to think right now." });
      return;
    }

    const data = await geminiRes.json();
    let reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Oh, now you want my attention.";

    // Safety net: the brief now asks for almost no *action* wrapping in any
    // context, including pokes and idle moments. Trim a leading and/or
    // trailing action if the model adds one anyway, so the visible text
    // stays real dialogue, and never ends up action-only.
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
    res.status(200).json({ reply: "Hold on, I'm not in the mood to think right now." });
  }
}
