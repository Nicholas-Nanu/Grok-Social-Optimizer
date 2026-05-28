// Fetchers that pull a user's recent posts from public sources, so we can
// auto-build voice profiles and performance datasets without manual paste.
//
// Bluesky: uses the official public AppView API (zero auth, real metrics).
// X (Twitter): uses Grok itself as the fetcher — Grok's X access is the
// thing it has that other LLMs don't, so we lean on it.

import { runGrok, extractJson } from "./grok.js";

// ── Bluesky ──────────────────────────────────────────────────────────────

const BSKY_HOST = "https://public.api.bsky.app";

// Normalize anything the user might paste into a bare AT-Protocol handle.
// Accepts: "jay.bsky.team", "@jay.bsky.team", "https://bsky.app/profile/jay.bsky.team"
export function normalizeBlueskyHandle(input) {
  if (!input) throw new Error("Missing Bluesky handle.");
  let h = String(input).trim();
  h = h.replace(/^https?:\/\/(www\.)?bsky\.app\/profile\//i, "");
  h = h.replace(/^@/, "");
  h = h.split(/[?#/]/)[0].trim().toLowerCase();
  if (!h) throw new Error("Empty Bluesky handle after normalization.");
  if (!/\./.test(h)) {
    // Bare username without a dotted handle — assume the default .bsky.social domain.
    h = `${h}.bsky.social`;
  }
  return h;
}

// Fetch up to `limit` recent original posts (no replies, no reposts) for a handle.
// Returns [{ text, likes, reposts, replies, indexedAt, uri }].
export async function fetchBluesky(handleRaw, limit = 30) {
  const handle = normalizeBlueskyHandle(handleRaw);
  const url =
    `${BSKY_HOST}/xrpc/app.bsky.feed.getAuthorFeed?` +
    `actor=${encodeURIComponent(handle)}&limit=${limit}&filter=posts_no_replies`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = "";
    try { detail = " — " + (await res.text()).slice(0, 200); } catch {}
    throw new Error(`Bluesky API ${res.status}${detail}`);
  }
  const data = await res.json();
  const items = Array.isArray(data?.feed) ? data.feed : [];
  return items
    .filter((it) => it?.post?.record?.text && !it.reason) // drop reposts (have `reason`)
    .map((it) => ({
      text: String(it.post.record.text).trim(),
      likes: Number(it.post.likeCount || 0),
      reposts: Number(it.post.repostCount || 0),
      replies: Number(it.post.replyCount || 0),
      indexedAt: it.post.indexedAt || null,
      uri: it.post.uri || null,
    }))
    .filter((p) => p.text);
}

// ── X (Twitter) via Grok ─────────────────────────────────────────────────

export function normalizeXHandle(input) {
  if (!input) throw new Error("Missing X handle.");
  let h = String(input).trim();
  h = h.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "");
  h = h.replace(/^@/, "");
  h = h.split(/[?#/]/)[0].trim();
  if (!h) throw new Error("Empty X handle after normalization.");
  return h;
}

// Ask Grok to fetch a user's recent original posts from X. We lean on its X access
// instead of trying to scrape (X blocks anonymous reads).
export async function fetchX(handleRaw, limit = 25) {
  const handle = normalizeXHandle(handleRaw);
  const prompt = `You have live web and X search. Fetch the ${limit} most recent ORIGINAL posts (not replies, not reposts/retweets) from @${handle} on x.com. Use only what is currently visible on the public profile.

Return ONLY a single JSON object (no markdown, no commentary). Schema:

{
  "handle": "${handle}",
  "posts": [
    { "text": "the post text", "likes": <int or null if not visible>, "reposts": <int or null>, "replies": <int or null>, "indexedAt": "<ISO date or null>" }
  ]
}

If the account doesn't exist, is private, or has no public posts, return { "handle": "${handle}", "posts": [], "error": "<short reason>" }. Never invent posts or metrics. Output JSON only.`;

  const text = await runGrok(prompt, { web: true });
  const data = extractJson(text);
  if (data?.error) throw new Error(`X fetch via Grok: ${data.error}`);
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  return posts
    .map((p) => ({
      text: String(p.text || "").trim(),
      likes: p.likes == null ? null : Number(p.likes),
      reposts: p.reposts == null ? null : Number(p.reposts),
      replies: p.replies == null ? null : Number(p.replies),
      indexedAt: p.indexedAt || null,
    }))
    .filter((p) => p.text);
}

// ── Dispatcher ───────────────────────────────────────────────────────────

// Returns { posts, handle } for a given platform key.
export async function fetchPostsFor(platformKey, handle, limit) {
  if (platformKey === "bluesky") {
    const posts = await fetchBluesky(handle, limit || 30);
    return { posts, handle: normalizeBlueskyHandle(handle) };
  }
  if (platformKey === "x") {
    const posts = await fetchX(handle, limit || 25);
    return { posts, handle: normalizeXHandle(handle) };
  }
  throw new Error(
    `Auto-ingest not yet supported for "${platformKey}". Use CSV import for that platform.`
  );
}

// Compute a composite engagement score per post (likes + reposts + replies).
// Returns numeric 0 if any metric is missing.
export function compositeScore(p) {
  return (Number(p.likes) || 0) + (Number(p.reposts) || 0) + (Number(p.replies) || 0);
}
