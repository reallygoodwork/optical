"""Plotter drawings for the README.

Each drawing states one construction relationship (Plotter hard rule 1):
  1. same-frame     One scene, compiled once, gives the same frame on a device and on a server.
  2. frame-reuse    After motion settles, every later frame is the last rendered frame, reused.
  3. base-video     A transparent overlay aligns exactly over a background video the encoder composites.
  4. device-budget  A job's work, measured on one scale, falls either side of the device budget.

Run:  python3 docs/diagrams/drawings.py   (writes src/*.svg; see build.sh for export + renders)
Grammar and tokens: https://github.com/pasqualevitiello/plotter (MIT).
"""
from __future__ import annotations
import html, os, math

HERE = os.path.dirname(os.path.abspath(__file__))
PLOTTER = os.environ.get("PLOTTER") or os.path.join(HERE, ".plotter/skills/plotter")
ROLE_CSS = open(os.path.join(PLOTTER, "assets/foundation/roles.css")).read()


class Sheet:
    def __init__(self, slug: str, title: str, desc: str):
        self.slug, self.title, self.desc = slug, title, desc
        self.parts: list[str] = []

    # --- primitives -------------------------------------------------------------------------
    def path(self, d: str, role: str = "primary", **attrs):
        extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
        self.parts.append(f'<path data-plotter-role="{role}" d="{d}"{extra}/>')

    def rect(self, x, y, w, h, role="primary", rx=6):
        self.parts.append(f'<rect data-plotter-role="{role}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>')

    def highlight(self, x, y, w, h, rx=6):
        self.parts.append(f'<rect data-plotter-fill="highlight" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="currentColor" stroke="none" fill-opacity="var(--plotter-opacity-highlight, 0.055)"/>')

    def text(self, x, y, s, kind="name", anchor="start", size=11):
        op = 0.72 if kind == "name" else 0.5
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" fill="currentColor" stroke="none" opacity="{op}">{html.escape(s)}</text>')

    # --- drafting marks ---------------------------------------------------------------------
    def dim_x(self, x1, x2, y, label, from_y=None, label_w=None):
        """Horizontal dimension: witnesses from from_y (8 short of the contour), slashes, split around label."""
        lw = label_w or (len(label) * 6 + 8)
        cx = (x1 + x2) / 2
        if from_y is not None:
            sgn = 1 if y > from_y else -1
            self.path(f"M{x1} {from_y + 8 * sgn}V{y + 8 * sgn} M{x2} {from_y + 8 * sgn}V{y + 8 * sgn}", "dimension")
        self.path(f"M{x1} {y}H{cx - lw / 2} M{cx + lw / 2} {y}H{x2}", "dimension")
        self.path(f"M{x1 - 4} {y + 4}l8 -8 M{x2 - 4} {y + 4}l8 -8", "dimension")
        self.text(cx, y + 3.5, label, "value", "middle", 10)

    def arrow(self, x1, y1, x2, y2):
        """Transfer arrow: dashed 4 6 shaft drawn from the tip, solid 6-unit legs at 45°."""
        a = math.atan2(y2 - y1, x2 - x1)
        legs = []
        for s in (1, -1):
            b = a + math.pi + s * math.pi / 4
            legs.append(f"M{x2:.2f} {y2:.2f}L{x2 + 6 * math.cos(b):.2f} {y2 + 6 * math.sin(b):.2f}")
        self.parts.append(
            f'<g data-plotter-role="transfer"><path d="M{x2} {y2}L{x1} {y1}"/>'
            f'<path d="{" ".join(legs)}" stroke-dasharray="none"/></g>'
        )

    def svg(self) -> str:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="560" height="440" viewBox="0 0 560 440" data-plotter="" '
            f'fill="none" stroke="currentColor" stroke-linecap="butt" stroke-linejoin="round" '
            f"style=\"color:#171717;font-family:Cal Sans,sans-serif;font-optical-sizing:auto;font-synthesis:none;font-variation-settings:'GEOM' 25;font-weight:400\" "
            f'role="img" aria-labelledby="{self.slug}-title {self.slug}-desc">'
            f'<title id="{self.slug}-title">{html.escape(self.title)}</title><desc id="{self.slug}-desc">{html.escape(self.desc)}</desc>'
            f'<style data-plotter-styles="true">{ROLE_CSS}</style>' + "".join(self.parts) + "</svg>"
        )


