import test from "node:test";
import assert from "node:assert/strict";
import { defineTestApp } from "convex-test";
import schema from "../convex/schema";
import * as cache from "../convex/cache";
import {
  type Claim,
  type ContentRecord,
  type ContentRepository,
} from "../src/lib/content-sets";
import { parseQuiz } from "../src/lib/quiz";
import { contentKeys, quizPromptKey } from "../src/lib/normalize-prompt";
import { defaultSettings } from "../src/lib/examples";
import { createQuizResolver } from "../src/lib/resolve-quiz";
import { type GenerationProgress } from "../src/lib/generation-response";
import { resolveReading } from "../src/lib/resolve-reading";
import {
  dailyGenerationLimit,
  GenerationLimitError,
  ProviderRefusalError,
} from "../src/lib/generation-budget";
import { reusableFixture } from "./reusable-fixture";

const app = defineTestApp({ schema }).defineModules({ cache });
const secret = "only-for-in-memory-tests";
function setup(limit = 5) {
  process.env.BUZZQUIZ_SERVER_SECRET = secret;
  process.env.DAILY_GENERATION_LIMIT = String(limit);
  const t = app.createTest();
  const update = async (
    key: string,
    owner: string,
    status: "building" | "ready" | "failed",
    extra = {},
  ) => {
    await t.mutation(app.api.cache.updateContent, {
      secret,
      key,
      owner,
      status,
      ...extra,
    });
  };
  const repository: ContentRepository = {
    async findQuiz(key) {
      const q = await t.query(app.api.cache.findQuiz, { secret, key });
      return q ? parseQuiz(q) : null;
    },
    async saveQuiz(key, quiz) {
      return parseQuiz(
        await t.mutation(app.api.cache.saveQuiz, { secret, key, quiz }),
      );
    },
    async findContent(key) {
      return (await t.query(app.api.cache.findContent, {
        secret,
        key,
      })) as ContentRecord | null;
    },
    async claim(key, kind) {
      return (await t.mutation(app.api.cache.claim, {
        secret,
        key,
        kind,
        owner: crypto.randomUUID(),
      })) as Claim;
    },
    checkpoint: (key, owner, data) => update(key, owner, "building", { data }),
    complete: (key, owner, content) => update(key, owner, "ready", content),
    fail: (key, owner, blocked = false) =>
      update(key, owner, "failed", { blocked }),
    async recordCall(key, owner, type) {
      await t.mutation(app.api.cache.recordCall, { secret, key, owner, type });
    },
  };
  return { t, repository };
}

test("Convex claims are atomic, fail closed, enforce five attempts, and protect provider-call counts", async () => {
  const { t } = setup();
  await assert.rejects(
    () =>
      t.mutation(app.api.cache.claim, {
        secret: "wrong",
        key: "subject",
        kind: "outcomes",
        owner: "a",
      }),
    /Unauthorized/,
  );
  const claims = await Promise.all(
    ["a", "b"].map((owner) =>
      t.mutation(app.api.cache.claim, {
        secret,
        key: "same",
        kind: "outcomes",
        owner,
      }),
    ),
  );
  assert.deepEqual(claims.map((c) => c.state).sort(), ["claimed", "wait"]);
  const owner = claims.find((c) => c.state === "claimed")!.owner!;
  await t.mutation(app.api.cache.recordCall, {
    secret,
    key: "same",
    owner,
    type: "text",
  });
  await assert.rejects(
    () =>
      t.mutation(app.api.cache.recordCall, {
        secret,
        key: "same",
        owner,
        type: "text",
      }),
    /already used/,
  );
  for (let i = 0; i < 4; i++)
    assert.equal(
      (
        await t.mutation(app.api.cache.claim, {
          secret,
          key: `new-${i}`,
          kind: "reading",
          owner: "a",
        })
      ).state,
      "claimed",
    );
  assert.equal(
    (
      await t.mutation(app.api.cache.claim, {
        secret,
        key: "over-budget",
        kind: "questions",
        owner: "a",
      })
    ).state,
    "limited",
  );
  assert.deepEqual(await t.query(app.api.cache.usage, { secret }), {
    day: new Date().toISOString().slice(0, 10),
    limit: 5,
    attempts: 5,
    textCalls: 1,
    imageCalls: 0,
  });
  assert.equal(dailyGenerationLimit("garbage"), 0);
  assert.equal(dailyGenerationLimit("-1"), 0);
});

