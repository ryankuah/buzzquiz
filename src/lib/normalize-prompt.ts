import { createHash } from "node:crypto";
import { generationInputSchema, type GenerationInput } from "./quiz";

import { canonicalTopic } from "./topic-text";
export { canonicalTopic, meaningText, spellSymbols } from "./topic-text";

/** The first blank: "Find out ___" (formerly "What ___ are you"). */
export function canonicalSubject(value: string) {
  return (
    canonicalTopic(value)
      .replace(/^(?:what |which )?(?:kind of |type of )?/, "")
      // "which Disney princess you are" reads the same as the older
      // "What Disney princess are you", so old saved quizzes still match.
      .replace(/ (?:are you|you are)$/, "")
      .replace(/^hogwarts house$/, "harry potter house")
  );
}

/** The second blank: "based on ___" (formerly "your favourite ___"). */
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
