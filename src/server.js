#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PLATFORMS, resolvePlatform } from "./platforms.js";
import { buildPrompt, buildTrendPrompt, buildRepurposePrompt, buildPersonaPrompt, buildPlanPrompt } from "./prompt.js";
import { fetchPostsFor, compositeScore } from "./ingest.js";
import { runGrok, extractJson } from "./grok.js";
import { listVoices, getVoice, saveVoice, deleteVoice, validateName } from "./voices.js";
import {
  listDatasets, getDataset, saveDataset, deleteDataset,
  validateName as validatePerfName, topRecords,
} from "./performance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 3000;

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}
const json = (res, status, obj) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(obj));

// Load a performance dataset and return a payload for the prompt — only if its
// platform tag matches the platform being optimized (mismatched data would hurt,
// not help). Returns null if the dataset doesn't apply.
async function loadPerformanceFor(name, platformKey) {
  if (!name) return null;
  let d;
  try { d = await getDataset(name); } catch { return null; }
  if (!d) return null;
  if (d.platform && d.platform !== platformKey) return null;
  return {
    name: d.name,
    displayName: d.displayName,
    scoreLabel: d.scoreLabel,
    records: topRecords(d, 5),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(join(PUBLIC, "index.html"));
      return send(res, 200, "text/html; charset=utf-8", html);
    }

    if (req.method === "GET" && url.pathname === "/api/platforms") {
      const list = Object.entries(PLATFORMS).map(([key, v]) => ({
        key,
        name: v.name,
        hashtags: v.hashtagGuidance,
      }));
      return json(res, 200, list);
    }

    if (req.method === "POST" && url.pathname === "/api/optimize") {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        return json(res, 400, { error: "Invalid JSON body." });
      }
      const draft = (parsed.draft || "").trim();
      const key = resolvePlatform(parsed.platform || "");
      const web = !!parsed.web;
      if (!draft) return json(res, 400, { error: "Missing draft text." });
      if (!key) return json(res, 400, { error: `Unknown platform "${parsed.platform}".` });

      let voice = null;
      if (parsed.voice) {
        try {
          voice = await getVoice(parsed.voice);
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
        if (!voice) return json(res, 400, { error: `Voice "${parsed.voice}" not found.` });
      }
      const performance = await loadPerformanceFor(parsed.performance, key);

      const prompt = buildPrompt({ platformKey: key, draft, web, voice, performance });
      const text = await runGrok(prompt, { web, maxTurns: web ? 20 : undefined });
      const data = extractJson(text);
      if (!data.platform) data.platform = PLATFORMS[key].name;
      if (voice) data.voice = voice.displayName || voice.name;
      if (performance) data.performance = performance.displayName || performance.name;
      return json(res, 200, { result: data });
    }

    if (req.method === "POST" && url.pathname === "/api/ingest/voice") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "Invalid JSON body." }); }
      const platformKey = resolvePlatform(parsed.platform || "");
      if (!platformKey) return json(res, 400, { error: `Unknown platform "${parsed.platform}".` });
      if (!parsed.handle) return json(res, 400, { error: "Missing handle." });
      if (!parsed.name) return json(res, 400, { error: "Missing voice name." });
      try {
        const { posts, handle } = await fetchPostsFor(platformKey, parsed.handle);
        if (!posts.length) return json(res, 400, { error: `No public posts found for @${handle}.` });

        // Ask Grok to pick representative samples and write the persona.
        const personaPrompt = buildPersonaPrompt({
          handle, platformName: PLATFORMS[platformKey].name, posts,
        });
        const personaText = await runGrok(personaPrompt, { web: false });
        const analysis = extractJson(personaText);
        const idxs = Array.isArray(analysis.sampleIndexes) ? analysis.sampleIndexes : [];
        const samples = idxs
          .map((i) => posts[Number(i) - 1]?.text)
          .filter(Boolean)
          .slice(0, 12);
        // Fallback: if Grok returned no usable indexes, use the top-by-engagement posts.
        const finalSamples = samples.length
          ? samples
          : [...posts].sort((a, b) => compositeScore(b) - compositeScore(a)).slice(0, 10).map((p) => p.text);

        const saved = await saveVoice({
          name: parsed.name,
          displayName: parsed.displayName || `@${handle} (${platformKey})`,
          persona: String(analysis.persona || "").trim(),
          samples: finalSamples,
        });
        return json(res, 200, {
          saved,
          fetched: posts.length,
          samplesPicked: finalSamples.length,
          handle,
        });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/ingest/performance") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "Invalid JSON body." }); }
      const platformKey = resolvePlatform(parsed.platform || "");
      if (!platformKey) return json(res, 400, { error: `Unknown platform "${parsed.platform}".` });
      if (!parsed.handle) return json(res, 400, { error: "Missing handle." });
      if (!parsed.name) return json(res, 400, { error: "Missing dataset name." });
      try {
        const { posts, handle } = await fetchPostsFor(platformKey, parsed.handle);
        if (!posts.length) return json(res, 400, { error: `No public posts found for @${handle}.` });

        // Build a CSV string from the fetched posts and reuse saveDataset's CSV pipeline,
        // which gives us the same auto-detection + scoreLabel as manual import.
        const lines = ["post,likes,reposts,replies"];
        for (const p of posts) {
          const cell = `"${String(p.text).replace(/"/g, '""')}"`;
          lines.push(`${cell},${p.likes ?? 0},${p.reposts ?? 0},${p.replies ?? 0}`);
        }
        const csv = lines.join("\n");
        const saved = await saveDataset({
          name: parsed.name,
          displayName: parsed.displayName || `@${handle} (${platformKey})`,
          platform: platformKey,
          csv,
        });
        return json(res, 200, { saved, fetched: posts.length, handle });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/performance") {
      return json(res, 200, await listDatasets());
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/performance/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/performance/".length));
      try {
        const d = await getDataset(name);
        if (!d) return json(res, 404, { error: "Not found" });
        // Don't ship every record back over the wire on list views — return summary + top 5.
        return json(res, 200, {
          ...d,
          records: d.records,
          top: topRecords(d, 5),
        });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/performance") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "Invalid JSON body." }); }
      try {
        const saved = await saveDataset(parsed);
        return json(res, 200, saved);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/performance/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/performance/".length));
      try {
        validatePerfName(name);
        const ok = await deleteDataset(name);
        return json(res, ok ? 200 : 404, { ok });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/voices") {
      return json(res, 200, await listVoices());
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/voices/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/voices/".length));
      try {
        const v = await getVoice(name);
        if (!v) return json(res, 404, { error: "Not found" });
        return json(res, 200, v);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/voices") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "Invalid JSON body." }); }
      try {
        const saved = await saveVoice(parsed);
        return json(res, 200, saved);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/voices/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/voices/".length));
      try {
        validateName(name);
        const ok = await deleteVoice(name);
        return json(res, ok ? 200 : 404, { ok });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/plan") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "Invalid JSON body." }); }
      const topic = (parsed.topic || "").trim();
      const key = resolvePlatform(parsed.platform || "");
      const web = !!parsed.web;
      if (!topic) return json(res, 400, { error: "Missing topic." });
      if (!key) return json(res, 400, { error: `Unknown platform "${parsed.platform}".` });

      let voice = null;
      if (parsed.voice) {
        try { voice = await getVoice(parsed.voice); } catch (e) { return json(res, 400, { error: e.message }); }
        if (!voice) return json(res, 400, { error: `Voice "${parsed.voice}" not found.` });
      }
      const performance = await loadPerformanceFor(parsed.performance, key);

      const prompt = buildPlanPrompt({ platformKey: key, topic, voice, performance, web });
      // A 7-day plan is a big single output; give Grok enough turns to think and
      // (optionally) search before assembling. 25 is plenty without web; 40 with.
      const text = await runGrok(prompt, { web, maxTurns: web ? 40 : 25 });
      const data = extractJson(text);
      if (!data.platform) data.platform = PLATFORMS[key].name;
      if (voice) data.voice = voice.displayName || voice.name;
      if (performance) data.performance = performance.displayName || performance.name;
      return json(res, 200, { result: data });
    }

    if (req.method === "POST" && url.pathname === "/api/repurpose") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "Invalid JSON body." }); }
      const source = (parsed.source || "").trim();
      const key = resolvePlatform(parsed.platform || "");
      const web = !!parsed.web;
      if (!source) return json(res, 400, { error: "Missing source content." });
      if (!key) return json(res, 400, { error: `Unknown platform "${parsed.platform}".` });

      let voice = null;
      if (parsed.voice) {
        try { voice = await getVoice(parsed.voice); } catch (e) { return json(res, 400, { error: e.message }); }
        if (!voice) return json(res, 400, { error: `Voice "${parsed.voice}" not found.` });
      }
      const performance = await loadPerformanceFor(parsed.performance, key);

      const prompt = buildRepurposePrompt({ platformKey: key, source, voice, web, performance });
      const text = await runGrok(prompt, { web, maxTurns: web ? 20 : undefined });
      const data = extractJson(text);
      if (!data.platform) data.platform = PLATFORMS[key].name;
      if (voice) data.voice = voice.displayName || voice.name;
      if (performance) data.performance = performance.displayName || performance.name;
      return json(res, 200, { result: data });
    }

    if (req.method === "POST" && url.pathname === "/api/trends") {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        return json(res, 400, { error: "Invalid JSON body." });
      }
      const topic = (parsed.topic || "").trim();
      const key = resolvePlatform(parsed.platform || "");
      if (!topic) return json(res, 400, { error: "Missing topic." });
      if (!key) return json(res, 400, { error: `Unknown platform "${parsed.platform}".` });

      const prompt = buildTrendPrompt({ platformKey: key, topic });
      // Trend Brief is research-heavy; give Grok enough turns to do multiple searches
      // before it has to produce the final JSON, otherwise it runs out and returns empty.
      // 50 leaves headroom even if a search tool fails and triggers retries.
      const text = await runGrok(prompt, { web: true, maxTurns: 50 });
      const data = extractJson(text);
      if (!data.platform) data.platform = PLATFORMS[key].name;
      return json(res, 200, { result: data });
    }

    return send(res, 404, "text/plain", "Not found");
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`social-optimizer web UI → http://localhost:${PORT}\n`);
});