# ── 1. One scene, two renderers, the same frame ───────────────────────────────────────────────
def same_frame() -> Sheet:
    s = Sheet("same-frame", "One scene, the same frame",
              "A JSON scene compiles once. Takumi in WebAssembly on the user’s device and native Takumi on a server draw the same frame; their outputs align edge to edge.")
    # scene record (left)
    s.rect(48, 188, 112, 64)
    s.path("M64 208H120 M64 220H144 M64 232H104", "secondary")
    s.text(48, 176, "scene.json", "name")
    # two identical frames, stacked (right)
    fx, fw, fh = 248, 176, 99
    for y in (96, 264):
        s.rect(fx, y, fw, fh)
        s.path(f"M{fx + 16} {y + 56}H{fx + 128} M{fx + 16} {y + 68}H{fx + 96}", "secondary")
        s.parts.append(f'<circle data-plotter-role="secondary" cx="{fx + 24}" cy="{y + 22}" r="6"/>')
        s.path(f"M{fx + 16} {y + 84}H{fx + 64}", "secondary")
    lx = fx + fw + 16
    s.text(lx, 140, "Device", "name")
    s.text(lx, 156, "WebAssembly", "value", "start", 10)
    s.text(lx, 308, "Server", "name")
    s.text(lx, 324, "native", "value", "start", 10)
    # projection guides: the same edges carry through
    s.path(f"M{fx} {96 + fh + 8}V{264 - 8} M{fx + fw} {96 + fh + 8}V{264 - 8}", "guide")
    s.path(f"M{fx + fw / 2 - 10} 226H{fx + fw / 2 + 10} M{fx + fw / 2 - 10} 234H{fx + fw / 2 + 10}", "secondary")
    s.text(lx, 233, "pixel-identical", "value", "start", 10)
    # compile: one scene becomes both frames
    s.arrow(168, 206, 236, 156)
    s.arrow(168, 234, 236, 300)
    s.text(176, 224, "compile", "value", "start", 10)
    s.dim_x(fx, fx + fw, 400, "1080 px", from_y=264 + fh)
    return s


# ── 2. Frame reuse ─────────────────────────────────────────────────────────────────────────────
def frame_reuse() -> Sheet:
    s = Sheet("frame-reuse", "Rendered once, then reused",
              "Twelve half-second frames on one timeline. Motion settles after the third; every later frame is identical, so the renderer reuses the last rendered frame instead of drawing it again.")
    x0, w, gap, y, h = 40, 32, 8, 168, 56
    pitch = w + gap  # one frame = 0.5 s
    settled = 3
    for i in range(12):
        x = x0 + i * pitch
        rendered = i < settled
        s.rect(x, y, w, h, "primary" if rendered else "secondary", 4)
        rise = [16, 8, 0][i] if rendered else 0  # a headline rising into place, then still
        s.path(f"M{x + 8} {y + 36 + rise}H{x + w - 8}", "primary" if rendered else "secondary")
    s.highlight(x0 - 6, y - 6, settled * pitch - gap + 12, h + 12, 8)
    # timeline: each tick is a frame start, two frames per second
    tl = y + h + 32
    s.path(f"M{x0} {tl}H{x0 + 12 * pitch}", "secondary")
    for k in range(7):
        x = x0 + k * 2 * pitch
        s.path(f"M{x} {tl - 4}v8", "secondary")
        s.text(x, tl + 20, f"{k} s", "value", "middle", 10)
    # one chain: drawn | reused, sharing the witness at the settle point (1.5 s)
    mid = x0 + settled * pitch - gap / 2
    end = x0 + 12 * pitch - gap / 2
    s.path(f"M{x0} {y - 14}V128 M{mid} {y - 8}V120 M{end} {y - 8}V120", "dimension")
    s.dim_x(x0, mid, 128, "drawn")
    s.dim_x(mid, end, 128, "reused, not redrawn")
    s.text(x0, 96, "Frames of a 6 s brand clip", "name")
    s.text(x0, 340, "A typical clip draws 20–25 % of its frames.", "value", "start", 10)
    return s


