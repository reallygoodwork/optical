import { z } from "zod";
import type { Brand, Scene } from "./schema.js";

export interface Template<P extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** Size used when the caller doesn't pass one. */
  size?: Scene["size"];
  props: P;
  build(props: z.infer<P>, ctx: { brand: Brand; size: { width: number; height: number } }): Scene;
}

export function defineTemplate<P extends z.ZodType>(t: Template<P>): Template<P> {
  return t;
}

export function describeTemplate(t: Template) {
  return {
    name: t.name,
    description: t.description,
    size: t.size,
    props: z.toJSONSchema(t.props, { unrepresentable: "any" }),
  };
}

/* ----------------------------------------------------------------------------------------------
 * Starter templates. Each is plain data in, scene out, so agents can read them as examples.
 * --------------------------------------------------------------------------------------------*/

const isPortrait = (s: { width: number; height: number }) => s.height > s.width * 1.1;

export const quoteCard = defineTemplate({
  name: "quote-card",
  description: "Pull quote with attribution. Good for testimonials and social posts. Animates if rendered as video.",
  size: "square",
  props: z.object({
    quote: z.string(),
    author: z.string().optional(),
    role: z.string().optional(),
    background: z.string().optional().describe("color/gradient/token, default $colors.primary or brand background"),
  }),
  build: (p, { brand, size }) => {
    const m = Math.round(Math.min(size.width, size.height) * 0.08);
    return {
      background: p.background ?? (brand.colors.primary ? "$colors.primary" : undefined),
      color: brand.colors.onPrimary ? "$colors.onPrimary" : undefined,
      layers: [
        { id: "mark", type: "text", text: "“", textStyle: "display", size: Math.round(size.width * 0.22), position: "top-left", margin: m, enter: "fade", lineHeight: 1 },
        { id: "quote", type: "text", text: p.quote, textStyle: "display", position: "center", width: size.width - 2 * m, height: Math.round(size.height * (isPortrait(size) ? 0.5 : 0.48)), size: Math.round(size.width * 0.075), align: "left", enter: { preset: "rise", delay: 0.15 } },
        ...(p.author
          ? [{ id: "author", type: "text" as const, text: [p.author, p.role].filter(Boolean).join(" · "), textStyle: "body", size: Math.round(size.width * 0.03), position: "bottom-left" as const, margin: m, enter: { preset: "fade" as const, delay: 0.45 } }]
          : []),
        ...(brand.assets.logo ? [{ id: "logo", type: "image" as const, src: brand.assets.logoOnDark ? "$assets.logoOnDark" : "$assets.logo", fit: "contain" as const, width: Math.round(size.width * 0.14), height: Math.round(size.width * 0.06), position: "bottom-right" as const, margin: m, enter: { preset: "fade" as const, delay: 0.6 } }] : []),
      ],
    };
  },
});

export const announcement = defineTemplate({
  name: "announcement",
  description: "Launch / announcement card: eyebrow, headline, subline, CTA. Optional background image or video with a scrim. Works as still or motion.",
  size: "instagram-story",
  props: z.object({
    eyebrow: z.string().optional(),
    headline: z.string(),
    subline: z.string().optional(),
    cta: z.string().optional(),
    media: z.string().optional().describe("background image or video URL/path"),
    mediaType: z.enum(["image", "video"]).optional().describe("inferred from extension if omitted"),
    duration: z.number().optional().describe("seconds when rendered as video, default 6"),
  }),
  build: (p, { brand, size }) => {
    const m = Math.round(Math.min(size.width, size.height) * 0.07);
    const portrait = isPortrait(size);
    const isVideo = p.media ? (p.mediaType ?? (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(p.media) ? "video" : "image")) === "video" : false;
    const W = size.width - 2 * m;
    return {
      duration: p.duration ?? 6,
      background: "$colors.ink",
      color: "#ffffff",
      layers: [
        ...(p.media
          ? [
              isVideo
                ? { id: "media", type: "video" as const, src: p.media, loop: true, volume: 0, keyframes: [{ at: 0, scale: 1.06 }, { at: p.duration ?? 6, scale: 1, ease: "linear" as const }] }
                : { id: "media", type: "image" as const, src: p.media, keyframes: [{ at: 0, scale: 1.08 }, { at: p.duration ?? 6, scale: 1, ease: "linear" as const }] },
              { id: "scrim", type: "shape" as const, fill: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.78) 100%)" },
            ]
          : []),
        {
          id: "copy",
          type: "group",
          position: portrait ? "bottom-left" : "left",
          margin: m,
          width: portrait ? W : Math.round(size.width * 0.6),
          layout: "column",
          gap: Math.round(m * 0.35),
          children: [
            ...(p.eyebrow ? [{ id: "eyebrow", type: "text" as const, text: p.eyebrow, textStyle: "eyebrow", size: Math.round(size.width * 0.028), uppercase: true, letterSpacing: 0.12, color: brand.colors.accent ? "$colors.accent" : undefined, enter: { preset: "fade" as const, delay: 0.1 } }] : []),
            { id: "headline", type: "text" as const, text: p.headline, textStyle: "display", size: Math.round(size.width * (portrait ? 0.1 : 0.065)), height: Math.round(size.height * (portrait ? 0.24 : 0.36)), fit: "box" as const, enter: { preset: "rise" as const, delay: 0.2 } },
            ...(p.subline ? [{ id: "subline", type: "text" as const, text: p.subline, textStyle: "body", size: Math.round(size.width * (portrait ? 0.038 : 0.024)), color: "rgba(255,255,255,.82)", enter: { preset: "rise" as const, delay: 0.35 } }] : []),
            ...(p.cta
              ? [{ id: "cta", type: "text" as const, text: p.cta, textStyle: "body", weight: 700, size: Math.round(size.width * (portrait ? 0.034 : 0.02)), background: brand.colors.accent ? "$colors.accent" : "#ffffff", color: brand.colors.ink ? "$colors.ink" : "#000000", padding: [Math.round(m * 0.22), Math.round(m * 0.45)], radius: 999, style: { alignSelf: "flex-start" }, enter: { preset: "pop" as const, delay: 0.55 } }]
              : []),
          ],
        },
        ...(brand.assets.logo ? [{ id: "logo", type: "image" as const, src: brand.assets.logoOnDark ? "$assets.logoOnDark" : "$assets.logo", fit: "contain" as const, width: Math.round(size.width * 0.18), height: Math.round(size.width * 0.07), position: "top-left" as const, margin: m, enter: "fade" as const }] : []),
      ],
    };
  },
});

