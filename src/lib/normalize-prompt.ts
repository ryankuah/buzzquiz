import { createHash } from "node:crypto";
import { generationInputSchema, type GenerationInput } from "./quiz";

// Deliberately conservative: keep meaningful modifiers (e.g. favourite/least
// favourite, chocolate/vanilla). This is equivalence matching, not fuzzy search.
export function canonicalTopic(value: string) {
  return value
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

export function normalizePrompt(input: GenerationInput) {
  const settings = generationInputSchema.parse(input);
  const subject = canonicalTopic(settings.subject)
    .replace(/^(?:what |which )?(?:kind of |type of )?/, "")
    .replace(/ are you$/, "")
    .replace(/^hogwarts house$/, "harry potter house");
  const basis = canonicalTopic(settings.basis)
    .replace(/^based on /, "")
    .replace(/^(?:your |my |our |the )/, "");
  if (!subject || !basis) throw new Error("Fill in both blanks to find out.");
  return {
    subject,
    basis,
    questionCount: settings.questionCount,
    tone: settings.tone,
  };
}

export function quizPromptKey(input: GenerationInput) {
  // Presentation is chosen internally and doesn't change the quiz idea.
  return createHash("sha256")
    .update(JSON.stringify(normalizePrompt(input)))
    .digest("hex");
}

export function contentKeys(input: GenerationInput) {
  const prompt = normalizePrompt(input);
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return {
    outcomes: `outcomes:${hash([prompt.subject, prompt.tone])}`,
    questions: `questions:${hash([prompt.basis, prompt.questionCount, prompt.tone])}`,
  };
}
