import sharp from "sharp";
import { readQuizImage } from "./asset-store";
import { type QuizArtwork, type QuizPalette } from "./quiz";

// Colour maths in OKLCH, so lightness steps look even across hues.
type Oklch = { l: number; c: number; h: number };

const toLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toGamma = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

export function rgbToOklch(r: number, g: number, b: number): Oklch {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255));
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: L,
    c: Math.hypot(A, B),
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  };
}

function oklchToLinear({ l, c, h }: Oklch) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

/** Converts to sRGB hex, reducing chroma until the colour fits the gamut. */
export function oklchToHex(colour: Oklch) {
  let { c } = colour;
  let rgb = oklchToLinear(colour);
  while (rgb.some((v) => v < -0.0001 || v > 1.0001) && c > 0) {
    c = Math.max(0, c - 0.005);
    rgb = oklchToLinear({ ...colour, c });
  }
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) =>
    toLinear(parseInt(hex.slice(i, i + 2), 16) / 255),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const hueDistance = (a: number, b: number) =>
  Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

const BINS = 24;
const centre = (bin: number) => (bin + 0.5) * (360 / BINS);

/** Chroma-weighted hue histogram of opaque pixels, plus mean lightness. */
async function hues(image: Buffer, size: number) {
  const { data, info } = await sharp(image)
    .resize(size, size, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const weight = new Float64Array(BINS);
  const chroma = new Float64Array(BINS);
  let lightness = 0,
    count = 0;
  for (let index = 0; index < info.width * info.height; index++) {
    if (data[index * 4 + 3] < 200) continue;
    const colour = rgbToOklch(
      data[index * 4],
      data[index * 4 + 1],
      data[index * 4 + 2],
    );
    lightness += colour.l;
    count++;
    if (colour.c < 0.03) continue;
    const bin = Math.floor(colour.h / (360 / BINS)) % BINS;
    weight[bin] += colour.c * colour.c;
    chroma[bin] = Math.max(chroma[bin], colour.c);
  }
  // Smooth neighbouring bins so one hue isn't split across a boundary.
  const smoothed = Array.from(
    { length: BINS },
    (_, i) =>
      weight[i] +
      0.5 * (weight[(i + 1) % BINS] + weight[(i + BINS - 1) % BINS]),
  );
  return { smoothed, chroma, lightness: count ? lightness / count : 0.7 };
}

/**
 * Derives a quiz palette from its artwork: a soft tint of the scene's main
 * hue for the page, readable ink (at least 7:1), and a vivid accent for
 * selections and highlights. The accent prefers the quiz's own cutouts
 * (berries, icing, sprinkles) over incidental scenery such as houseplants.
 */
export async function paletteFromImage(
  scene: Buffer,
  cutouts?: Buffer,
): Promise<QuizPalette> {
  const page = await hues(scene, 48);
  const main = page.smoothed.indexOf(Math.max(...page.smoothed));
  const hue = page.smoothed[main] > 0 ? centre(main) : 60;
  const tint = Math.min(
    0.05,
    Math.max(0.02, (page.chroma[main] || 0.06) * 0.3),
  );
  const source = cutouts ? await hues(cutouts, 160) : page;
  // The most vivid well-represented hue, clearly different from the tint.
  const top = Math.max(...source.smoothed);
  let accentBin = -1;
  for (let bin = 0; bin < BINS; bin++)
    if (
      hueDistance(centre(bin), hue) >= 45 &&
      source.smoothed[bin] > 0.08 * top &&
      (accentBin === -1 ||
        source.chroma[bin] * Math.sqrt(source.smoothed[bin]) >
          source.chroma[accentBin] * Math.sqrt(source.smoothed[accentBin]))
    )
      accentBin = bin;
  const accentHue = accentBin === -1 ? (hue + 150) % 360 : centre(accentBin);

  const dark = page.lightness < 0.42;
  const background = oklchToHex({ l: dark ? 0.24 : 0.95, c: tint, h: hue });
  const ink = (l: number) => oklchToHex({ l, c: dark ? 0.03 : 0.1, h: hue });
  let inkLightness = dark ? 0.93 : 0.32;
  while (
    contrast(ink(inkLightness), background) < 7 &&
    inkLightness > 0.05 &&
    inkLightness < 0.99
  )
    inkLightness += dark ? 0.02 : -0.02;
  const accent = oklchToHex({
    l: dark ? 0.78 : 0.7,
    c: Math.min(0.2, Math.max(0.13, source.chroma[accentBin] || 0.15)),
    h: accentHue,
  });
  return { background, foreground: ink(inkLightness), accent, dark };
}

/**
 * The palette of a question atlas: page colours from its background scene
 * cell, and, for packed atlases, the accent from its transparent cutouts.
 */
export async function atlasCellPalette(
  artwork: QuizArtwork,
  index: number,
  read: (id: string) => Promise<Buffer | null> = readQuizImage,
) {
  const bytes = await read(artwork.url.split("/").pop()!);
  if (!bytes) return undefined;
  const { width, height } = await sharp(bytes).metadata();
  const cellWidth = Math.floor(width! / artwork.columns);
  const cellHeight = Math.floor(height! / artwork.rows);
  const row = Math.floor(index / artwork.columns);
  const scene = await sharp(bytes)
    .extract({
      left: (index % artwork.columns) * cellWidth,
      top: row * cellHeight,
      width: cellWidth,
      height: cellHeight,
    })
    .png()
    .toBuffer();
  const cutouts =
    artwork.packed && row > 0
      ? await sharp(bytes)
          .extract({ left: 0, top: 0, width: width!, height: row * cellHeight })
          .png()
          .toBuffer()
      : undefined;
  return paletteFromImage(scene, cutouts);
}
