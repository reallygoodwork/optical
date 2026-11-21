/**
 * Demons sizzle reels: three motion-heavy scenes used as visual test cases.
 *
 * Each scene is plain JSON once built (see scenes/*.json). This file only exists because
 * repeating beats, bobbing crew and staggered words are easier to write with a few helpers.
 * Everything is timed to a 120 BPM beat: one beat is 0.5 s.
 *
 * Brand rules followed (clients/demons/brand.json): a demon never stands on its own colour,
 * at most three demons together, stickers only in stickers, agent lines lowercase mono,
 * logo only on flat approved grounds.
 */
import type { Scene } from "../../src/core/schema.js";

type L = Scene["layers"][number];
const B = 0.5; // one beat
const AUDIO = "examples/demons/audio/beat-120.mp3";

/* ---------------------------------------------------------------- helpers */

const ground = (id: string, fill: string, start: number, end: number, enter?: L["enter"]): L => ({ id, type: "shape", fill, start, end, ...(enter ? { enter } : {}) });

/** Full-frame pattern that drifts and turns slowly so the ground is never still. */
const pattern = (id: string, src: string, start: number, end: number, spin = 6, zoom = 1.25): L => ({
  id, type: "image", src, fit: "cover", start, end,
  keyframes: [{ at: 0, scale: zoom, rotate: -spin / 2 }, { at: end - start, scale: zoom + 0.15, rotate: spin / 2, ease: "linear" }],
});

/** A crew member that pops in, then bobs on the beat. */
function demon(id: string, who: string, o: { x: number; y: number; size: number; start: number; end: number; delay?: number; tilt?: number; exit?: L["exit"] }): L {
  const len = o.end - o.start;
  const kf: NonNullable<L["keyframes"]> = [];
  const tilt = o.tilt ?? 5;
  for (let t = 0, i = 0; t <= len + 1e-6; t += B / 2, i++) {
    kf.push({ at: +t.toFixed(3), y: i % 2 ? -o.size * 0.06 : 0, rotate: i % 2 ? tilt : -tilt, scale: i % 2 ? 1.04 : 1, ease: "inOutCubic" });
  }
  return {
    id, type: "image", src: `$assets.${who}`, fit: "contain", x: o.x, y: o.y, width: o.size, height: o.size,
    start: o.start, end: o.end, enter: { preset: "pop", delay: o.delay ?? 0, duration: 0.4, ease: "outBack" },
    ...(o.exit ? { exit: o.exit } : {}), keyframes: kf,
  };
}

/** One big word that slams in on a beat. */
const slam = (id: string, text: string, o: { x: number; y: number; w: number; h: number; start: number; end: number; color: string; style?: string; size?: number; align?: "left" | "center" | "right"; enter?: L["enter"]; exit?: L["exit"]; rotate?: number }): L => ({
  id, type: "text", text, textStyle: o.style ?? "display", color: o.color, x: o.x, y: o.y, width: o.w, height: o.h,
  ...(o.size ? { size: o.size } : {}), fit: "line", align: o.align ?? "left", start: o.start, end: o.end,
  enter: o.enter ?? { preset: "zoom", duration: 0.28, ease: "outBack" }, ...(o.exit ? { exit: o.exit } : {}), ...(o.rotate ? { rotate: o.rotate } : {}),
});

/** An agent line: lowercase mono, typed out. */
const daemon = (id: string, text: string, o: { x: number; y: number; w: number; start: number; end: number; color: string; size: number; bg?: string }): L => ({
  id, type: "text", text, textStyle: "daemon", size: o.size, color: o.color, x: o.x, y: o.y,
  width: o.bg ? Math.min(o.w, Math.ceil(text.length * o.size * 0.6 + o.size * 1.6)) : o.w,
  start: o.start, end: o.end, enter: { preset: "typewriter", duration: 0.7, ease: "linear" },
  ...(o.bg ? { background: o.bg, padding: [Math.round(o.size * 0.5), Math.round(o.size * 0.8)] as [number, number], radius: 999 } : {}),
});

