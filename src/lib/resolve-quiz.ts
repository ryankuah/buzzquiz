import {
  createConvexLibraryRepository,
  createConvexRepository,
  createConvexTopicRepository,
} from "./convex-repository";
import {
  canonicalBasis,
  canonicalSubject,
  canonicalTopic,
  meaningText,
  quizPromptKey,
  type TopicNames,
} from "./normalize-prompt";
import { type ContentRepository } from "./content-sets";
import { resolveContent } from "./content-cache";
import {
  addToLibrary,
  refusalKey,
  type LibraryAsset,
  type LibraryRepository,
  type NewLibraryAsset,
} from "./asset-library";
import { findAssets } from "./find-assets";
import {
  ideaSchema,
  planQuiz,
  planQuizKey,
  validateQuizPlan,
  wordingKey,
  type QuizPlan,
} from "./plan-quiz";
import { writeQuiz, type PictureRef, type QuizDraft } from "./write-quiz";
import {
  drawPictures,
  partOf,
  type DrawnPart,
  type DrawnParts,
  type PartName,
} from "./draw-pictures";
import {
  depictsEmoji,
  illustrationCell,
  answerIllustrations,
  questionIllustration,
  awardCell,
} from "./quiz-illustrations";
import { composeCells } from "./compose-quiz-artwork";
import { questionTemplatePlan } from "./templates";
import { type Embedder, type TopicKind, type TopicRepository } from "./topics";
import {
  parseQuiz,
  type GenerationInput,
  type Quiz,
  type QuizArtwork,
  type QuizPalette,
} from "./quiz";
import { atlasCellPalette } from "./palette";
import {
  generationSteps,
  type GenerationProgress,
  type GenerationStage,
} from "./generation-response";

export class QuizBusyError extends Error {}

/** Checkpointed after each paid step, so a retry never repeats one. */
type QuizProgress = {
  draft: QuizDraft;
  parts?: DrawnParts;
  /** A refused portrait sheet was recorded; never count it twice. */
  refusalNoted?: boolean;
  /** Every part settled and its pictures were offered to the library. */
  drawn?: boolean;
};

type Cell = Pick<LibraryAsset, "atlas" | "cell"> | null;
type Palette = (
  artwork: QuizArtwork,
  index: number,
) => Promise<QuizPalette | undefined>;

