import test from "node:test";
import assert from "node:assert/strict";
import { app, secret, setup } from "./convex-fixture";
import { contentKeys, quizPromptKey } from "../src/lib/normalize-prompt";
import { defaultSettings } from "../src/lib/examples";
import { createQuizResolver } from "../src/lib/resolve-quiz";
import { resolveReading } from "../src/lib/resolve-reading";
import { reusableFixture } from "./reusable-fixture";

test("Convex claims are atomic, count attempts on the first paid call, and protect provider-call counts", async () => {
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
  // Attempts are counted on the first paid call, not on the claim, and
  // there is no daily cap on how many can start.
  for (let i = 0; i < 8; i++) {
    const claim = await t.mutation(app.api.cache.claim, {
      secret,
      key: `new-${i}`,
      kind: "reading",
      owner: "a",
    });
    assert.equal(claim.state, "claimed");
    await t.mutation(app.api.cache.recordCall, {
      secret,
      key: `new-${i}`,
      owner: "a",
      type: "text",
    });
  }
  await t.mutation(app.api.cache.claim, {
    secret,
    key: "unpaid",
    kind: "quiz",
    owner: "b",
  });
  assert.deepEqual(await t.query(app.api.cache.usage, { secret }), {
    day: new Date().toISOString().slice(0, 10),
    attempts: 9,
    textCalls: 9,
    imageCalls: 0,
  });
});

test("answer-specific readings reuse the exact picks, and saved quizzes cost nothing", async () => {
  const { repository, t } = setup();
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
  await resolveReading(quiz, changed, { repository, generate });
  assert.equal(calls, 2);
  await repository.saveQuiz(quizPromptKey(defaultSettings), quiz);
  assert.equal(
    (await createQuizResolver({ repository })(defaultSettings)).reused,
    true,
  );
  assert.equal((await t.query(app.api.cache.usage, { secret })).attempts, 2);
});
