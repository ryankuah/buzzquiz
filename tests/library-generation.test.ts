import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import OpenAI from "openai";
import sharp from "sharp";
import { app, secret, setup } from "./convex-fixture";
import { archetypes } from "../src/lib/content-sets";
import {
  refusalKey,
  sameName,
  type LibraryAsset,
  type LibraryRepository,
} from "../src/lib/asset-library";
import { findAssets, type FoundAssets } from "../src/lib/find-assets";
import {
  planQuizKey,
  planQuiz,
  validateQuizPlan,
  wordingKey,
  type QuizPlan,
} from "../src/lib/plan-quiz";
import {
  bindQuizDraft,
  MAX_NEW_PICTURES,
  pictureBudget,
  pictureHandles,
  writeQuiz,
} from "../src/lib/write-quiz";
import {
  drawPictures,
  type DrawnParts,
  type PartName,
} from "../src/lib/draw-pictures";
import { composeCells } from "../src/lib/compose-quiz-artwork";
import { createQuizResolver } from "../src/lib/resolve-quiz";
import { ProviderRefusalError } from "../src/lib/generation-budget";
import { questionTemplatePlan } from "../src/lib/templates";
import { assetIdentity } from "../src/lib/topic-text";
import {
  DEFAULT_QUIZ_SETTINGS,
  parseQuiz,
  type GenerationInput,
  type QuizArtwork,
} from "../src/lib/quiz";
import { type Embedder, type TopicRepository } from "../src/lib/topics";
import { quizPromptKey } from "../src/lib/normalize-prompt";
import { reusableFixture } from "./reusable-fixture";

// Bag-of-words vectors: texts sharing words are similar, like real embeddings.
const embed: Embedder = async (texts) =>
  texts.map((value) => {
    const vector = new Array(3072).fill(0);
    for (const word of value.toLowerCase().match(/[a-z]+/g) ?? []) {
      let hash = 0;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 3072;
      vector[hash] += 1;
    }
    const length = Math.hypot(...vector) || 1;
    return { vector: vector.map((item) => item / length), model: "test" };
  });

