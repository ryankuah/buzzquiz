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

test("saved quizzes collapse into readable, deduplicated topics", () => {
  const { subjects, bases, pairs } = buildSuggestions(saved);
  assert.deepEqual(subjects, [
    { name: "Disney princess", count: 2 },
    { name: "Harry Potter houses", count: 2 },
    { name: "dog breed", count: 1 },
  ]);
  assert.deepEqual(
    bases.map((item) => item.name),
    ["muffins", "coding language", "tea"],
  );
  // Disney princess (0) has only been made with muffins (0).
  assert.ok(pairs.some(([s, b]) => s === 0 && b === 0));
  assert.ok(!pairs.some(([s, b]) => s === 0 && b === 2));
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
