/**
 * CSS conformance: render every case in Chrome (the reference) and in Takumi, pixel-diff them,
 * and write a support matrix.
 *
 *   npx tsx test/conformance/run.ts                    # run, compare with baseline, exit 1 on regressions
 *   npx tsx test/conformance/run.ts --update-baseline  # accept current results
 *   npx tsx test/conformance/run.ts --only=oklch,emoji
 *
 * Env: CHROME_PATH (default /usr/bin/google-chrome if present, else Playwright's Chromium)
 */
import { Renderer } from "@takumi-rs/core";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, type Case } from "./cases.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../out/conformance");
const BASELINE = join(HERE, "baseline.json");
const W = 320, H = 200;
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const update = args.includes("--update-baseline");
/**
 * Takumi's UA defaults differ from browsers in one big way: every element is border-box (like
 * Satori). This one-line sheet restores browser semantics for content authored as web CSS.
 * Exported from the library as BROWSER_COMPAT_CSS; the suite always applies it so the matrix
 * measures rendering, not the default.
 */
const COMPAT = "*,*::before,*::after{box-sizing:content-box}";

type Status = "pass" | "partial" | "fail" | "error" | "skip";
interface Result { id: string; group: string; name: string; status: Status; diff: number; ignored: string[]; note?: string; expect?: string }

/* thresholds: share of inked pixels that differ noticeably (anti-aliasing excluded) */
const PASS = 0.03, PARTIAL = 0.15;

const FONTS = [
  { family: "Inter", file: join(HERE, "fonts/Inter-Regular.otf"), weight: 400, style: "normal" },
  { family: "Inter", file: join(HERE, "fonts/Inter-Bold.otf"), weight: 700, style: "normal" },
  { family: "Inter", file: join(HERE, "fonts/Inter-Italic.otf"), weight: 400, style: "italic" },
];
/* Optional system fonts (CI installs them; cases that need a missing one are skipped). */
const OPTIONAL: Record<string, { family: string; paths: string[] }> = {
  cjk: { family: "Noto Sans CJK SC", paths: ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"] },
  emoji: { family: "Noto Color Emoji", paths: ["/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"] },
  hebrew: { family: "Noto Sans Hebrew", paths: ["/usr/share/fonts/truetype/noto/NotoSansHebrew-Regular.ttf"] },
};
const NEEDS: Record<string, string[]> = { cjk: ["cjk"], emoji: ["emoji"], rtl: ["hebrew"] };

const ROOT_STYLE = `width:${W}px;height:${H}px;background:#fff;color:#111;font-family:Inter,sans-serif;font-size:16px;position:relative;overflow:hidden;padding:12px;box-sizing:border-box`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const available = new Set<string>();
  const takumi = new Renderer();
  for (const f of FONTS) await takumi.registerFont({ name: f.family, data: readFileSync(f.file), weight: f.weight, style: f.style } as any);
  for (const [key, f] of Object.entries(OPTIONAL)) {
    const p = f.paths.find(existsSync);
    if (!p) continue;
    try {
      await takumi.registerFont({ name: f.family, data: readFileSync(p) } as any);
      available.add(key);
    } catch (e) {
      console.warn(`could not register ${f.family}: ${(e as Error).message}`);
    }
  }

  const exe = process.env.CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  // Serve the test fonts to Chrome from the same files Takumi uses.
  await page.route("http://conformance.test/**", (route) => {
    const name = route.request().url().split("/").pop()!;
    if (name.endsWith(".otf")) return route.fulfill({ body: readFileSync(join(HERE, "fonts", name)), contentType: "font/otf" });
    return route.fulfill({ body: "<!doctype html><html><body></body></html>", contentType: "text/html" });
  });
  await page.goto("http://conformance.test/");
  const fontFaces = FONTS.map((f) => `@font-face{font-family:${f.family};src:url(/${f.file.split("/").pop()});font-weight:${f.weight};font-style:${f.style}}`).join("");
  const chromeVersion = browser.version();

  const results: Result[] = [];
  const cases = CASES.filter((c) => !only || only.includes(c.id));
  for (const c of cases) {
    const need = NEEDS[c.id]?.filter((k) => !available.has(k)) ?? [];
    if (need.length) {
      results.push({ id: c.id, group: c.group, name: c.name, status: "skip", diff: 0, ignored: [], note: `missing font: ${need.join(", ")}`, expect: c.expect });
      continue;
    }
    results.push(await runCase(c, page, takumi, fontFaces));
    const r = results[results.length - 1]!;
    console.log(`${icon(r.status)} ${c.id.padEnd(24)} ${(r.diff * 100).toFixed(2).padStart(6)}%  ${r.ignored.length ? `ignored: ${r.ignored.join(", ")}` : ""}${r.note ? ` ${r.note}` : ""}`);
  }
  await browser.close();

  // Baseline comparison: a case that used to pass and no longer does is a regression.
  const baseline: Record<string, Status> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const rank: Record<Status, number> = { pass: 3, partial: 2, fail: 1, error: 0, skip: -1 };
  const regressions = results.filter((r) => r.status !== "skip" && baseline[r.id] && rank[r.status] < rank[baseline[r.id]!]);
  const improvements = results.filter((r) => r.status !== "skip" && baseline[r.id] && rank[r.status] > rank[baseline[r.id]!]);
  const added = results.filter((r) => r.status !== "skip" && !baseline[r.id]);

  writeFileSync(join(OUT, "results.json"), JSON.stringify({ chrome: chromeVersion, results }, null, 2));
  writeFileSync(join(OUT, "report.md"), report(results, chromeVersion, { regressions, improvements, added }));
  if (update || !existsSync(BASELINE)) {
    const next = { ...baseline };
    for (const r of results) if (r.status !== "skip") next[r.id] = r.status;
    writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2) + "\n");
    console.log(`\nbaseline written (${Object.keys(next).length} cases)`);
  }
  const count = (s: Status) => results.filter((r) => r.status === s).length;
  console.log(`\npass ${count("pass")} · partial ${count("partial")} · fail ${count("fail")} · error ${count("error")} · skip ${count("skip")}  (Chrome ${chromeVersion})`);
  if (regressions.length && !update) {
    console.error(`\n${regressions.length} regression(s): ${regressions.map((r) => `${r.id} (${baseline[r.id]} → ${r.status})`).join(", ")}`);
    process.exit(1);
  }
}

