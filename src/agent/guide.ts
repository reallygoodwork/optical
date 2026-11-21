/** Compact authoring guide served to agents (kept short on purpose: it rides in context). */
export const SCENE_GUIDE = `# Scene format (JSON)
{ size, duration?, fps?, background?, color?, font?, layers: Layer[], audio?: AudioTrack[] }
- size: preset ("square","instagram-post","instagram-story","reel","youtube","youtube-thumbnail","og","linkedin-post","twitter-post","slide","a4",...) or "1200x800" or {width,height}
- duration: seconds. Omit for a still. Video/GIF renders of a scene with no duration auto-size to their media, else 5s.
- Any string starting with "$" is a brand token: "$colors.accent", "$assets.logo", "$fonts.display". Tokens also work inside strings: "linear-gradient(135deg, $colors.ink, $colors.primary)".

## Layer (common fields)
type: "text" | "image" | "video" | "shape" | "group" | "node"
id: stable name — use it for edits. Set ids yourself ("headline", "bg-video").
Placement (pick one):
  - nothing → fills the frame (backgrounds)
  - position: "center"|"top"|"bottom"|"left"|"right"|"top-left"|"top-right"|"bottom-left"|"bottom-right" (+ width/height, margin) → snaps inside the safe margin. Best for responsive layouts across sizes.
  - x, y, width, height → absolute px or "50%"
Timing: start, end (seconds). Motion: enter, exit = "fade"|"rise"|"drop"|"slide-left"|"slide-right"|"zoom"|"pop"|"blur"|"wipe"|"typewriter" or {preset, duration, delay, ease}.
keyframes: [{at, x?, y?, scale?, rotate?, opacity?, blur?, ease?}] (at = seconds from layer start). Ken Burns: [{at:0,scale:1.08},{at:6,scale:1,ease:"linear"}]
Look: opacity, rotate, scale, blur, radius, background, padding, shadow, style (raw CSS escape hatch).

## Types
text: { text, textStyle? (brand style name), font?, size?, weight?, color?, align?, lineHeight?, letterSpacing? (em), uppercase?, fit? }
  fit: "box" (default when height is set) shrinks type to fit width×height; "line" keeps one line and shrinks; "none".
image: { src, fit?: "cover"|"contain"|"fill", focus?: "50% 30%" }
video: { src, fit?, trim?: [in, out], speed?, loop?, volume? (0 mutes) }
shape: { shape?: "rect"|"circle", fill?, stroke?, strokeWidth? } — use fill gradients for scrims.
group: { layout: "row"|"column"|"stack", gap?, align?, justify?, children: Layer[] } — children flow; they keep their own timing/motion.
node: { html, css } real HTML + CSS with browser semantics: grid, :has(), nesting, @media, color-mix/oklch, filters, blend modes, clip-path, masks, @keyframes (driven by scene time). Tokens work inside. Not supported: 3D perspective, writing-mode, container queries, !important, full-turn rotate keyframes (use 359.9deg or keyframes on the layer). Scene-wide CSS goes in scene.css.
source: { source, props } pixels from a registered frame source (Canvas 2D, WebGL, WebGPU, Three.js…). List them with get_brand.
audio: [{ src, start?, trim?, volume?, fadeIn?, fadeOut? }]

## Workflow that works
1. get_brand → use tokens and text styles, never hardcode brand colors.
2. Prefer a template (list_templates) and pass props; drop to a raw scene for custom layouts.
3. preview (cheap contact sheet) → look → edit_scene with small ops → render final formats.
4. For many sizes, call render with sizes:[...]. Use position + % sizes so layouts reflow.
5. validate catches unknown tokens, timing errors, missing media and low contrast before you spend a render.

## Edit ops (target = layer id or "scene")
{op:"set", target, path, value}         e.g. {op:"set",target:"headline",path:"text",value:"New copy"}
{op:"merge", target, value:{...}}       several fields at once
{op:"add", layer, parent?, before?, after?, index?}
{op:"remove", target} · {op:"move", target, before?|after?|index?}
{op:"retime", target, start?, end?, shift?} · {op:"replace", target, layer} · {op:"duplicate", target, id, with?}
`;
