import type { Brand, Layer } from "./schema.js";
import { defaultMargin, padBox, textProps, toPx, type PreparedLayer, type PreparedScene } from "./prepare.js";
import { poseAt, type Pose } from "./motion.js";

/** Minimal Takumi node shapes (kept local so core has no runtime dependency on Takumi). */
export type TNode =
  | { type: "container"; style?: Record<string, unknown>; children?: TNode[] }
  | { type: "text"; text: string; style?: Record<string, unknown> }
  | { type: "image"; src: string | Uint8Array | RgbaImage; style?: Record<string, unknown>; width?: number; height?: number };

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
  premultiplied?: boolean;
}

export interface FrameMedia {
  /** Current decoded frame for a video layer, already sized to the layer's box. */
  video(id: string): RgbaImage | null | undefined;
  /** Pixels produced by a source layer for this frame. */
  source?(id: string): RgbaImage | null | undefined;
}

export function paint(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  return /gradient\(|url\(/.test(value) ? { backgroundImage: value } : { backgroundColor: value };
}

const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;

function positionFlex(pos: string) {
  const v = pos.includes("top") ? "flex-start" : pos.includes("bottom") ? "flex-end" : "center";
  const h = pos.includes("left") ? "flex-start" : pos.includes("right") ? "flex-end" : "center";
  return { alignItems: h, justifyContent: v };
}

function transformCss(p: Pose): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const parts: string[] = [];
  if (p.x || p.y) parts.push(`translate(${r2(p.x)}px, ${r2(p.y)}px)`);
  if (p.scale !== 1) parts.push(`scale(${r4(p.scale)})`);
  if (p.rotate) parts.push(`rotate(${r2(p.rotate)}deg)`);
  if (parts.length) s.transform = parts.join(" ");
  if (p.opacity < 1) s.opacity = r4(Math.max(0, p.opacity));
  if (p.blur > 0.05) s.filter = `blur(${r2(p.blur)}px)`;
  if (p.reveal < 1) s.clipPath = `inset(0 ${r2((1 - p.reveal) * 100)}% 0 0)`;
  return s;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Build the Takumi node tree for the frame at scene time `t` (seconds). */
export function compileFrame(ps: PreparedScene, t: number, media: FrameMedia): TNode {
  const { scene, brand, width: W, height: H } = ps;
  const children: TNode[] = [];
  for (const pl of ps.layers) {
    const n = layerNode(pl, ps, t, media, true);
    if (n) children.push(n);
  }
  return {
    type: "container",
    style: {
      width: W,
      height: H,
      position: "relative",
      overflow: "hidden",
      display: "flex",
      ...(ps.transparent ? {} : paint(scene.background ?? brand.defaults.background ?? "#ffffff")),
      color: scene.color ?? brand.defaults.color ?? "#000000",
      ...(scene.font || brand.defaults.font || brand.fonts.body ? { fontFamily: scene.font ?? brand.defaults.font ?? brand.fonts.body } : {}),
    },
    children,
  };
}

function visible(pl: PreparedLayer, t: number, ps: PreparedScene) {
  if (ps.duration <= 0) return true;
  const eps = 1e-6;
  return t + eps >= pl.start && t < pl.end - eps;
}

function layerNode(pl: PreparedLayer, ps: PreparedScene, t: number, media: FrameMedia, top: boolean): TNode | null {
  const { brand, width: W, height: H } = ps;
  const l = pl.layer;
  const inTime = visible(pl, t, ps);
  if (!inTime && top) return null;
  // Stills (no duration) always show the settled pose: entrances finished, no exits.
  const pose = poseAt(l, pl.start, pl.end, ps.duration > 0 ? t : 1e6, brand, Math.min(W, H));
  if (!inTime) pose.opacity = 0;

  const box = boxStyle(l, W, H, brand, top);
  const inner = contentNode(pl, ps, t, media, pose);
  const look: Record<string, unknown> = {
    ...paint(l.background),
    ...(l.radius !== undefined ? { borderRadius: typeof l.radius === "number" ? l.radius : l.radius, overflow: "hidden" } : {}),
    ...(l.padding !== undefined ? { padding: Array.isArray(l.padding) ? l.padding.map((p) => `${p}px`).join(" ") : l.padding } : {}),
    ...(l.shadow ? { boxShadow: l.shadow } : {}),
    ...transformCss(pose),
    ...(l.style ?? {}),
  };
  const boxNode: TNode = { type: "container", style: { display: "flex", ...box.inner, ...look }, children: inner ? [inner] : [] };
  if (box.outer) return { type: "container", style: box.outer, children: [boxNode] };
  return boxNode;
}

/** Returns styles for the positioned box. `outer` is a full-frame flex wrapper when `position` is used. */
function boxStyle(l: Layer, W: number, H: number, brand: Brand, top: boolean) {
  const w = l.width, h = l.height;
  const size: Record<string, unknown> = {};
  if (w !== undefined) size.width = w;
  if (h !== undefined) size.height = h;
  if (!top) return { inner: { ...size, flexShrink: 0, position: "relative" } };

  if (l.position) {
    const m = l.margin ?? defaultMargin(brand, W, H);
    return {
      outer: { position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", flexDirection: "column", padding: m, ...positionFlex(l.position) },
      inner: { ...size, maxWidth: "100%", maxHeight: "100%", flexShrink: 0, ...(w === undefined && l.type !== "text" ? {} : {}) },
    };
  }
  if (l.x !== undefined || l.y !== undefined || w !== undefined || h !== undefined) {
    if (l.x === undefined && l.y === undefined) {
      // sized but unplaced: centre it
      return {
        outer: { position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", alignItems: "center", justifyContent: "center" },
        inner: { ...size, flexShrink: 0 },
      };
    }
    return { inner: { position: "absolute", left: toPx(l.x, W) ?? 0, top: toPx(l.y, H) ?? 0, ...size } };
  }
  return { inner: { position: "absolute", left: 0, top: 0, width: W, height: H } };
}

function contentNode(pl: PreparedLayer, ps: PreparedScene, t: number, media: FrameMedia, pose: Pose): TNode | null {
  const l = pl.layer;
  const { brand, scene } = ps;
  switch (l.type) {
    case "text": {
      const tp = textProps(l, brand, scene);
      const fitMode = l.fit ?? (l.height !== undefined ? "box" : "none");
      let text = l.uppercase ?? tp.uppercase ? l.text.toUpperCase() : l.text;
      if (pose.chars < 1) text = text.slice(0, Math.round(text.length * pose.chars));
      const pos = l.position ?? "";
      const vAlign = pos.includes("bottom") ? "flex-end" : pos.includes("top") ? "flex-start" : l.height !== undefined ? "center" : "flex-start";
      return {
        type: "container",
        style: { display: "flex", flexDirection: "column", justifyContent: vAlign, width: "100%", height: "100%" },
        children: [{
          type: "text",
          text: text || "​",
          style: {
            fontSize: pl.fittedSize ?? tp.size,
            ...(tp.font ? { fontFamily: tp.font } : {}),
            ...(tp.weight ? { fontWeight: tp.weight } : {}),
            lineHeight: tp.lineHeight,
            ...(tp.letterSpacing !== undefined ? { letterSpacing: `${tp.letterSpacing}em` } : {}),
            color: tp.color,
            textAlign: l.align ?? (pos.includes("right") ? "right" : pos.includes("left") || !pos ? "left" : "center"),
            ...(fitMode === "line" ? { whiteSpace: "nowrap", textFit: "shrink" } : {}),
            width: "100%",
          },
        }],
      };
    }
    case "image":
      return { type: "image", src: l.src, style: { width: "100%", height: "100%", objectFit: l.fit ?? "cover", ...(l.focus ? { objectPosition: l.focus } : {}) } };
    case "video": {
      const frame = media.video(pl.id);
      if (!frame) return null;
      return { type: "image", src: frame, style: { width: "100%", height: "100%", objectFit: l.fit ?? "cover" } };
    }
    case "source": {
      const frame = media.source?.(pl.id);
      if (!frame) return null;
      return { type: "image", src: frame, style: { width: "100%", height: "100%", objectFit: l.fit ?? "cover" } };
    }
    case "shape":
      return {
        type: "container",
        style: {
          width: "100%",
          height: "100%",
          ...paint(l.fill ?? "#000"),
          ...(l.shape === "circle" ? { borderRadius: "50%" } : {}),
          ...(l.stroke ? { border: `${l.strokeWidth ?? 2}px solid ${l.stroke}` } : {}),
        },
      };
    case "node": {
      if (pl.htmlNode) return { type: "container", className: "optical-web", style: { width: "100%", height: "100%", display: "block" }, children: [pl.htmlNode as TNode] } as TNode;
      return (l.node as TNode) ?? null;
    }
    case "group": {
      const dir = l.layout === "row" ? "row" : "column";
      const kids = (pl.children ?? []).map((c) => layerNode(c, ps, t, media, false)).filter(Boolean) as TNode[];
      const stack = l.layout === "stack";
      return {
        type: "container",
        style: {
          display: "flex",
          flexDirection: dir,
          width: "100%",
          height: "100%",
          ...(l.gap !== undefined ? { gap: l.gap } : {}),
          alignItems: ALIGN[l.align ?? "stretch"],
          justifyContent: JUSTIFY[l.justify ?? "start"],
          ...(stack ? { position: "relative" } : {}),
        },
        children: stack ? kids.map((k) => ({ ...k, style: { ...(k as any).style, position: "absolute", left: 0, top: 0 } }) as TNode) : kids,
      };
    }
  }
}

/** Text measurement node: same styles the frame uses, so fitting matches rendering exactly. */
export function measureNode(spec: { text: string; font?: string; weight?: number; size: number; lineHeight?: number; letterSpacing?: number; uppercase?: boolean; width: number }): TNode {
  return {
    type: "container",
    style: { width: spec.width, display: "flex", flexDirection: "column" },
    children: [{
      type: "text",
      text: spec.uppercase ? spec.text.toUpperCase() : spec.text,
      style: {
        width: "100%",
        fontSize: spec.size,
        ...(spec.font ? { fontFamily: spec.font } : {}),
        ...(spec.weight ? { fontWeight: spec.weight } : {}),
        lineHeight: spec.lineHeight ?? 1.15,
        ...(spec.letterSpacing !== undefined ? { letterSpacing: `${spec.letterSpacing}em` } : {}),
      },
    }],
  };
}

export { padBox };
