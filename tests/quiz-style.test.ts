import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { contrast, paletteFromImage } from "../src/lib/palette";
import { assembleQuiz } from "../src/lib/content-sets";
import { parseQuiz } from "../src/lib/quiz";
import { atlasCellDataUrl } from "../src/lib/share-card";
import { decorationIndices, quizColours } from "../src/components/quiz-visuals";
import { reusableFixture } from "./reusable-fixture";

const solid = (r: number, g: number, b: number, size = 64) =>
  sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

test("palettes keep readable ink on light and dark scenes", async () => {
  for (const [scene, dark] of [
    [await solid(245, 214, 170), false],
    [await solid(20, 30, 60), true],
    [await solid(120, 200, 120), false],
  ] as const) {
    const palette = await paletteFromImage(scene);
    assert.equal(palette.dark, dark);
    assert.ok(contrast(palette.foreground, palette.background) >= 7);
    assert.match(palette.accent, /^#[0-9a-f]{6}$/);
  }
});

test("the accent comes from the cutouts, clearly apart from the page tint", async () => {
  const palette = await paletteFromImage(
    await solid(240, 200, 150),
    await solid(40, 90, 220, 160),
  );
  const [r, , b] = [1, 3, 5].map((i) =>
    parseInt(palette.accent.slice(i, i + 2), 16),
  );
  assert.ok(b > r, `expected a blue accent, got ${palette.accent}`);
});

test("assembled quizzes carry their typeface, palette, and stickers", () => {
  const { quiz, foreground, background } = reusableFixture();
  assert.equal(quiz.style?.typeface, "storybook");
  // Decorations need an exactly packed atlas to be cut out cleanly.
  assert.equal(quiz.style?.decorations, undefined);
  assert.deepEqual(decorationIndices(quiz), []);

  const palette = {
    background: "#feebd8",
    foreground: "#4a2b01",
    accent: "#ff6365",
    dark: false,
  };
  const packed = assembleQuiz(
    quiz.settings,
    foreground,
    { ...background, artwork: { ...background.artwork!, packed: true } },
    undefined,
    palette,
  );
  assert.equal(packed.style?.decorations, 4);
  assert.deepEqual(decorationIndices(packed), [
    packed.backgroundIndex! + 1,
    packed.backgroundIndex! + 2,
    packed.backgroundIndex! + 3,
    packed.backgroundIndex! + 4,
  ]);
  assert.deepEqual(quizColours(packed), palette);
  assert.deepEqual(parseQuiz(structuredClone(packed)).style, packed.style);
});

test("older quizzes without a style fall back to their preset theme", () => {
  const { quiz } = reusableFixture();
  const legacy = parseQuiz({ ...quiz, style: undefined });
  const colours = quizColours(legacy);
  assert.match(colours.background, /^#/);
  assert.equal(typeof colours.dark, "boolean");
});

test("share cards crop exactly one atlas cell", async () => {
  const atlas = await sharp({
    create: {
      width: 200,
      height: 100,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([
      {
        input: await solid(0, 0, 255, 100),
        left: 100,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const artwork = {
    url: `/api/quiz-assets/${crypto.randomUUID()}`,
    columns: 2,
    rows: 1,
    width: 100,
    height: 100,
    model: "fixture",
    generatedAt: new Date().toISOString(),
    packed: true,
  };
  const url = await atlasCellDataUrl(artwork, 1, async () => atlas);
  assert.ok(url);
  const { data, info } = await sharp(Buffer.from(url.split(",")[1], "base64"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 100);
  assert.deepEqual([...data.subarray(0, 3)], [0, 0, 255]);
  assert.deepEqual(
    [...data.subarray(-info.channels, -info.channels + 3)],
    [0, 0, 255],
  );
});
