import { variedQuiz } from "./varied-quiz";
import { exampleQuiz } from "../src/lib/examples";
import {
  archetypes,
  validateOutcomeSet,
  questionSetSchema,
  assembleQuiz,
} from "../src/lib/content-sets";
import { type QuizArtwork } from "../src/lib/quiz";

export function reusableFixture() {
  const old = variedQuiz(exampleQuiz("princess"));
  const map = new Map(
    old.results.map((result, index) => [result.id, archetypes[index]]),
  );
  const outcomes = validateOutcomeSet({
    results: old.results.map((result, index) => ({
      ...result,
      id: archetypes[index],
      profile: {
        headline: "A soft heart. Very firm opinions.",
        traits: ["Curious", "Loyal", "Determined"],
        paragraphs: [
          "You notice the small details.",
          `Like ${result.title}, you find your own way.`,
        ],
      },
    })),
  });
  const questions = questionSetSchema.parse({
    backgroundPrompt:
      "A cosy bakery table with muffins beside a window, no people.",
    questions: old.questions.map((question) => ({
      ...question,
      answers: question.answers.map((answer) => ({
        ...answer,
        resultId: map.get(answer.resultId),
        secondaryResultId: answer.secondaryResultId
          ? map.get(answer.secondaryResultId)
          : null,
        personalityNote:
          "You trust your own taste and notice the little extras.",
      })),
    })),
  });
  const art = (columns: number, rows: number): QuizArtwork => ({
    url: `/api/quiz-assets/${crypto.randomUUID()}`,
    columns,
    rows,
    width: columns * 100,
    height: rows * 100,
    model: "fixture",
    generatedAt: new Date().toISOString(),
  });
  const foreground = { data: outcomes, artwork: art(2, 2) };
  const background = { data: questions, artwork: art(5, 6) };
  return {
    outcomes,
    questions,
    foreground,
    background,
    quiz: assembleQuiz(old.settings, foreground, background),
  };
}
