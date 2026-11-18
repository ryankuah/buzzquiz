import test from "node:test";
import assert from "node:assert/strict";
import { defineTestApp } from "convex-test";
import schema from "../convex/schema";
import * as cache from "../convex/cache";
import * as topics from "../convex/topics";
import { defaultSettings } from "../src/lib/examples";
import { favouriteBasis, DEFAULT_QUIZ_SETTINGS } from "../src/lib/quiz";
import {
  canonicalBasis,
  canonicalSubject,
  contentKeys,
  quizPromptKey,
} from "../src/lib/normalize-prompt";
import {
  createTopicResolver,
  TOPIC_EMBEDDING_DIMENSIONS,
  type Embedder,
  type TopicRepository,
} from "../src/lib/topics";

const app = defineTestApp({ schema }).defineModules({ cache, topics });
const secret = "only-for-in-memory-tests";
const model = "test-embedding";

// Unit vectors with a chosen cosine similarity to the axis they lean on.
function vector(axis: number, similarity = 1) {
  const values = new Array(TOPIC_EMBEDDING_DIMENSIONS).fill(0);
  values[axis] = similarity;
  values[TOPIC_EMBEDDING_DIMENSIONS - 1 - axis] = Math.sqrt(
    1 - similarity ** 2,
  );
  return values;
}

function setup(vectors: Record<string, number[]>) {
  process.env.BUZZQUIZ_SERVER_SECRET = secret;
  const t = app.createTest();
  const repository: TopicRepository = {
    findAlias: (kind, alias) =>
      t.query(app.api.topics.findAlias, { secret, kind, alias }),
    nearest: (kind, embedding) =>
      t.action(app.api.topics.nearest, { secret, kind, embedding }),
    async register(kind, alias, topic, embedding) {
      await t.mutation(app.api.topics.register, {
        secret,
        kind,
        alias,
        topic,
        ...(embedding ? { embedding } : {}),
      });
    },
  };
  const embedded: string[][] = [];
  const embed: Embedder = async (texts) => {
    embedded.push(texts);
    return texts.map((text) => {
      if (!vectors[text]) throw new Error(`No test vector for ${text}`);
      return { vector: vectors[text], model };
    });
  };
  return {
    t,
    embedded,
    resolve: createTopicResolver({ repository, embed, onError: () => {} }),
  };
}

test("free-form phrases still match the keys of older category quizzes", () => {
  assert.equal(DEFAULT_QUIZ_SETTINGS.basis, "your snack choices");
  // "Find out which Disney princess you are" reads like the old sentence.
  assert.equal(
    canonicalSubject("which Disney princess you are"),
    "disney princess",
  );
  assert.equal(
    canonicalSubject("What Disney princess are you"),
    "disney princess",
  );
  assert.equal(
    canonicalSubject("which Disney princess would date you"),
    "disney princess would date you",
  );
  assert.equal(favouriteBasis("muffins"), "your favourite muffins");
  assert.equal(
    favouriteBasis("your favourite muffins"),
    "your favourite muffins",
  );
  assert.equal(favouriteBasis("Favorite muffins"), "your favourite muffins");
  assert.equal(favouriteBasis("your perfect weekend"), "your perfect weekend");
  assert.equal(canonicalBasis("Muffins"), "muffin");
  assert.equal(canonicalBasis("based on your FAVOURITE muffins"), "muffin");
  assert.equal(
    canonicalBasis("least favourite muffins"),
    "least favorite muffin",
  );
  assert.equal(canonicalSubject("Pokémon"), "pokemon");
  const category = { ...defaultSettings, basis: "muffins" };
  assert.equal(quizPromptKey(category), quizPromptKey(defaultSettings));
  assert.deepEqual(contentKeys(category), contentKeys(defaultSettings));
  assert.notEqual(
    quizPromptKey({ ...defaultSettings, basis: "least favourite muffins" }),
    quizPromptKey(category),
  );
});