async function runCase(c: Case, page: import("playwright").Page, takumi: Renderer, fontFaces: string): Promise<Result> {
  const base = { id: c.id, group: c.group, name: c.name, expect: c.expect };
  const html = `<div id="root" style="${ROOT_STYLE}">${c.html}</div>`;
  // Chrome
  await page.setContent(`<!doctype html><html><head><style>${fontFaces} html,body{margin:0;background:#fff} ${c.css ?? ""}</style></head><body>${html}</body></html>`, { waitUntil: "load" });
  await page.evaluate(async (t) => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
    if (t !== undefined) for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
  }, c.timeMs);
  const chromePng = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H }, animations: c.timeMs !== undefined ? "allow" : "disabled" }));

  // Takumi
  const ignored: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    const m = a.join(" ");
    const prop = /property `([^`]+)`/.exec(m)?.[1] ?? /value for ([\w-]+)/.exec(m)?.[1];
    if (prop && !ignored.includes(prop)) ignored.push(prop);
  };
  let takumiPng: PNG;
  try {
    const buf = await takumi.render(html, { width: W, height: H, format: "png", css: [COMPAT, ...(c.css ? [c.css] : [])], ...(c.timeMs !== undefined ? { timeMs: c.timeMs } : {}) } as any);
    takumiPng = PNG.sync.read(Buffer.from(buf));
  } catch (e) {
    console.warn = warn;
    writeFileSync(join(OUT, `${c.id}.png`), PNG.sync.write(triptych(chromePng, blank(), blank())));
    return { ...base, status: "error", diff: 1, ignored, note: (e as Error).message.slice(0, 160) };
  } finally {
    console.warn = warn;
  }

  const diff = new PNG({ width: W, height: H });
  const n = pixelmatch(chromePng.data, takumiPng.data, diff.data, W, H, { threshold: 0.15, includeAA: false, alpha: 0.2 });
  // Score against "ink" (pixels that aren't the white background in either render), so a small
  // feature that is missing entirely still fails instead of vanishing into a mostly-white canvas.
  let ink = 0;
  for (let i = 0; i < W * H * 4; i += 4) {
    const bgA = chromePng.data[i]! > 248 && chromePng.data[i + 1]! > 248 && chromePng.data[i + 2]! > 248;
    const bgB = takumiPng.data[i]! > 248 && takumiPng.data[i + 1]! > 248 && takumiPng.data[i + 2]! > 248;
    if (!bgA || !bgB) ink++;
  }
  const ratio = n / Math.max(ink, 400);
  writeFileSync(join(OUT, `${c.id}.png`), PNG.sync.write(triptych(chromePng, takumiPng, diff)));
  const status: Status = ratio <= PASS ? "pass" : ratio <= PARTIAL ? "partial" : "fail";
  return { ...base, status, diff: ratio, ignored };
}

function blank() {
  const p = new PNG({ width: W, height: H });
  p.data.fill(0x40);
  return p;
}

/** chrome | takumi | diff, side by side */
function triptych(a: PNG, b: PNG, d: PNG) {
  const out = new PNG({ width: W * 3 + 16, height: H });
  out.data.fill(255);
  [a, b, d].forEach((img, i) => PNG.bitblt(img, out, 0, 0, W, H, i * (W + 8), 0));
  return out;
}

const icon = (s: Status) => ({ pass: "✅", partial: "🟡", fail: "❌", error: "💥", skip: "⏭️" })[s];

function report(rs: Result[], chrome: string, d: { regressions: Result[]; improvements: Result[]; added: Result[] }) {
  const groups = [...new Set(rs.map((r) => r.group))];
  const count = (s: Status) => rs.filter((r) => r.status === s).length;
  const scored = rs.filter((r) => r.status !== "skip");
  const score = scored.length ? (scored.reduce((a, r) => a + (r.status === "pass" ? 1 : r.status === "partial" ? 0.5 : 0), 0) / scored.length) * 100 : 0;
  let md = `## CSS conformance: Takumi vs Chrome ${chrome}\n\n`;
  md += `**${score.toFixed(0)}% score** · ✅ ${count("pass")} pass · 🟡 ${count("partial")} partial · ❌ ${count("fail")} fail · 💥 ${count("error")} error · ⏭️ ${count("skip")} skipped\n\n`;
  if (d.regressions.length) md += `### ⚠️ Regressions\n${d.regressions.map((r) => `- \`${r.id}\` ${r.name} → ${icon(r.status)} ${r.status}`).join("\n")}\n\n`;
  if (d.improvements.length) md += `### 🎉 Improvements\n${d.improvements.map((r) => `- \`${r.id}\` ${r.name} → ${icon(r.status)} ${r.status}`).join("\n")}\n\n`;
  md += `Diff = differing pixels ÷ inked pixels. Pass ≤ ${PASS * 100}%, partial ≤ ${PARTIAL * 100}%. Anti-aliasing is ignored. Side-by-side images (Chrome | Takumi | diff) are in the artifact.\n\n`;
  for (const g of groups) {
    md += `<details${g === groups[0] ? "" : ""}><summary><b>${g}</b> — ${rs.filter((r) => r.group === g && r.status === "pass").length}/${rs.filter((r) => r.group === g).length} pass</summary>\n\n| | Feature | Diff | Notes |\n|---|---|---:|---|\n`;
    for (const r of rs.filter((x) => x.group === g)) {
      const notes = [r.ignored.length ? `ignored: \`${r.ignored.join("`, `")}\`` : "", r.note ?? "", r.expect === "unsupported" ? "known unsupported" : ""].filter(Boolean).join("; ");
      md += `| ${icon(r.status)} | ${r.name} | ${r.status === "skip" ? "—" : `${(r.diff * 100).toFixed(1)}%`} | ${notes} |\n`;
    }
    md += `\n</details>\n\n`;
  }
  return md;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
