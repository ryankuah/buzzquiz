import { createHash } from "node:crypto";
import { resolveContent } from "./content-cache";
import { createConvexRepository } from "./convex-repository";
import { getAiConfig } from "./ai-config";
import { generatePersonalityReading } from "./generate-reading";
import { personalityReadingSchema } from "./personality";
import { scoreQuiz, type Quiz } from "./quiz";
import { type ContentRepository } from "./content-sets";

export async function resolveReading(
  quiz: Quiz,
  selections: Record<string, string>,
  options: {
    repository?: ContentRepository;
    generate?: typeof generatePersonalityReading;
  } = {},
) {
  scoreQuiz(quiz, selections);
  const key = readingKey(quiz, selections);
  const repository = options.repository || createConvexRepository();
  const signal = AbortSignal.timeout(50000);
  const content = await resolveContent(
    repository,
    key,
    "reading",
    async (owner) => {
      await repository.recordCall(key, owner, "text");
      const reading = await (options.generate || generatePersonalityReading)(
        quiz,
        selections,
        undefined,
        signal,
      );
      return { data: personalityReadingSchema.parse(reading) };
    },
    {
      signal,
      beforeGenerate: () => {
        if (!options.generate && !getAiConfig().configured)
          throw new Error("Your personal reading isn't available right now.");
      },
    },
  );
  return personalityReadingSchema.parse(content.data);
}

export function readingKey(quiz: Quiz, selections: Record<string, string>) {
  return `reading:${createHash("sha256")
    .update(
      JSON.stringify([
        quiz.id,
        quiz.questions.map((question) => [
          question.id,
          selections[question.id],
        ]),
      ]),
    )
    .digest("hex")}`;
}
