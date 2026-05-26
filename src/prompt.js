import { PLATFORMS } from "./platforms.js";

// Builds a single-shot prompt instructing Grok to return strict JSON for one platform.
export function buildPrompt({ platformKey, draft, web }) {
  const p = PLATFORMS[platformKey];
  const algoLines = p.algo.map((l) => `- ${l}`).join("\n");

  const webNote = web
    ? "You may use web search to check current trends and trending hashtags."
    : "Do not use any tools. Rely on your own knowledge.";

  return `You are an expert social media growth strategist optimizing a post for the ${p.name} algorithm.

${p.name} algorithm facts to optimize for:
${algoLines}

Constraints: ${p.limit}
Hashtag guidance: ${p.hashtagGuidance}
${webNote}

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
  "notes": "<one or two sentences of extra advice>"
}

Provide exactly 3 rewrites (distinct styles), 4 hooks, and hashtags per the guidance above. Keep all post text within the platform character limit. Output JSON only.`;
}