function memoryLibrary() {
  const rows: Array<LibraryAsset & { embedding: number[] }> = [];
  const refusals = new Set<string>();
  const refuseLog: string[][] = [];
  const repository: LibraryRepository = {
    async namedSprites(names) {
      return names.map((name) =>
        rows.filter((a) => a.kind === "sprite" && sameName(a.name, name)),
      );
    },
    async portraits(topic, names) {
      return names.map(
        (name) =>
          rows.find(
            (a) =>
              a.kind === "sprite" &&
              assetIdentity(topic, name) === assetIdentity(a.topic, a.name),
          ) ?? null,
      );
    },
    async refused(keys) {
      return keys.filter((key) => refusals.has(key));
    },
    async refuse(keys) {
      refuseLog.push(keys);
      for (const key of keys) refusals.add(key);
    },
    async search(queries) {
      return queries.map((query) =>
        rows
          .filter((row) => row.kind === query.kind)
          .map(({ embedding, ...asset }) => ({
            ...asset,
            score: embedding.reduce(
              (sum, value, index) => sum + value * query.vector[index],
              0,
            ),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, query.limit),
      );
    },
    async get(ids) {
      return ids.map((id) => {
        const row = rows.find((item) => item.id === id);
        if (!row) return null;
        const { embedding: _embedding, ...asset } = row;
        return asset;
      });
    },
    async add(assets) {
      rows.push(...assets);
      return assets.length;
    },
  };
  return { rows, refusals, refuseLog, repository };
}

function plan(overrides: Partial<QuizPlan> = {}): QuizPlan {
  return validateQuizPlan({
    title: "Which Disney Princess Are You, Based on Your Snack Choices?",
    outcomeCategory: "Disney princess",
    outcomeRelation: "you are",
    questionTopic: "snack",
    questionAngle: "choices",
    outcomes: ["Belle", "Mulan", "Tiana", "Moana"].map((name) => ({
      name,
      description: `${name} smiling in her signature outfit`,
      imagePrompt: `${name}, waist-up cutout`,
    })),
    visualQueries: [
      "bag of salted crisps",
      "chocolate bar",
      "bowl of popcorn",
      "fresh fruit",
      "spicy noodles",
      "cheese board",
    ],
    scene: "a cosy pantry with shelves of snacks",
    typeface: "storybook",
    questions: questionTemplatePlan(5).map(({ answerCount }, index) => ({
      text: `Which snack would you pick in situation ${index}?`,
      neutralSubject: null,
      answers: (answerCount === 4
        ? archetypes.map((id) => [id])
        : [
            ["curious", "bold"],
            ["warm", "driven"],
          ]
      ).map(([resultId, secondary], j) => ({
        text: `Snack choice ${index}-${j}`,
        resultId,
        secondaryResultId: secondary ?? null,
      })),
    })),
    ...overrides,
  });
}

const pairs: Array<[[string, string], [string, string]]> = [
  [
    ["curious", "bold"],
    ["warm", "driven"],
  ],
  [
    ["curious", "warm"],
    ["bold", "driven"],
  ],
  [
    ["curious", "driven"],
    ["bold", "warm"],
  ],
];

/** A valid writer response that uses saved pictures first, then new ones. */
function writerOutput(
  quizPlan: QuizPlan,
  found: FoundAssets,
  count: GenerationInput["questionCount"],
  options: { fresh?: number } = {},
) {
  const handles = pictureHandles(found, pictureBudget(found));
  const fresh = handles.fresh.slice(0, options.fresh ?? handles.fresh.length);
  const pool = [...handles.sprites.map(([handle]) => handle), ...fresh];
  let next = 0;
  const used = new Set<string>();
  const take = () => {
    if (!pool.length) return null;
    const handle = pool[next++ % pool.length];
    used.add(handle);
    return handle;
  };
  let binary = 0;
  const questions = questionTemplatePlan(count).map(
    ({ answerCount }, index) => {
      const picks = new Set<string>();
      const image = () => {
        const handle = take();
        if (!handle || picks.has(handle)) return null;
        picks.add(handle);
        return handle;
      };
      const answers =
        answerCount === 4
          ? archetypes.map((id, choice) => ({
              id: `q${index}a${choice}`,
              text: `Choice ${choice}`,
              emoji: "🍿",
              literalSubject: null as string | null,
              simplerSubject: null as string | null,
              image: image(),
              resultId: id,
              secondaryResultId: null,
              personalityNote: "You know what you like.",
            }))
          : pairs[binary++ % pairs.length].map(([first, second], choice) => ({
              id: `q${index}a${choice}`,
              text: `Choice ${choice}`,
              emoji: "🍫",
              literalSubject: null as string | null,
              simplerSubject: null as string | null,
              image: image(),
              resultId: first,
              secondaryResultId: second,
              personalityNote: "Decisive.",
            }));
      return {
        id: `q${index}`,
        text: `Question ${index}?`,
        emoji: "🥨",
        image: take(),
        answers,
      };
    },
  );
  return {
    results: quizPlan.outcomes.map((_, index) => ({
      outcome: `o${index + 1}`,
      portrait: null as string | null,
      id: archetypes[index],
      emoji: "👑",
      description: "A warm introduction.",
      profile: {
        headline: "Big heart, bigger plans",
        traits: ["Curious", "Loyal", "Bold"],
        paragraphs: ["You notice things.", "Like her, you find a way."],
      },
    })),
    questions,
    scene: handles.scenes.length ? "b1" : "new",
    newScene: handles.scenes.length ? null : "A cosy pantry, no people.",
    decorations: handles.decorations.slice(0, 4).map(([handle]) => handle),
    newPictures: fresh
      .filter((handle) => used.has(handle))
      .map((ref) => ({
        ref,
        name: `${quizPlan.visualQueries[Number(ref.slice(1)) % 6]} ${ref}`,
        description: `A ${quizPlan.visualQueries[Number(ref.slice(1)) % 6]}`,
        imagePrompt: "An isolated cutout",
      })),
  };
}

function fakeArtwork(columns: number, rows: number): QuizArtwork {
  return {
    url: `/api/quiz-assets/${crypto.randomUUID()}`,
    columns,
    rows,
    width: columns * 512,
    height: rows * 512,
    model: "test",
    generatedAt: new Date().toISOString(),
    packed: true,
  };
}

function harness(
  options: {
    refuse?: boolean;
    failCompose?: number;
    failImage?: number;
    /** Fails the first checkpoint write whose data matches, once. */
    failCheckpoint?: (data: any) => boolean;
    /** Holds the writer open until this settles. */
    holdWrite?: Promise<void>;
  } = {},
) {
  const { repository, t } = setup();
  const checkpoint = repository.checkpoint;
  let failCheckpoint = options.failCheckpoint;
  repository.checkpoint = async (key, owner, data) => {
    if (failCheckpoint?.(data)) {
      failCheckpoint = undefined;
      throw new Error("Convex was briefly unreachable.");
    }
    return checkpoint(key, owner, data);
  };
  const library = memoryLibrary();
  const calls = { plan: 0, write: 0, draw: 0, compose: 0 };
  const drawn: Array<{ count: number; scene: string | null }> = [];
  /** Every paid image request, in order. */
  const paid: PartName[] = [];
  const found: FoundAssets[] = [];
  let currentPlan = plan();
  let failCompose = options.failCompose ?? 0;
  let failImage = options.failImage ?? 0;
  const resolver = createQuizResolver({
    repository,
    library: library.repository,
    embed,
    plan: async () => {
      calls.plan++;
      return currentPlan;
    },
    write: async (input, quizPlan, assets) => {
      calls.write++;
      await options.holdWrite;
      found.push(assets);
      return bindQuizDraft(
        writerOutput(quizPlan, assets, input.questionCount),
        quizPlan,
        assets,
        input,
      );
    },
    // Mirrors drawPictures: three independent parts, each settled and
    // reported as soon as it finishes, skipping parts already done.
    draw: async (pictures, scene, drawOptions = {}) => {
      calls.draw++;
      drawn.push({ count: pictures.length, scene });
      const parts: DrawnParts = { ...drawOptions.done };
      const part = async (name: PartName, count: number) => {
        if (!count || parts[name]) return;
        paid.push(name);
        await drawOptions.record?.(name);
        if (name === "image" && failImage > 0) {
          failImage--;
          throw new Error("The image provider timed out.");
        }
        const value = options.refuse
          ? name === "scene"
            ? "failed"
            : "refused"
          : {
              artwork: fakeArtwork(4, Math.ceil(count / 4)),
              cells: Array.from({ length: count }, (_, index) => index),
              ids: Array.from({ length: count }, () => crypto.randomUUID()),
            };
        parts[name] = value;
        await drawOptions.onPart?.(name, value);
      };
      const results = await Promise.allSettled([
        part("portrait", pictures.filter((picture) => picture.result).length),
        part("image", pictures.filter((picture) => !picture.result).length),
        part("scene", scene ? 1 : 0),
      ]);
      for (const result of results)
        if (result.status === "rejected") throw result.reason;
      return parts;
    },
    compose: async (cells, columns, rows) => {
      calls.compose++;
      if (failCompose > 0) {
        failCompose--;
        throw new Error("Storage was briefly unavailable.");
      }
      assert.equal(cells.length, columns * rows);
      return fakeArtwork(columns, rows);
    },
  });
  return {
    t,
    resolver,
    library,
    calls,
    drawn,
    paid,
    found,
    setPlan: (value: QuizPlan) => (currentPlan = value),
  };
}

const input = (subject: string, basis: string): GenerationInput => ({
  ...DEFAULT_QUIZ_SETTINGS,
  subject,
  basis,
});

test("a cold quiz plans, searches, writes and draws only what is missing, once", async () => {
  const h = harness();
  const first = await h.resolver(
    input("which Disney princess you are", "your snack choices"),
  );
  assert.equal(first.reused, false);
  assert.deepEqual(h.calls, { plan: 1, write: 1, draw: 1, compose: 2 });
  // An empty library: four result portraits plus at most the remaining budget.
  assert.ok(h.drawn[0].count >= 4 && h.drawn[0].count <= MAX_NEW_PICTURES);
  assert.ok(h.drawn[0].scene);
  const quiz = parseQuiz(first.quiz);
  assert.equal(
    quiz.title,
    "Which Disney Princess Are You, Based on Your Snack Choices?",
  );
  assert.deepEqual(
    quiz.results.map((result) => result.title),
    ["Belle", "Mulan", "Tiana", "Moana"],
  );
  assert.ok(
    quiz.results.every((result) => result.assetId && !result.imageless),
  );
  assert.equal(quiz.style?.typeface, "storybook");
  // Every drawn picture is now in the shared library, including the scene.
  assert.equal(h.library.rows.length, h.drawn[0].count + 1);

  // Repeating the wording is free.
  const again = await h.resolver(
    input("Which Disney princess you are", "your snack choices!"),
  );
  assert.equal(again.reused, true);
  assert.equal(again.quiz.id, quiz.id);
  assert.deepEqual(h.calls, { plan: 1, write: 1, draw: 1, compose: 2 });

  // New wording with the same meaning only pays to interpret it.
  const reworded = await h.resolver(
    input("which Disney princess are you", "the snacks you pick"),
  );
  assert.equal(reworded.quiz.id, quiz.id);
  assert.deepEqual(h.calls, { plan: 2, write: 1, draw: 1, compose: 2 });
  const usage = await h.t.query(app.api.cache.usage, { secret });
  assert.equal(usage.attempts, 3);
  assert.equal(usage.imageCalls, 3); // portraits, pictures and a scene
});

test("a new idea reuses saved results and pictures from other quizzes", async () => {
  const h = harness();
  await h.resolver(
    input("which Disney princess you are", "your snack choices"),
  );
  const firstDraw = h.drawn[0].count;
  // Two of the same princesses, a different question topic with overlapping
  // snack pictures: those come from the library instead of being redrawn.
  h.setPlan(
    plan({
      title: "Which Disney Princess Should Be Your Best Friend?",
      outcomeRelation: "should be your best friend",
      questionTopic: "movie night",
      outcomes: ["Belle", "Mulan", "Rapunzel", "Ariel"].map((name) => ({
        name,
        description: `${name} smiling in her signature outfit`,
        imagePrompt: `${name}, waist-up cutout`,
      })),
      visualQueries: [
        "bowl of popcorn",
        "chocolate bar",
        "bag of salted crisps",
        "fizzy drink",
        "blanket",
        "remote",
      ],
    }),
  );
  await h.resolver(
    input("which Disney princess should be your best friend", "movie nights"),
  );
  const found = h.found[1];
  assert.equal(found.outcomes[0]?.name, "Belle");
  assert.equal(found.outcomes[1]?.name, "Mulan");
  assert.equal(found.outcomes[2], null);
  assert.ok(found.sprites.length > 0, "snack pictures are offered");
  assert.ok(
    found.sprites.every((sprite) => !["Belle", "Mulan"].includes(sprite.name)),
    "result portraits stay out of the answers",
  );
  assert.ok(found.scenes.length > 0, "the pantry scene is offered");
  // Only Rapunzel and Ariel are certain to be drawn; the rest is optional.
  assert.ok(h.drawn[1].count >= 2);
  assert.equal(h.drawn[1].scene, null);
  assert.ok(h.drawn[1].count < firstDraw + 2);
});

test("refused pictures use generated illustrations and refused results aren't retried", async () => {
  const h = harness({ refuse: true });
  const { quiz } = await h.resolver(
    input("which muffin you are", "your coding habits"),
  );
  assert.ok(
    quiz.results.every((result) => !result.imageless && !result.assetId),
  );
  assert.ok(
    quiz.questions.every(
      (question) =>
        !question.imageless &&
        question.answers.every(
          (answer) => !answer.imageless && !answer.assetId,
        ),
    ),
  );
  assert.equal(h.library.rows.length, 0);
  assert.ok(
    [...h.library.refusals].some((key) =>
      key.endsWith("|disney princess|belle"),
    ),
  );
  // Saved as usual: repeating it costs nothing and isn't "blocked".
  const again = await h.resolver(
    input("which muffin you are", "your coding habits"),
  );
  assert.equal(again.reused, true);
  assert.equal(h.calls.draw, 1);
  // Another quiz with the same results doesn't pay to be refused again.
  h.setPlan(plan({ outcomeRelation: "would be your best friend" }));
  const friend = await h.resolver(
    input("which Disney princess would be your best friend", "your snacks"),
  );
  assert.ok(
    friend.quiz.results.every((result) => !result.imageless && !result.assetId),
  );
  assert.equal(
    h.drawn[1].count,
    MAX_NEW_PICTURES - 4 >= 0 ? h.drawn[1].count : 0,
  );
  assert.ok(h.found[1].refused?.every(Boolean));
  assert.ok(h.drawn[1].count <= MAX_NEW_PICTURES);
});

test("a retry after a failure reuses the checkpointed copy and drawn pictures", async () => {
  const h = harness({ failCompose: 1 });
  const wording = input("which Disney princess you are", "your snack choices");
  await assert.rejects(() => h.resolver(wording), /briefly unavailable/);
  const before = await h.t.query(app.api.cache.usage, { secret });
  const { quiz } = await h.resolver(wording);
  assert.ok(parseQuiz(quiz));
  assert.equal(h.calls.write, 1);
  assert.equal(h.calls.draw, 1);
  assert.equal(h.library.rows.length, h.drawn[0].count + 1);
  // Laying out saved pixels again is free: no new attempt or paid call.
  assert.deepEqual(await h.t.query(app.api.cache.usage, { secret }), before);
});

test("a partly failed drawing only retries the part that failed", async () => {
  const h = harness({ failImage: 1 });
  const wording = input("which Disney princess you are", "your snack choices");
  await assert.rejects(() => h.resolver(wording), /timed out/);
  assert.deepEqual([...h.paid].sort(), ["image", "portrait", "scene"]);
  const { quiz } = await h.resolver(wording);
  assert.ok(quiz.results.every((result) => result.assetId));
  // The portraits and scene were checkpointed; only the pictures are redrawn.
  assert.deepEqual(h.paid.slice(3), ["image"]);
  assert.equal(h.calls.write, 1);
  const usage = await h.t.query(app.api.cache.usage, { secret });
  assert.equal(usage.imageCalls, 4);
  assert.equal(h.library.rows.length, h.drawn[0].count + 1);
});

test("a failed checkpoint never loses parts that finished after it", async () => {
  const h = harness({ failCheckpoint: (data) => !!data?.parts });
  const wording = input("which Disney princess you are", "your snack choices");
  await assert.rejects(() => h.resolver(wording), /briefly unreachable/);
  assert.equal(h.paid.length, 3);
  const { quiz } = await h.resolver(wording);
  assert.ok(quiz.results.every((result) => result.assetId));
  // Later snapshots held every part, so nothing is paid for twice.
  assert.equal(h.paid.length, 3);
});

test("a refused sheet is counted once even when the next save fails", async () => {
  const h = harness({ refuse: true, failCheckpoint: (data) => !!data?.drawn });
  const wording = input("which Disney princess you are", "your snack choices");
  await assert.rejects(() => h.resolver(wording), /briefly unreachable/);
  await h.resolver(wording);
  assert.equal(h.library.refuseLog.length, 1);
  assert.equal(h.paid.length, 3);
});

test("two requests racing for one new quiz: one builds it, the other reuses it", async () => {
  let release = () => {};
  const h = harness({ holdWrite: new Promise((done) => (release = done)) });
  const wording = input("which Disney princess you are", "your snack choices");
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const first = h.resolver(wording);
  while (h.calls.write === 0) await pause(5);
  // The second request finds the quiz being built and waits for it.
  const second = h.resolver(wording);
  await pause(200);
  release();
  const both = await Promise.all([first, second]);
  assert.equal(both[0].quiz.id, both[1].quiz.id);
  assert.deepEqual(
    both.map((item) => item.reused),
    [false, true],
  );
  assert.equal(h.calls.write, 1);
});

test("older quizzes are found by saved topic aliases without paying to plan", async () => {
  const { repository } = setup();
  const legacy = reusableFixture().quiz;
  await repository.saveQuiz(
    quizPromptKey(input("Disney princess", "snack"), {
      subject: "disney princess",
      basis: "snack",
    }),
    legacy,
  );
  const topics: TopicRepository = {
    // The basis also has an alias, but the old quiz was saved under its
    // exact wording: mixed pairs must still be tried.
    findAlias: async (kind, alias) =>
      kind !== "shared"
        ? null
        : alias === "princess from disney"
          ? "disney princess"
          : alias === "snack"
            ? "treat"
            : null,
    nearest: async () => null,
    register: async () => {},
  };
  let planned = 0;
  const resolver = createQuizResolver({
    repository,
    library: memoryLibrary().repository,
    topics,
    plan: async () => {
      planned++;
      throw new Error("No planning expected.");
    },
  });
  const found = await resolver(
    input("which princess from Disney you are", "snack"),
  );
  assert.equal(found.reused, true);
  assert.equal(found.quiz.id, legacy.id);
  assert.equal(planned, 0);
  // Symbols that older keys erased never match an older quiz.
  await repository.saveQuiz(quizPromptKey(input("C feature", "snack")), legacy);
  await assert.rejects(
    () => resolver(input("which C++ feature you are", "snack")),
    /No planning expected/,
  );
  assert.equal(planned, 1);
  for (const [older, different] of [
    ["number 1", "number -1"],
    ["R B", "R&B"],
  ]) {
    await repository.saveQuiz(quizPromptKey(input(older, "snack")), legacy);
    await assert.rejects(
      () => resolver(input(different, "snack")),
      /No planning expected/,
    );
  }
});

test("a saved quiz using a previous free-form plan still opens without paid calls", async () => {
  const { repository } = setup();
  const wording = input("which muffin you are", "your coding habits");
  const { questions: _questions, ...idea } = plan({
    outcomeCategory: "muffin",
  });
  const key = wordingKey(wording, 2);
  const claim = await repository.claim(key, "plan");
  assert.ok(claim.state === "claimed");
  await repository.complete(key, claim.owner, { data: idea });
  const quiz = await repository.saveQuiz(
    planQuizKey(idea, wording),
    reusableFixture().quiz,
  );
  const resolve = createQuizResolver({
    repository,
    plan: async () => {
      throw Error("unexpected generation");
    },
  });
  const repeat = await resolve(wording);
  assert.equal(repeat.quiz.id, quiz.id);
  assert.equal(repeat.reused, true);
});

test("the illustrator cannot change a question, a choice, or its score to suit an available prop", () => {
  const quizPlan = plan();
  quizPlan.outcomes.forEach((outcome, i) => {
    outcome.archetype = archetypes[i];
  });
  const found: FoundAssets = {
    outcomes: [null, null, null, null],
    sprites: [],
    scenes: [],
    decorations: [],
  };
  const output = writerOutput(quizPlan, found, 5, { fresh: 0 });
  output.questions[0].text = "Which gadget is on your desk?";
  output.questions[0].answers[0].text = "The prop from the library.";
  output.questions[0].answers[0].resultId = "driven";
  output.questions[0].answers.reverse();
  [output.results[0].id, output.results[1].id] = [
    output.results[1].id,
    output.results[0].id,
  ];
  output.results.reverse();
  const draft = bindQuizDraft(
    output,
    quizPlan,
    found,
    input("which muffin you are", "your coding habits"),
  );
  assert.equal(draft.questions[0].text, quizPlan.questions[0].text);
  assert.equal(
    draft.questions[0].answers[0].text,
    quizPlan.questions[0].answers[0].text,
  );
  assert.equal(
    draft.questions[0].answers[0].resultId,
    quizPlan.questions[0].answers[0].resultId,
  );
  assert.deepEqual(
    draft.results.map((r) => [r.title, r.id]),
    quizPlan.outcomes.map((o) => [o.name, o.archetype]),
  );
});

test("a named ingredient reuses its own cutout across recipes and never borrows the finished food", () => {
  const quizPlan = plan();
  const sprite = (id: string, name: string): LibraryAsset => ({
    id,
    name,
    description: name,
    kind: "sprite",
    topic: "baking",
    atlas: fakeArtwork(1, 1),
    cell: 0,
  });
  const found: FoundAssets = {
    outcomes: [null, null, null, null],
    sprites: [
      sprite("muffin", "Peach muffin"),
      sprite("fruit", "Fresh peaches"),
    ],
    scenes: [],
    decorations: [],
  };
  const raw = writerOutput(quizPlan, found, 5, { fresh: 0 });
  for (const q of raw.questions) for (const a of q.answers) a.image = null;
  const [one, two, three, four] = raw.questions[0].answers;
  one.literalSubject = "Peach";
  one.image = "s1";
  two.literalSubject = "Plum";
  two.image = "i14";
  three.literalSubject = "Pear and blackberry";
  three.image = "s1";
  three.simplerSubject = "Peach muffin";
  four.literalSubject = "Tower of peaches";
  four.simplerSubject = "Fresh peaches";
  const again = raw.questions[1].answers[0];
  again.literalSubject = "Peach wedge";
  again.simplerSubject = "Fresh peaches";
  const draft = bindQuizDraft(raw, quizPlan, found, input("cake", "fruit"));
  const picks = draft.questions[0].answers.map((a) => a.picture);
  assert.deepEqual(picks[0], { asset: "fruit" });
  assert.deepEqual(draft.questions[1].answers[0].picture, { asset: "fruit" });
  for (const [index, name] of [
    [1, "Plum"],
    [2, "Pear and blackberry"],
    [3, "Tower of peaches"],
  ] as const) {
    const pick = picks[index];
    assert.ok(pick && "draw" in pick);
    assert.equal(draft.draw[pick.draw].name, name);
  }
  assert.ok(draft.draw.length <= MAX_NEW_PICTURES);
});

test("a visually different hero cannot hint at an answer through a posed scene", () => {
  const quizPlan = plan();
  quizPlan.questions[0].text =
    "You arrive in matching sweaters. How do you react?";
  quizPlan.questions[0].neutralSubject = null;
  quizPlan.questions[0].answers[0].text = "Ask to take a photo together.";
  const found: FoundAssets = {
    outcomes: [null, null, null, null],
    sprites: [
      {
        id: "picture",
        kind: "sprite",
        topic: "social event",
        name: "Posing in matching sweaters",
        description: "Two friends posing for a picture together",
        atlas: fakeArtwork(1, 1),
        cell: 0,
      },
    ],
    scenes: [],
    decorations: [],
  };
  const output = writerOutput(quizPlan, found, 5, { fresh: 0 });
  output.questions[0].image = "s1";
  for (const answer of output.questions[0].answers) answer.image = null;
  assert.equal(
    bindQuizDraft(output, quizPlan, found, input("house", "awkward moments"))
      .questions[0].picture,
    null,
  );
});

test("Convex refusal memory: unseen subjects are drawn, and a shared sheet needs two refusals", async () => {
  const { t } = setup();
  const refused = (keys: string[]) =>
    t.query(app.api.library.refused, { secret, keys });
  assert.deepEqual(await refused(["m|cat|a", "m|cat|b"]), []);
  // Refused together on one sheet: either could be the cause.
  await t.mutation(app.api.library.refuse, {
    secret,
    keys: ["m|cat|a", "m|cat|b"],
  });
  assert.deepEqual(await refused(["m|cat|a", "m|cat|b"]), []);
  await t.mutation(app.api.library.refuse, {
    secret,
    keys: ["m|cat|a", "m|cat|c"],
  });
  assert.deepEqual(await refused(["m|cat|a", "m|cat|b", "m|cat|c"]), [
    "m|cat|a",
  ]);
  // Refused alone: certain at once.
  await t.mutation(app.api.library.refuse, { secret, keys: ["m|cat|d"] });
  assert.deepEqual(await refused(["m|cat|d", "other|cat|d"]), ["m|cat|d"]);
});

test("drafts are rejected when they reference pictures they can't show", () => {
  const quizPlan = plan();
  const library = { name: "Bag of crisps", description: "Salted crisps" };
  const sprite = (id: string): LibraryAsset => ({
    id,
    kind: "sprite",
    ...library,
    topic: "snack",
    atlas: fakeArtwork(4, 1),
    cell: 0,
  });
  const found: FoundAssets = {
    outcomes: [null, null, null, null],
    sprites: [sprite("a"), sprite("b"), sprite("c"), sprite("d")],
    scenes: [],
    decorations: [],
  };
  const settings = input("which Disney princess you are", "snacks");
  const valid = writerOutput(quizPlan, found, 5, { fresh: 0 });
  const draft = bindQuizDraft(valid, quizPlan, found, settings);
  assert.equal(draft.draw.length, 4); // only the four result portraits
  assert.deepEqual(draft.scene, { draw: "A cosy pantry, no people." });

  const undescribed = structuredClone(valid);
  undescribed.questions[0].answers[0].image = "n1";
  assert.throws(
    () => bindQuizDraft(undescribed, quizPlan, found, settings),
    /didn't describe/,
  );
  const duplicate = structuredClone(valid);
  duplicate.questions[0].answers[1].image =
    duplicate.questions[0].answers[0].image;
  assert.throws(
    () => bindQuizDraft(duplicate, quizPlan, found, settings),
    /different pictures/,
  );
  const repeated = structuredClone(valid);
  repeated.results[1].outcome = "o1";
  assert.throws(
    () => bindQuizDraft(repeated, quizPlan, found, settings),
    /exactly once/,
  );
  const unknown = structuredClone(valid);
  unknown.questions[0].image = "s99";
  assert.throws(() => bindQuizDraft(unknown, quizPlan, found, settings));
});

test("outcome pictures are reused only for the same named member", async () => {
  const library = memoryLibrary();
  const atlas = fakeArtwork(4, 1);
  const embeddings = await embed([
    "Disney princess — Belle: Belle smiling in her signature outfit",
    "Bluey character — Muffin: a small excitable puppy cousin of Bluey",
  ]);
  await library.repository.add([
    {
      id: "belle",
      kind: "sprite",
      name: "Belle",
      description: "Belle smiling in her signature outfit",
      topic: "Disney princess",
      atlas,
      cell: 0,
      source: "test",
      ...embeddings[0],
      embedding: embeddings[0].vector,
    },
    {
      id: "bluey-muffin",
      kind: "sprite",
      name: "Muffin",
      description: "a small excitable puppy cousin of Bluey",
      topic: "Bluey character",
      atlas,
      cell: 1,
      source: "test",
      model: "test",
      embedding: embeddings[1].vector,
    },
    {
      id: "old-emoji",
      kind: "sprite",
      name: "Heart emoji",
      description: "A phone reaction icon",
      topic: "reaction",
      atlas,
      cell: 2,
      source: "test",
      model: "test",
      embedding: (await embed(["reaction Heart emoji"]))[0].vector,
    },
  ]);
  const reactions = plan();
  reactions.outcomeCategory = "reaction";
  reactions.outcomes[0].name = "Heart emoji";
  reactions.visualQueries[0] = "Heart emoji";
  const filtered = await findAssets(reactions, library.repository, { embed });
  assert.equal(filtered.outcomes[0], null);
  assert.deepEqual(filtered.alternatives?.[0], []);
  assert.ok(filtered.sprites.every((a) => a.id !== "old-emoji"));
  const princesses = await findAssets(plan(), library.repository, { embed });
  assert.equal(princesses.outcomes[0]?.id, "belle");
  assert.equal(princesses.outcomes[1], null);
  const muffins = await findAssets(
    plan({
      outcomeCategory: "muffin",
      outcomes: [
        "Muffin",
        "Blueberry muffin",
        "Bran muffin",
        "Lemon muffin",
      ].map((name) => ({
        name,
        description: `a freshly baked ${name.toLowerCase()} in a paper case`,
        imagePrompt: `${name}, cutout`,
      })),
    }),
    library.repository,
    { embed },
  );
  assert.equal(muffins.outcomes[0], null, "never the Bluey character");
  assert.equal(muffins.alternatives?.[0][0].id, "bluey-muffin");
  // Search failures never block a quiz; they just mean more drawing.
  const offline = await findAssets(plan(), library.repository, {
    embed: async () => {
      throw new Error("offline");
    },
    onError: () => {},
  });
  assert.deepEqual(
    offline.outcomes.map((a) => a?.id ?? null),
    ["belle", null, null, null],
  );
});

test("a city can illustrate a holiday result, while a namesake can be declined", async () => {
  const library = memoryLibrary();
  const atlas = fakeArtwork(2, 1);
  const add = (
    id: string,
    name: string,
    topic: string,
    description: string,
    cell: number,
  ) =>
    library.repository.add([
      {
        id,
        name,
        topic,
        description,
        cell,
        atlas,
        kind: "sprite",
        source: "test",
        model: "another-model",
        embedding: [],
      },
    ]);
  await add("old-nyc", "New York City", "city", "The Statue of Liberty", 0);
  await add("old-paris", "Paris", "Greek myth", "Paris, the Trojan prince", 1);
  const idea = plan({ outcomeCategory: "holiday destination" });
  idea.outcomes[0].name = "New York City";
  idea.outcomes[1].name = "Paris";
  const found = await findAssets(idea, library.repository, {
    embed: async () => {
      throw new Error("offline");
    },
    onError: () => {},
  });
  assert.deepEqual(
    found.alternatives?.map((list) => list.map((asset) => asset.id)),
    [["old-nyc"], ["old-paris"], [], []],
  );
  const output = writerOutput(idea, found, 5, { fresh: 0 });
  output.results[0].portrait = "p1";
  const draft = bindQuizDraft(output, idea, found, input("holiday", "coffee"));
  assert.deepEqual(draft.results[0].picture, { asset: "old-nyc" });
  assert.deepEqual(draft.results[1].picture, { draw: 0 });
  assert.equal(draft.draw[0].name, "Paris");
});

test("a close café backdrop survives a request for different lighting", async () => {
  const library = memoryLibrary();
  const cafe = {
    id: "cafe",
    name: "Warm café",
    description: "A coffee counter near the window",
    topic: "coffee",
    kind: "scene" as const,
    atlas: fakeArtwork(1, 1),
    cell: 0,
  };
  const idea = plan({
    questionTopic: "coffee order",
    scene: "The café in morning light",
  });
  let score = 0.81;
  library.repository.search = async (queries) =>
    queries.map((q) => (q.kind === "scene" ? [{ ...cafe, score }] : []));
  const found = await findAssets(idea, library.repository, { embed });
  const output = writerOutput(idea, found, 5, { fresh: 0 });
  output.scene = "new";
  output.newScene = idea.scene;
  assert.deepEqual(
    bindQuizDraft(output, idea, found, input("holiday", "coffee")).scene,
    { asset: "cafe" },
  );
  score = 0.42;
  const different = await findAssets(idea, library.repository, { embed });
  assert.deepEqual(
    bindQuizDraft(output, idea, different, input("holiday", "coffee")).scene,
    { draw: idea.scene },
  );
});

test("the quiz key follows meaning, not wording, and keeps relations apart", () => {
  const settings = input("x", "y");
  assert.equal(
    planQuizKey(plan(), settings),
    planQuizKey(plan({ title: "Another headline" }), settings),
  );
  assert.notEqual(
    planQuizKey(plan(), settings),
    planQuizKey(plan({ outcomeRelation: "would date you" }), settings),
  );
  assert.notEqual(
    planQuizKey(plan(), settings),
    planQuizKey(plan({ questionAngle: "least favourite" }), settings),
  );
  // Symbols carry meaning: C++ and C# are different quizzes.
  assert.notEqual(
    planQuizKey(plan({ questionTopic: "C++ features" }), settings),
    planQuizKey(plan({ questionTopic: "C# features" }), settings),
  );
  assert.notEqual(
    wordingKey(input("which C++ feature you are", "your habits")),
    wordingKey(input("which C# feature you are", "your habits")),
  );
  assert.equal(
    wordingKey(input("Which muffin you are", "your coffee!")),
    wordingKey(input("which muffin you are", "your coffee")),
  );
  // Symbols stay in place, so their order matters too.
  assert.notEqual(
    wordingKey(input("whether +1 comes before -1", "your habits")),
    wordingKey(input("whether -1 comes before +1", "your habits")),
  );
  // Results and refusals use the same identity.
  assert.doesNotThrow(() =>
    plan({
      outcomeCategory: "programming language",
      outcomes: ["C++", "C#", "Python", "Rust"].map((name) => ({
        name,
        description: `The ${name} logo`,
        imagePrompt: `${name} logo`,
      })),
    }),
  );
  assert.notEqual(
    refusalKey("programming language", "C++", "m"),
    refusalKey("programming language", "C#", "m"),
  );
  assert.notEqual(
    wordingKey(input("Send 😂", "group chat")),
    wordingKey(input("Send ❤️", "group chat")),
  );
});

test("planning accepts a complete mobile answer past 65 characters without truncating it or exposing art", async () => {
  const idea = plan();
  idea.outcomes.forEach((o, i) => {
    o.archetype = archetypes[i];
  });
  const complete =
    "Take a familiar route so a friend who is running late can catch up with us.";
  idea.questions[0].answers[0].text = complete;
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const q = body.text.format.schema.properties.questions.items.properties;
      assert.equal(q.text.maxLength, undefined);
      assert.equal(
        q.answers.anyOf[0].items.properties.text.maxLength,
        undefined,
      );
      assert.equal(JSON.parse(body.input[1].content).library, undefined);
      return Response.json({
        id: "resp_mock",
        object: "response",
        created_at: 1,
        status: "completed",
        model: "mock",
        output: [
          {
            type: "message",
            id: "msg_mock",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(idea),
                annotations: [],
              },
            ],
          },
        ],
      });
    },
  });
  const result = await planQuiz(
    input("which city you should live in", "your ideal weekend"),
    undefined,
    client,
  );
  assert.equal(result.questions[0].answers[0].text, complete);
});

