# Demons sizzle reels

Test cases for motion-heavy rendering, using the Demons test brand from the Scout repo (`clients/demons`). Demons is a test brand by Really Good Work; the name isn't cleared for trademark use.

- `brand.json`: the Demons kit mapped to `@reallygoodwork/scout-render` tokens (colours, Bricolage Grotesque / Fraunces / JetBrains Mono, logos, crew, patterns).
- `sizzle.ts`: builds the three scenes. Edit here, then run `npm run demons`.
- `scenes/`: the generated JSON. Render one directly with `scout-render render examples/demons/scenes/demons-keeper-square.json --brand examples/demons/brand.json -f mp4`.
- `videos/`: MP4s, GIF previews, poster frames and 24-frame contact sheets.
- `audio/beat-120.mp3`: a 120 BPM beat synthesised with ffmpeg, so there are no licence questions.

Brand rules the scenes follow: a demon never stands on its own colour, at most three demons share a frame, all-caps only in stickers, agent lines are lowercase mono, the logo only sits on flat approved grounds.

Fonts are SIL Open Font License. Crew, logos and patterns are © Really Good Work.