export const statReel = defineTemplate({
  name: "stat",
  description: "Big number with a label, counted up when rendered as video. For results, milestones, metrics.",
  size: "square",
  props: z.object({
    value: z.number(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    label: z.string(),
    decimals: z.number().int().min(0).max(4).optional(),
    countUp: z.boolean().optional().describe("default true"),
  }),
  build: (p, { size }) => {
    const steps = p.countUp === false ? 1 : 24;
    const dur = 1.6;
    const fmt = (v: number) => `${p.prefix ?? ""}${v.toLocaleString("en-US", { minimumFractionDigits: p.decimals ?? 0, maximumFractionDigits: p.decimals ?? 0 })}${p.suffix ?? ""}`;
    // Count-up as a sequence of short-lived text layers: pure data, no code in the scene.
    const numbers = Array.from({ length: steps }, (_, i) => {
      const e = 1 - (1 - (i + 1) / steps) ** 3;
      const last = i === steps - 1;
      return {
        id: last ? "value" : `value-${i}`,
        type: "text" as const,
        text: fmt(p.value * e),
        textStyle: "display",
        size: Math.round(size.width * 0.2),
        fit: "line" as const,
        width: Math.round(size.width * 0.84),
        position: "center" as const,
        align: "center" as const,
        start: last ? (i * dur) / steps : (i * dur) / steps,
        ...(last ? {} : { end: ((i + 1) * dur) / steps }),
      };
    });
    return {
      duration: 4,
      background: "$colors.ink",
      color: "#ffffff",
      layers: [
        ...numbers,
        { id: "label", type: "text", text: p.label, textStyle: "body", size: Math.round(size.width * 0.045), width: Math.round(size.width * 0.8), position: "bottom", align: "center", margin: Math.round(size.height * 0.18), enter: { preset: "rise", delay: 0.4 } },
      ],
    };
  },
});

export const titleCard = defineTemplate({
  name: "title-card",
  description: "Full-bleed title over a brand colour, gradient, or image. Use for YouTube thumbnails, OG images, chapter cards, slide covers.",
  size: "og",
  props: z.object({
    title: z.string(),
    kicker: z.string().optional(),
    image: z.string().optional(),
    background: z.string().optional(),
  }),
  build: (p, { brand, size }) => {
    const m = Math.round(Math.min(size.width, size.height) * 0.08);
    return {
      background: p.background ?? "$colors.ink",
      color: "#ffffff",
      layers: [
        ...(p.image ? [{ id: "image", type: "image" as const, src: p.image }, { id: "scrim", type: "shape" as const, fill: "linear-gradient(90deg, rgba(0,0,0,.8), rgba(0,0,0,.1))" }] : []),
        ...(p.kicker ? [{ id: "kicker", type: "text" as const, text: p.kicker, textStyle: "eyebrow", uppercase: true, letterSpacing: 0.14, size: Math.round(size.height * 0.045), position: "top-left" as const, margin: m, color: brand.colors.accent ? "$colors.accent" : undefined, enter: "fade" as const }] : []),
        { id: "title", type: "text", text: p.title, textStyle: "display", size: Math.round(size.height * 0.16), width: Math.round(size.width * 0.78), height: Math.round(size.height * 0.56), position: "bottom-left", margin: m, enter: "rise" },
      ],
    };
  },
});

export const BUILTIN_TEMPLATES: Template<any>[] = [quoteCard, announcement, statReel, titleCard];
