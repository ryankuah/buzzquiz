import { z } from "zod";
import { readingDraftSchema } from "./personality";

// Both blanks are short categories: "What [Disney princess] are you based on
// your favourite [muffins]?". Older saved quizzes stored the basis as a phrase,
// so the stored limits stay generous.
export const generationInputSchema = z.object({
  subject: z.string().trim().min(2, "Add what someone can be.").max(100),
  basis: z.string().trim().min(2, "Add a favourite thing.").max(150),
  questionCount: z.union([z.literal(5), z.literal(7), z.literal(10)]),
  tone: z.enum(["playful", "chaotic", "wholesome"]),
  layout: z.enum(["hero-grid", "card-grid", "stack"]),
  theme: z.enum(["basic", "scent", "study", "foodie"]),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;

export const DEFAULT_QUIZ_SETTINGS: GenerationInput = {
  subject: "Disney princess",
  basis: "muffins",
  questionCount: 5,
  tone: "playful",
  layout: "hero-grid",
  theme: "foodie",
};

/** "muffins" → "your favourite muffins", tolerating older phrase-style bases. */
export function favouriteBasis(basis: string) {
  const phrase = basis.trim().replace(/^based on\s+/i, "");
  const category = phrase
    .replace(/^(?:your|my)\s+/i, "")
    .replace(/^favou?rites?\s+/i, "");
  // Older phrases such as "your perfect weekend" are already complete.
  if (
    category === phrase.replace(/^(?:your|my)\s+/i, "") &&
    category !== phrase
  )
    return phrase;
  return `your favourite ${category}`;
}

const text = (max: number) => z.string().trim().min(1).max(max);
export const resultSchema = z.object({
  id: text(40),
  title: text(100),
  emoji: text(16),
  description: text(700),
  imagePrompt: text(240).optional(),
  profile: readingDraftSchema.omit({ evidence: true }).optional(),
});
export const answerSchema = z.object({
  id: text(40),
  text: text(180),
  emoji: text(16),
  // Binary choices score a pair of traits; four-choice questions score one.
  resultId: text(40),
  secondaryResultId: text(40).nullable().optional(),
  personalityNote: text(150).optional(),
  imagePrompt: text(240).optional(),
});
export const contentSchema = z.object({
  title: text(240),
  description: text(300),
  emoji: text(16),
  results: z.array(resultSchema).length(4),
  questions: z
    .array(
      z.object({
        id: text(40),
        text: text(240),
        emoji: text(16),
        imagePrompt: text(240).optional(),
        layout: generationInputSchema.shape.layout.optional(),
        answers: z.union([
          z.array(answerSchema).length(2),
          z.array(answerSchema).length(4),
        ]),
      }),
    )
    .min(5)
    .max(10),
});
// Generated copy must fit the phone template. The wider storage schema above
// keeps previously shared quizzes compatible.
export const mobileContentSchema = contentSchema.extend({
  results: z
    .array(
      resultSchema.extend({
        title: text(45),
        description: text(260),
        imagePrompt: text(240),
      }),
    )
    .length(4),
  questions: z
    .array(
      contentSchema.shape.questions.element.omit({ layout: true }).extend({
        text: text(100),
        imagePrompt: text(240),
        answers: z.union([
          z
            .array(
              answerSchema.extend({
                text: text(65),
                imagePrompt: text(240),
                secondaryResultId: text(40).nullable(),
              }),
            )
            .length(2),
          z
            .array(
              answerSchema.extend({
                text: text(65),
                imagePrompt: text(240),
                secondaryResultId: text(40).nullable(),
              }),
            )
            .length(4),
        ]),
      }),
    )
    .min(5)
    .max(10),
});
export const quizArtworkSchema = z.object({
  url: z.string().regex(/^\/api\/quiz-assets\/[a-f0-9-]{36}$/),
  columns: z.number().int().min(1).max(5),
  rows: z.number().int().min(1).max(11),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  model: text(150),
  generatedAt: z.string().datetime(),
  // Cells were repacked onto an exact grid with transparent padding.
  packed: z.boolean().optional(),
});
export type QuizArtwork = z.infer<typeof quizArtworkSchema>;
// Each quiz gets its own look: colours drawn from its artwork, a heading
// typeface chosen for its subject, and small decorative cutouts.
export const typefaces = {
  storybook: {
    family: "Fraunces",
    weight: 600,
    mood: "fairytales, myths, cosy classics",
  },
  retro: {
    family: "Shrikhand",
    weight: 400,
    mood: "food, desserts, 70s fun, loud and playful",
  },
  handwritten: {
    family: "Caveat",
    weight: 700,
    mood: "crafts, journals, gentle and homey",
  },
  rounded: {
    family: "Baloo 2",
    weight: 700,
    mood: "animals, toys, cute and bubbly",
  },
  elegant: {
    family: "Playfair Display",
    weight: 700,
    mood: "magic, royalty, history, glamour",
  },
  techy: {
    family: "Space Grotesk",
    weight: 700,
    mood: "coding, sci-fi, games, gadgets",
  },
} as const;
export type TypefaceId = keyof typeof typefaces;
export const typefaceSchema = z.enum(
  Object.keys(typefaces) as [TypefaceId, ...TypefaceId[]],
);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
export const paletteSchema = z.object({
  background: hex,
  foreground: hex,
  accent: hex,
  dark: z.boolean(),
});
export type QuizPalette = z.infer<typeof paletteSchema>;
export const quizStyleSchema = z.object({
  palette: paletteSchema.optional(),
  typeface: typefaceSchema.optional(),
  // Decorative cutouts follow the background scene in its atlas row.
  decorations: z.number().int().min(0).max(4).optional(),
});
export type QuizStyle = z.infer<typeof quizStyleSchema>;

export const quizSchema = contentSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  source: z.enum(["ai", "example"]),
  settings: generationInputSchema,
  artwork: quizArtworkSchema.optional(),
  questionArtwork: quizArtworkSchema.optional(),
  resultArtwork: quizArtworkSchema.optional(),
  backgroundIndex: z.number().int().min(0).max(54).optional(),
  style: quizStyleSchema.optional(),
});
export type QuizContent = z.infer<typeof contentSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export type QuizResult = z.infer<typeof resultSchema>;

