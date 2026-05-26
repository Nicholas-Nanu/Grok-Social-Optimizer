// Terminal rendering with minimal ANSI styling (no dependencies).

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const cyan = (s) => c("36", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);
const red = (s) => c("31", s);
const magenta = (s) => c("35", s);

function scoreColor(v) {
  if (v >= 70) return green;
  if (v >= 40) return yellow;
  return red;
}

function bar(value) {
  const width = 20;
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}

function rule(label) {
  const line = "─".repeat(Math.max(0, 56 - label.length));
  return dim("── ") + bold(label) + " " + dim(line);
}

export function renderReport(r) {
  const out = [];
  out.push("");
  out.push(cyan(bold(`  ${r.platform || "Result"}`)));
  out.push("");

  if (r.score) {
    const v = Number(r.score.value) || 0;
    const col = scoreColor(v);
    out.push(rule("Reach score (original draft)"));
    out.push(`  ${col(bar(v))} ${col(bold(v + "/100"))}`);
    if (r.score.verdict) out.push(`  ${r.score.verdict}`);
    if (Array.isArray(r.score.drivers)) {
      out.push("");
      for (const d of r.score.drivers) {
        const s = String(d);
        const colored = s.startsWith("+") ? green(s) : s.startsWith("-") ? red(s) : s;
        out.push(`    ${colored}`);
      }
    }
    out.push("");
  }

  if (Array.isArray(r.rewrites) && r.rewrites.length) {
    out.push(rule("Optimized rewrites"));
    r.rewrites.forEach((rw, i) => {
      out.push(`  ${bold(magenta(`${i + 1}. ${rw.label || "Variant"}`))}`);
      out.push(indent(rw.text || ""));
      if (rw.why) out.push(`     ${dim("→ " + rw.why)}`);
      out.push("");
    });
  }

  if (Array.isArray(r.hooks) && r.hooks.length) {
    out.push(rule("Hook variations"));
    r.hooks.forEach((h) => out.push(`  ${yellow("•")} ${h}`));
    out.push("");
  }

  if (Array.isArray(r.hashtags) && r.hashtags.length) {
    out.push(rule("Hashtags"));
    out.push("  " + cyan(r.hashtags.join("  ")));
    out.push("");
  }

  if (r.timing) {
    out.push(rule("Best time to post"));
    out.push(`  ${green(r.timing.best || "")}`);
    if (r.timing.rationale) out.push(`  ${dim(r.timing.rationale)}`);
    out.push("");
  }

  if (r.notes) {
    out.push(rule("Notes"));
    out.push(indent(r.notes));
    out.push("");
  }

  return out.join("\n");
}

function indent(text, pad = "     ") {
  return String(text)
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

export const log = {
  info: (s) => process.stderr.write(dim(s) + "\n"),
  error: (s) => process.stderr.write(red("Error: ") + s + "\n"),
};
