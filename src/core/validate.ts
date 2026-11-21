import type { Backend } from "./backend.js";
import { SceneSchema, type Brand, type Layer, type Scene } from "./schema.js";
import { resolveToken } from "./prepare.js";
import { ensureIds, listIds } from "./edit.js";
import { resolveSize } from "./sizes.js";

export interface Issue {
  path: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  info?: { width: number; height: number; duration?: number; layers: string[] };
}

/** Everything an agent needs to fix a scene before spending a render on it. */
export async function validate(sceneInput: Scene, brand: Brand, backend?: Backend, sources?: string[]): Promise<ValidationReport> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const parsed = SceneSchema.safeParse(sceneInput);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })), warnings };
  }
  const scene = structuredClone(parsed.data);
  ensureIds(scene.layers);

  let size = { width: 0, height: 0 };
  try {
    size = resolveSize(scene.size);
  } catch (e) {
    errors.push({ path: "size", message: (e as Error).message });
  }

  // tokens
  const missing: string[] = [];
  resolveToken(JSON.stringify({ ...scene, layers: stripNodes(scene.layers) }), brand, missing);
  for (const m of new Set(missing)) errors.push({ path: "tokens", message: `Unknown brand token ${m}. Known: ${knownTokens(brand).slice(0, 30).join(", ")}` });

  const seen = new Set<string>();
  const families = new Set([...brand.fontFaces.map((f) => f.family.toLowerCase())]);
  const media: Promise<void>[] = [];

  const walk = (layers: Layer[], path: string) => {
    layers.forEach((l, i) => {
      const p = `${path}[${i}](${l.id})`;
      if (seen.has(l.id!)) errors.push({ path: p, message: `Duplicate id "${l.id}"` });
      seen.add(l.id!);
      if (l.end !== undefined && l.start !== undefined && l.end <= l.start) errors.push({ path: p, message: `end (${l.end}) must be after start (${l.start})` });
      if (scene.duration !== undefined && (l.start ?? 0) >= scene.duration) warnings.push({ path: p, message: `starts at ${l.start}s but the scene is ${scene.duration}s long, so it never shows` });
      if (l.type === "text") {
        if (l.textStyle && !brand.text[l.textStyle]) warnings.push({ path: p, message: `Unknown textStyle "${l.textStyle}". Brand styles: ${Object.keys(brand.text).join(", ") || "(none)"}` });
        const font = resolveToken(l.font ?? (l.textStyle ? brand.text[l.textStyle]?.font : undefined) ?? "", brand);
        if (font && families.size && !families.has(font.toLowerCase())) warnings.push({ path: p, message: `Font "${font}" is not in brand.fontFaces; it will fall back.` });
        const bg = resolveToken(l.background ?? backdropAt(layers, i, l.start ?? 0) ?? scene.background ?? brand.defaults.background ?? "", brand);
        const fg = resolveToken(l.color ?? (l.textStyle ? brand.text[l.textStyle]?.color : undefined) ?? scene.color ?? brand.defaults.color ?? "", brand);
        const ratio = contrast(fg, bg);
        if (ratio !== null && ratio < 3) warnings.push({ path: p, message: `Low contrast ${ratio.toFixed(2)}:1 between text ${fg} and background ${bg} (aim for 4.5:1, 3:1 for large type)` });
        if (!l.text.trim()) warnings.push({ path: p, message: "Empty text" });
      }
      if ((l.type === "video" || l.type === "image") && backend) {
        const src = resolveToken(l.src, brand);
        media.push(
          (l.type === "video" ? backend.probe(src) : backend.loadBytes(src)).then(
            (info: any) => {
              if (l.type === "video" && l.trim && info?.duration && l.trim[0] >= info.duration) errors.push({ path: p, message: `trim starts at ${l.trim[0]}s but the video is ${info.duration.toFixed(2)}s` });
            },
            (e: Error) => void errors.push({ path: p, message: `Can't load ${l.type} "${src}": ${e.message}` }),
          ),
        );
      }
      if (l.type === "source" && sources && !sources.includes(l.source)) errors.push({ path: p, message: `Unknown source "${l.source}". Registered: ${sources.join(", ") || "(none)"}` });
      if (l.type === "group") walk(l.children, `${p}.children`);
    });
  };
  walk(scene.layers, "layers");
  await Promise.all(media);

  return { ok: errors.length === 0, errors, warnings, info: { width: size.width, height: size.height, duration: scene.duration, layers: listIds(scene.layers) } };
}

function stripNodes(layers: Layer[]): unknown[] {
  return layers.map((l) => (l.type === "node" ? { ...l, node: null } : l.type === "group" ? { ...l, children: stripNodes(l.children) } : l));
}

function knownTokens(brand: Brand) {
  const out: string[] = [];
  for (const k of Object.keys(brand.colors)) out.push(`$colors.${k}`);
  for (const k of Object.keys(brand.fonts)) out.push(`$fonts.${k}`);
  for (const k of Object.keys(brand.assets)) out.push(`$assets.${k}`);
  return out;
}

/**
 * What sits behind layer `i` when it starts: the last earlier full-frame layer that is showing
 * at that moment. A solid shape gives its fill; an image or video gives "" (unknown, so the
 * contrast check is skipped). Moving or translucent shapes (wipes, scrims) are ignored.
 */
function backdropAt(layers: Layer[], i: number, t: number): string | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const b = layers[j]!;
    const full = b.position === undefined && b.x === undefined && b.y === undefined && b.width === undefined && b.height === undefined;
    if (!full || (b.start ?? 0) > t || (b.end !== undefined && b.end <= t)) continue;
    if (b.type === "image" || b.type === "video" || b.type === "source") {
      if ((b.opacity ?? 1) >= 0.5) return "";
      continue;
    }
    if (b.type === "shape" && !b.keyframes?.length && (b.opacity ?? 1) === 1 && b.fill) return b.fill;
  }
  return undefined;
}

/* WCAG contrast for solid hex/rgb colors; null when either side isn't a plain color. */
export function contrast(a: string, b: string): number | null {
  const ca = parseColor(a), cb = parseColor(b);
  if (!ca || !cb) return null;
  const L = (c: number[]) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [L(ca), L(cb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(c: string): number[] | null {
  c = c.trim().toLowerCase();
  if (c === "white") return [255, 255, 255];
  if (c === "black") return [0, 0, 0];
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
  if (m) {
    const h = m[1]!.length === 3 ? m[1]!.split("").map((x) => x + x).join("") : m[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)$/.exec(c);
  if (m && (m[4] === undefined || parseFloat(m[4]) >= 0.99)) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
