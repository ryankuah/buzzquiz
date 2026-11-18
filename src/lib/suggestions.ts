import {
  canonicalBasis,
  canonicalSubject,
  spellSymbols,
} from "./normalize-prompt";
import { favouriteBasis } from "./quiz";

export type Suggestion = { name: string; count: number };
export type Suggestions = {
  subjects: Suggestion[];
  bases: Suggestion[];
  /** Saved subject/basis pairs, as indices into the two lists. */
  pairs: Array<[number, number]>;
};

// Older quizzes saved bare categories ("Disney princess", "tea"). The
// sentence now reads "Find out ___ based on ___", so offer them as phrases.
export const subjectPhrase = (value: string) => {
  const phrase = value.trim();
  return /^(?:which|what|who|where|how|if|whether|when|why)\b/i.test(phrase)
    ? phrase
    : `which ${phrase} you are`;
};
export const basisPhrase = (value: string) => {
  const phrase = value.trim().replace(/^based on\s+/i, "");
  return /^(?:how|what|which|the|whether|who|where|when)\b/i.test(phrase)
    ? phrase
    : favouriteBasis(phrase.replace(/^my\b/i, "your"));
};

function group(
  values: string[],
  canonical: (value: string) => string,
  label: (value: string, index: number) => string,
) {
  const groups = new Map<
    string,
    { names: Map<string, number>; count: number }
  >();
  for (const [index, value] of values.entries()) {
    const key = canonical(value);
    const name = label(value, index);
    if (!key || !name) continue;
    const entry = groups.get(key) ?? { names: new Map(), count: 0 };
    entry.count++;
    entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
    groups.set(key, entry);
  }
  const keys = [...groups.keys()].sort(
    (a, b) => groups.get(b)!.count - groups.get(a)!.count || a.localeCompare(b),
  );
  return {
    keys,
    list: keys.map((key) => {
      const { names, count } = groups.get(key)!;
      // Prefer a wording someone capitalised, then the most used.
      const name = [...names.entries()].sort(
        (a, b) =>
          Number(/\p{Lu}/u.test(b[0])) - Number(/\p{Lu}/u.test(a[0])) ||
          b[1] - a[1],
      )[0][0];
      return { name, count };
    }),
  };
}

/**
 * Collapses saved quizzes into the subjects and favourites that already have
 * artwork, most used first. Any saved subject pairs with any saved favourite
 * without new drawing, so these are the cheap, instant choices.
 */
// Symbols are spelled out first, so "C++" and "C#" phrases stay apart.
const subjectKey = (value: string) => canonicalSubject(spellSymbols(value));
const basisKey = (value: string) => canonicalBasis(spellSymbols(value));

export function buildSuggestions(
  saved: Array<{ subject: string; basis: string; legacy?: boolean }>,
): Suggestions {
  // Only older quizzes saved bare categories; newer ones keep the exact
  // phrase the player typed, which mustn't be rewritten.
  const phrased = saved.map((item) =>
    item.legacy === false
      ? { subject: item.subject.trim(), basis: item.basis.trim() }
      : {
          subject: subjectPhrase(item.subject),
          basis: basisPhrase(item.basis),
        },
  );
  const subjects = group(
    saved.map((item) => item.subject),
    subjectKey,
    (_, index) => phrased[index].subject,
  );
  const bases = group(
    saved.map((item) => item.basis),
    basisKey,
    (_, index) => phrased[index].basis,
  );
  const pairs = new Set<string>();
  for (const item of saved) {
    const subject = subjects.keys.indexOf(subjectKey(item.subject));
    const basis = bases.keys.indexOf(basisKey(item.basis));
    if (subject !== -1 && basis !== -1) pairs.add(`${subject}:${basis}`);
  }
  return {
    subjects: subjects.list,
    bases: bases.list,
    pairs: [...pairs].map(
      (pair) => pair.split(":").map(Number) as [number, number],
    ),
  };
}

/**
 * Ranks names against what the player has typed: whole-prefix matches, then
 * word-prefix matches, then anywhere; ties keep popularity order. With
 * nothing typed, the most used come first, with favoured indices (those
 * already saved with the other blank) ahead.
 */
export function rankSuggestions(
  names: Suggestion[],
  typed: string,
  favoured: Set<number> = new Set(),
  limit = 4,
) {
  const query = typed.trim().toLowerCase().replace(/\s+/g, " ");
  const scored = names
    .map((item, index) => {
      const name = item.name.toLowerCase();
      if (query && name === query) return null;
      const score = !query
        ? 1
        : name.startsWith(query)
          ? 3
          : name.split(/\s+/).some((word) => word.startsWith(query))
            ? 2
            : name.includes(query)
              ? 1
              : 0;
      return score
        ? { item, index, score: score + (favoured.has(index) ? 0.5 : 0) }
        : null;
    })
    .filter((entry) => entry !== null);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.item.name);
}

/** The best suggestion that starts with (and extends) the typed text. */
export function completion(names: string[], typed: string) {
  if (typed.trim().length < 2) return "";
  const match = names.find(
    (name) =>
      name.length > typed.length &&
      name.toLowerCase().startsWith(typed.toLowerCase()),
  );
  return match ?? "";
}
