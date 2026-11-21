import type { Easing } from "./schema.js";

const c1 = 1.70158;
const c3 = c1 + 1;

export const EASE: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t ** 3,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inQuart: (t) => t ** 4,
  outQuart: (t) => 1 - (1 - t) ** 4,
  inOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  inExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  outBack: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  spring: (t) => spring(t),
};

/** Critically-damped-ish spring normalised to land at 1 when t = 1. */
function spring(t: number, stiffness = 180, damping = 14): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const w = Math.sqrt(stiffness);
  const z = damping / (2 * w);
  const time = t * 1.2;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * time) * (Math.cos(wd * time) + ((z * w) / wd) * Math.sin(wd * time));
  }
  return 1 - Math.exp(-w * time) * (1 + w * time);
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Remotion-style interpolate: map `t` across `input` ranges onto `output`, clamped. */
export function interpolate(t: number, input: number[], output: number[], ease: Easing = "linear"): number {
  if (input.length !== output.length || input.length < 2) throw new Error("interpolate needs matching ranges of 2+ values");
  if (t <= input[0]!) return output[0]!;
  if (t >= input[input.length - 1]!) return output[output.length - 1]!;
  let i = 1;
  while (t > input[i]!) i++;
  const a = input[i - 1]!, b = input[i]!;
  const p = EASE[ease]((t - a) / (b - a));
  return output[i - 1]! + (output[i]! - output[i - 1]!) * p;
}