/** A sticker: the only place all-caps is allowed. Spins in and wobbles. */
const sticker = (id: string, text: string, o: { x: number; y: number; size: number; start: number; end: number; fill: string; color: string; rotate: number }): L => ({
  id, type: "text", text, textStyle: "sticker", size: o.size, color: o.color, background: o.fill, x: o.x, y: o.y,
  padding: [Math.round(o.size * 0.28), Math.round(o.size * 0.5)], radius: Math.round(o.size * 0.3), start: o.start, end: o.end,
  shadow: "0 10px 0 $colors.ink", rotate: o.rotate,
  enter: { preset: "pop", duration: 0.35, ease: "outBack" },
  keyframes: [{ at: 0, rotate: -12 }, { at: 0.35, rotate: 8, ease: "outBack" }, { at: 0.7, rotate: -3, ease: "inOutCubic" }, { at: 1.05, rotate: 4, ease: "inOutCubic" }, { at: o.end - o.start, rotate: 0, ease: "inOutCubic" }],
});

/** A hard wipe of colour that crosses the frame on a cut. */
const wipe = (id: string, fill: string, at: number, W = 1080): L => ({
  id, type: "shape", fill, start: at - 0.22, end: at + 0.18,
  keyframes: [{ at: 0, x: -(W + 80) }, { at: 0.22, x: 0, ease: "inCubic" }, { at: 0.4, x: W + 80, ease: "outCubic" }],
});

/* ---------------------------------------------------------------- 1. Summon the crew (reel) */

