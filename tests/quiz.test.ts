import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import OpenAI from "openai";
import { defaultSettings, exampleQuiz, examples } from "../src/lib/examples";
import {
  contentSchema,
  generationInputSchema,
  mobileContentSchema,
  parseQuiz,
  scoreQuiz,
  validateContent,
} from "../src/lib/quiz";
import { variedQuiz } from "./varied-quiz";
import { writeContentSet } from "../src/lib/generate-content";
import { reusableFixture } from "./reusable-fixture";
import { createShareUrl, readShareUrl } from "../src/lib/library";

test("new generations enforce mobile copy limits while older quiz links remain valid", () => {
  const quiz = exampleQuiz("princess");
  assert.equal(mobileContentSchema.safeParse(quiz).success, true);
  quiz.results[0].description = "A".repeat(261);
  assert.equal(mobileContentSchema.safeParse(quiz).success, false);
  assert.equal(contentSchema.safeParse(quiz).success, true);
  quiz.results[0].description = "Short description.";
  quiz.questions[0].answers[0].text = "A".repeat(66);
  assert.equal(mobileContentSchema.safeParse(quiz).success, false);
  assert.equal(contentSchema.safeParse(quiz).success, true);
});

test("examples validate and all four outcomes are independently reachable", () => {
  for (const example of examples) {
    const quiz = parseQuiz(exampleQuiz(example.id));
    for (const result of quiz.results) {
      const choices = Object.fromEntries(
        quiz.questions.map((q) => [
          q.id,
          q.answers.find((a) => a.resultId === result.id)!.id,
        ]),
      );
      assert.equal(scoreQuiz(quiz, choices).id, result.id);
    }
  }
});

test("scoring requires a valid answer for every question and resolves ties consistently", () => {
  const quiz = exampleQuiz("princess");
  assert.throws(() => scoreQuiz(quiz, {}), /Answer every question/);
  const ids = [0, 1, 0, 1, 2];
  const choices = Object.fromEntries(
    quiz.questions.map((q, index) => [q.id, q.answers[ids[index]].id]),
  );
  assert.equal(scoreQuiz(quiz, choices).id, quiz.results[0].id);
  const alternatePresentation = {
    ...quiz,
    settings: {
      ...quiz.settings,
      theme: "study" as const,
      layout: "stack" as const,
    },
  };
  assert.equal(
    scoreQuiz(alternatePresentation, choices).id,
    scoreQuiz(quiz, choices).id,
  );
});

test("malformed mappings, duplicated IDs, and incorrect counts are rejected", () => {
  const quiz = exampleQuiz("princess");
  quiz.questions[0].answers[0].resultId = "missing";
  assert.throws(() => validateContent(quiz), /map one answer/);
  const duplicate = exampleQuiz("princess");
  duplicate.results[1].id = duplicate.results[0].id;
  assert.throws(() => validateContent(duplicate), /unique IDs/);
  assert.throws(() => validateContent(exampleQuiz("cat"), 7), /wrong number/);
  assert.equal(
    generationInputSchema.safeParse({
      ...defaultSettings,
      subject: " ",
      questionCount: 1000,
    }).success,
    false,
  );
});

test("compressed share links round-trip complete quizzes and reject damaged data", async () => {
  const quiz = exampleQuiz("cat");
  const url = await createShareUrl(quiz, "https://example.com");
  assert.deepEqual(await readShareUrl(new URL(url).hash), quiz);
  assert.equal(await readShareUrl("#something-else"), null);
  await assert.rejects(() => readShareUrl("#quiz=broken"));
  await assert.rejects(
    () => readShareUrl(`#quiz=${"a".repeat(24001)}`),
    /too large/,
  );
});

test("AI integration sends the structured schema, validates mappings, and handles refusal", async () => {
  let mode: "valid" | "invalid" | "refusal" = "valid";
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    const content = structuredClone(reusableFixture().questions);
    if (mode === "invalid")
      content.questions[0].answers[0].resultId =
        content.questions[0].answers[1].resultId;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_mock",
        object: "response",
        created_at: 1,
        status: "completed",
        model: "mock-model",
        output: [
          {
            id: "msg_mock",
            type: "message",
            role: "assistant",
            status: "completed",
            content:
              mode === "refusal"
                ? [{ type: "refusal", refusal: "Try another topic" }]
                : [
                    {
                      type: "output_text",
                      text: JSON.stringify(content),
                      annotations: [],
                    },
                  ],
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new OpenAI({
    apiKey: "test-key",
    baseURL: `http://127.0.0.1:${address.port}`,
    maxRetries: 0,
  });
  try {
    const content = await writeContentSet(
      "questions",
      defaultSettings,
      undefined,
      client,
    );
    assert.ok("questions" in content);
    const sentInput = (bodies[0].input as Array<{ content: string }>)[1]
      .content;
    assert.ok(sentInput.includes(defaultSettings.basis));
    assert.ok(!sentInput.includes(defaultSettings.subject));
    assert.equal(bodies[0].store, false);
    const format = (
      bodies[0].text as { format: { type: string; strict: boolean } }
    ).format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    mode = "invalid";
    await assert.rejects(
      () => writeContentSet("questions", defaultSettings, undefined, client),
      /map one answer/,
    );
    mode = "refusal";
    await assert.rejects(
      () => writeContentSet("questions", defaultSettings, undefined, client),
      /different topic/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
