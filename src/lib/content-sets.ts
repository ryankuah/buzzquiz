import { z } from "zod";
import {
  contentSchema,
  resultSchema,
  answerSchema,
  type GenerationInput,
  type Quiz,
  type QuizArtwork,
  type QuizPalette,
  favouriteBasis,
  typefaceSchema,
  parseQuiz,
  validateContent,
} from "./quiz";
import { readingDraftSchema } from "./personality";
import { questionTemplatePlan } from "./templates";

export const archetypes = ["curious", "bold", "warm", "driven"] as const;
export const archetypeSchema = z.enum(archetypes);
const text = (max: number) => z.string().trim().min(1).max(max);
export const outcomeSetSchema = z.object({
  results: z
    .array(
      resultSchema.extend({
        id: archetypeSchema,
        title: text(45),
        description: text(260),
        imagePrompt: text(240),
        profile: readingDraftSchema.omit({ evidence: true }),
      }),
    )
    .length(4),
  // Older saved sets predate per-quiz typefaces.
  typeface: typefaceSchema.optional(),
});
// Structured outputs need every field, so new sets must choose one.
export const outcomeGenerationSchema = outcomeSetSchema.extend({
  typeface: typefaceSchema,
});
const reusableAnswerSchema = answerSchema.extend({
  text: text(65),
  imagePrompt: text(240),
  personalityNote: text(150),
  resultId: archetypeSchema,
  secondaryResultId: archetypeSchema.nullable(),
});
export const questionSetSchema = z.object({
  backgroundPrompt: text(240),
  questions: z
    .array(
      contentSchema.shape.questions.element.omit({ layout: true }).extend({
        text: text(100),
        imagePrompt: text(240),
        answers: z.union([
          z.array(reusableAnswerSchema).length(2),
          z.array(reusableAnswerSchema).length(4),
        ]),
      }),
    )
    .min(5)
    .max(10),
  // Small themed cutouts drawn beside the background scene. Optional for
  // sets saved before decorations existed.
  decorations: z.array(text(160)).length(4).optional(),
});
export const questionGenerationSchema = questionSetSchema.extend({
  decorations: z.array(text(160)).length(4),
});
export type OutcomeSet = z.infer<typeof outcomeSetSchema>;
export type QuestionSet = z.infer<typeof questionSetSchema>;
export type ContentKind = "outcomes" | "questions" | "reading";
export type ContentRecord = {
  key: string;
  kind: ContentKind;
  data?: unknown;
  artwork?: QuizArtwork;
  status: "building" | "ready" | "failed";
  leaseUntil: number;
  blocked?: boolean;
};
export type ReadyContent = { data: unknown; artwork?: QuizArtwork };
export type Claim =
  | { state: "claimed"; owner: string; draft?: unknown }
  | { state: "ready"; content: ReadyContent }
  | { state: "wait" }
  | { state: "limited" }
  | { state: "blocked" };
export interface ContentRepository {
  /** Keys come from quizPromptKey, after topic matching. */
  findQuiz(key: string): Promise<Quiz | null>;
  saveQuiz(key: string, quiz: Quiz): Promise<Quiz>;
  findContent(key: string): Promise<ContentRecord | null>;
  claim(key: string, kind: ContentKind): Promise<Claim>;
  checkpoint(key: string, owner: string, data: unknown): Promise<void>;
  complete(key: string, owner: string, content: ReadyContent): Promise<void>;
  fail(key: string, owner: string, blocked?: boolean): Promise<void>;
  recordCall(
    key: string,
    owner: string,
    type: "text" | "image" | "background",
  ): Promise<void>;
}

export function validateOutcomeSet(value: unknown): OutcomeSet {
  const parsed = outcomeSetSchema.parse(value);
  if (new Set(parsed.results.map((result) => result.id)).size !== 4)
    throw new Error(
      "Outcomes must cover four distinct personality archetypes.",
    );
  return parsed;
}

export function assembleQuiz(
  input: GenerationInput,
  outcomes: ReadyContent,
  questions: ReadyContent,
  id = crypto.randomUUID(),
  palette?: QuizPalette,
): Quiz {
  if (!outcomes.artwork || !questions.artwork)
    throw new Error("The quiz artwork isn't ready.");
  const outcomeSet = validateOutcomeSet(outcomes.data);
  const results = outcomeSet.results;
  const content = questionSetSchema.parse(questions.data);
  const plan = questionTemplatePlan(input.questionCount);
  validateContent(
    {
      title: "Quiz",
      description: "Quiz",
      emoji: "✨",
      results,
      questions: content.questions,
    },
    input.questionCount,
  );
  return parseQuiz({
    id,
    createdAt: new Date().toISOString(),
    source: "ai",
    settings: input,
    title: `What ${input.subject} are you based on ${favouriteBasis(input.basis)}?`,
    description: "Pick what feels like you.",
    emoji: "✨",
    results,
    questions: content.questions.map((question, index) => ({
      ...question,
      layout: plan[index].layout,
    })),
    questionArtwork: questions.artwork,
    resultArtwork: outcomes.artwork,
    backgroundIndex: input.questionCount * 5,
    style: {
      ...(palette ? { palette } : {}),
      ...(outcomeSet.typeface ? { typeface: outcomeSet.typeface } : {}),
      ...(content.decorations && questions.artwork.packed
        ? { decorations: content.decorations.length }
        : {}),
    },
  });
}