function summon(): Scene {
  const W = 1080, M = 72, layers: L[] = [];
  // Act 1: kinetic type on a moving warp, one word per beat.
  layers.push(ground("g-plum", "$colors.plum", 0, 2.1));
  layers.push(pattern("warp", "$assets.warpFlamePlum", 0, 2.1, 10, 1.4));
  const words: [string, string][] = [["Your", "$colors.bone"], ["brand's", "$colors.bone"], ["background", "$colors.gold"], ["crew.", "$colors.acid"]];
  words.forEach(([w, c], i) => layers.push(slam(`w${i}`, w, { x: M, y: 560 + i * 210, w: W - 2 * M, h: 220, size: 210, start: i * B, end: 2.1, color: c, exit: { preset: "slide-left", duration: 0.25, ease: "inCubic" } })));
  layers.push(wipe("cut1", "$colors.flame", 2.1));

  // Act 2: one demon per shot, three beats each, never on its own colour.
  const shots: { who: string; name: string; verb: string; line: string; ground: string; ink: string; chip: string; pat?: string }[] = [
    { who: "scout", name: "Scout", verb: "maps it.", line: "scout: read 1,204 assets. map ready.", ground: "$colors.sapphire", ink: "$colors.bone", chip: "$colors.ink", pat: "$assets.warpSapphireMaya" },
    { who: "keeper", name: "Keeper", verb: "checks it.", line: "keeper: 1 fix. cta colour → flame.", ground: "$colors.ink", ink: "$colors.bone", chip: "$colors.raised" },
    { who: "builder", name: "Builder", verb: "ships it.", line: "builder: 6 sizes from 1 template.", ground: "$colors.gold", ink: "$colors.ink", chip: "$colors.ink" },
    { who: "tally", name: "Tally", verb: "counts it.", line: "tally: 96% on brand first try.", ground: "$colors.plum", ink: "$colors.bone", chip: "$colors.raised" },
  ];
  shots.forEach((s, i) => {
    const t0 = 2.1 + i * 1.5, t1 = t0 + 1.5;
    layers.push(ground(`g-${s.who}`, s.ground, t0, t1));
    if (s.pat) layers.push({ ...pattern(`p-${s.who}`, s.pat, t0, t1, 8, 1.3), opacity: 0.35 });
    layers.push({ id: `ring-${s.who}`, type: "shape", shape: "circle", fill: "transparent", stroke: s.ink, strokeWidth: 6, x: 190, y: 330, width: 700, height: 700, opacity: 0.25, start: t0, end: t1,
      keyframes: [{ at: 0, scale: 0.6, opacity: 0 }, { at: 0.5, scale: 1, opacity: 0.25, ease: "outCubic" }, { at: 1.5, scale: 1.25, opacity: 0, ease: "linear" }] });
    layers.push(demon(`d-${s.who}`, s.who, { x: 240, y: 380, size: 600, start: t0, end: t1, tilt: 6 }));
    layers.push(slam(`n-${s.who}`, s.name, { x: M, y: 1080, w: W - 2 * M, h: 210, size: 200, start: t0 + 0.12, end: t1, color: s.ink, align: "center", enter: { preset: "rise", duration: 0.3, ease: "outBack" } }));
    layers.push({ id: `v-${s.who}`, type: "text", text: s.verb, textStyle: "serif", size: 120, color: s.ink, x: M, y: 1290, width: W - 2 * M, align: "center", style: { fontStyle: "italic" }, start: t0 + B, end: t1, enter: { preset: "slide-right", duration: 0.3, ease: "outCubic" } });
    layers.push(daemon(`l-${s.who}`, s.line, { x: 120, y: 1520, w: 840, size: 34, start: t0 + 0.6, end: t1, color: s.ink === "$colors.ink" ? "$colors.bone" : "$colors.acid", bg: s.chip }));
    if (i < shots.length - 1) layers.push(wipe(`cut-${s.who}`, i % 2 ? "$colors.acid" : "$colors.flame", t1));
  });

  // Act 3: three demons together on bone, a sticker, the ask.
  const a3 = 8.1, a3e = 10.1;
  layers.push(wipe("cut3", "$colors.candy", a3));
  layers.push(ground("g-bone", "$colors.bone", a3, a3e));
  layers.push({ id: "sun", type: "image", src: "$assets.sunray", fit: "cover", opacity: 0.18, start: a3, end: a3e, x: -420, y: -100, width: 1920, height: 1920,
    keyframes: [{ at: 0, rotate: 0 }, { at: 2, rotate: 25, ease: "linear" }] });
  layers.push(slam("ask1", "Summon", { x: M, y: 260, w: W - 2 * M, h: 230, size: 230, start: a3, end: a3e, color: "$colors.ink", align: "center" }));
  layers.push(slam("ask2", "the crew.", { x: M, y: 480, w: W - 2 * M, h: 230, size: 230, start: a3 + B, end: a3e, color: "$colors.ink", align: "center" }));
  layers.push(demon("trio-scout", "scout", { x: 40, y: 900, size: 380, start: a3 + 0.2, end: a3e, tilt: -6 }));
  layers.push(demon("trio-keeper", "keeper", { x: 350, y: 820, size: 400, start: a3 + 0.4, end: a3e, tilt: 5 }));
  layers.push(demon("trio-builder", "builder", { x: 680, y: 900, size: 380, start: a3 + 0.6, end: a3e, tilt: -4 }));
  layers.push(sticker("poof", "Poof!", { x: 640, y: 1380, size: 120, start: a3 + 1.0, end: a3e, fill: "$colors.flame", color: "$colors.ink", rotate: -8 }));
  layers.push(daemon("cmd", "/summon keeper", { x: 300, y: 1620, w: 480, size: 40, start: a3 + 0.9, end: a3e, color: "$colors.acid", bg: "$colors.ink" }));

  // End card: logo on ink.
  layers.push(wipe("cut4", "$colors.flame", a3e));
  layers.push(ground("g-end", "$colors.ink", a3e, 12));
  layers.push({ id: "logo", type: "image", src: "$assets.stackedBone", fit: "contain", x: 240, y: 560, width: 600, height: 480, start: a3e + 0.05, end: 12,
    enter: { preset: "zoom", duration: 0.45, ease: "outBack" }, keyframes: [{ at: 0, scale: 1 }, { at: 1.9, scale: 1.06, ease: "linear" }] });
  layers.push({ id: "tag", type: "text", text: "Your brand's background crew.", textStyle: "serif", size: 72, color: "$colors.bone", x: M, y: 1120, width: W - 2 * M, align: "center", style: { fontStyle: "italic" }, start: a3e + 0.5, end: 12, enter: { preset: "rise", duration: 0.4 } });
  return { size: "reel", duration: 12, fps: 30, background: "$colors.plum", layers, audio: [{ src: AUDIO, volume: 0.8, fadeOut: 0.8 }] };
}

/* ---------------------------------------------------------------- 2. Keeper checks (square) */

