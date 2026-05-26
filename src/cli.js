#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { PLATFORMS, resolvePlatform } from "./platforms.js";
import { buildPrompt, buildTrendPrompt } from "./prompt.js";
import { runGrok, extractJson } from "./grok.js";
import { renderReport, renderTrendBrief, log } from "./render.js";

const HELP = `
optimize — tune a social post for the platform algorithm using Grok

Usage:
  optimize [options] "<your draft post>"
  echo "<draft>" | optimize -p tiktok
  optimize -f draft.txt -p x,instagram,tiktok
  optimize --trends -p tiktok "<topic or niche>"

Options:
  -p, --platform <list>  Comma-separated, e.g. x,instagram,tiktok (default: x)
  -f, --file <path>      Read the draft (or topic) from a file
  -w, --web              Let Grok pull live trends and ground the post in them (slower)
      --trends           Trend Brief mode: what's hot now for a topic (implies --web)
  -m, --model <id>       Override the Grok model
  -e, --effort <level>   Grok effort: low|medium|high|xhigh|max (only works with
                         models that support it; the default model does not)
      --json             Print raw JSON results instead of a formatted report
  -h, --help             Show this help

Examples:
  optimize -p x,tiktok "shipping our new feature today"
  optimize -w -p instagram "our spring sale starts Friday"
  optimize --trends -p tiktok,youtube-shorts "home espresso"
`;

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        platform: { type: "string", short: "p" },
        file: { type: "string", short: "f" },
        web: { type: "boolean", short: "w", default: false },
        trends: { type: "boolean", default: false },
        model: { type: "string", short: "m" },
        effort: { type: "string", short: "e" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (e) {
    log.error(e.message);
    process.stderr.write(HELP);
    process.exit(2);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  // Resolve the draft: file > positional > stdin.
  let draft = "";
  if (values.file) {
    try {
      draft = readFileSync(values.file, "utf8").trim();
    } catch {
      log.error(`Could not read file: ${values.file}`);
      process.exit(1);
    }
  } else if (positionals.length) {
    draft = positionals.join(" ").trim();
  } else {
    draft = await readStdin();
  }

  if (!draft) {
    log.error(values.trends ? "No topic provided." : "No draft post provided.");
    process.stderr.write(HELP);
    process.exit(1);
  }

  // Resolve platforms.
  const requested = (values.platform || "x")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const platformKeys = [];
  for (const r of requested) {
    const key = resolvePlatform(r);
    if (!key) {
      log.error(`Unknown platform "${r}". Valid: ${Object.keys(PLATFORMS).join(", ")}`);
      process.exit(1);
    }
    if (!platformKeys.includes(key)) platformKeys.push(key);
  }

  const names = platformKeys.map((k) => PLATFORMS[k].name).join(", ");
  log.info(
    values.trends
      ? `Finding live trends on ${names} via Grok…`
      : `Optimizing for ${names} via Grok…`
  );

  const tasks = platformKeys.map(async (platformKey) => {
    const prompt = values.trends
      ? buildTrendPrompt({ platformKey, topic: draft })
      : buildPrompt({ platformKey, draft, web: values.web });
    const text = await runGrok(prompt, {
      web: values.trends || values.web,
      model: values.model,
      effort: values.effort,
    });
    const data = extractJson(text);
    if (!data.platform) data.platform = PLATFORMS[platformKey].name;
    return data;
  });

  const settled = await Promise.allSettled(tasks);

  const results = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      log.error(`${PLATFORMS[platformKeys[i]].name}: ${s.reason.message}`);
    }
  }

  if (!results.length) process.exit(1);

  if (values.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    const render = values.trends ? renderTrendBrief : renderReport;
    for (const r of results) process.stdout.write(render(r) + "\n");
  }
}

main().catch((e) => {
  log.error(e.message);
  process.exit(1);
});
