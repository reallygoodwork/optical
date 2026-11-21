/**
 * @scout/render — platform-neutral core.
 *
 * Import a runtime entry to get a working studio:
 *   import { createNodeStudio } from "@scout/render/node";      // servers, agents, CLIs
 *   import { createBrowserStudio } from "@scout/render/browser"; // user's device, with server fallback
 */
export * from "./core/schema.js";
export { SIZES, resolveSize, type SizeInput, type SizeName } from "./core/sizes.js";
export { EASE, interpolate, clamp } from "./core/easing.js";
export { edit, ensureIds, listIds, type EditOp } from "./core/edit.js";
export { validate, contrast, type ValidationReport, type Issue } from "./core/validate.js";
export { BROWSER_COMPAT_CSS, prepare, parseBrand, parseScene, resolveToken, SceneError, type PreparedScene, type MediaInfo } from "./core/prepare.js";
export { compileFrame, measureNode, type TNode, type RgbaImage } from "./core/compile.js";
export { poseAt, settleTime } from "./core/motion.js";
export { defineTemplate, describeTemplate, BUILTIN_TEMPLATES, quoteCard, announcement, statReel, titleCard, type Template } from "./core/templates.js";
export { Studio, createStudio, MIME, VERSION, type RenderInput, type RenderOptions, type RenderResult, type StudioOptions, type CacheStore } from "./core/studio.js";
export type { Backend, VideoReader, VideoSink, AudioClip, ImageBytes } from "./core/backend.js";
export { hashValue, stableStringify } from "./core/hash.js";
export { toRgba, type FrameSource, type SourceContext, type SourceDefinition, type SourceOutput } from "./core/sources.js";