# ── 3. Overlay over a background video ────────────────────────────────────────────────────────
def base_video() -> Sheet:
    s = Sheet("base-video", "An overlay over a background video",
              "Takumi draws every layer except the background video as one transparent overlay. The encoder decodes, scales and zooms the video and lays the overlay on top; both share one frame.")
    x, w, h = 128, 224, 126
    top, bot = 64, 264
    # overlay frame: transparent, content only
    s.rect(x, top, w, h)
    s.parts.append(f'<circle data-plotter-role="primary" cx="{x + 24}" cy="{top + 22}" r="6"/>')
    s.path(f"M{x + 16} {top + 76}H{x + 160} M{x + 16} {top + 90}H{x + 120} M{x + 16} {top + 108}H{x + 64}", "primary")
    # video frame with zoom window (Ken Burns): the decoded frame and the 1/1.06 window inside it
    s.rect(x, bot, w, h)
    zw, zh = w / 1.06, h / 1.06
    s.rect(round(x + (w - zw) / 2, 2), round(bot + (h - zh) / 2, 2), round(zw, 2), round(zh, 2), "proposed", 5)
    # hatch the video region between frame and zoom window? keep it clean: hatch identifies the pixels the encoder owns
    s.parts.append(f'<clipPath id="bv-clip"><rect x="{x}" y="{bot}" width="{w}" height="{h}" rx="6"/></clipPath>')
    lines = " ".join(f"M{x + k} {bot}l-{h} {h}" for k in range(12, w + h, 12))
    s.parts.append(f'<path data-plotter-role="hatch" clip-path="url(#bv-clip)" d="{lines}"/>')
    # projection guides: same edges
    s.path(f"M{x} {top + h + 8}V{bot - 8} M{x + w} {top + h + 8}V{bot - 8}", "guide")
    s.arrow(x + w / 2, top + h + 14, x + w / 2, bot - 14)
    # labels
    s.text(x + w + 24, top + 60, "Overlay", "name")
    s.text(x + w + 24, top + 76, "Takumi · transparent", "value", "start", 10)
    s.text(x + w + 24, top + 90, "25 of 180 frames drawn", "value", "start", 10)
    s.text(x + w + 24, bot + 56, "Background video", "name")
    s.text(x + w + 24, bot + 72, "ffmpeg · decode, scale", "value", "start", 10)
    s.text(x + w + 24, bot + 86, "zoom 1.06 → 1.00", "value", "start", 10)
    s.text(x + w / 2 + 12, (top + h + bot) / 2 + 4, "composite", "value", "start", 10)
    s.dim_x(x, x + w, 420, "same frame", from_y=bot + h)
    return s


# ── 4. Device or server ────────────────────────────────────────────────────────────────────────
def device_budget() -> Sheet:
    s = Sheet("device-budget", "Where a render runs",
              "Each job’s work is measured in megapixel-frames on one scale. Jobs inside the device budget render on the user’s device; the part of a job beyond it sends the whole job to the server.")
    ax0, ax1, y_axis = 168, 520, 336
    scale = (ax1 - ax0) / 1600  # units per MPx-frame
    X = lambda v: ax0 + v * scale
    budget = 1200
    jobs = [("Quote · 5 s · 1080²", 175), ("Story · 6 s · 1080×1920", 373), ("Reel · 20 s · half scale", 311), ("Reel · 20 s · 1080×1920", 1244)]
    for i, (name, cost) in enumerate(jobs):
        y = 112 + i * 52
        s.rect(ax0, y, round(cost * scale, 2), 20, "primary", 4)
        s.text(ax0 - 12, y + 14, name, "name", "end", 11)
        s.text(X(cost) + 10, y + 14, f"{cost}", "value", "start", 10)
        if cost > budget:
            s.parts.append(f'<clipPath id="db-clip"><rect x="{X(budget)}" y="{y}" width="{round((cost - budget) * scale, 2)}" height="20"/></clipPath>')
            lines = " ".join(f"M{X(budget) + k} {y}l-20 20" for k in range(6, 60, 12))
            s.parts.append(f'<path data-plotter-role="hatch" clip-path="url(#db-clip)" d="{lines}"/>')
    # axis
    s.path(f"M{ax0} {y_axis}H{ax1}", "secondary")
    for v in range(0, 1601, 400):
        s.path(f"M{X(v):.1f} {y_axis - 4}v8", "secondary")
        s.text(X(v), y_axis + 20, f"{v}", "value", "middle", 10)
    s.text(ax1, y_axis + 40, "MPx · frames", "value", "end", 10)
    # budget centerline through every bar
    s.path(f"M{X(budget)} 96V{y_axis + 8}", "centerline")
    s.text(X(budget) - 8, 88, "On the device", "name", "end", 11)
    s.text(X(budget) + 8, 88, "Server", "name", "start", 11)
    return s


SHEETS = [same_frame, frame_reuse, base_video, device_budget]

if __name__ == "__main__":
    out = os.path.join(HERE, "src")
    os.makedirs(out, exist_ok=True)
    for fn in SHEETS:
        sh = fn()
        open(os.path.join(out, f"{sh.slug}.svg"), "w").write(sh.svg())
        print(f"src/{sh.slug}.svg")
