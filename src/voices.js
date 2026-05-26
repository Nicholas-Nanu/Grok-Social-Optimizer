// File-backed storage for voice profiles. One JSON file per profile in voices/.
// A profile captures a user's voice (persona + sample posts) so rewrites
// can mimic their style instead of sounding like generic AI.

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICES_DIR = join(__dirname, "..", "voices");

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function validateName(name) {
  if (!name || typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid voice name "${name}". Use lowercase letters, digits, and dashes (max 41 chars).`
    );
  }
}

async function ensureDir() {
  if (!existsSync(VOICES_DIR)) await mkdir(VOICES_DIR, { recursive: true });
}

function pathFor(name) {
  validateName(name);
  return join(VOICES_DIR, `${name}.json`);
}

export async function listVoices() {
  await ensureDir();
  const files = await readdir(VOICES_DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const v = JSON.parse(await readFile(join(VOICES_DIR, f), "utf8"));
      out.push({
        name: v.name,
        displayName: v.displayName || v.name,
        sampleCount: Array.isArray(v.samples) ? v.samples.length : 0,
        updatedAt: v.updatedAt || null,
      });
    } catch {
      // skip unreadable files
    }
  }
  return out.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
}

export async function getVoice(name) {
  const path = pathFor(name);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function saveVoice(profile) {
  validateName(profile?.name);
  await ensureDir();
  const now = new Date().toISOString();
  const existing = existsSync(pathFor(profile.name))
    ? JSON.parse(await readFile(pathFor(profile.name), "utf8"))
    : null;

  const samples = Array.isArray(profile.samples)
    ? profile.samples.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const next = {
    name: profile.name,
    displayName: String(profile.displayName || profile.name).trim(),
    persona: String(profile.persona || "").trim(),
    samples,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await writeFile(pathFor(profile.name), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function deleteVoice(name) {
  const path = pathFor(name);
  if (!existsSync(path)) return false;
  await unlink(path);
  return true;
}
