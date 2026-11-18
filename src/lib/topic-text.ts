// Deliberately conservative: keep meaningful modifiers (e.g. least favourite,
// chocolate/vanilla). Wording-level equivalence only; semantic matching of
// different names lives in topics.ts.
export function canonicalTopic(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\bfavourites?\b/g, "favorite")
    .replace(/\bfavorites\b/g, "favorite")
    .replace(
      /\b(princesses|houses|muffins|characters|cats|dogs|flowers|colours|colors)\b/g,
      (word) =>
        ({
          princesses: "princess",
          houses: "house",
          muffins: "muffin",
          characters: "character",
          cats: "cat",
          dogs: "dog",
          flowers: "flower",
          colours: "color",
          colors: "color",
        })[word]!,
    )
    .replace(/\bcolour\b/g, "color")
    .trim()
    .replace(/\s+/g, " ");
}

const SYMBOLS: Record<string, string> = {
  "+": "plus",
  "#": "sharp",
  "&": "and",
  "@": "at",
  $: "dollar",
  "%": "percent",
  "*": "star",
  "=": "equals",
  "<": "less than",
  ">": "greater than",
  "/": "slash",
  "\\": "backslash",
  "^": "caret",
  "~": "tilde",
  "|": "pipe",
};

/**
 * Spells out symbols canonicalTopic would erase, in place, so "C++" and "C#"
 * or "+1 before -1" and "-1 before +1" stay distinct, while "C#" and
 * "C sharp" or "salt & pepper" and "salt and pepper" still match.
 */
export function spellSymbols(value: string) {
  return value
    .normalize("NFKC")
    .replace(/(^|[^\p{L}\p{N}])-(?=\p{N})/gu, "$1 minus ")
    .replace(/[+#&@$%*=<>/\\^~|]/g, (symbol) => ` ${SYMBOLS[symbol]} `);
}

/** Wording-level identity for keys, names and refusals; keeps symbols. */
export function meaningText(value: string) {
  // Encode the whole emoji, including modifiers and joined characters, in
  // place so a quiz about two different reactions keeps distinct keys.
  value = value.replace(
    /(?:\p{Regional_Indicator}{1,2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)/gu,
    (emoji) =>
      " emoji " +
      [...emoji]
        .filter((c) => c !== "\ufe0f" && c !== "\ufe0e")
        .map((c) => c.codePointAt(0)!.toString(16))
        .join(" ") +
      " ",
  );
  return canonicalTopic(spellSymbols(value));
}

/** Stable across embedding models and the role an image played in its first quiz. */
export function assetName(value: string) {
  return meaningText(value).replace(/^(?:the|a|an) /, "");
}

export function assetIdentity(topic: string, name: string) {
  return JSON.stringify([assetName(topic), assetName(name)]);
}