test("first and second blanks reuse independently, including previously unseen combinations", async () => {
  const { repository, t } = setup();
  const fixture = reusableFixture();
  const written: string[] = [],
    drawn: string[] = [];
  const resolver = createQuizResolver({
    repository,
    write: async (kind, input) => {
      written.push(
        `${kind}:${kind === "outcomes" ? input.subject : input.basis}`,
      );
      return kind === "outcomes" ? fixture.outcomes : fixture.questions;
    },
    draw: async (kind) => {
      drawn.push(kind);
      return kind === "outcomes"
        ? fixture.foreground.artwork
        : fixture.background.artwork;
    },
  });
  const progress: GenerationProgress[] = [];
  const first = await resolver(defaultSettings, {
    onStage: (event) => progress.push(event),
  });
  assert.deepEqual(progress, [
    { stage: "checking", status: "active" },
    { stage: "checking", status: "complete" },
    { stage: "results", status: "active" },
    { stage: "results", status: "complete" },
    { stage: "result-artwork", status: "active" },
    { stage: "result-artwork", status: "complete" },
    { stage: "questions", status: "active" },
    { stage: "questions", status: "complete" },
    { stage: "question-artwork", status: "active" },
    { stage: "question-artwork", status: "complete" },
    { stage: "finishing", status: "active" },
  ]);
  progress.length = 0;
  await resolver(defaultSettings, { onStage: (event) => progress.push(event) });
  assert.deepEqual(progress, [
    { stage: "checking", status: "active" },
    { stage: "checking", status: "complete" },
    { stage: "results", status: "reused" },
    { stage: "result-artwork", status: "reused" },
    { stage: "questions", status: "reused" },
    { stage: "question-artwork", status: "reused" },
    { stage: "finishing", status: "active" },
  ]);
  assert.deepEqual(
    written.map((s) => s.split(":")[0]),
    ["outcomes", "questions"],
  );
  const otherSubject = { ...defaultSettings, subject: "Harry Potter houses" };
  const otherBasis = { ...defaultSettings, basis: "your favourite breakfasts" };
  await resolver(otherSubject);
  await resolver(otherBasis);
  assert.equal(written.length, 4);
  progress.length = 0;
  const combo = await resolver(
    { ...otherSubject, basis: otherBasis.basis },
    { onStage: (event) => progress.push(event) },
  );
  assert.deepEqual(progress, [
    { stage: "checking", status: "active" },
    { stage: "checking", status: "complete" },
    { stage: "results", status: "reused" },
    { stage: "result-artwork", status: "reused" },
    { stage: "questions", status: "reused" },
    { stage: "question-artwork", status: "reused" },
    { stage: "finishing", status: "active" },
  ]);
  assert.equal(combo.reused, true);
  assert.equal(written.length, 4);
  assert.equal(drawn.length, 4);
  assert.deepEqual(combo.quiz.questionArtwork, fixture.background.artwork);
  assert.deepEqual(combo.quiz.resultArtwork, fixture.foreground.artwork);
  assert.equal(combo.quiz.backgroundIndex, 25);
  assert.deepEqual(
    combo.quiz.questions.map((q) => q.answers.length),
    [4, 2, 4, 2, 4],
  );
  assert.equal(
    (
      await resolver({
        ...defaultSettings,
        subject: "DISNEY PRINCESSES!",
        basis: "my favorite muffin",
      })
    ).quiz.id,
    first.quiz.id,
  );
  assert.equal((await t.query(app.api.cache.usage, { secret })).attempts, 4);
  assert.equal(
    contentKeys(otherSubject).questions,
    contentKeys(defaultSettings).questions,
  );
  assert.equal(
    contentKeys(otherBasis).outcomes,
    contentKeys(defaultSettings).outcomes,
  );
});

