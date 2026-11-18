import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { contrast, paletteFromImage } from "../src/lib/palette";
import { assembleQuiz } from "../src/lib/content-sets";
import { parseQuiz } from "../src/lib/quiz";
import {
  answerImage,
  answerIllustrations,
  illustrationAtlas,
  questionImage,
} from "../src/lib/quiz-illustrations";
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

test("empty result slots use the same real artwork in the player and share card", async () => {
  const { resultImage, illustrationAtlas, answerIllustrations } =
    await import("../src/lib/quiz-illustrations");
  const { exampleQuiz } = await import("../src/lib/examples");
  const { quizCopy } = await import("../src/lib/quiz-copy");
  const quiz = exampleQuiz("princess");
  quiz.results[0].imageless = true;
  const { artwork, index } = resultImage(quiz, 0);
  assert.equal(artwork.url, illustrationAtlas.url);
  const uri = await atlasCellDataUrl(artwork, index, async () => {
    throw new Error("Unexpected network read");
  });
  const data = Buffer.from(uri!.split(",")[1], "base64");
  const { channels } = await sharp(data).stats();
  assert.ok(channels[3].max === 255 && channels[3].min === 0);
  assert.equal(
    new Set(
      answerIllustrations(
        ["Explore", "Explore", "Unknown", "Unknown"],
        [undefined, undefined, 12, undefined],
      ),
    ).size,
    4,
  );
  assert.equal(quizCopy("Send 😂"), "Send face with tears of joy");
  const { depictsEmoji } = await import("../src/lib/quiz-illustrations");
  assert.equal(
    depictsEmoji("A ripe pear, no lettering, logos, or emoji."),
    false,
  );
  assert.equal(depictsEmoji("A waving hand emoji on a phone."), true);
  assert.deepEqual(
    answerIllustrations([
      "Build a tiny experiment.",
      "Ship a rough prototype.",
      "Make setup easy for teammates.",
      "Set goals and milestones.",
    ]),
    [0, 1, 6, 3],
  );
  quiz.results[0].imageless = false;
  quiz.resultArtwork = { ...illustrationAtlas, url: "/api/quiz-assets/saved" };
  assert.equal(resultImage(quiz, 0).artwork.url, quiz.resultArtwork.url);
  quiz.results[0].imagePrompt = "A glossy yellow laughing emoji";
  assert.equal(resultImage(quiz, 0).artwork.url, illustrationAtlas.url);
  assert.equal(quizCopy("Fold in fresh cherries."), "Fold in fresh cherries.");
});

test("saved choices can reuse an unambiguous, previously pictured object from another question", () => {
  const { quiz } = reusableFixture();
  const atlas = {
    ...illustrationAtlas,
    url: "/api/quiz-assets/saved",
    model: "asset-library-v1",
  };
  quiz.questionArtwork = atlas;
  const choice = quiz.questions[0].answers[0];
  Object.assign(choice, {
    text: "Popcorn in an unfamiliar flavor.",
    imageless: true,
    imagePrompt: undefined,
  });
  const donor = quiz.questions[2].answers[1];
  Object.assign(donor, {
    text: "A tub of popcorn to pass around.",
    assetId: "popcorn",
    imagePrompt: undefined,
  });
  assert.deepEqual(answerImage(quiz, 0, 0), { artwork: atlas, index: 12 });
  assert.deepEqual(answerImage(quiz, 2, 1), { artwork: atlas, index: 12 });
  quiz.questions[0].answers[1].assetId = "popcorn";
  assert.equal(answerImage(quiz, 0, 0).artwork, illustrationAtlas);
  quiz.questions[0].answers[1].assetId = undefined;
  donor.text = "A basket of peach muffins to share.";
  choice.text = "Peach for the topping.";
  assert.equal(answerImage(quiz, 0, 0).artwork, illustrationAtlas);
  donor.text = "A peach to share.";
  donor.imagePrompt = "A peach emoji";
  assert.equal(answerImage(quiz, 0, 0).artwork, illustrationAtlas);
});

test("legacy fallback uses the saved scene for the hero and reads ambiguous props in context", () => {
  const { quiz } = reusableFixture();
  const atlas = {
    ...illustrationAtlas,
    model: "asset-library-v1",
    url: "/api/quiz-assets/saved",
    columns: 5,
    rows: 6,
    width: 2560,
    height: 3072,
  };
  quiz.questionArtwork = atlas;
  quiz.questions[0].imageless = true;
  quiz.backgroundIndex = 25;
  quiz.style = {
    palette: {
      background: "#fafafa",
      foreground: "#040404",
      accent: "#ffa400",
      dark: false,
    },
  };
  assert.deepEqual(questionImage(quiz, 0), { artwork: atlas, index: 25 });
  const recipe = answerIllustrations(
    ["Bring a snack feast.", "Test a new recipe ahead of time."],
    [],
    "Picnic snacks",
  );
  assert.equal(recipe[1], 10);
  assert.notEqual(recipe[0], recipe[1]);
  assert.notEqual(
    answerIllustrations(
      ["Portion it evenly into spare cups."],
      [],
      "Muffin batter",
    )[0],
    4,
  );
  const route = answerIllustrations([
    "Charge down the first promising path.",
    "Mark each turn so you can backtrack.",
    "Shield everyone traveling with me.",
  ]);
  assert.equal(route[1], 2);
  assert.ok(route[0] !== 2 && route[2] !== 2);
});
