import { z } from "zod";

/**
 * The scene format. Everything an agent writes is plain JSON that validates against these
 * schemas, so a scene can be stored, diffed, edited with ops, sent over the wire, and rendered
 * identically on a device or a server.
 *
 * Conventions:
 * - Times are in seconds. Sizes are px numbers or percentage strings ("50%") of the frame.
 * - Any string value starting with "$" is a brand token: "$colors.primary", "$assets.logo".
 *   A bare "$primary" looks in colors first, then assets.
 */

const Length = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?%$/, "use a number (px) or a percentage like \"50%\"")]);
export type Length = z.infer<typeof Length>;

export const EASINGS = [
  "linear", "in", "out", "inOut",
  "inCubic", "outCubic", "inOutCubic",
  "inQuart", "outQuart", "inOutQuart",
  "inExpo", "outExpo", "inOutExpo",
  "outBack", "spring",
] as const;
export const Easing = z.enum(EASINGS);
export type Easing = z.infer<typeof Easing>;

export const MOTION_PRESETS = [
  "fade", "rise", "drop", "slide-left", "slide-right", "zoom", "pop", "blur", "wipe", "typewriter",
] as const;
export const MotionPreset = z.enum(MOTION_PRESETS);

const Motion = z.union([
  MotionPreset,
  z.object({
    preset: MotionPreset,
    duration: z.number().positive().optional().describe("seconds, default from brand.motion.duration (0.6)"),
    delay: z.number().min(0).optional(),
    ease: Easing.optional(),
    distance: z.number().optional().describe("px travelled by rise/drop/slide, default 8% of the frame"),
  }),
]);
export type Motion = z.infer<typeof Motion>;

const Keyframe = z.object({
  at: z.number().min(0).describe("seconds from the layer's start"),
  ease: Easing.optional().describe("easing used to arrive at this keyframe"),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().optional(),
  rotate: z.number().optional().describe("degrees"),
  opacity: z.number().min(0).max(1).optional(),
  blur: z.number().min(0).optional(),
});
export type Keyframe = z.infer<typeof Keyframe>;

export const POSITIONS = [
  "center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right",
] as const;

const LayerBase = {
  id: z.string().optional().describe("stable name used by edit ops; auto-assigned if missing"),
  // geometry
  position: z.enum(POSITIONS).optional().describe("snap the box inside the frame's safe margin; omit to fill the frame or use x/y"),
  x: Length.optional(),
  y: Length.optional(),
  width: Length.optional(),
  height: Length.optional(),
  margin: z.number().optional().describe("safe margin in px used by `position`, default brand.layout.margin or 6% of the short side"),
  // timing
  start: z.number().min(0).optional().describe("seconds, default 0"),
  end: z.number().min(0).optional().describe("seconds, default scene end"),
  // motion
  enter: Motion.optional(),
  exit: Motion.optional(),
  keyframes: z.array(Keyframe).optional(),
  // static transform / look
  opacity: z.number().min(0).max(1).optional(),
  rotate: z.number().optional(),
  scale: z.number().optional(),
  blur: z.number().min(0).optional(),
  radius: Length.optional(),
  background: z.string().optional().describe("color, gradient, or token"),
  padding: z.union([z.number(), z.array(z.number()).min(2).max(4)]).optional(),
  shadow: z.string().optional().describe("CSS box-shadow, e.g. \"0 20px 60px rgba(0,0,0,.35)\""),
  style: z.record(z.string(), z.any()).optional().describe("escape hatch: raw CSS properties merged last"),
};

export const TextLayer = z.object({
  type: z.literal("text"),
  ...LayerBase,
  text: z.string(),
  textStyle: z.string().optional().describe("name of a brand.text style, e.g. \"display\" or \"body\""),
  font: z.string().optional().describe("family name or token like \"$fonts.display\""),
  size: z.number().positive().optional(),
  weight: z.number().optional(),
  color: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional().describe("em"),
  uppercase: z.boolean().optional(),
  fit: z.enum(["box", "line", "none"]).optional().describe("box (default when the layer has a height): shrink to fit the box; line: keep on one line and shrink; none: never resize"),
  minSize: z.number().optional(),
});

export const ImageLayer = z.object({
  type: z.literal("image"),
  ...LayerBase,
  src: z.string().describe("URL, file path, data URL, or token like \"$assets.logo\""),
  fit: z.enum(["cover", "contain", "fill"]).optional(),
  focus: z.string().optional().describe("object-position, e.g. \"50% 30%\""),
});

export const VideoLayer = z.object({
  type: z.literal("video"),
  ...LayerBase,
  src: z.string(),
  fit: z.enum(["cover", "contain", "fill"]).optional(),
  trim: z.tuple([z.number().min(0), z.number().min(0)]).optional().describe("[in, out] seconds inside the source"),
  speed: z.number().positive().optional(),
  loop: z.boolean().optional(),
  volume: z.number().min(0).max(2).optional().describe("0 mutes; default 1"),
});

