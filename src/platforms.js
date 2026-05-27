// Platform-specific algorithm heuristics injected into the Grok prompt.
// These describe what each platform's ranking system rewards so Grok can
// optimize accordingly.

export const PLATFORMS = {
  x: {
    name: "X (Twitter)",
    limit: "280 characters per post (threads allowed)",
    algo: [
      "Rewards replies and reposts far more than likes; conversation-driving posts win.",
      "Strong first line matters — most impressions come from the timeline preview.",
      "Outbound links suppress reach; put links in a reply instead.",
      "1-2 well-chosen hashtags max; more looks spammy and hurts reach.",
      "Posts that keep users on-platform (native media, threads, polls) get boosted.",
      "Avoid obvious engagement-bait phrasing ('like if', 'RT if') — it's penalized.",
    ],
    hashtagGuidance: "0-2 highly relevant hashtags.",
  },
  instagram: {
    name: "Instagram",
    limit: "2,200 character caption (first ~125 chars show before 'more').",
    algo: [
      "Saves and shares are the strongest ranking signals, then comments, then likes.",
      "First line must hook before the '...more' cutoff (~125 chars).",
      "Captions that prompt a save ('save this for later') or a comment perform well.",
      "Mix of broad + niche hashtags; 3-8 relevant tags outperform 30 generic ones.",
      "Keywords in the caption now feed SEO/discovery, not just hashtags.",
      "Carousels and Reels get more reach than single images.",
    ],
    hashtagGuidance: "3-8 mixed broad+niche hashtags.",
  },
  tiktok: {
    name: "TikTok",
    limit: "2,200 character caption; but short punchy captions perform best.",
    algo: [
      "Watch time and completion rate dominate; the caption's job is to stop the scroll and tease.",
      "First 1-2 seconds / first words must create a curiosity gap.",
      "Comments and shares are heavily weighted; ask a question or invite duets.",
      "3-5 specific hashtags blending a trend tag with niche tags; avoid #fyp spam.",
      "Captions double as search SEO — include the literal phrase people would search.",
      "Keep captions short and punchy; let the hook do the work.",
    ],
    hashtagGuidance: "3-5 specific hashtags (trend + niche).",
  },
  linkedin: {
    name: "LinkedIn",
    limit: "3,000 character post; only the first ~140 chars show before 'see more'.",
    algo: [
      "Dwell time is the dominant signal — long-reads and carousels that hold attention win.",
      "First 1-2 lines must hook before the 'see more' cutoff (~140 chars).",
      "Outbound links in the post body suppress reach; put the link in the first comment.",
      "Comments (especially thoughtful, multi-word replies) outweigh likes; end with a question.",
      "An early 'golden hour' test sends to a small audience first — fast early engagement matters.",
      "Short single-line paragraphs increase readability and scroll dwell.",
      "Professional, insight-driven tone; native docs/carousels and polls keep users on-platform.",
    ],
    hashtagGuidance: "3-5 professional, relevant hashtags.",
  },
  youtube: {
    name: "YouTube (title + description)",
    limit: "Title up to 100 chars (~60 visible); description up to 5,000 chars, first ~150 chars + 3 lines are critical.",
    algo: [
      "Click-through rate (title + thumbnail) and watch time are the dominant ranking signals.",
      "Title must create a curiosity gap AND contain the exact phrase people search for.",
      "Front-load the primary keyword in the title and in the first line of the description.",
      "First 2-3 description lines (above 'show more') should hook and restate the keyword.",
      "Descriptions feed search — write naturally with related keywords, not keyword stuffing.",
      "First 3 hashtags render above the title; add chapters/timestamps and a watch CTA.",
    ],
    hashtagGuidance: "3-5 hashtags (the first 3 appear above the title).",
  },
  "youtube-shorts": {
    name: "YouTube Shorts",
    limit: "Title up to 100 chars; keep it short and punchy. Caption is secondary to the on-screen hook.",
    algo: [
      "Swipe-away vs. watched is the dominant signal — the first 1-2 seconds must stop the scroll.",
      "Average view duration and loops/replays drive distribution; tease a payoff to keep people watching.",
      "Title must create a curiosity gap AND include the phrase people would search.",
      "Comments and shares are strongly weighted; ask a quick question or invite a reaction.",
      "2-4 relevant hashtags; a niche tag helps discovery (the #Shorts tag is now optional, not required).",
      "Front-load searchable keywords — Shorts surface in both the Shorts feed and YouTube search.",
    ],
    hashtagGuidance: "2-4 relevant hashtags (niche tag helps; #Shorts optional).",
  },
  threads: {
    name: "Threads",
    limit: "500 characters per post.",
    algo: [
      "Replies and reposts are the strongest signals; the goal is to start a conversation.",
      "Casual, conversational, opinionated tone outperforms polished marketing copy.",
      "Open with a hot take or a question that's easy and inviting to answer.",
      "Links get reduced distribution; lead with the idea, not the URL.",
      "Recency plus fast early engagement drives the for-you feed.",
      "Supports a single topic tag rather than many hashtags — keep it focused.",
    ],
    hashtagGuidance: "0-1 topic tag (Threads supports one topic tag, not hashtag spam).",
  },
  bluesky: {
    name: "Bluesky",
    limit: "300 characters per post (threads supported via reply chains).",
    algo: [
      "Default feed is reverse-chronological — the Discover feed and community 'custom feeds' are where algorithmic reach lives.",
      "Custom feeds curate by tag/keyword — 1-3 specific tags help your post surface in the right niche feeds.",
      "Early engagement velocity (likes + reposts in the first hour) drives the Discover feed.",
      "Replies and quote-posts amplify reach and keep posts visible; ask a real question.",
      "Audience leans tech/journalism/academic — witty, substantive, conversational beats marketing speak.",
      "Outbound links are NOT suppressed (unlike X) — link freely, but the idea should still stand alone.",
      "Image and video posts outperform text-only in most custom feeds; alt text matters for accessibility-focused community.",
    ],
    hashtagGuidance: "1-3 specific topic tags (used to target custom feeds, not for discovery spam).",
  },
};

export const PLATFORM_ALIASES = {
  x: "x",
  twitter: "x",
  ig: "instagram",
  insta: "instagram",
  instagram: "instagram",
  tiktok: "tiktok",
  tt: "tiktok",
  linkedin: "linkedin",
  li: "linkedin",
  youtube: "youtube",
  yt: "youtube",
  "youtube-shorts": "youtube-shorts",
  shorts: "youtube-shorts",
  ytshorts: "youtube-shorts",
  yts: "youtube-shorts",
  threads: "threads",
  bluesky: "bluesky",
  bsky: "bluesky",
};

export function resolvePlatform(input) {
  const key = String(input).trim().toLowerCase();
  return PLATFORM_ALIASES[key] || null;
}
