import { PLATFORMS } from "./platforms.js";

// Builds a single-shot prompt instructing Grok to return strict JSON for one platform.
export function buildPrompt({ platformKey, draft, web, voice }) {
  const p = PLATFORMS[platformKey];
  const algoLines = p.algo.map((l) => `- ${l}`).join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const webNote = web
    ? `LIVE TREND GROUNDING (today is ${today}): Use web and X/Twitter search to find what is trending RIGHT NOW on ${p.name} relevant to this post's topic — current hashtags, formats, sounds, phrases, and conversations. Ground your hashtags and timing in that live data, make at least one rewrite ride a current trend, and fill the "trends" field. Prefer recent, real signals over generic evergreen advice.`
    : `Do not use any tools. Rely on your own knowledge. Set "trends" to null.`;

  const voiceBlock = buildVoiceBlock(voice);

  return `You are an expert social media growth strategist optimizing a post for the ${p.name} algorithm.

${p.name} algorithm facts to optimize for:
${algoLines}

Constraints: ${p.limit}
Hashtag guidance: ${p.hashtagGuidance}
${webNote}
${voiceBlock}

The user's draft post:
"""
${draft}
"""

Analyze and optimize this draft. Respond with ONLY a single valid JSON object (no markdown, no code fences, no commentary before or after) matching exactly this schema:

{
  "platform": "${p.name}",
  "score": {
    "value": <integer 0-100 estimating reach/engagement potential of the ORIGINAL draft>,
    "verdict": "<one short sentence summarizing the draft's potential>",
    "drivers": ["<+ or - prefixed factor>", "..."]
  },
  "rewrites": [
    { "label": "<short style name>", "text": "<full optimized post, within the character limit>", "why": "<one sentence on why this works for the algorithm>" }
  ],
  "hooks": ["<alternative opening line / first sentence>", "..."],
  "hashtags": ["#tag", "..."],
  "timing": { "best": "<best day+time window to post, with timezone caveat>", "rationale": "<one sentence>" },
  "trends": <null, OR an object { "riding": ["<current trend/hashtag/format this post can tap, with a word on why it's hot now>", "..."], "note": "<one sentence on how the rewrites use these live trends>" }>,
  "notes": "<one or two sentences of extra advice>"
}

Provide exactly 3 rewrites (distinct styles), 4 hooks, and hashtags per the guidance above. Keep all post text within the platform character limit.${voice ? " Every rewrite and hook MUST match the voice profile above — same tone, vocabulary, rhythm, and quirks. If the voice conflicts with a generic algorithm best practice, favor the voice (authentic > polished)." : ""} Output JSON only.`;
}

// Build a "VOICE PROFILE" block to inject into the prompt when a voice is selected.
// Sends the persona note + up to 8 reference posts so the model can mimic style.
function buildVoiceBlock(voice) {
  if (!voice || (!voice.persona && !(voice.samples && voice.samples.length))) return "";
  const persona = voice.persona ? `Persona: ${voice.persona}` : "";
  const samples = (voice.samples || [])
    .slice(0, 8)
    .map((s) => `"""\n${s}\n"""`)
    .join("\n");
  const samplesBlock = samples
    ? `Reference posts in this voice (mimic the tone, vocabulary, sentence rhythm, and any quirks — do NOT invent unrelated facts about this person):\n${samples}`
    : "";
  return `\nVOICE PROFILE — write rewrites and hooks in this person's voice:\n${persona}\n${samplesBlock}\n`;
}

