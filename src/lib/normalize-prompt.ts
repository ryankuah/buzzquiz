import { createHash } from "node:crypto";
import { generationInputSchema, type GenerationInput } from "./quiz";

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

/** The first blank: "What ___ are you". */
export function canonicalSubject(value: string) {
  return canonicalTopic(value)
    .replace(/^(?:what |which )?(?:kind of |type of )?/, "")
    .replace(/ are you$/, "")
    .replace(/^hogwarts house$/, "harry potter house");
}

/** The second blank: "based on your favourite ___". */
export function canonicalBasis(value: string) {
  return canonicalTopic(value)
    .replace(/^based on /, "")
    .replace(/^(?:your |my |our |the )/, "")
    .replace(/^favorite /, "");
}

/** Topic names after semantic matching; defaults to the canonical wording. */
export type TopicNames = { subject: string; basis: string };

export function normalizePrompt(input: GenerationInput, topics?: TopicNames) {
  const settings = generationInputSchema.parse(input);
  const subject = topics?.subject ?? canonicalSubject(settings.subject);
  const basis = topics?.basis ?? canonicalBasis(settings.basis);
  if (!subject || !basis) throw new Error("Fill in both blanks to find out.");
  return {
    subject,
    // Keys predate the fixed "your favourite" wording, when the basis was a
    // free phrase such as "your favourite muffins". Keeping the prefix in the
    // key lets those saved question sets and quizzes keep being reused.
    basis: `favorite ${basis}`,
    questionCount: settings.questionCount,
    tone: settings.tone,
  };
}

export function quizPromptKey(input: GenerationInput, topics?: TopicNames) {
  // Presentation is chosen internally and doesn't change the quiz idea.
  return createHash("sha256")
    .update(JSON.stringify(normalizePrompt(input, topics)))
    .digest("hex");
}

export function contentKeys(input: GenerationInput, topics?: TopicNames) {
  const prompt = normalizePrompt(input, topics);
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return {
    outcomes: `outcomes:${hash([prompt.subject, prompt.tone])}`,
    questions: `questions:${hash([prompt.basis, prompt.questionCount, prompt.tone])}`,
  };
}
