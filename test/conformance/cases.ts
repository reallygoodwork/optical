/**
 * CSS conformance cases. Each renders in a 320×200 box in both Chrome and Takumi; results are
 * pixel-diffed. Keep cases small and single-purpose so a failure names exactly one feature.
 *
 * `html` is the inside of the root box. `css` is extra CSS. `timeMs` freezes animations.
 * `expect` documents what we already know (for the report), it does not change scoring.
 */
export interface Case {
  id: string;
  group: string;
  name: string;
  html: string;
  css?: string;
  timeMs?: number;
  /** Feature is known-unsupported upstream; tracked so the matrix shows it without failing CI. */
  expect?: "unsupported";
}

const box = (style: string, inner = "") => `<div style="${style}">${inner}</div>`;
const sq = "width:80px;height:80px";
const SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#2a1b5c"/><circle cx="30" cy="30" r="20" fill="#ff6b4a"/><path d="M60 50 L80 10 L95 50 Z" fill="#f6f1e9"/></svg>`)}`;

export const CASES: Case[] = [
  // ── Layout ───────────────────────────────────────────────────────────────
  { id: "flex-row", group: "Layout", name: "flex row + gap + align", html: box("display:flex;gap:12px;align-items:center;height:100%", [40, 70, 100].map((h) => box(`width:60px;height:${h}px;background:#3b82f6`)).join("")) },
  { id: "flex-justify", group: "Layout", name: "justify-content: space-between", html: box("display:flex;justify-content:space-between;width:100%", [1, 2, 3].map(() => box(`${sq};background:#10b981`)).join("")) },
  { id: "flex-wrap", group: "Layout", name: "flex-wrap + row-gap", html: box("display:flex;flex-wrap:wrap;gap:8px;width:220px", Array.from({ length: 7 }, () => box("width:60px;height:40px;background:#f59e0b")).join("")) },
  { id: "flex-grow", group: "Layout", name: "flex-grow / basis", html: box("display:flex;gap:6px;width:100%", box("flex:1;height:60px;background:#ef4444") + box("flex:2;height:60px;background:#8b5cf6") + box("flex:0 0 50px;height:60px;background:#111")) },
  { id: "flex-column-reverse", group: "Layout", name: "flex-direction: column-reverse", html: box("display:flex;flex-direction:column-reverse;gap:6px", box("width:100px;height:30px;background:#111") + box("width:100px;height:30px;background:#ef4444")) },
  { id: "grid-template", group: "Layout", name: "grid-template-columns fr + gap", html: box("display:grid;grid-template-columns:1fr 2fr 1fr;gap:8px;height:100%", Array.from({ length: 6 }, (_, i) => box(`background:hsl(${i * 50} 70% 50%)`)).join("")) },
  { id: "grid-areas", group: "Layout", name: "grid-template-areas", html: box("display:grid;grid-template-areas:'a a b' 'c d b';grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr;gap:6px;height:100%", box("grid-area:a;background:#ef4444") + box("grid-area:b;background:#3b82f6") + box("grid-area:c;background:#10b981") + box("grid-area:d;background:#f59e0b")) },
  { id: "grid-span", group: "Layout", name: "grid-column span + auto-fill minmax", html: box("display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:6px", box("grid-column:span 2;height:40px;background:#111") + Array.from({ length: 5 }, () => box("height:40px;background:#94a3b8")).join("")) },
  { id: "grid-place", group: "Layout", name: "place-items: center", html: box("display:grid;place-items:center;width:100%;height:100%;background:#e2e8f0", box(`${sq};background:#0ea5e9`)) },
  { id: "block-flow", group: "Layout", name: "block flow + margins", html: box("display:block", box("height:30px;margin:10px 20px;background:#111") + box("height:30px;margin:10px 40px;background:#ef4444")) },
  { id: "margin-collapse", group: "Layout", name: "vertical margin collapse", html: box("display:block", box("height:30px;margin-bottom:30px;background:#111") + box("height:30px;margin-top:20px;background:#ef4444")) },
  { id: "inline-flow", group: "Layout", name: "inline-block flow", html: box("display:block;width:240px", Array.from({ length: 6 }, () => `<span style="display:inline-block;width:60px;height:30px;margin:4px;background:#8b5cf6"></span>`).join("")) },
  { id: "float", group: "Layout", name: "float + text wrap", html: box("display:block;width:300px;font-size:14px;line-height:1.3", box("float:left;width:80px;height:80px;margin-right:10px;background:#f59e0b") + "Text flows around the floated square in normal flow. It keeps going for a few lines so wrapping is visible.") },
  { id: "position-absolute", group: "Layout", name: "absolute + inset + z-index", html: box("position:relative;width:100%;height:100%", box("position:absolute;inset:20px 40px auto auto;width:100px;height:80px;background:#ef4444;z-index:2") + box("position:absolute;left:30px;top:40px;width:120px;height:90px;background:#3b82f6;z-index:1")) },
  { id: "calc-clamp", group: "Layout", name: "calc() / min() / max() / clamp()", html: box("display:flex;flex-direction:column;gap:6px", box("width:calc(100% - 40px);height:30px;background:#111") + box("width:min(50%,120px);height:30px;background:#ef4444") + box("width:clamp(50px,40%,300px);height:30px;background:#10b981") + box("width:max(20%,90px);height:30px;background:#3b82f6")) },
  { id: "aspect-ratio", group: "Layout", name: "aspect-ratio", html: box("display:flex;gap:10px;align-items:flex-start", box("width:120px;aspect-ratio:16/9;background:#111") + box("width:80px;aspect-ratio:1;background:#ef4444")) },
  { id: "min-max-size", group: "Layout", name: "min/max width/height", html: box("display:flex;gap:8px", box("width:500px;max-width:140px;min-height:90px;background:#0ea5e9") + box("width:10px;min-width:60px;height:40px;background:#f59e0b")) },
  { id: "logical-props", group: "Layout", name: "logical properties (inline-size, margin-inline)", html: box("display:block", box("inline-size:160px;block-size:60px;margin-inline:40px;margin-block-start:20px;background:#8b5cf6")) },
  { id: "overflow-hidden", group: "Layout", name: "overflow: hidden clipping", html: box("width:120px;height:80px;overflow:hidden;background:#e2e8f0;border-radius:16px", box("width:200px;height:200px;margin:-20px;background:linear-gradient(45deg,#ef4444,#3b82f6)")) },
  { id: "percent-units", group: "Layout", name: "% and viewport units", html: box("width:50%;height:25vh;background:#111") },

  // ── Box ─────────────────────────────────────────────────────────────────
  { id: "border-radius", group: "Box", name: "border-radius (incl. elliptical)", html: box("display:flex;gap:10px", box(`${sq};background:#111;border-radius:16px`) + box(`${sq};background:#ef4444;border-radius:50%`) + box(`${sq};background:#3b82f6;border-radius:40px 10px / 20px 40px`)) },
  { id: "border-styles", group: "Box", name: "border solid/dashed/dotted/double", html: box("display:flex;gap:10px;padding:8px", ["solid", "dashed", "dotted", "double"].map((s) => box(`width:56px;height:56px;border:6px ${s} #111`)).join("")) },
  { id: "border-sides", group: "Box", name: "per-side border colors", html: box(`${sq};border-width:10px;border-style:solid;border-color:#ef4444 #10b981 #3b82f6 #f59e0b`) },
  { id: "box-shadow", group: "Box", name: "box-shadow (outer, multiple, spread)", html: box("padding:30px", box(`${sq};background:#fff;box-shadow:0 10px 25px rgba(0,0,0,.35), 0 0 0 4px #ef4444`)) },
  { id: "box-shadow-inset", group: "Box", name: "box-shadow inset", html: box("padding:30px", box(`width:140px;height:80px;background:#f8fafc;box-shadow:inset 0 6px 16px rgba(0,0,0,.4)`)) },
  { id: "outline", group: "Box", name: "outline + outline-offset", html: box("padding:30px", box(`${sq};background:#111;outline:3px solid #ef4444;outline-offset:6px`)) },
  { id: "box-sizing-default", group: "Box", name: "default box-sizing (content-box in browsers)", html: box("width:100px;height:60px;padding:15px;border:5px solid #111;background:#ef4444") },
  { id: "box-sizing", group: "Box", name: "box-sizing border-box vs content-box", html: box("display:flex;gap:10px", box("box-sizing:border-box;width:100px;height:60px;padding:15px;border:5px solid #111;background:#ef4444") + box("box-sizing:content-box;width:100px;height:60px;padding:15px;border:5px solid #111;background:#3b82f6")) },

  // ── Backgrounds ─────────────────────────────────────────────────────────
  { id: "linear-gradient", group: "Backgrounds", name: "linear-gradient with stops + angle", html: box("width:100%;height:100%;background:linear-gradient(120deg,#2a1b5c 0%,#ff6b4a 60%,#f6f1e9 100%)") },
  { id: "radial-gradient", group: "Backgrounds", name: "radial-gradient", html: box("width:100%;height:100%;background:radial-gradient(circle at 30% 40%,#ff6b4a,#2a1b5c 70%)") },
  { id: "conic-gradient", group: "Backgrounds", name: "conic-gradient", html: box("width:160px;height:160px;border-radius:50%;background:conic-gradient(from 90deg,#ef4444,#f59e0b,#10b981,#3b82f6,#ef4444)") },
  { id: "repeating-gradient", group: "Backgrounds", name: "repeating-linear-gradient", html: box("width:100%;height:100%;background:repeating-linear-gradient(45deg,#111 0 10px,#fff 10px 20px)") },
  { id: "multi-background", group: "Backgrounds", name: "multiple backgrounds layered", html: box("width:100%;height:100%;background:radial-gradient(circle at 80% 20%,rgba(255,107,74,.9) 0 40px,transparent 41px),linear-gradient(#2a1b5c,#14121f)") },
  { id: "background-size", group: "Backgrounds", name: "background-size / repeat / position", html: box(`width:100%;height:100%;background-image:url("${SVG}");background-size:80px 48px;background-repeat:repeat-x;background-position:10px 60px;background-color:#e2e8f0`) },
  { id: "background-clip-text", group: "Backgrounds", name: "background-clip: text (gradient text)", html: `<div style="font-size:64px;font-weight:700;background:linear-gradient(90deg,#ef4444,#3b82f6);background-clip:text;-webkit-background-clip:text;color:transparent">Grad</div>` },

  // ── Color ───────────────────────────────────────────────────────────────
  { id: "color-spaces", group: "Color", name: "hsl / hwb / rgb alpha / hex8", html: box("display:flex;gap:6px", ["hsl(200 80% 50%)", "hwb(30 10% 20%)", "rgb(255 0 0 / 50%)", "#3b82f680"].map((c) => box(`width:70px;height:120px;background:${c}`)).join("")) },
  { id: "oklch", group: "Color", name: "oklch() / oklab() / lab()", html: box("display:flex;gap:6px", ["oklch(70% 0.2 30)", "oklab(0.6 0.1 -0.1)", "lab(50% 40 60)", "lch(60% 50 250)"].map((c) => box(`width:70px;height:120px;background:${c}`)).join("")) },
  { id: "color-mix", group: "Color", name: "color-mix()", html: box("display:flex;gap:6px", box("width:90px;height:120px;background:color-mix(in srgb,#ef4444 50%,#3b82f6)") + box("width:90px;height:120px;background:color-mix(in oklch,#ef4444 30%,white)")) },
  { id: "css-variables", group: "Color", name: "custom properties + var() fallback", css: ".v{--brand:#ff6b4a;--pad:16px}", html: `<div class="v" style="padding:var(--pad);background:var(--brand)"><div style="width:80px;height:40px;background:var(--missing,#111)"></div></div>` },
  { id: "current-color", group: "Color", name: "currentColor", html: `<div style="color:#10b981;border:8px solid currentColor;width:120px;height:60px;box-shadow:0 0 0 6px currentColor"></div>` },
  { id: "relative-color", group: "Color", name: "relative color syntax rgb(from …)", html: box("width:160px;height:120px;background:rgb(from #3b82f6 r g b / 50%)") },

  // ── Transforms ──────────────────────────────────────────────────────────
  { id: "transform-2d", group: "Transforms", name: "translate / rotate / scale", html: box("padding:40px", box(`${sq};background:#ef4444;transform:translate(40px,10px) rotate(20deg) scale(1.2)`)) },
  { id: "transform-skew", group: "Transforms", name: "skew()", html: box("padding:40px 60px", box(`width:120px;height:80px;background:#3b82f6;transform:skew(-15deg,5deg)`)) },
  { id: "transform-origin", group: "Transforms", name: "transform-origin", html: box("padding:40px 80px", box(`${sq};background:#111;transform-origin:0 0;transform:rotate(30deg)`)) },
  { id: "individual-transforms", group: "Transforms", name: "individual rotate/scale/translate props", html: box("padding:50px", box(`${sq};background:#10b981;rotate:15deg;scale:1.1;translate:30px 0`)) },
  { id: "transform-3d", group: "Transforms", name: "perspective + rotateY (3D)", html: box("padding:40px 100px;perspective:300px", box(`width:120px;height:100px;background:#8b5cf6;transform:rotateY(40deg)`)), expect: "unsupported" },
  { id: "transform-matrix", group: "Transforms", name: "matrix()", html: box("padding:40px 80px", box(`${sq};background:#f59e0b;transform:matrix(1,0.3,-0.3,1,20,0)`)) },

  // ── Effects ─────────────────────────────────────────────────────────────
  { id: "opacity", group: "Effects", name: "opacity nesting", html: box("display:flex", box("width:150px;height:120px;background:#ef4444;opacity:.5", box("width:80px;height:60px;background:#111;opacity:.5"))) },
  { id: "filter-blur", group: "Effects", name: "filter: blur()", html: box("padding:30px", box(`width:140px;height:100px;background:#3b82f6;filter:blur(6px)`)) },
  { id: "filter-color", group: "Effects", name: "filter: grayscale / sepia / hue-rotate / brightness / contrast / saturate / invert", html: box("display:flex;gap:4px", ["grayscale(1)", "sepia(1)", "hue-rotate(120deg)", "brightness(1.5)", "contrast(2)", "saturate(3)", "invert(1)"].map((f) => box(`width:40px;height:120px;background:linear-gradient(#ef4444,#3b82f6);filter:${f}`)).join("")) },
  { id: "filter-drop-shadow", group: "Effects", name: "filter: drop-shadow()", html: box("padding:30px", `<img src="${SVG}" style="width:160px;height:96px;filter:drop-shadow(6px 8px 6px rgba(0,0,0,.5))">`) },
  { id: "backdrop-filter", group: "Effects", name: "backdrop-filter: blur()", html: box("position:relative;width:100%;height:100%;background:repeating-linear-gradient(45deg,#ef4444 0 14px,#3b82f6 14px 28px)", box("position:absolute;left:60px;top:40px;width:200px;height:120px;background:rgba(255,255,255,.25);backdrop-filter:blur(8px)")) },
  { id: "blend-mode", group: "Effects", name: "mix-blend-mode multiply/screen/difference", html: box("position:relative;width:100%;height:100%;background:linear-gradient(90deg,#f59e0b,#3b82f6)", ["multiply", "screen", "difference"].map((m, i) => box(`position:absolute;left:${20 + i * 95}px;top:50px;width:80px;height:100px;background:#ef4444;mix-blend-mode:${m}`)).join("")) },
  { id: "background-blend", group: "Effects", name: "background-blend-mode", html: box("width:100%;height:100%;background:linear-gradient(#ef4444,#3b82f6),linear-gradient(90deg,#fff,#000);background-blend-mode:multiply") },
  { id: "clip-path-shapes", group: "Effects", name: "clip-path circle / polygon / inset round", html: box("display:flex;gap:10px", box(`width:90px;height:90px;background:#ef4444;clip-path:circle(40%)`) + box(`width:90px;height:90px;background:#3b82f6;clip-path:polygon(50% 0,100% 100%,0 100%)`) + box(`width:90px;height:90px;background:#10b981;clip-path:inset(10px round 20px)`)) },
  { id: "mask-image", group: "Effects", name: "mask-image linear-gradient", html: box("width:100%;height:100%;background:#111;mask-image:linear-gradient(90deg,#000,transparent);-webkit-mask-image:linear-gradient(90deg,#000,transparent)") },

  // ── Typography ──────────────────────────────────────────────────────────
  { id: "text-basic", group: "Typography", name: "font-size / weight / line-height / color", html: `<div style="font-size:28px;line-height:1.2;color:#111">Regular <b>Bold</b><br><span style="font-size:16px;color:#ef4444">Small red line</span></div>` },
  { id: "text-italic", group: "Typography", name: "font-style: italic (real italic face)", html: `<div style="font-size:32px"><i>Italic text</i></div>` },
  { id: "text-wrap", group: "Typography", name: "wrapping + text-align center/right/justify", html: `<div style="width:300px;font-size:14px;line-height:1.35"><p style="margin:0 0 6px;text-align:center">Centered text that wraps across a couple of lines to check balance.</p><p style="margin:0 0 6px;text-align:right">Right aligned paragraph wrapping too.</p><p style="margin:0;text-align:justify">Justified text spreads words so both edges line up neatly here.</p></div>` },
  { id: "letter-spacing", group: "Typography", name: "letter-spacing / word-spacing", html: `<div style="font-size:24px;letter-spacing:0.2em">TRACKED</div><div style="font-size:24px;word-spacing:20px">word spacing test</div>` },
  { id: "text-transform", group: "Typography", name: "text-transform", html: `<div style="font-size:24px;text-transform:uppercase">upper case</div><div style="font-size:24px;text-transform:capitalize">capital each word</div>` },
  { id: "text-decoration", group: "Typography", name: "underline / line-through / decoration color+style", html: `<div style="font-size:26px;text-decoration:underline">Underline</div><div style="font-size:26px;text-decoration:line-through #ef4444 3px">Strike</div><div style="font-size:26px;text-decoration:underline wavy #3b82f6">Wavy</div>` },
  { id: "text-shadow", group: "Typography", name: "text-shadow", html: `<div style="font-size:48px;font-weight:700;color:#fff;text-shadow:0 4px 8px rgba(0,0,0,.6), 0 0 2px #ef4444;padding:20px;background:#94a3b8">Shadow</div>` },
  { id: "text-stroke", group: "Typography", name: "-webkit-text-stroke", html: `<div style="font-size:64px;font-weight:700;color:transparent;-webkit-text-stroke:2px #111">Outline</div>` },
  { id: "line-clamp", group: "Typography", name: "-webkit-line-clamp", html: `<div style="width:260px;font-size:16px;line-height:1.3;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden">This paragraph is long enough that it must be clamped after two lines with an ellipsis at the end of the second.</div>` },
  { id: "text-overflow", group: "Typography", name: "text-overflow: ellipsis + nowrap", html: `<div style="width:200px;font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A single line that is far too long to fit</div>` },
  { id: "white-space-pre", group: "Typography", name: "white-space: pre / pre-wrap", html: `<div style="font-size:16px;white-space:pre">  indented
    more indented</div>` },
  { id: "word-break", group: "Typography", name: "overflow-wrap / word-break", html: `<div style="width:120px;font-size:16px;overflow-wrap:anywhere;background:#f1f5f9">Supercalifragilisticexpialidocious</div>` },
  { id: "text-wrap-balance", group: "Typography", name: "text-wrap: balance", html: `<div style="width:280px;font-size:24px;text-wrap:balance">Balanced headlines avoid one lonely word</div>` },
  { id: "rtl", group: "Typography", name: "direction: rtl (Arabic/Hebrew)", html: `<div dir="rtl" style="font-size:24px;font-family:'Noto Sans Arabic','Noto Sans Hebrew',sans-serif">שלום עולם</div>` },
  { id: "cjk", group: "Typography", name: "CJK text", html: `<div style="font-size:28px;font-family:'Noto Sans CJK SC'">你好，世界。日本語</div>` },
  { id: "emoji", group: "Typography", name: "emoji", html: `<div style="font-size:40px">Launch 🚀🎉</div>` },
  { id: "font-feature", group: "Typography", name: "font-variant-numeric: tabular-nums", html: `<div style="font-size:28px;font-variant-numeric:tabular-nums">1111<br>8888</div>` },
  { id: "vertical-writing", group: "Typography", name: "writing-mode: vertical-rl", html: `<div style="writing-mode:vertical-rl;font-size:22px;height:180px">Vertical text</div>`, expect: "unsupported" },
  { id: "lists", group: "Typography", name: "ul/ol list markers", html: `<ul style="font-size:16px;margin:0;padding-left:24px"><li>First</li><li>Second</li></ul><ol style="font-size:16px;margin:0;padding-left:24px"><li>One</li><li>Two</li></ol>` },

  // ── Images ──────────────────────────────────────────────────────────────
  { id: "img-svg", group: "Images", name: "SVG image", html: `<img src="${SVG}" style="width:200px;height:120px">` },
  { id: "object-fit", group: "Images", name: "object-fit cover / contain / fill + object-position", html: box("display:flex;gap:6px", ["cover", "contain", "fill"].map((f) => `<img src="${SVG}" style="width:90px;height:120px;object-fit:${f};object-position:left top;background:#e2e8f0">`).join("")) },
  { id: "img-radius", group: "Images", name: "image with border-radius + border", html: `<img src="${SVG}" style="width:200px;height:120px;border-radius:24px;border:4px solid #111">` },
  { id: "inline-svg", group: "Images", name: "inline <svg> element", html: `<svg width="200" height="120" viewBox="0 0 100 60"><rect width="100" height="60" rx="8" fill="#0ea5e9"/><circle cx="50" cy="30" r="18" fill="#fff"/></svg>` },

  // ── Selectors & cascade ─────────────────────────────────────────────────
  { id: "class-selectors", group: "Selectors", name: "class / descendant / child / sibling", css: ".p .c{background:#ef4444} .p>.d{background:#3b82f6} .c+.d{border:6px solid #111}", html: `<div class="p" style="display:flex;gap:8px"><div class="c" style="${sq}"></div><div class="d" style="${sq}"></div></div>` },
  { id: "pseudo-classes", group: "Selectors", name: ":first-child / :nth-child / :not()", css: ".r>div{width:40px;height:80px;background:#cbd5e1} .r>div:first-child{background:#111} .r>div:nth-child(3n){background:#ef4444} .r>div:not(:first-child):last-child{background:#3b82f6}", html: `<div class="r" style="display:flex;gap:6px">${"<div></div>".repeat(6)}</div>` },
  { id: "has-selector", group: "Selectors", name: ":has()", css: ".card:has(.badge){outline:6px solid #ef4444}", html: `<div style="display:flex;gap:20px;padding:10px"><div class="card" style="${sq};background:#e2e8f0"><span class="badge"></span></div><div class="card" style="${sq};background:#e2e8f0"></div></div>` },
  { id: "pseudo-elements", group: "Selectors", name: "::before / ::after content", css: ".q::before{content:'“';color:#ef4444} .q::after{content:' →';color:#3b82f6}", html: `<div class="q" style="font-size:36px">Quote</div>` },
  { id: "css-nesting", group: "Selectors", name: "native CSS nesting", css: ".n{background:#e2e8f0;& .i{background:#10b981;width:100px;height:60px}}", html: `<div class="n" style="padding:20px"><div class="i"></div></div>` },
  { id: "media-query", group: "Selectors", name: "@media (min-width)", css: ".m{background:#ef4444} @media (min-width:200px){.m{background:#10b981}}", html: `<div class="m" style="${sq}"></div>` },
  { id: "container-query", group: "Selectors", name: "@container size query", css: ".cq{container-type:inline-size} .cqi{background:#ef4444;height:60px} @container (min-width:200px){.cqi{background:#10b981}}", html: `<div class="cq" style="width:260px"><div class="cqi"></div></div>`, expect: "unsupported" },
  { id: "cascade-layers", group: "Selectors", name: "@layer + @supports", css: "@layer base,theme; @layer theme{.l{background:#10b981}} @layer base{.l{background:#ef4444}} @supports (display:grid){.s{background:#3b82f6}}", html: `<div style="display:flex;gap:8px"><div class="l" style="${sq}"></div><div class="s" style="${sq}"></div></div>` },
  { id: "important", group: "Selectors", name: "!important + specificity", css: "#x{background:#ef4444} .y{background:#3b82f6 !important}", html: `<div id="x" class="y" style="${sq}"></div>` },

  // ── Animation ───────────────────────────────────────────────────────────
  { id: "keyframes", group: "Animation", name: "@keyframes sampled at t=500ms", timeMs: 500, css: "@keyframes slide{from{transform:translateX(0);background:#ef4444}to{transform:translateX(200px);background:#3b82f6}} .a{animation:slide 1s linear both}", html: `<div class="a" style="${sq}"></div>` },
  { id: "keyframes-easing", group: "Animation", name: "animation-timing-function cubic-bezier", timeMs: 300, css: "@keyframes grow{from{width:20px}to{width:300px}} .e{animation:grow 1s cubic-bezier(.2,.8,.2,1) both;height:40px;background:#111}", html: `<div class="e"></div>` },
  { id: "keyframes-full-turn", group: "Animation", name: "@keyframes rotate 0→360deg (angle interpolation)", timeMs: 250, css: "@keyframes spin{to{rotate:360deg}} .s{animation:spin 1s linear both}", html: `<div style="padding:40px 100px"><div class="s" style="width:100px;height:30px;background:#111"></div></div>` },
  { id: "transition-freeze", group: "Animation", name: "animation-delay + fill-mode backwards", timeMs: 200, css: "@keyframes fade{from{opacity:0}to{opacity:1}} .f{animation:fade 1s linear 0.5s backwards}", html: `<div class="f" style="width:160px;height:100px;background:#ef4444"></div>` },
];
