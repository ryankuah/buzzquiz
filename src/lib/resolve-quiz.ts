import { createConvexRepository } from "./convex-repository";
import { contentKeys } from "./normalize-prompt";
import { assembleQuiz, type ContentRepository } from "./content-sets";
import { writeContentSet, drawContentSet } from "./generate-content";
import { resolveContent } from "./content-cache";
import { type GenerationInput } from "./quiz";
import { type GenerationStage } from "./generation-response";

export class QuizBusyError extends Error {}

export function createQuizResolver(
  options: {
    repository?: ContentRepository;
    write?: typeof writeContentSet;
    draw?: typeof drawContentSet;
  } = {},
) {
  return async function resolveQuiz(
    input: GenerationInput,
    request: {
      signal?: AbortSignal;
      onStage?: (stage: GenerationStage) => void;
      beforeGenerate?: () => void;
    } = {},
  ) {
    request.signal?.throwIfAborted();
    const repository = options.repository || createConvexRepository();
    const saved = await repository.findQuiz(input);
    if (saved) return { quiz: saved, reused: true };
    const keys = contentKeys(input);
    const signal = AbortSignal.timeout(275000);
    let generated = false;
    const report = (stage: GenerationStage) => {
      if (!request.signal?.aborted) {
        try {
          request.onStage?.(stage);
        } catch {
          /* Disconnected clients don't invalidate saved content. */
        }
      }
    };
    const get = (kind: "outcomes" | "questions") =>
      resolveContent(
        repository,
        keys[kind],
        kind,
        async (owner, draft) => {
          generated = true;
          let data = draft;
          if (!data) {
            report("writing");
            await repository.recordCall(keys[kind], owner, "text");
            data = await (options.write || writeContentSet)(
              kind,
              input,
              signal,
            );
            await repository.checkpoint(keys[kind], owner, data);
          }
          report("drawing");
          await repository.recordCall(keys[kind], owner, "image");
          const artwork = await (options.draw || drawContentSet)(
            kind,
            input,
            data,
            signal,
          );
          return { data, artwork };
        },
        { signal, beforeGenerate: request.beforeGenerate },
      );
    const outcomes = await get("outcomes");
    const questions = await get("questions");
    const quiz = await repository.saveQuiz(
      input,
      assembleQuiz(input, outcomes, questions),
    );
    return { quiz, reused: !generated };
  };
}
export const resolveQuiz = createQuizResolver();