test("different names reuse a saved topic, unrelated ones don't, and repeats skip embeddings", async () => {
  const { t, embedded, resolve } = setup({
    "disney princess": vector(1),
    muffin: vector(2),
    "princess from disney": vector(1, 0.9),
    "disney villain": vector(1, 0.75),
    "muffin flavour": vector(2, 0.88),
  });

  const first = await resolve({ ...defaultSettings, basis: "muffins" });
  assert.deepEqual(first.names, {
    subject: "disney princess",
    basis: "muffin",
  });
  assert.deepEqual(embedded, [["disney princess", "muffin"]]);
  await first.commit();

  // Exact wording is now an alias: no embedding request at all.
  const repeat = await resolve({
    ...defaultSettings,
    subject: "Disney Princesses",
  });
  assert.deepEqual(repeat.names, first.names);
  assert.equal(embedded.length, 1);

  const synonym = await resolve({
    ...defaultSettings,
    subject: "Princess from Disney",
    basis: "muffin flavour",
  });
  assert.deepEqual(synonym.names, first.names);
  assert.equal(
    quizPromptKey(defaultSettings, synonym.names),
    quizPromptKey(defaultSettings),
  );
  await synonym.commit();

  const related = await resolve({
    ...defaultSettings,
    subject: "Disney villain",
  });
  assert.equal(related.names.subject, "disney villain");
  await related.commit();

  // Synonym aliases were saved; the villain became its own topic.
  embedded.length = 0;
  const again = await resolve({
    ...defaultSettings,
    subject: "princess from disney",
    basis: "Muffin Flavour",
  });
  assert.deepEqual(again.names, first.names);
  assert.equal(
    (await resolve({ ...defaultSettings, subject: "disney villain" })).names
      .subject,
    "disney villain",
  );
  assert.deepEqual(embedded, []);
  assert.equal(
    (await t.run((ctx) => ctx.db.query("topics").collect())).length,
    3,
  );
});

test("subjects and bases are matched separately, and failures fall back to exact wording", async () => {
  const { resolve } = setup({
    "disney princess": vector(1),
    muffin: vector(1),
  });
  const first = await resolve({ ...defaultSettings, basis: "muffins" });
  await first.commit();
  assert.deepEqual(first.names, {
    subject: "disney princess",
    basis: "muffin",
  });

  const broken = createTopicResolver({
    repository: {
      findAlias: async () => null,
      nearest: async () => ({ topic: "wrong", score: 1 }),
      register: async () => {},
    },
    embed: async () => {
      throw new Error("provider down");
    },
    onError: () => {},
  });
  const fallback = await broken({ ...defaultSettings, subject: "Cat" });
  assert.deepEqual(fallback.names, { subject: "cat", basis: "muffin" });
  await fallback.commit();
});

test("topic functions require the server secret", async () => {
  const { t } = setup({});
  await assert.rejects(
    () =>
      t.query(app.api.topics.findAlias, {
        secret: "wrong",
        kind: "subject",
        alias: "cat",
      }),
    /Unauthorized/,
  );
});

test("shared topic identities and synonyms work in either blank without repeating embeddings", async () => {
  process.env.BUZZQUIZ_SERVER_SECRET = secret;
  const t = app.createTest();
  const repository: TopicRepository = {
    findAlias: (kind, alias) =>
      t.query(app.api.topics.findAlias, { secret, kind, alias }),
    nearest: (kind, embedding) =>
      t.action(app.api.topics.nearest, { secret, kind, embedding }),
    register: async (kind, alias, topic, embedding) => {
      await t.mutation(app.api.topics.register, {
        secret,
        kind,
        alias,
        topic,
        ...(embedding ? { embedding } : {}),
      });
    },
  };
  const vectors: Record<string, number[]> = {
    "coding language": vector(3),
    cupcake: vector(4),
    "programming language": vector(3, 0.92),
  };
  let calls = 0;
  const resolve = createTopicResolver({
    repository,
    shared: true,
    embed: async (texts) => {
      calls++;
      return texts.map((text) => ({ vector: vectors[text], model }));
    },
  });
  const first = await resolve({
    ...defaultSettings,
    subject: "Coding language",
    basis: "Cupcake",
  });
  await first.commit();
  const reverse = await resolve({
    ...defaultSettings,
    subject: "Cupcake",
    basis: "Coding language",
  });
  assert.deepEqual(reverse.names, {
    subject: first.names.basis,
    basis: first.names.subject,
  });
  assert.equal(calls, 1);
  const synonym = await resolve({
    ...defaultSettings,
    subject: "Cupcake",
    basis: "Programming language",
  });
  assert.equal(synonym.names.basis, first.names.subject);
  await synonym.commit();
  assert.equal(calls, 2);
  const flippedSynonym = await resolve({
    ...defaultSettings,
    subject: "Programming language",
    basis: "Cupcake",
  });
  assert.equal(flippedSynonym.names.subject, first.names.subject);
  assert.equal(calls, 2);
});
