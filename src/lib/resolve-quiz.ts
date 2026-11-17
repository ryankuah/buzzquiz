import {
  createConvexRepository,
  createConvexTopicRepository,
} from "./convex-repository";
import { contentKeys, quizPromptKey } from "./normalize-prompt";
import { createTopicResolver, type ResolvedTopics } from "./topics";
import {
  assembleQuiz,
  type ContentRepository,
  type ReadyContent,
} from "./content-sets";
import { writeContentSet, drawContentSet } from "./generate-content";
import { resolveContent } from "./content-cache";
import { type GenerationInput, type QuizPalette } from "./quiz";
import { atlasCellPalette } from "./palette";
import { type GenerationStage } from "./generation-response";

export class QuizBusyError extends Error {}

export function createQuizResolver(
  options: {
    repository?: ContentRepository;
    write?: typeof writeContentSet;
    draw?: typeof drawContentSet;
    /** Matches each blank to saved topics, or false to use exact wording. */
    topics?:
      | ((
          input: GenerationInput,
          signal?: AbortSignal,
        ) => Promise<ResolvedTopics>)
      | false;
    /** Derives the quiz colours from its background scene. */
    palette?:
      | ((
          questions: ReadyContent,
          backgroundIndex: number,
        ) => Promise<QuizPalette | undefined>)
      | false;
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
    // A custom content repository (tests, migrations) skips topic matching
    // unless a resolver is supplied alongside it.
    const resolveTopics =
      options.topics ??
      (options.repository
        ? false
        : createTopicResolver({ repository: createConvexTopicRepository() }));
    const topics = resolveTopics
      ? await resolveTopics(input, request.signal)
      : undefined;
    const key = quizPromptKey(input, topics?.names);
    const saved = await repository.findQuiz(key);
    if (saved) {
      await topics?.commit();
      return { quiz: saved, reused: true };
    }
    const keys = contentKeys(input, topics?.names);
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
          // Question sets also draw their result background as its own image.
          if (kind === "questions")
            await repository.recordCall(keys[kind], owner, "background");
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
    // Colours are a finishing touch: a failure leaves the preset theme.
    const derivePalette =
      options.palette ??
      (options.repository
        ? false
        : (content: ReadyContent, index: number) =>
            atlasCellPalette(content.artwork!, index));
    const palette = derivePalette
      ? await derivePalette(questions, input.questionCount * 5).catch(
          () => undefined,
        )
      : undefined;
    const quiz = await repository.saveQuiz(
      key,
      assembleQuiz(input, outcomes, questions, undefined, palette),
    );
    // Only wording that now has saved content becomes a matchable topic.
    await topics?.commit();
    return { quiz, reused: !generated };
  };
}
export const resolveQuiz = createQuizResolver();
