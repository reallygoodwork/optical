# Using @reallygoodwork/scout-render as an agent

You produce on-brand assets by writing JSON scenes and rendering them. The tools are designed to be cheap to call often.

## Loop

1. **`get_brand`**: tokens, text styles, assets, size presets, and the scene guide. Use tokens (`$colors.accent`, `$assets.logo`) and text styles (`textStyle: "display"`), never raw brand hex values.
2. **Start from a template** (`list_templates`) when one fits. Otherwise write a scene.
3. **`preview`**: a contact sheet of the timeline (one image). Look at it.
4. **`edit_scene`** with small ops by layer id. It returns a fresh preview and a new `sceneId`.
5. **`render`** the finals: `formats: ["png","mp4"]`, `sizes: ["instagram-story","square","og"]` in one call.
6. **`validate`** whenever something looks wrong. It names unknown tokens, impossible timings, unreachable media and low-contrast text, with paths.

## Writing scenes that reflow

- Use `position` (`"bottom-left"`, `"center"`, …) plus widths in `%` instead of absolute x/y, so one scene works in every size.
- Give text a `height` so it auto-fits (`fit: "box"`). Use `fit: "line"` for one-line labels.
- Backgrounds (`video`, `image`, `shape` scrims) need no geometry: they fill the frame.
- Set your own `id`s (`"headline"`, `"cta"`, `"bg"`) so later edits read naturally.

## Motion vocabulary

`enter` / `exit`: `fade`, `rise`, `drop`, `slide-left`, `slide-right`, `zoom`, `pop`, `blur`, `wipe`, `typewriter`. Stagger with `{ preset, delay }`.
`keyframes`: `[{ at, x, y, scale, rotate, opacity, blur, ease }]` for anything else (Ken Burns = scale 1.08 → 1 over the duration).
Timing: `start` / `end` per layer, `duration` on the scene. Stills always show the settled pose.

## Composing media

- `video`: `trim: [in, out]`, `speed`, `loop`, `volume` (0 = mute). Source audio is mixed automatically when `volume > 0`.
- `audio`: `[{ src, start, trim, volume, fadeIn, fadeOut }]`
- Picture-in-picture: a `video` layer with `width`, `height`, `position`, `radius`, `shadow`.

## Edit ops

```json
[
  { "op": "set", "target": "headline", "path": "text", "value": "New copy" },
  { "op": "merge", "target": "cta", "value": { "background": "$colors.accent", "enter": "pop" } },
  { "op": "add", "layer": { "id": "badge", "type": "text", "text": "NEW", "position": "top-right" }, "after": "headline" },
  { "op": "retime", "target": "logo", "start": 1.2 },
  { "op": "remove", "target": "scrim" },
  { "op": "set", "target": "scene", "path": "size", "value": "square" }
]
```

## Cost sense

- Stills cost milliseconds. Text-only motion costs about 0.3 s per second of 1080p video. Video backgrounds cost about 1 s per second on a small server.
- Draft with `scale: 0.5`, look with `preview`, render finals once.
- Identical requests are served from cache, so re-rendering after an undo is free.