test("a new picture is drawn as a decoration only when nothing else shows it", () => {
  const quizPlan = plan();
  const found: FoundAssets = {
    outcomes: [null, null, null, null],
    sprites: [],
    scenes: [],
    decorations: [],
  };
  const settings = input("which Disney princess you are", "snacks");
  const output = writerOutput(quizPlan, found, 5, { fresh: 4 });
  const sticker = pictureHandles(found, pictureBudget(found)).fresh[4];
  output.decorations = [sticker, output.questions[0].answers[0].image!];
  // The third question's picture is hidden by its layout: it doesn't count.
  output.questions[2].image = sticker;
  output.newPictures.push({
    ref: sticker,
    name: "Tiny star",
    description: "A tiny star",
    imagePrompt: "A tiny star sticker",
  });
  const draft = bindQuizDraft(output, quizPlan, found, settings);
  const kinds = new Map(
    draft.draw.map((picture) => [picture.name, picture.kind]),
  );
  assert.equal(kinds.get("Tiny star"), "decoration");
  assert.ok(
    draft.draw
      .filter((picture) => picture.name !== "Tiny star")
      .every((picture) => picture.kind === "sprite"),
  );
});

test("drawing keeps good cells, empties blank ones, and survives a refused scene", async () => {
  const cell = 256;
  const sheet = await sharp({
    create: {
      width: cell * 4,
      height: cell,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      [0, 2].map((index) => ({
        input: {
          create: {
            width: 120,
            height: 120,
            channels: 4 as const,
            background: { r: 200, g: 40, b: 40, alpha: 1 },
          },
        },
        left: index * cell + 60,
        top: 60,
      })),
    )
    .png()
    .toBuffer();
  const pictures = ["a", "b", "c", "d"].map((name) => ({
    kind: "sprite" as const,
    name,
    description: name,
    imagePrompt: name,
    topic: "test",
  }));
  const save = async (_id: string, bytes: Buffer) => {
    const { width, height } = await sharp(bytes).metadata();
    return { width: width!, height: height! };
  };
  const recorded: string[] = [];
  const settled: string[] = [];
  const result = await drawPictures(pictures, "A scene", {
    record: async (type) => {
      recorded.push(type);
    },
    onPart: async (name) => {
      settled.push(name);
    },
    request: async (_prompt, spec) => {
      if (!spec.transparent) throw new Error("The scene request failed.");
      return { bytes: sheet, model: "test" };
    },
    save,
  });
  const image = result.image;
  assert.ok(image && typeof image === "object");
  assert.deepEqual(image.cells, [0, null, 2, null]);
  assert.equal(image.ids.filter(Boolean).length, 2);
  assert.equal(result.scene, "failed");
  assert.equal(result.portrait, undefined);
  assert.deepEqual(recorded.sort(), ["image", "scene"]);
  assert.deepEqual(settled.sort(), ["image", "scene"]);

  // A refused character sheet only blanks the results, never the answers.
  const characters = [
    { ...pictures[0], name: "Belle", result: true },
    { ...pictures[1], name: "Tiana", result: true },
    pictures[2],
    pictures[3],
  ];
  const mixed = await drawPictures(characters, null, {
    request: async (prompt) => {
      if (prompt.includes("Belle")) throw new ProviderRefusalError();
      return { bytes: sheet, model: "test" };
    },
    save,
  });
  assert.equal(mixed.portrait, "refused");
  assert.deepEqual(
    mixed.image && typeof mixed.image === "object" && mixed.image.cells,
    [0, 1],
  );

  // Parts an earlier attempt finished are never requested again.
  let requests = 0;
  const resumed = await drawPictures(pictures, "A scene", {
    done: { image: result.image, scene: "failed" },
    request: async () => {
      requests++;
      return { bytes: sheet, model: "test" };
    },
    save,
  });
  assert.equal(requests, 0);
  assert.equal(resumed.image, result.image);

  // An opaque sheet would publish boxed tiles; it falls back to the bundled illustrations.
  const opaque = await sharp(sheet)
    .flatten({ background: "#ffffff" })
    .jpeg()
    .toBuffer();
  const boxed = await drawPictures(pictures, null, {
    request: async () => ({ bytes: opaque, model: "test" }),
    save,
  });
  assert.equal(boxed.image, "failed");

  const refused = await drawPictures(pictures, null, {
    request: async () => {
      throw new ProviderRefusalError();
    },
  });
  assert.equal(refused.image, "refused");
});

test("composition crops cells from several saved atlases for the player", async () => {
  const atlas = await sharp({
    create: {
      width: 1024,
      height: 512,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 0, g: 0, b: 255, alpha: 1 },
          },
        },
        left: 512,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  let saved: Buffer | undefined;
  const artwork = await composeCells(
    [
      null,
      {
        atlas: {
          url: `/api/quiz-assets/${crypto.randomUUID()}`,
          columns: 2,
          rows: 1,
          width: 1024,
          height: 512,
        },
        cell: 1,
      },
    ],
    2,
    1,
    {
      read: async () => atlas,
      save: async (_id, bytes) => {
        saved = bytes;
        return { width: 1024, height: 512 };
      },
    },
  );
  assert.equal(artwork.columns, 2);
  const { data } = await sharp(saved!)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number) => [
    ...data.subarray((256 * 1024 + x) * 4, (256 * 1024 + x) * 4 + 4),
  ];
  assert.equal(pixel(256)[3], 0, "an empty slot stays transparent");
  assert.deepEqual(pixel(768), [0, 0, 255, 255]);
});

test("the writer request is strict, sends library names, and surfaces refusals", async () => {
  const quizPlan = plan();
  const found: FoundAssets = {
    outcomes: [null, null, null, null],
    sprites: [],
    scenes: [],
    decorations: [],
  };
  let mode: "valid" | "refusal" = "valid";
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
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
                ? [{ type: "refusal", refusal: "No" }]
                : [
                    {
                      type: "output_text",
                      text: JSON.stringify(writerOutput(quizPlan, found, 5)),
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
    const settings = input("which Disney princess you are", "your snacks");
    const draft = await writeQuiz(settings, quizPlan, found, undefined, client);
    assert.equal(draft.results.length, 4);
    assert.equal(bodies[0].store, false);
    const format = (
      bodies[0].text as { format: { type: string; strict: boolean } }
    ).format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    const sent = (bodies[0].input as Array<{ content: string }>)[1].content;
    assert.ok(sent.includes("Belle"));
    assert.ok(!sent.includes("embedding"));
    mode = "refusal";
    await assert.rejects(() =>
      writeQuiz(settings, quizPlan, found, undefined, client),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