export function validateContent(
  content: QuizContent,
  count?: number,
): QuizContent {
  const parsed = contentSchema.parse(content);
  if (count !== undefined && parsed.questions.length !== count)
    throw new Error(
      "The quiz has the wrong number of questions. Try generating it again.",
    );
  const ids = parsed.results.map((result) => result.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Quiz results must have unique IDs.");
  if (
    new Set(parsed.questions.map((question) => question.id)).size !==
    parsed.questions.length
  )
    throw new Error("Quiz questions must have unique IDs.");
  for (const question of parsed.questions) {
    if (
      new Set(question.answers.map((answer) => answer.id)).size !==
      question.answers.length
    )
      throw new Error("Answer IDs must be unique within a question.");
    const mappings = question.answers.flatMap((answer) => [
      answer.resultId,
      ...(answer.secondaryResultId ? [answer.secondaryResultId] : []),
    ]);
    if (
      mappings.length !== 4 ||
      new Set(mappings).size !== 4 ||
      mappings.some((id) => !ids.includes(id)) ||
      question.answers.some((answer) =>
        question.answers.length === 2
          ? !answer.secondaryResultId
          : !!answer.secondaryResultId,
      )
    ) {
      throw new Error(
        "Each question must map one answer to each result, using disjoint pairs for two choices.",
      );
    }
  }
  // Choosing the target's mapped option on every question must let it win.
  // This also rejects all-binary quizzes with indistinguishable outcomes.
  for (const id of ids) {
    const maximum = new Map(ids.map((resultId) => [resultId, 0]));
    for (const question of parsed.questions) {
      const answer = question.answers.find(
        (answer) => answer.resultId === id || answer.secondaryResultId === id,
      )!;
      for (const resultId of [answer.resultId, answer.secondaryResultId])
        if (resultId) maximum.set(resultId, maximum.get(resultId)! + 1);
    }
    if (
      ids.some(
        (other, index) =>
          other !== id &&
          (maximum.get(other)! > maximum.get(id)! ||
            (index < ids.indexOf(id) &&
              maximum.get(other) === maximum.get(id))),
      )
    )
      throw new Error("Every quiz outcome must be independently reachable.");
  }
  return parsed;
}

export function parseQuiz(value: unknown): Quiz {
  const quiz = quizSchema.parse(value);
  validateContent(quiz, quiz.settings.questionCount);
  if (quiz.artwork && quiz.artwork.rows !== quiz.questions.length + 1)
    throw new Error("The quiz artwork doesn't match its questions.");
  if (
    quiz.questionArtwork &&
    (quiz.questionArtwork.columns !== 5 ||
      ![quiz.questions.length, quiz.questions.length + 1].includes(
        quiz.questionArtwork.rows,
      ))
  )
    throw new Error("The question artwork doesn't match its questions.");
  if (
    quiz.resultArtwork &&
    quiz.resultArtwork.columns * quiz.resultArtwork.rows < quiz.results.length
  )
    throw new Error("The result artwork doesn't match its outcomes.");
  return quiz;
}

// Ties resolve in the stable result order. The same answers always yield the
// same result, independently of layout, theme, or the order of object keys.
export function scoreQuiz(
  quiz: Quiz,
  selections: Record<string, string>,
): QuizResult {
  const scores = new Map(quiz.results.map((result) => [result.id, 0]));
  for (const question of quiz.questions) {
    const answer = question.answers.find(
      (option) => option.id === selections[question.id],
    );
    if (!answer) throw new Error("Answer every question to see your result.");
    scores.set(answer.resultId, (scores.get(answer.resultId) ?? 0) + 1);
    if (answer.secondaryResultId)
      scores.set(
        answer.secondaryResultId,
        (scores.get(answer.secondaryResultId) ?? 0) + 1,
      );
  }
  return quiz.results.reduce((best, result) =>
    scores.get(result.id)! > scores.get(best.id)! ? result : best,
  );
}
