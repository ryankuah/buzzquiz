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
