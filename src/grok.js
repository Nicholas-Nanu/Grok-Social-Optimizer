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
// Automatically retries once on stopReason=Cancelled (transient xAI API
// cancellation that mostly resolves on a second attempt).
export async function runGrok(prompt, opts = {}) {
  try {
    return await runGrokOnce(prompt, opts);
  } catch (e) {
    if (e.stopReason === "Cancelled") {
      // One retry. If it fails again, the user gets the original Cancelled error.
      try {
        return await runGrokOnce(prompt, opts);
      } catch (retryErr) {
        // Surface that we tried twice so the user knows it's not a one-off.
        retryErr.message = "Retried once after Cancelled. " + retryErr.message;
        throw retryErr;
      }
    }
    throw e;
  }
}

function runGrokOnce(prompt, { web = false, model, effort, maxTurns } = {}) {
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
  if (maxTurns) args.push("--max-turns", String(maxTurns));

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
        const clean = stripAnsi(stderr.trim() || stdout.trim());
        reject(new Error(`grok exited with code ${code}.\n${clean}`));
        return;
      }
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        reject(new Error(`Could not parse grok output as JSON:\n${stdout.slice(0, 500)}`));
        return;
      }
      const text = envelope.text ?? "";
      if (!text.trim()) {
        // Grok exited successfully but produced no text. Surface why so the
        // caller knows whether to retry, raise max-turns, or change the prompt.
        const reason = envelope.stopReason || envelope.stop_reason || "unknown";
        const tail = stderr.trim().slice(-400);
        const err = new Error(
          `Grok returned an empty response (stopReason=${reason}). It likely hit a turn limit while searching, or refused silently.${tail ? "\n\nstderr tail:\n" + tail : ""}`
        );
        err.stopReason = reason;
        err.envelope = envelope;
        reject(err);
        return;
      }
      resolve(text);
    });
  });
}

// Strip ANSI color/style escape sequences from text (used to clean grok's
// stderr before showing it to the user; otherwise [2m, [31m, etc. leak through).
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

// Extract a JSON object from model text that may contain stray prose or code fences.
// On failure, throws an Error with `.raw` (full response) and `.snippet` (first 600 chars)
// attached so callers can surface what actually came back.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const snippet = String(text || "").trim().slice(0, 600);

  if (start === -1 || end === -1 || end < start) {
    const e = new Error(
      `Grok returned no JSON object. It responded with prose or a refusal instead.\nFirst 600 chars:\n${snippet || "(empty)"}`
    );
    e.raw = text;
    e.snippet = snippet;
    throw e;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (parseErr) {
    const e = new Error(
      `Grok returned text that started like JSON but didn't parse: ${parseErr.message}\nFirst 600 chars:\n${snippet}`
    );
    e.raw = text;
    e.snippet = snippet;
    throw e;
  }
}
