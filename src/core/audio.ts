import type { AudioClip } from "./backend.js";
import { allLayers, type PreparedScene } from "./prepare.js";

/** Every sound in a scene: audio tracks plus unmuted video layers that have audio. */
export function audioPlanFor(ps: PreparedScene): AudioClip[] {
  const clips: AudioClip[] = [];
  for (const pl of allLayers(ps.layers)) {
    const l = pl.layer;
    if (l.type !== "video" || l.volume === 0 || !pl.media?.hasAudio) continue;
    clips.push({ src: l.src, at: pl.start, trimIn: l.trim?.[0] ?? 0, trimOut: l.trim?.[1], volume: l.volume ?? 1, speed: l.speed ?? 1, loop: !!l.loop });
  }
  for (const a of ps.scene.audio ?? []) {
    clips.push({ src: a.src, at: a.start ?? 0, trimIn: a.trim?.[0] ?? 0, trimOut: a.trim?.[1], volume: a.volume ?? 1, speed: 1, loop: false, fadeIn: a.fadeIn, fadeOut: a.fadeOut });
  }
  return clips;
}
