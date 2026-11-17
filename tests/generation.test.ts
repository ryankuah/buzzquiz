import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { exampleQuiz, defaultSettings } from "../src/lib/examples";
import { parseQuiz, type Quiz, type QuizArtwork } from "../src/lib/quiz";
import {
  artworkPrompt,
  generateQuizArtwork,
  generateArtworkSheet,
  ATLAS_CELL,
} from "../src/lib/generate-artwork";
import { readGenerationResponse } from "../src/lib/generation-response";
import {
  saveQuizImage,
  readQuizImage,
  removeForegroundMatte,
} from "../src/lib/asset-store";

function artwork(quiz: Quiz): QuizArtwork {
  return {
    url: `/api/quiz-assets/${quiz.id}`,
    columns: 5,
    rows: quiz.questions.length + 1,
    width: 500,
    height: 600,
    model: "test-image-model",
    generatedAt: new Date().toISOString(),
  };
}

test("foreground removal preserves enclosed colours and creates real transparency", async () => {
  const pixels = Buffer.alloc(10 * 10 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255;
    pixels[i + 2] = 255;
    pixels[i + 3] = 255;
  }
  for (let y = 2; y < 8; y++)
    for (let x = 2; x < 8; x++) {
      const i = (y * 10 + x) * 4;
      pixels[i] = 0;
      pixels[i + 1] = 100;
      pixels[i + 2] = 200;
    }
  const middle = (5 * 10 + 5) * 4;
  pixels[middle] = 255;
  pixels[middle + 1] = 0;
  pixels[middle + 2] = 255;
  const png = await sharp(pixels, {
    raw: { width: 10, height: 10, channels: 4 },
  })
    .png()
    .toBuffer();
  const output = await sharp(await removeForegroundMatte(png))
    .raw()
    .toBuffer();
  assert.equal(output[3], 0);
  assert.equal(output[middle + 3], 255);
  assert.equal(output[(2 * 10 + 2) * 4 + 3], 255);
});

function streamResponse(lines: string, chunkSize = 17) {
  const bytes = new TextEncoder().encode(lines);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize)
          controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

test("art prompts contain every actual choice and result, with no reusable catalogue lookup", () => {
  const quiz = exampleQuiz("princess");
  const prompt = artworkPrompt(quiz);
  assert.ok(prompt.includes(quiz.id));
  for (const question of quiz.questions) {
    assert.ok(prompt.includes(question.imagePrompt!));
    for (const answer of question.answers)
      assert.ok(prompt.includes(answer.imagePrompt!));
  }
  for (const result of quiz.results) assert.ok(prompt.includes(result.title));
  const changed = structuredClone(quiz);
  changed.questions[0].answers[0].imagePrompt =
    "A pistachio-mango muffin with green nuts and golden fruit.";
  assert.notEqual(artworkPrompt(changed), prompt);
  assert.ok(artworkPrompt(changed).includes("pistachio-mango"));
});