test("separate resolver instances share Convex locks and retry artwork from saved text", async () => {
  const { repository } = setup();
  const fixture = reusableFixture();
  let writes = 0,
    draws = 0,
    fail = true;
  const options = {
    repository,
    write: async (kind: "outcomes" | "questions") => {
      writes++;
      return kind === "outcomes" ? fixture.outcomes : fixture.questions;
    },
    draw: async (kind: "outcomes" | "questions") => {
      draws++;
      if (fail) {
        fail = false;
        throw new Error("Image service failed");
      }
      return kind === "outcomes"
        ? fixture.foreground.artwork
        : fixture.background.artwork;
    },
  };
  await assert.rejects(
    () => createQuizResolver(options)(defaultSettings),
    /Image service failed/,
  );
  const progress: GenerationProgress[] = [];
  const [a, b] = await Promise.all([
    createQuizResolver(options)(defaultSettings, {
      onStage: (event) => progress.push(event),
    }),
    createQuizResolver(options)(defaultSettings),
  ]);
  assert.equal(a.quiz.id, b.quiz.id);
  assert.equal(writes, 2);
  assert.equal(draws, 3);
  assert(
    progress.some(
      (event) => event.stage === "results" && event.status === "reused",
    ),
  );
  assert(
    !progress.some(
      (event) => event.stage === "results" && event.status === "complete",
    ),
  );
});

test("answer-specific readings reuse the exact picks, and the shared limit leaves saved quizzes playable", async () => {
  const { repository, t } = setup(1);
  const fixture = reusableFixture();
  const quiz = fixture.quiz;
  const picks = Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.answers[0].id]),
  );
  let calls = 0;
  const generate = async () => {
    calls++;
    return {
      resultId: "curious",
      headline: "You notice the details",
      traits: ["Curious", "Loyal", "Thoughtful"],
      paragraphs: [
        "Your choices show a thoughtful streak.",
        "Belle would approve of your curiosity.",
      ],
      evidence: {
        questionId: quiz.questions[0].id,
        choice: quiz.questions[0].answers[0].text,
        note: "You trust your taste.",
      },
    };
  };
  const first = await resolveReading(quiz, picks, { repository, generate });
  assert.deepEqual(
    await resolveReading(
      quiz,
      Object.fromEntries(Object.entries(picks).reverse()),
      { repository, generate },
    ),
    first,
  );
  assert.equal(calls, 1);
  const changed = {
    ...picks,
    [quiz.questions[0].id]: quiz.questions[0].answers[1].id,
  };
  await assert.rejects(
    () => resolveReading(quiz, changed, { repository, generate }),
    GenerationLimitError,
  );
  await repository.saveQuiz(quizPromptKey(defaultSettings), quiz);
  assert.equal(
    (await createQuizResolver({ repository })(defaultSettings)).reused,
    true,
  );
  assert.equal((await t.query(app.api.cache.usage, { secret })).attempts, 1);
});

test("provider refusals are remembered so repeated requests cannot spend another allowance slot", async () => {
  const { repository, t } = setup();
  const fixture = reusableFixture();
  let draws = 0;
  const resolver = createQuizResolver({
    repository,
    write: async () => fixture.outcomes,
    draw: async () => {
      draws++;
      throw new ProviderRefusalError();
    },
  });
  await assert.rejects(() => resolver(defaultSettings), ProviderRefusalError);
  await assert.rejects(() => resolver(defaultSettings), ProviderRefusalError);
  assert.equal(draws, 1);
  assert.equal((await t.query(app.api.cache.usage, { secret })).attempts, 1);
});