function keeper(): Scene {
  const D = 10;
  // A conveyor of ads driven by CSS @keyframes on scene time. Each card scrolls through the
  // scanner; the flagged one gets fixed (its CTA turns flame) after the scan.
  const card = (i: number, bg: string, fg: string, head: string, flagged: boolean) => `
    <div class="card c${i}" style="background:${bg};color:${fg}">
      <div class="k">demons</div>
      <div class="h">${head}</div>
      <div class="cta ${flagged ? "bad" : ""}">Summon</div>
      <div class="pill ${flagged ? "fix" : "ok"}">${flagged ? "fixed: cta colour" : "on brand"}</div>
    </div>`;
  const cards = [
    card(0, "$colors.maya", "$colors.ink", "Colour, type and tone, checked.", false),
    card(1, "$colors.candy", "$colors.ink", "Every asset, before it ships.", true),
    card(2, "$colors.acid", "$colors.ink", "Summon Keeper in Slack.", false),
    card(3, "$colors.gold", "$colors.ink", "The fix, not just the flag.", true),
  ].join("");
  const css = `
    .belt{position:absolute;left:0;top:0;width:1080px;height:1080px}
    .card{position:absolute;top:300px;left:1120px;width:400px;height:460px;border-radius:28px;padding:28px;display:flex;flex-direction:column;gap:14px;
      box-shadow:0 14px 0 $colors.ink;font-family:'Bricolage Grotesque'}
    .k{font-family:'JetBrains Mono';font-size:20px;opacity:.7}
    .h{font-size:52px;font-weight:800;line-height:1;letter-spacing:-0.03em;flex-grow:1}
    .cta{align-self:flex-start;font-size:26px;font-weight:700;padding:12px 22px;border-radius:999px;background:$colors.ink;color:$colors.bone}
    .pill{position:absolute;top:-22px;right:20px;font-family:'JetBrains Mono';font-size:20px;padding:8px 16px;border-radius:999px;opacity:0;transform:scale(.4)}
    .ok{background:$colors.ink;color:$colors.acid}
    .fix{background:$colors.flame;color:$colors.ink}
    @keyframes ride{0%{left:1120px;top:300px;transform:rotate(8deg)}35%{left:590px;top:300px;transform:rotate(0deg)}70%{left:590px;top:300px;transform:rotate(0deg)}100%{left:640px;top:1180px;transform:rotate(-14deg)}}
    @keyframes stamp{0%{opacity:0;transform:scale(.4) rotate(-12deg)}60%{opacity:1;transform:scale(1.15) rotate(4deg)}100%{opacity:1;transform:scale(1) rotate(0deg)}}
    @keyframes fixcta{0%{background:$colors.sapphire;color:$colors.bone}50%{background:$colors.sapphire;transform:scale(1)}75%{transform:scale(1.15)}100%{background:$colors.flame;color:$colors.ink;transform:scale(1)}}
    ${[0, 1, 2, 3].map((i) => {
      const s = 1.0 + i * 1.7;
      return `.c${i}{animation:ride 2.6s cubic-bezier(.65,0,.35,1) ${s}s both}
      .c${i} .pill{animation:stamp .35s cubic-bezier(.34,1.56,.64,1) ${s + 1.05}s both}
      .c${i} .bad{animation:fixcta .7s ease-out ${s + 0.7}s both}`;
    }).join("\n")}
    .scan{position:absolute;left:560px;top:270px;width:460px;height:520px;border:5px dashed $colors.acid;border-radius:36px}
    .beam{position:absolute;left:574px;top:280px;width:432px;height:10px;background:$colors.acid;border-radius:10px;animation:beam 8s linear 1s both}
    @keyframes beam{${Array.from({ length: 17 }, (_, k) => `${(k * 100) / 16}%{top:${k % 2 ? 768 : 284}px}`).join("")}}
  `;
  const layers: L[] = [
    { id: "bg", type: "shape", fill: "$colors.ink" },
    { id: "dots", type: "image", src: "$assets.halftoneFlame", fit: "cover", opacity: 0.12, keyframes: [{ at: 0, scale: 1.3, x: -40 }, { at: D, scale: 1.45, x: 40, ease: "linear" }] },
    { id: "scanner", type: "node", html: `<div class="belt"><div class="scan"></div><div class="beam"></div>${cards}</div>`, css, start: 0.6, enter: "fade" },
    demon("keeper", "keeper", { x: 60, y: 340, size: 400, start: 0.2, end: D, tilt: 4 }),
    { id: "title", type: "text", text: "Keeper checks every asset.", textStyle: "headline", size: 92, color: "$colors.bone", x: 64, y: 64, width: 952, start: 0, end: 7.6,
      enter: { preset: "rise", duration: 0.45, ease: "outBack" }, exit: { preset: "slide-left", duration: 0.3, ease: "inCubic" } },
    daemon("log1", "keeper: 4 assets in. 2 fixes.", { x: 64, y: 900, w: 620, size: 30, start: 2.4, end: 7.6, color: "$colors.acid", bg: "$colors.raised" }),
    sticker("bam", "Bam!", { x: 820, y: 140, size: 84, start: 2.75, end: 3.9, fill: "$colors.gold", color: "$colors.ink", rotate: 10 }),
    sticker("poof", "Poof!", { x: 760, y: 820, size: 84, start: 6.15, end: 7.3, fill: "$colors.candy", color: "$colors.ink", rotate: -8 }),
    wipe("cut", "$colors.flame", 7.7),
    ground("end", "$colors.flame", 7.7, D),
    { id: "fixline", type: "text", text: "With the fix, not just the flag.", textStyle: "display", size: 160, color: "$colors.ink", x: 64, y: 250, width: 952, height: 400, start: 7.75, end: D,
      enter: { preset: "zoom", duration: 0.4, ease: "outBack" } },
    { id: "logo", type: "image", src: "$assets.lockupInk", fit: "contain", x: 64, y: 860, width: 360, height: 120, start: 8.2, end: D, enter: { preset: "slide-right", duration: 0.4 } },
    daemon("cmd", "/summon keeper", { x: 640, y: 880, w: 380, size: 30, start: 8.5, end: D, color: "$colors.acid", bg: "$colors.ink" }),
  ];
  return { size: "square", duration: D, fps: 30, background: "$colors.ink", layers, audio: [{ src: AUDIO, trim: [2, 12], volume: 0.8, fadeIn: 0.2, fadeOut: 0.6 }] };
}

