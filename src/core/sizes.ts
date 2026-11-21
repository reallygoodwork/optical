/** Output size presets agents can name instead of remembering pixel dimensions. */
export const SIZES = {
  square: { width: 1080, height: 1080 },
  "instagram-post": { width: 1080, height: 1350 },
  "instagram-story": { width: 1080, height: 1920 },
  reel: { width: 1080, height: 1920 },
  tiktok: { width: 1080, height: 1920 },
  "youtube-short": { width: 1080, height: 1920 },
  youtube: { width: 1920, height: 1080 },
  "youtube-thumbnail": { width: 1280, height: 720 },
  landscape: { width: 1920, height: 1080 },
  "hd": { width: 1280, height: 720 },
  "4k": { width: 3840, height: 2160 },
  og: { width: 1200, height: 630 },
  "twitter-post": { width: 1600, height: 900 },
  "linkedin-post": { width: 1200, height: 1200 },
  "linkedin-banner": { width: 1584, height: 396 },
  "facebook-cover": { width: 1640, height: 624 },
  pinterest: { width: 1000, height: 1500 },
  slide: { width: 1920, height: 1080 },
  "a4": { width: 794, height: 1123 },
  "letter": { width: 816, height: 1056 },
  "email-header": { width: 1200, height: 400 },
  "display-mrec": { width: 300, height: 250 },
  "display-leaderboard": { width: 728, height: 90 },
  "display-skyscraper": { width: 160, height: 600 },
} as const;

export type SizeName = keyof typeof SIZES;
export type SizeInput = SizeName | (string & {}) | { width: number; height: number };

export function resolveSize(size: SizeInput | undefined): { width: number; height: number } {
  if (!size) return { ...SIZES.square };
  if (typeof size === "object") return { width: size.width, height: size.height };
  const preset = (SIZES as Record<string, { width: number; height: number }>)[size];
  if (preset) return { ...preset };
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (m) return { width: Number(m[1]), height: Number(m[2]) };
  throw new Error(`Unknown size "${size}". Use one of: ${Object.keys(SIZES).join(", ")}, "WIDTHxHEIGHT", or {width,height}.`);
}