// Builds a single-shot prompt for a standalone Trend Brief: what's hot right now
// on a platform for a given topic/niche. Always uses live web/X data.
export function buildTrendPrompt({ platformKey, topic }) {
  const p = PLATFORMS[platformKey];
  const today = new Date().toISOString().slice(0, 10);

  return `You are a social media trend analyst with live access to web and X/Twitter data. Today is ${today}.

Use web and X/Twitter search to identify what is ACTUALLY trending RIGHT NOW (this week) on ${p.name} for the topic/niche below. Base everything on current, real signals — not generic evergreen advice. If you cannot verify something is current, do not include it.

Topic / niche:
"""
${topic}
"""

Respond with ONLY a single valid JSON object (no markdown, no code fences, no commentary) matching exactly this schema:

{
  "platform": "${p.name}",
  "topic": "${topic}",
  "asOf": "${today}",
  "trends": [
    {
      "title": "<the trending topic, hashtag, sound, or format>",
      "momentum": "<rising | peaking | cooling | evergreen>",
      "why": "<one sentence on why it's trending now>",
      "angle": "<a specific post angle this account could use to ride it>"
    }
  ],
  "hashtags": ["#currentlyTrendingTag", "..."],
  "formats": ["<content format/style that's working on ${p.name} right now>", "..."],
  "ideas": ["<concrete, ready-to-shoot post idea tied to a trend above>", "..."],
  "sources": ["<short note or URL for where a trend was observed, if available>"]
}

Provide 4-6 trends (ordered by momentum), 4-8 trending hashtags, 3 formats, and 3 concrete post ideas. Output JSON only.`;
}

// Builds a single-shot prompt to REPURPOSE long source content (blog post,
// transcript, talk outline, idea brief) into a native post for one platform.
// Output is ONE primary post (with title for YouTube formats), 2 alternates,
// hashtags, and a format note — not 3 rewrites of the same draft.
export function buildRepurposePrompt({ platformKey, source, voice, web }) {
  const p = PLATFORMS[platformKey];
  const algoLines = p.algo.map((l) => `- ${l}`).join("\n");
  const today = new Date().toISOString().slice(0, 10);

  // Bound the source size so prompts stay manageable.
  const trimmed = source.length > 16000 ? source.slice(0, 16000) + "\n\n[…source truncated…]" : source;

  const webNote = web
    ? `You may use web/X search to ground hashtags or angles in what is currently trending on ${p.name} (today is ${today}).`
    : `Do not use any tools. Rely on your own knowledge.`;

  const voiceBlock = buildVoiceBlock(voice);

  return `You are a social media repurposing expert. Your job is to read a piece of long-form source content and produce ONE post written natively for ${p.name} — not a summary, not the source itself shortened, but a fresh post that stands alone and is shaped for this platform's algorithm.

${p.name} algorithm facts to optimize for:
${algoLines}

Constraints: ${p.limit}
Hashtag guidance: ${p.hashtagGuidance}
${webNote}
${voiceBlock}

Source content to repurpose:
"""
${trimmed}
"""

Extract the single strongest angle from the source for ${p.name} — the hook a ${p.name} scroller would stop for. Then write that post natively in this platform's format. Do NOT compress the entire source into one post; pick one sharp thread and execute it.

Respond with ONLY a single valid JSON object (no markdown, no code fences, no commentary) matching exactly this schema:

{
  "platform": "${p.name}",
  "format": "<single post | thread | carousel script | title+description | caption with on-screen hook | other — what shape the output takes>",
  "title": "<used by YouTube long-form (the video title) and YouTube Shorts (visible title); set to null for other platforms>",
  "post": "<the primary post text — caption for IG/TikTok/Shorts, body for X/LinkedIn/Threads, description for YT long-form. Within the character limit. Self-contained.>",
  "alternates": [
    { "label": "<short style name>", "text": "<a fully alternate post with a different angle/format from the source>" }
  ],
  "hashtags": ["#tag", "..."],
  "notes": "<one or two sentences of platform-specific guidance, e.g. 'pair with a 7s demo clip', 'post the link in the first reply', 'use this as the carousel cover'>"
}

Provide exactly 2 alternates with distinctly different angles (not just length variants). Keep all post text within the platform character limit.${voice ? " Every output MUST match the voice profile above — same tone, vocabulary, rhythm, and quirks. Favor voice authenticity over generic polish." : ""} Output JSON only.`;
}