/* ---------------------------------------------------------------- 3. Tally's numbers (landscape) */

function tally(): Scene {
  const D = 9;
  // Odometer digits: each column is 0–9 stacked, slid up with CSS keyframes.
  const odo = (value: string, cls: string, delay: number) => {
    let i = 0;
    return `<div class="odo ${cls}">${[...value].map((ch) => {
      if (!/\d/.test(ch)) return `<span class="sep">${ch}</span>`;
      const n = Number(ch), d = delay + i++ * 0.08;
      return `<span class="col"><span class="reel" style="animation:roll${n} 1.4s cubic-bezier(.2,.9,.1,1) ${d}s both">${"0123456789".split("").map((x) => `<span>${x}</span>`).join("")}</span></span>`;
    }).join("")}</div>`;
  };
  const rolls = Array.from({ length: 10 }, (_, n) => `@keyframes roll${n}{from{transform:translateY(0px)}to{transform:translateY(-${n * 150}px)}}`).join("\n");
  const stat = (x: number, value: string, label: string, color: string, delay: number, cls: string) => `
    <div class="stat" style="left:${x}px">${odo(value, cls, delay)}<div class="lab" style="color:${color};animation:up .4s ease-out ${delay + 0.9}s both">${label}</div></div>`;
  const bars = [0.42, 0.6, 0.55, 0.78, 0.7, 0.92, 0.88, 1].map((h, i) =>
    `<div class="bar" style="height:${Math.round(h * 560)}px;background:${i === 7 ? "$colors.acid" : "$colors.gold"};animation:grow .7s cubic-bezier(.34,1.56,.64,1) ${4.6 + i * 0.12}s both"></div>`).join("");
  const css = `
    .wrap{position:absolute;left:0;top:0;width:1920px;height:1080px;font-family:'Bricolage Grotesque';color:$colors.bone}
    .stat{position:absolute;top:430px;display:flex;flex-direction:column;gap:10px}
    .odo{display:flex;height:150px;overflow:hidden;font-size:160px;font-weight:800;line-height:150px;letter-spacing:-0.04em}
    .col{display:flex;justify-content:center;width:0.6em;height:150px;overflow:hidden}
    .reel{display:flex;flex-direction:column;align-items:center}
    .reel span{height:150px;line-height:150px}
    .sep{height:150px;line-height:150px}
    .lab{font-family:'JetBrains Mono';font-size:40px}
    @keyframes up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0px)}}
    ${rolls}
    .chart{position:absolute;left:780px;top:330px;width:1040px;height:600px;display:flex;align-items:flex-end;gap:26px;border-bottom:4px solid $colors.raised}
    .bar{width:96px;border-radius:18px 18px 0 0;transform-origin:50% 100%}
    @keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
  `;
  const layers: L[] = [
    { id: "bg", type: "shape", fill: "$colors.plum" },
    { id: "dots", type: "image", src: "$assets.halftoneMaya", fit: "cover", opacity: 0.14, keyframes: [{ at: 0, scale: 1.2, rotate: -3 }, { at: D, scale: 1.4, rotate: 3, ease: "linear" }] },
    { id: "eyebrow", type: "text", text: "tally: this quarter", textStyle: "daemon", size: 36, color: "$colors.acid", x: 100, y: 180, width: 800, enter: { preset: "typewriter", duration: 0.6, ease: "linear" }, end: 4.3 },
    { id: "head", type: "text", text: "The crew keeps count.", textStyle: "headline", size: 120, color: "$colors.bone", x: 100, y: 230, width: 1600, enter: { preset: "rise", duration: 0.45, ease: "outBack", delay: 0.2 }, end: 4.3, exit: { preset: "slide-left", duration: 0.3, ease: "inCubic" } },
    { id: "stats", type: "node", html: `<div class="wrap">${stat(100, "12,480", "assets checked", "$colors.gold", 0.6, "a")}${stat(760, "96%", "on brand first try", "$colors.maya", 1.0, "b")}${stat(1320, "4,200", "fixes shipped", "$colors.candy", 1.4, "c")}</div>`, css, end: 4.3, exit: { preset: "drop", duration: 0.3, ease: "inCubic" } },
    wipe("cut0", "$colors.flame", 4.35, 1920),
    { id: "chart-title", type: "text", text: "On brand, week by week.", textStyle: "headline", size: 110, color: "$colors.bone", x: 100, y: 110, width: 1700, start: 4.4, end: 7.3, enter: { preset: "rise", duration: 0.4 } },
    { id: "chart", type: "node", html: `<div class="wrap"><div class="chart">${bars}</div></div>`, start: 4.4, end: 7.3 },
    demon("tally", "tally", { x: 120, y: 380, size: 560, start: 4.5, end: 7.3, tilt: 5 }),
    sticker("bam", "Bam!", { x: 1600, y: 260, size: 90, start: 5.6, end: 7.3, fill: "$colors.flame", color: "$colors.ink", rotate: 9 }),
    wipe("cut", "$colors.acid", 7.4, 1920),
    ground("end", "$colors.gold", 7.4, D),
    { id: "half", type: "image", src: "$assets.halftoneMaya", fit: "cover", opacity: 0.25, start: 7.4, end: D, keyframes: [{ at: 0, scale: 1.2 }, { at: 1.6, scale: 1.35, ease: "linear" }] },
    { id: "logo", type: "image", src: "$assets.lockupInk", fit: "contain", x: 560, y: 380, width: 800, height: 240, start: 7.45, end: D, enter: { preset: "zoom", duration: 0.45, ease: "outBack" } },
    { id: "tag", type: "text", text: "Your brand's background crew.", textStyle: "serif", size: 64, color: "$colors.ink", x: 160, y: 680, width: 1600, align: "center", style: { fontStyle: "italic" }, start: 7.8, end: D, enter: "rise" },
  ];
  return { size: "landscape", duration: D, fps: 30, background: "$colors.plum", layers, audio: [{ src: AUDIO, trim: [4, 13], volume: 0.8, fadeOut: 0.6 }] };
}

export const SIZZLE: Record<string, () => Scene> = {
  "demons-summon-reel": summon,
  "demons-keeper-square": keeper,
  "demons-tally-landscape": tally,
};