export const ShapeLayer = z.object({
  type: z.literal("shape"),
  ...LayerBase,
  shape: z.enum(["rect", "circle"]).optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
});

export const NodeLayer = z.object({
  type: z.literal("node"),
  ...LayerBase,
  html: z.string().optional().describe("HTML with browser CSS semantics (content-box sizing, <style> tags allowed). See the CSS support matrix."),
  css: z.string().optional().describe("CSS for this layer's HTML: classes, :has(), nesting, @media, @keyframes (animated by scene time)…"),
  node: z.any().optional().describe("raw Takumi node tree, for anything else"),
});

export const SourceLayer = z.object({
  type: z.literal("source"),
  ...LayerBase,
  source: z.string().describe("name of a frame source registered with studio.registerSource (Canvas 2D, WebGL, WebGPU, Three.js, Lottie, shaders…)"),
  props: z.record(z.string(), z.any()).optional().describe("passed to the source every frame"),
  fit: z.enum(["cover", "contain", "fill"]).optional(),
});
export type SourceLayer = z.infer<typeof SourceLayer>;

export type TextLayer = z.infer<typeof TextLayer>;
export type ImageLayer = z.infer<typeof ImageLayer>;
export type VideoLayer = z.infer<typeof VideoLayer>;
export type ShapeLayer = z.infer<typeof ShapeLayer>;
export type NodeLayer = z.infer<typeof NodeLayer>;
export type GroupLayer = {
  type: "group";
  layout?: "row" | "column" | "stack";
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  children: Layer[];
} & z.infer<z.ZodObject<typeof LayerBase>>;
export type Layer = TextLayer | ImageLayer | VideoLayer | ShapeLayer | NodeLayer | SourceLayer | GroupLayer;

export const GroupLayer: z.ZodType<GroupLayer> = z.lazy(() =>
  z.object({
    type: z.literal("group"),
    ...LayerBase,
    layout: z.enum(["row", "column", "stack"]).optional(),
    gap: z.number().optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    justify: z.enum(["start", "center", "end", "between"]).optional(),
    children: z.array(LayerSchema),
  }),
) as z.ZodType<GroupLayer>;

export const LayerSchema: z.ZodType<Layer> = z.lazy(() =>
  z.discriminatedUnion("type", [TextLayer, ImageLayer, VideoLayer, ShapeLayer, NodeLayer, SourceLayer, GroupLayer as any]),
) as z.ZodType<Layer>;

export const AudioTrack = z.object({
  src: z.string(),
  start: z.number().min(0).optional().describe("when it starts in the scene, seconds"),
  trim: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  volume: z.number().min(0).max(2).optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
});
export type AudioTrack = z.infer<typeof AudioTrack>;

export const Size = z.union([
  z.string().describe("preset name, see SIZES"),
  z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
]);

export const SceneSchema = z.object({
  size: Size.optional().describe("preset name like \"instagram-story\" or {width,height}; default \"square\""),
  duration: z.number().min(0).optional().describe("seconds; omit for a still or to auto-size to the longest layer"),
  fps: z.number().int().min(1).max(120).optional(),
  background: z.string().optional(),
  font: z.string().optional().describe("default font family for the scene"),
  css: z.string().optional().describe("scene-wide CSS applied to every layer's HTML; tokens like $colors.accent work inside"),
  color: z.string().optional().describe("default text color"),
  layers: z.array(LayerSchema),
  audio: z.array(AudioTrack).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const FontFace = z.object({
  family: z.string(),
  src: z.string().describe("URL, file path, or data URL to a TTF/OTF/WOFF/WOFF2"),
  weight: z.number().optional(),
  style: z.enum(["normal", "italic"]).optional(),
});

export const TextStyle = z.object({
  font: z.string().optional(),
  size: z.number().optional(),
  weight: z.number().optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  uppercase: z.boolean().optional(),
  color: z.string().optional(),
});

export const BrandSchema = z.object({
  name: z.string(),
  colors: z.record(z.string(), z.string()).default({}),
  fonts: z.record(z.string(), z.string()).default({}).describe("role -> family, e.g. { display: \"Inter Display\", body: \"Inter\" }"),
  fontFaces: z.array(FontFace).default([]),
  text: z.record(z.string(), TextStyle).default({}).describe("named text styles agents can use via textStyle"),
  assets: z.record(z.string(), z.string()).default({}),
  layout: z.object({ margin: z.number().optional(), radius: z.number().optional() }).default({}),
  motion: z.object({ duration: z.number().optional(), ease: Easing.optional(), enter: MotionPreset.optional() }).default({}),
  defaults: z.object({ background: z.string().optional(), color: z.string().optional(), font: z.string().optional() }).default({}),
});
export type Brand = z.infer<typeof BrandSchema>;
export type BrandInput = z.input<typeof BrandSchema>;

export const FORMATS = ["png", "jpeg", "webp", "gif", "apng", "webp-animated", "mp4", "webm", "svg", "pdf"] as const;
export const Format = z.enum(FORMATS);
export type Format = z.infer<typeof Format>;
