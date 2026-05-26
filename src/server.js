#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PLATFORMS, resolvePlatform } from "./platforms.js";
import { buildPrompt, buildTrendPrompt } from "./prompt.js";
import { runGrok, extractJson } from "./grok.js";
import { listVoices, getVoice, saveVoice, deleteVoice, validateName } from "./voices.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 3000;

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}
const json = (res, status, obj) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(obj));

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

      const prompt = buildPrompt({ platformKey: key, draft, web, voice });
      const text = await runGrok(prompt, { web });
      const data = extractJson(text);
      if (!data.platform) data.platform = PLATFORMS[key].name;
      if (voice) data.voice = voice.displayName || voice.name;
      return json(res, 200, { result: data });
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
      const text = await runGrok(prompt, { web: true });
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
