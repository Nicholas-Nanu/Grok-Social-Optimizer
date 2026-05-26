import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Locate the grok binary. Prefer PATH; fall back to the default install location.
function grokBinary() {
  const fromEnv = process.env.GROK_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const win = join(homedir(), ".grok", "bin", "grok.exe");
  if (existsSync(win)) return win;
  const nix = join(homedir(), ".grok", "bin", "grok");
  if (existsSync(nix)) return nix;
  return "grok"; // hope it's on PATH
}

// Run a single-shot Grok prompt and return its text response.
export function runGrok(prompt, { web = false, model, effort } = {}) {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--no-plan",
    "--no-subagents",
  ];
  if (effort) args.push("--effort", effort);
  if (!web) args.push("--disable-web-search");
  if (model) args.push("--model", model);

  const bin = grokBinary();

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `Could not find the grok CLI. Install it from https://x.ai/cli or set GROK_BIN to its path.`
          )
        );
      } else {
        reject(err);
      }
    });

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`grok exited with code ${code}.\n${stderr.trim() || stdout.trim()}`)
        );
        return;
      }
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        reject(new Error(`Could not parse grok output as JSON:\n${stdout.slice(0, 500)}`));
        return;
      }
      resolve(envelope.text ?? "");
    });
  });
}

// Extract a JSON object from model text that may contain stray prose or code fences.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in Grok response.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
