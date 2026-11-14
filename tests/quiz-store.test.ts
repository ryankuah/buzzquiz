import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleQuiz, defaultSettings } from "../src/lib/examples";
import { normalizePrompt, quizPromptKey } from "../src/lib/normalize-prompt";
import { createQuizStore } from "../src/lib/quiz-store";
import { parseQuiz, scoreQuiz, type Quiz } from "../src/lib/quiz";
import { artworkPrompt } from "../src/lib/generate-artwork";
import { variedQuiz } from "./varied-quiz";

const equivalent = {
  ...defaultSettings,
  subject: "  What kind of DISNEY PRINCESSES are you?! ",
  basis: "Based on my FAVORITE muffins!!!",
};
function completeQuiz() {
  const quiz = variedQuiz(exampleQuiz("princess"));
  quiz.artwork = {
    url: `/api/quiz-assets/${quiz.id}`,
    columns: 5,
    rows: 6,
    width: 500,
    height: 600,
    model: "test",
    generatedAt: new Date().toISOString(),
  };
  return quiz;
}

test("prompt equivalence handles spelling, wrappers, plurals and Unicode without merging different ideas", () => {
  assert.equal(quizPromptKey(defaultSettings), quizPromptKey(equivalent));
  assert.equal(
    quizPromptKey({ ...defaultSettings, subject: "Ｄｉｓｎｅｙ princess" }),
    quizPromptKey(defaultSettings),
  );
  assert.equal(
    quizPromptKey({ ...defaultSettings, theme: "scent", layout: "stack" }),
    quizPromptKey(defaultSettings),
  );
  for (const change of [
    { basis: "your least favourite muffins" },
    { basis: "your favourite cookies" },
    { subject: "Disney villain" },
    { tone: "chaotic" as const },
    { questionCount: 7 as const },
  ])
    assert.notEqual(
      quizPromptKey({ ...defaultSettings, ...change }),
      quizPromptKey(defaultSettings),
    );
  assert.equal(normalizePrompt(defaultSettings).basis, "favorite muffin");
  assert.throws(
    () => normalizePrompt({ ...defaultSettings, subject: "?!" }),
    /both blanks/,
  );
});

test("saved quizzes survive a new store instance, keep exact art, and skip missing or damaged data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buzzquiz-store-"));
  let artExists = true;
  const options = { directory, hasArtwork: async () => artExists };
  try {
    const store = createQuizStore(options);
    const quiz = completeQuiz();
    await store.save(defaultSettings, quiz);
    assert.deepEqual(
      await createQuizStore(options).find(equivalent),
      parseQuiz(quiz),
    );
    assert.equal((await readdir(directory)).length, 1);
    artExists = false;
    assert.equal(await store.find(defaultSettings), null);
    const invalid = completeQuiz();
    invalid.questions[0].answers[0].resultId = "missing";
    await writeFile(
      join(directory, `${quizPromptKey(defaultSettings)}.json`),
      JSON.stringify({ version: 1, quiz: invalid }),
    );
    assert.equal(await store.find(defaultSettings), null);
    await assert.rejects(() => store.save(defaultSettings, quiz), /incomplete/);
    artExists = true;
    await writeFile(
      join(directory, `${quizPromptKey(defaultSettings)}.json`),
      "partial json",
    );
    assert.equal(await store.find(defaultSettings), null);
    assert.equal(
      await store.find({ ...defaultSettings, subject: "a different subject" }),
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mixed answer counts preserve all outcomes, validate pair scoring, and pad the art atlas", () => {
  const quiz = parseQuiz(completeQuiz());
  assert.deepEqual(
    quiz.questions.map((q) => q.answers.length),
    [4, 2, 4, 2, 4],
  );
  assert.equal(new Set(quiz.questions.map((q) => q.layout)).size, 3);
  for (const result of quiz.results) {
    const selections = Object.fromEntries(
      quiz.questions.map((q) => [
        q.id,
        q.answers.find(
          (a) => a.resultId === result.id || a.secondaryResultId === result.id,
        )!.id,
      ]),
    );
    assert.equal(scoreQuiz(quiz, selections).id, result.id);
  }
  const duplicate = structuredClone(quiz);
  duplicate.questions[1].answers[0].secondaryResultId =
    duplicate.questions[1].answers[0].resultId;
  assert.throws(() => parseQuiz(duplicate), /disjoint pairs/);
  const three = structuredClone(quiz);
  three.questions[0].answers.pop();
  assert.throws(() => parseQuiz(three));
  assert.equal(artworkPrompt(quiz).match(/An empty cell/g)?.length, 4);
});

test("house plurals and the Hogwarts alias share the same subject set", () => {
  const house = { ...defaultSettings, subject: "Harry Potter house" };
  assert.equal(
    quizPromptKey(house),
    quizPromptKey({ ...house, subject: "Harry Potter houses" }),
  );
  assert.equal(
    quizPromptKey(house),
    quizPromptKey({ ...house, subject: "Hogwarts house" }),
  );
});