// Older keys erased symbols, so "C++ feature" and "C# feature" collided.
const erasesMeaning = (value: string) =>
  canonicalTopic(value) !== meaningText(value) ||
  /[^\p{L}\p{N}\s'’"“”?!.,:;()&-]/u.test(value);

/**
 * Saved quizzes from before free-form wording, by their exact key or by
 * wording already matched to a saved topic. Read-only: no embeddings.
 */
async function findLegacyQuiz(
  input: GenerationInput,
  repository: ContentRepository,
  topics: TopicRepository | false,
) {
  if (erasesMeaning(input.subject) || erasesMeaning(input.basis)) return null;
  const exact = await repository.findQuiz(quizPromptKey(input));
  if (exact || !topics) return exact;
  try {
    const wording: TopicNames = {
      subject: canonicalSubject(input.subject),
      basis: canonicalBasis(input.basis),
    };
    // Each blank may be saved under its own wording or a known alias, so try
    // every mix; the exact pair was already tried above.
    const options = async (kind: keyof TopicNames) => {
      for (const namespace of [
        "shared",
        kind,
        kind === "subject" ? "basis" : "subject",
      ] as TopicKind[]) {
        const topic = await topics.findAlias(namespace, wording[kind]);
        if (topic && topic !== wording[kind]) return [wording[kind], topic];
      }
      return [wording[kind]];
    };
    const [subjects, bases] = await Promise.all([
      options("subject"),
      options("basis"),
    ]);
    for (const subject of subjects)
      for (const basis of bases) {
        if (subject === wording.subject && basis === wording.basis) continue;
        const quiz = await repository.findQuiz(
          quizPromptKey(input, { subject, basis }),
        );
        if (quiz) return quiz;
      }
    return null;
  } catch (error) {
    console.warn(error);
    return null;
  }
}

export function createQuizResolver(
  options: {
    repository?: ContentRepository;
    library?: LibraryRepository;
    /** Saved topic aliases of older quizzes, or false to skip them. */
    topics?: TopicRepository | false;
    plan?: typeof planQuiz;
    write?: typeof writeQuiz;
    draw?: typeof drawPictures;
    compose?: typeof composeCells;
    embed?: Embedder;
    /** Derives the quiz colours from its background scene. */
    palette?: Palette | false;
  } = {},
) {
  return async function resolveQuiz(
    input: GenerationInput,
    request: {
      signal?: AbortSignal;
      onStage?: (progress: GenerationProgress) => void;
      beforeGenerate?: () => void;
    } = {},
  ): Promise<{ quiz: Quiz; reused: boolean }> {
    request.signal?.throwIfAborted();
    const reported = new Set<GenerationStage>();
    const report = (
      stage: GenerationStage,
      status: GenerationProgress["status"],
    ) => {
      reported.add(stage);
      if (!request.signal?.aborted) {
        try {
          request.onStage?.({ stage, status });
        } catch {
          /* Disconnected clients don't invalidate saved content. */
        }
      }
    };
    const reuseRemaining = () => {
      for (const step of generationSteps.slice(1, -1))
        if (!reported.has(step.id)) report(step.id, "reused");
      report("finishing", "active");
    };
    report("checking", "active");
    const repository = options.repository || createConvexRepository();
    const legacy = await findLegacyQuiz(
      input,
      repository,
      options.topics ??
        (options.repository ? false : createConvexTopicRepository()),
    );
    report("checking", "complete");
    if (legacy) {
      reuseRemaining();
      return { quiz: legacy, reused: true };
    }
    // An earlier free-form plan can still open its finished quiz for free.
    // Only new builds need the version that commits choices before art search.
    const earlier = await repository.findContent(wordingKey(input, 2));
    if (earlier?.status === "ready") {
      const idea = ideaSchema.safeParse(earlier.data);
      if (idea.success) {
        const quiz = await repository.findQuiz(planQuizKey(idea.data, input));
        if (quiz) {
          reuseRemaining();
          return { quiz, reused: true };
        }
      }
    }
    // Paid work finishes and is cached even if the browser disconnects.
    const signal = AbortSignal.timeout(275000);
    const cache = { signal, beforeGenerate: request.beforeGenerate };

    // 1. Interpret the wording. Cached per wording, so repeats are free.
    const planKey = wordingKey(input);
    const plan = validateQuizPlan(
      (
        await resolveContent(
          repository,
          planKey,
          "plan",
          async (owner) => {
            report("planning", "active");
            await repository.recordCall(planKey, owner, "text");
            const data = await (options.plan || planQuiz)(input, signal);
            report("planning", "complete");
            return { data };
          },
          cache,
        )
      ).data,
      input.questionCount,
    );
    if (!reported.has("planning")) report("planning", "reused");

    // Different wording with the same meaning shares one quiz.
    const key = planQuizKey(plan, input);
    const saved = await repository.findQuiz(key);
    if (saved) {
      reuseRemaining();
      return { quiz: saved, reused: true };
    }

    const library = options.library || createConvexLibraryRepository();
    // Another request may finish building this quiz first; then it's reused.
    let built = false;
    const content = await resolveContent(
      repository,
      key,
      "quiz",
      async (owner, checkpoint) => {
        built = true;
        let progress = checkpoint as QuizProgress | undefined;
        // 2. Search the shared library, then 3. write around what exists.
        if (!progress?.draft) {
          report("searching", "active");
          const found = await findAssets(plan, library, {
            embed: options.embed,
            signal,
          });
          report("searching", "complete");
          report("writing", "active");
          await repository.recordCall(key, owner, "text");
          const draft = await (options.write || writeQuiz)(
            input,
            plan,
            found,
            signal,
          );
          progress = { draft };
          await repository.checkpoint(key, owner, progress);
          report("writing", "complete");
        } else {
          report("searching", "reused");
          report("writing", "reused");
        }
        // 4. Draw only what the library was missing, checkpointing each part.
        const { draft } = progress;
        const scene =
          draft.scene && "draw" in draft.scene ? draft.scene.draw : null;
        if (!progress.drawn && (draft.draw.length || scene)) {
          report("drawing", "active");
          let saving = Promise.resolve();
          const parts = await (options.draw || drawPictures)(
            draft.draw,
            scene,
            {
              signal,
              done: progress.parts,
              record: (type) =>
                repository.recordCall(
                  key,
                  owner,
                  type === "scene" ? "background" : type,
                ),
              onPart: (name, part) => {
                progress = {
                  ...progress!,
                  parts: { ...progress!.parts, [name]: part },
                };
                const snapshot = progress;
                // Parts finish concurrently; save their checkpoints in order.
                // Each snapshot holds every part so far, and a failed write
                // never stops a later one from saving them.
                saving = saving
                  .catch(() => {})
                  .then(() => repository.checkpoint(key, owner, snapshot));
                return saving;
              },
            },
          );
          if (parts.portrait === "refused" && !progress.refusalNoted) {
            // Saved first: a retry must not count the same refusal again.
            progress = { ...progress, parts, refusalNoted: true };
            await repository.checkpoint(key, owner, progress);
            await library
              .refuse(
                draft.draw.flatMap((picture) =>
                  picture.result
                    ? [refusalKey(picture.topic, picture.name)]
                    : [],
                ),
              )
              .catch((error) => console.warn(error));
          }
          await remember(draft, parts, plan, {
            library,
            embed: options.embed,
            signal,
          });
          progress = { ...progress, draft, parts, drawn: true };
          await repository.checkpoint(key, owner, progress);
          report("drawing", "complete");
        }
        // 5. Lay out saved pixels for the player; no AI calls.
        report("finishing", "active");
        const quiz = await assemble(input, plan, progress, {
          library,
          compose: options.compose || composeCells,
          palette:
            options.palette ??
            (options.repository
              ? false
              : (artwork, index) => atlasCellPalette(artwork, index)),
          signal,
        });
        return { data: quiz };
      },
      cache,
    );
    reuseRemaining();
    const quiz = await repository.saveQuiz(key, parseQuiz(content.data));
    return { quiz, reused: !built };
  };
}

const drawnPart = (part: DrawnParts[PartName]) =>
  part && typeof part === "object" ? part : null;

/**
 * Offers drawn pictures to the shared library. Library IDs were fixed when
 * each part was saved, so repeating this after a retry adds nothing twice.
 */
async function remember(
  draft: QuizDraft,
  parts: DrawnParts,
  plan: QuizPlan,
  options: {
    library: LibraryRepository;
    embed?: Embedder;
    signal: AbortSignal;
  },
) {
  const entries: NewLibraryAsset[] = [];
  const add = (
    part: DrawnPart,
    position: number,
    asset: Pick<NewLibraryAsset, "kind" | "name" | "description" | "topic">,
  ) => {
    const cell = part.cells[position];
    const id = part.ids[position];
    if (cell === null || cell === undefined || !id) return;
    entries.push({
      ...asset,
      id,
      atlas: {
        url: part.artwork.url,
        columns: part.artwork.columns,
        rows: part.artwork.rows,
        width: part.artwork.width,
        height: part.artwork.height,
      },
      cell,
      source: part.artwork.url,
    });
  };
  draft.draw.forEach((picture, index) => {
    const { name, position } = partOf(draft.draw, index);
    const part = drawnPart(parts[name]);
    if (part)
      add(part, position, {
        kind: picture.kind,
        name: picture.name,
        description: picture.description,
        topic: picture.topic,
      });
  });
  const scene = drawnPart(parts.scene);
  if (scene && draft.scene && "draw" in draft.scene)
    add(scene, 0, {
      kind: "scene",
      name: draft.scene.draw.slice(0, 45),
      description: draft.scene.draw,
      topic: plan.questionTopic,
    });
  await addToLibrary(options.library, entries, {
    embed: options.embed,
    signal: options.signal,
  });
}

async function assemble(
  input: GenerationInput,
  plan: QuizPlan,
  progress: QuizProgress,
  options: {
    library: LibraryRepository;
    compose: typeof composeCells;
    palette: Palette | false;
    signal: AbortSignal;
  },
): Promise<Quiz> {
  const { draft } = progress;
  const parts = progress.parts ?? {};
  const savedIds = [
    ...new Set(
      [
        ...draft.results.map((result) => result.picture),
        ...draft.questions.flatMap((question) => [
          question.picture,
          ...question.answers.map((answer) => answer.picture),
        ]),
        draft.scene,
        ...draft.decorations,
      ].flatMap((ref) => (ref && "asset" in ref ? [ref.asset] : [])),
    ),
  ];
  const saved = new Map(
    (savedIds.length ? await options.library.get(savedIds) : []).flatMap(
      (asset) =>
        asset && !depictsEmoji(asset.name) ? [[asset.id, asset] as const] : [],
    ),
  );
  /** The drawn part and position of a new picture, or of the new scene. */
  const locate = (ref: { draw: number } | { draw: string }) => {
    if (typeof ref.draw === "string")
      return { part: drawnPart(parts.scene), position: 0 };
    const { name, position } = partOf(draft.draw, ref.draw);
    return { part: drawnPart(parts[name]), position };
  };
  const cell = (ref: PictureRef | { draw: string }): Cell => {
    if (!ref) return null;
    if ("asset" in ref) return saved.get(ref.asset) ?? null;
    if ("illustration" in ref) return illustrationCell(ref.illustration);
    const { part, position } = locate(ref);
    const index = part?.cells[position];
    return part && index !== null && index !== undefined
      ? { atlas: part.artwork, cell: index }
      : null;
  };
  const picture = (ref: PictureRef) => {
    if (!ref || "illustration" in ref || !cell(ref)) return {};
    const source =
      "asset" in ref ? ref.asset : locate(ref).part?.ids[locate(ref).position];
    return source ? { assetId: source } : {};
  };
  const resultCells = draft.results.map(
    (r, i) => cell(r.picture) ?? illustrationCell(awardCell(i)),
  );
  const layouts = questionTemplatePlan(input.questionCount);
  const sceneCell = draft.scene ? cell(draft.scene) : null;
  const questionCells = draft.questions.flatMap((q, i) => {
    const fallback = answerIllustrations(
      q.answers.map((a) => a.text),
      q.answers.map((a) =>
        a.picture && "illustration" in a.picture
          ? a.picture.illustration
          : undefined,
      ),
      q.text + " " + input.basis,
    );
    const answers = q.answers.map(
      (a, j) => cell(a.picture) ?? illustrationCell(fallback[j]),
    );
    const stockHero = illustrationCell(
      questionIllustration(q.text, plan.questionTopic),
    );
    const repeatsChoice = answers.some(
      (answer) =>
        answer.atlas.url === stockHero.atlas.url &&
        answer.cell === stockHero.cell,
    );
    const hero =
      cell(q.picture) ??
      (layouts[i].layout === "hero-grid"
        ? repeatsChoice && sceneCell
          ? sceneCell
          : stockHero
        : null);
    return [hero, ...answers, ...Array<Cell>(4 - q.answers.length).fill(null)];
  });
  const decorations = draft.decorations
    .map((ref) => cell(ref))
    .filter((item): item is NonNullable<Cell> => !!item)
    .slice(0, 4);
  questionCells.push(
    sceneCell,
    ...decorations,
    ...Array<Cell>(4 - decorations.length).fill(null),
  );
  const [resultArtwork, questionArtwork] = await Promise.all([
    options.compose(resultCells, 2, 2, { signal: options.signal }),
    options.compose(questionCells, 5, draft.questions.length + 1, {
      signal: options.signal,
    }),
  ]);
  const backgroundIndex = draft.questions.length * 5;
  // Colours are a finishing touch: a failure leaves the preset theme.
  const palette =
    options.palette && sceneCell
      ? await options
          .palette(questionArtwork, backgroundIndex)
          .catch(() => undefined)
      : undefined;
  return parseQuiz({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "ai",
    settings: input,
    title: plan.title,
    description: "Pick what feels like you.",
    results: draft.results.map(({ picture: ref, ...result }) => ({
      ...result,
      ...picture(ref),
    })),
    questions: draft.questions.map(
      ({ picture: ref, answers, ...question }, index) => ({
        ...question,
        layout: layouts[index].layout,
        ...picture(ref),
        answers: answers.map(({ picture: answerRef, ...answer }) => ({
          ...answer,
          ...picture(answerRef),
        })),
      }),
    ),
    questionArtwork,
    resultArtwork,
    backgroundIndex,
    style: {
      ...(palette ? { palette } : {}),
      typeface: plan.typeface,
      ...(decorations.length ? { decorations: decorations.length } : {}),
    },
  });
}

export const resolveQuiz = createQuizResolver();