test("image API sends a fresh, quiz-specific request and validates the returned image payload", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only-key";
  const quiz = exampleQuiz("princess");
  let calls = 0;
  try {
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(init!.body as string);
      assert.equal(body.max_tokens, 8192);
      assert.equal(body.image_config.image_size, "2K");
      assert.deepEqual(body.modalities, ["image", "text"]);
      assert.ok(
        body.messages[0].content.includes(
          quiz.questions[0].answers[0].imagePrompt!,
        ),
      );
      assert.ok(body.messages[0].content.includes(quiz.id));
      calls++;
      return Response.json({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url:
                      "data:image/png;base64," +
                      Buffer.from("image-fixture").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      });
    };
    const save = async (id: string, bytes: Buffer) => {
      assert.equal(id, quiz.id);
      assert.equal(bytes.toString(), "image-fixture");
      return { width: 500, height: 600 };
    };
    const first = await generateQuizArtwork(quiz, { fetcher, save });
    await generateQuizArtwork(quiz, { fetcher, save });
    assert.equal(calls, 2);
    assert.equal(first.url, `/api/quiz-assets/${quiz.id}`);
    await assert.rejects(
      () =>
        generateQuizArtwork(quiz, {
          fetcher: async () => Response.json({ data: [] }),
          save,
        }),
      /didn't return usable artwork/,
    );
    await assert.rejects(
      () =>
        generateQuizArtwork(quiz, {
          fetcher: async () =>
            new Response("upstream failure", { status: 402 }),
          save,
        }),
      /credits/,
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("stream parser handles split UTF-8/status events, artwork completion, and interrupted/error streams", async () => {
  const quiz = exampleQuiz("cat");
  quiz.title = "What 🐈 are you?";
  quiz.artwork = artwork(quiz);
  const stages: string[] = [];
  const lines = [
    { type: "stage", stage: "writing" },
    { type: "stage", stage: "drawing" },
    { type: "complete", quiz },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
  assert.deepEqual(
    await readGenerationResponse(streamResponse(lines, 1), (stage) =>
      stages.push(stage),
    ),
    parseQuiz(quiz),
  );
  assert.deepEqual(stages, ["writing", "drawing"]);
  await assert.rejects(
    () =>
      readGenerationResponse(
        streamResponse('{"type":"stage","stage":"drawing"}\n'),
        () => {},
      ),
    /stopped before/,
  );
  await assert.rejects(
    () =>
      readGenerationResponse(
        streamResponse('{"type":"error","error":"Drawing failed"}\n'),
        () => {},
      ),
    /Drawing failed/,
  );
  await assert.rejects(
    () => readGenerationResponse(streamResponse("invalid\n"), () => {}),
    /wasn't valid/,
  );
});

test("generated artwork is saved as WebP, readable by opaque ID, and rejects invalid paths or payloads", async () => {
  const previousDirectory = process.env.QUIZ_ASSET_DIR;
  const directory = await mkdtemp(join(tmpdir(), "buzzquiz-art-test-"));
  process.env.QUIZ_ASSET_DIR = directory;
  try {
    const id = crypto.randomUUID();
    const bytes = await sharp({
      create: { width: 50, height: 60, channels: 3, background: "#cceaf8" },
    })
      .png()
      .toBuffer();
    assert.deepEqual(await saveQuizImage(id, bytes), { width: 50, height: 60 });
    const saved = await readQuizImage(id);
    assert.ok(saved);
    assert.equal((await sharp(saved).metadata()).format, "webp");
    assert.deepEqual(saved, await readFile(join(directory, `${id}.webp`)));
    // A later generation must not evict artwork still used by a saved quiz.
    const old = new Date(Date.now() - 7 * 86400000);
    await utimes(join(directory, `${id}.webp`), old, old);
    await saveQuizImage(crypto.randomUUID(), bytes);
    assert.deepEqual(await readQuizImage(id), saved);
    assert.equal(await readQuizImage("../../.env.local"), null);
    await assert.rejects(() =>
      saveQuizImage(crypto.randomUUID(), Buffer.from("not-an-image")),
    );
    await assert.rejects(() => saveQuizImage("invalid", bytes));
  } finally {
    if (previousDirectory === undefined) delete process.env.QUIZ_ASSET_DIR;
    else process.env.QUIZ_ASSET_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test("sheets are drawn as native transparent cutouts, repacked, and saved with a separate background scene", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  const sheet = await sharp({
    create: {
      width: 400,
      height: 200,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><circle cx="100" cy="100" r="50" fill="#e33"/><rect x="250" y="50" width="100" height="100" fill="#33e"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const scene = await sharp({
    create: { width: 300, height: 300, channels: 3, background: "#7ac" },
  })
    .png()
    .toBuffer();
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  try {
    const id = crypto.randomUUID();
    const art = await generateArtworkSheet(
      id,
      [["A muffin", "A teacup"]],
      2,
      "foodie",
      {
        background: { prompt: "A cosy bakery window", row: 1 },
        fetcher: async (url, init) => {
          const body = JSON.parse(init!.body as string);
          requests.push({ url: String(url), body });
          if (url === "https://openrouter.ai/api/v1/images")
            return Response.json({
              data: [{ b64_json: sheet.toString("base64") }],
            });
          return Response.json({
            choices: [
              {
                message: {
                  images: [
                    {
                      image_url: {
                        url: `data:image/png;base64,${scene.toString("base64")}`,
                      },
                    },
                  ],
                },
              },
            ],
          });
        },
        save: async (_id, bytes, options) => {
          assert.equal(options?.packed, true);
          const metadata = await sharp(bytes).metadata();
          assert.equal(metadata.width, 2 * ATLAS_CELL);
          assert.equal(metadata.height, 2 * ATLAS_CELL);
          assert.equal(metadata.hasAlpha, true);
          // The background scene fills its whole cell, opaquely.
          const { data } = await sharp(bytes)
            .extract({ left: 0, top: ATLAS_CELL, width: 4, height: 4 })
            .raw()
            .toBuffer({ resolveWithObject: true });
          assert.equal(data[3], 255);
          return { width: metadata.width!, height: metadata.height! };
        },
      },
    );
    const [cutouts, background] = [
      requests.find((r) => r.url.endsWith("/images"))!,
      requests.find((r) => r.url.endsWith("/chat/completions"))!,
    ];
    assert.equal(requests.length, 2);
    assert.equal(cutouts.body.background, "transparent");
    assert.equal(cutouts.body.output_format, "png");
    assert.equal(cutouts.body.quality, "medium");
    assert.equal(cutouts.body.aspect_ratio, "16:9");
    assert.equal(cutouts.body.provider.allow_fallbacks, false);
    assert.equal(cutouts.body.max_tokens, undefined);
    assert.ok(cutouts.body.prompt.includes("TRANSPARENT CUTOUTS"));
    assert.ok(cutouts.body.prompt.includes("A teacup"));
    assert.ok(!cutouts.body.prompt.includes("bakery window"));
    assert.ok(background.body.messages[0].content.includes("bakery window"));
    assert.equal(background.body.image_config.aspect_ratio, "1:1");
    assert.deepEqual(
      { columns: art.columns, rows: art.rows, packed: art.packed },
      { columns: 2, rows: 2, packed: true },
    );

    // Portraits use the low-quality transparent request and no background.
    requests.length = 0;
    const portraits = await generateArtworkSheet(
      crypto.randomUUID(),
      [["Belle", "Moana"]],
      2,
      "foodie",
      {
        foreground: true,
        fetcher: async (url, init) => {
          requests.push({
            url: String(url),
            body: JSON.parse(init!.body as string),
          });
          return Response.json({
            data: [{ b64_json: sheet.toString("base64") }],
          });
        },
        save: async () => ({ width: 2 * ATLAS_CELL, height: ATLAS_CELL }),
      },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.quality, "low");
    assert.ok(requests[0].body.prompt.includes("Belle"));
    assert.equal(portraits.rows, 1);
  } finally {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
  }
});
