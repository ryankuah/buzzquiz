import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSuggestions,
  completion,
  rankSuggestions,
} from "../src/lib/suggestions";

const saved = [
  { subject: "harry potter house", basis: "favourite coding language" },
  { subject: "Harry Potter houses", basis: "muffins" },
  { subject: "Disney princess", basis: "your favourite muffins" },
  { subject: "Disney princess", basis: "muffin" },
  { subject: "dog breed", basis: "tea" },
];

test("saved quizzes collapse into readable, deduplicated phrases", () => {
  const { subjects, bases, pairs } = buildSuggestions([
    ...saved,
    { subject: "which city you should live in", basis: "your ideal weekend" },
  ]);
  // Older bare categories read naturally in "Find out ___ based on ___".
  assert.deepEqual(subjects, [
    { name: "which Disney princess you are", count: 2 },
    { name: "which Harry Potter houses you are", count: 2 },
    { name: "which city you should live in", count: 1 },
    { name: "which dog breed you are", count: 1 },
  ]);
  assert.deepEqual(
    bases.map((item) => item.name),
    [
      "your favourite muffins",
      "your favourite coding language",
      "your ideal weekend",
      "your favourite tea",
    ],
  );
  // Disney princess (0) has only been made with muffins (0).
  assert.ok(pairs.some(([s, b]) => s === 0 && b === 0));
  assert.ok(!pairs.some(([s, b]) => s === 0 && b === 2));
});

test("free-form quizzes keep the exact phrases the player typed", () => {
  const { subjects, bases } = buildSuggestions([
    { subject: "the city you belong in", basis: "tea", legacy: false },
    { subject: "Disney princess", basis: "tea", legacy: true },
  ]);
  assert.deepEqual(
    subjects.map((item) => item.name),
    ["which Disney princess you are", "the city you belong in"],
  );
  // Same canonical basis: the newer exact wording sits beside the old one.
  assert.equal(bases.length, 1);
  const languages = buildSuggestions([
    {
      subject: "which C++ feature you are",
      basis: "your habits",
      legacy: false,
    },
    {
      subject: "which C# feature you are",
      basis: "your habits",
      legacy: false,
    },
  ]);
  assert.equal(languages.subjects.length, 2);
});

test("ranking prefers prefixes, then word starts, then substrings", () => {
  const names = [
    { name: "house plant", count: 1 },
    { name: "Harry Potter houses", count: 5 },
    { name: "lighthouse", count: 9 },
    { name: "dog breed", count: 3 },
  ];
  assert.deepEqual(rankSuggestions(names, "hou"), [
    "house plant",
    "Harry Potter houses",
    "lighthouse",
  ]);
  // An exact match is already chosen, so it isn't offered again.
  assert.deepEqual(rankSuggestions(names, "Dog breed"), []);
  // With nothing typed, ones saved with the other blank lead.
  assert.equal(rankSuggestions(names, "", new Set([3]))[0], "dog breed");
});

test("ghost completion finds the best prefix match in its saved casing", () => {
  const names = ["Disney princess", "dog breed"];
  assert.equal(completion(names, "dis"), "Disney princess");
  assert.equal(completion(names, "d"), "");
  assert.equal(completion(names, "dogs"), "");
});
