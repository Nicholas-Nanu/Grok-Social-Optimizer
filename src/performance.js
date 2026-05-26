// File-backed storage for post-performance datasets. One JSON file per dataset
// in performance/. A dataset is the user's past posts on one platform along
// with measured engagement, used to ground prompts in what actually worked
// for THIS account (vs. generic best practices).

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERF_DIR = join(__dirname, "..", "performance");

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function validateName(name) {
  if (!name || typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid dataset name "${name}". Use lowercase letters, digits, and dashes (max 41 chars).`
    );
  }
}

async function ensureDir() {
  if (!existsSync(PERF_DIR)) await mkdir(PERF_DIR, { recursive: true });
}

function pathFor(name) {
  validateName(name);
  return join(PERF_DIR, `${name}.json`);
}

// Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes,
// commas and newlines inside quoted fields. Returns array of rows of strings.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  // Trailing field/row.
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop entirely-empty trailing rows.
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

// Given a header row, find the most likely text column and the score column.
// Text column: prefers exact matches (post, text, caption, content, message),
// falls back to the column with the longest average string in the data rows.
// Score column: prefers explicit (score, engagement); otherwise we synthesize
// a composite score by summing all numeric columns per row.
function pickColumns(headers, dataRows) {
  const lower = headers.map((h) => String(h).trim().toLowerCase());
  const TEXT_NAMES = ["post", "text", "caption", "content", "message", "body", "tweet"];
  const SCORE_NAMES = ["score", "engagement", "engagementscore", "total"];

  let textIdx = lower.findIndex((h) => TEXT_NAMES.includes(h));
  if (textIdx === -1) {
    // Fall back to longest-average-string column.
    let best = -1;
    let bestLen = 0;
    for (let c = 0; c < headers.length; c++) {
      let sum = 0;
      let n = 0;
      for (const r of dataRows) {
        const v = r[c] ?? "";
        if (typeof v === "string" && v.length) { sum += v.length; n++; }
      }
      const avg = n ? sum / n : 0;
      if (avg > bestLen) { bestLen = avg; best = c; }
    }
    textIdx = best;
  }

  const scoreIdx = lower.findIndex((h) => SCORE_NAMES.includes(h));

  // Numeric columns (any column whose data values are mostly numeric, excluding the text col).
  const numericIdxs = [];
  for (let c = 0; c < headers.length; c++) {
    if (c === textIdx) continue;
    let numeric = 0;
    let total = 0;
    for (const r of dataRows) {
      const v = (r[c] ?? "").toString().trim().replace(/[,_]/g, "");
      if (v === "") continue;
      total++;
      if (!isNaN(Number(v))) numeric++;
    }
    if (total > 0 && numeric / total > 0.7) numericIdxs.push(c);
  }

  return { textIdx, scoreIdx, numericIdxs };
}

function toNumber(v) {
  if (v == null) return 0;
  const n = Number(String(v).trim().replace(/[,_]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Turn parsed CSV rows into normalized records. Returns { records, scoreLabel, columns }.
export function recordsFromCsv(rows) {
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].map((h) => String(h).trim());
  const dataRows = rows.slice(1).filter((r) => r.some((v) => v !== ""));
  if (!dataRows.length) throw new Error("CSV has no data rows.");

  const { textIdx, scoreIdx, numericIdxs } = pickColumns(headers, dataRows);
  if (textIdx === -1) throw new Error("Could not find a post-text column in the CSV.");

  let scoreLabel;
  const records = dataRows.map((r) => {
    const text = String(r[textIdx] ?? "").trim();
    const metrics = {};
    for (const c of numericIdxs) metrics[headers[c]] = toNumber(r[c]);
    let score;
    if (scoreIdx !== -1) {
      score = toNumber(r[scoreIdx]);
    } else {
      score = numericIdxs.reduce((acc, c) => acc + toNumber(r[c]), 0);
    }
    return { text, score, metrics };
  }).filter((r) => r.text);

  if (scoreIdx !== -1) {
    scoreLabel = headers[scoreIdx];
  } else if (numericIdxs.length) {
    scoreLabel = "engagement (sum of " + numericIdxs.map((c) => headers[c]).join(" + ") + ")";
  } else {
    scoreLabel = "no numeric columns — all records score 0";
  }

  return {
    records,
    scoreLabel,
    columns: { text: headers[textIdx], score: scoreIdx !== -1 ? headers[scoreIdx] : null, numeric: numericIdxs.map((c) => headers[c]) },
  };
}

export async function listDatasets() {
  await ensureDir();
  const files = await readdir(PERF_DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(await readFile(join(PERF_DIR, f), "utf8"));
      out.push({
        name: d.name,
        displayName: d.displayName || d.name,
        platform: d.platform || null,
        recordCount: Array.isArray(d.records) ? d.records.length : 0,
        scoreLabel: d.scoreLabel || null,
        importedAt: d.importedAt || null,
      });
    } catch {}
  }
  return out.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
}

export async function getDataset(name) {
  const path = pathFor(name);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function saveDataset({ name, displayName, platform, csv }) {
  validateName(name);
  if (!csv || typeof csv !== "string" || !csv.trim()) throw new Error("Missing CSV content.");
  await ensureDir();
  const rows = parseCsv(csv);
  const { records, scoreLabel, columns } = recordsFromCsv(rows);
  const data = {
    name,
    displayName: String(displayName || name).trim(),
    platform: platform || null,
    importedAt: new Date().toISOString(),
    scoreLabel,
    columns,
    records,
  };
  await writeFile(pathFor(name), JSON.stringify(data, null, 2), "utf8");
  return {
    name: data.name,
    displayName: data.displayName,
    platform: data.platform,
    recordCount: data.records.length,
    scoreLabel: data.scoreLabel,
    columns: data.columns,
    importedAt: data.importedAt,
    sample: data.records.slice(0, 3),
  };
}

export async function deleteDataset(name) {
  const path = pathFor(name);
  if (!existsSync(path)) return false;
  await unlink(path);
  return true;
}

// Get the top N records of a dataset by score, descending.
export function topRecords(dataset, n = 5) {
  if (!dataset || !Array.isArray(dataset.records)) return [];
  return [...dataset.records]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, n);
}
