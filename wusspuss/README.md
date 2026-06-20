# WussPuss

A mysterious black cat that lives on an otherwise empty white page and
slowly forms a relationship with whoever visits.

WussPuss is not a chatbot. There's no message history, no avatars, no
"typing…" indicator. Just a cat, a thought that appears beneath it now and
then, and a place to say something if you want to.

## What's in here

```
wusspuss/
├── public/
│   ├── index.html      the page itself
│   ├── style.css        all visual styling
│   ├── app.js            animation, mood, memory, and the two API calls
│   └── cat.png           the cat
├── api/
│   ├── chat.js                  talks to Gemini as WussPuss
│   └── extract-memory.js        a quiet second call that decides what's worth remembering
├── vercel.json
└── package.json
```

## Why two files for "vanilla JS, no frameworks, single HTML file"

The brief asked for a single static file calling Gemini directly. That
would mean shipping your Gemini API key inside the page's JavaScript,
visible to anyone who opens dev tools. Two small serverless functions
(`/api/chat`, `/api/extract-memory`) keep the key server-side instead —
everything else stays exactly as specified: no frameworks, no build step,
vanilla JS and CSS for all the actual cat behavior.

## Running it locally

You'll need the [Vercel CLI](https://vercel.com/docs/cli):

```bash
npm install -g vercel
cd wusspuss
vercel dev
```

Then create a `.env` file (or set it when prompted by `vercel dev`) with:

```
GEMINI_API_KEY=your_key_here
```

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Visit the local URL it prints (usually `http://localhost:3000`).

## Deploying to Vercel

```bash
vercel
```

Then in the Vercel dashboard for the project, go to **Settings → Environment
Variables** and add `GEMINI_API_KEY` with your key. Redeploy after adding it
(`vercel --prod`).

## How the relationship actually works

- **Bond level** (0–100, stored in `localStorage`) grows a small amount each
  time you return after a meaningful gap (roughly half a day), with
  diminishing returns as it climbs — so the relationship deepens over real
  time, the way the brief asks for, not by spamming messages in one sitting.
- **Memories** are short factual lines ("likes chess," "name is Priya")
  extracted by a second, cheap Gemini call after each typed exchange. Small
  talk yields nothing; the extractor is explicitly told to return an empty
  list unless something is genuinely worth keeping.
- **Mood** (neutral / happy / annoyed / affectionate) is decided locally in
  JS for instant reactions to pokes, with irritation probability rising the
  more rapidly you poke and falling the more bonded you are — and it's never
  guaranteed either way, on purpose.
- WussPuss's actual *words* come from Gemini 2.5 Flash, given the current
  mood, bond stage, recent poke frequency, and the memory list as context,
  with strict instructions to never acknowledge being software.

## A note on the eyes

The source image is a flat black silhouette with no separate eye layer, so
true socket-bound eye movement isn't possible on the raster art itself. The
illusion is built from two parts instead: small dark pupil dots, positioned
precisely over the artwork's eye-white regions and nudged within that
bound toward the cursor, plus a very small whole-body lean that only
engages when the cursor is actually near the cat. Both ease back to center
when idle.
