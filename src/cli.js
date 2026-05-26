#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { PLATFORMS, resolvePlatform } from "./platforms.js";
import { buildPrompt } from "./prompt.js";
import { runGrok, extractJson } from "./grok.js";
import { renderReport, log } from "./render.js";

const HELP = `
optimize — tune a social post for the platform algorithm using Grok

Usage:
  optimize [options] "<your draft post>"
  echo "<draft>" | optimize -p tiktok
  optimize -f draft.txt -p x,instagram,tiktok

Options:
  -p, --platform <list>  Comma-separated: x, instagram, tiktok (default: x)
  -f, --file <path>      Read the draft from a file
  -w, --web              Let Grok use web search for current trends (slower)
  -m, --model <id>       Override the Grok model
  -e, --effort <level>   Grok effort: low|medium|high|xhigh|max (only works with
                         models that support it; the default model does not)
      --json             Print raw JSON results instead of a formatted report
  -h, --help             Show this help

Examples:
  optimize -p x,tiktok "shipping our new feature today, check it out https://x.com/y"
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
    log.error("No draft post provided.");
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

  log.info(
    `Optimizing for ${platformKeys.map((k) => PLATFORMS[k].name).join(", ")} via Grok…`
  );

  const tasks = platformKeys.map(async (platformKey) => {
    const prompt = buildPrompt({ platformKey, draft, web: values.web });
    const text = await runGrok(prompt, {
      web: values.web,
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
    for (const r of results) process.stdout.write(renderReport(r) + "\n");
  }
}

main().catch((e) => {
  log.error(e.message);
  process.exit(1);
});
