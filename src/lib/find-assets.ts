import {
  assetSearchText,
  refusalKey,
  sameName,
  type LibraryAsset,
  type LibraryMatch,
  type LibraryRepository,
} from "./asset-library";
import { type QuizPlan } from "./plan-quiz";
import { depictsEmoji } from "./quiz-illustrations";
import { assetName } from "./topic-text";
import { embedTopics, getEmbeddingConfig, type Embedder } from "./topics";

// Calibrated loosely on text-embedding-3-large: related pictures score about
// 0.4–0.7 against a short visual query, unrelated ones below 0.3. Candidates
// are only offered to the writer, who decides whether each one really fits,
// so this threshold just keeps the prompt short.
export const CANDIDATE_THRESHOLD = 0.35;
// A result picture must show that exact named member; the name check is the
// real guard, the score keeps "Muffin" the Bluey character away from muffins.
export const OUTCOME_THRESHOLD = 0.6;
export const MAX_SPRITE_CANDIDATES = 40;

export type FoundAssets = {
  /** A saved picture for each planned outcome, or null when it must be drawn. */
  outcomes: Array<LibraryAsset | null>;
  /** Same name under a different topic. The writer must confirm the subject. */
  alternatives?: LibraryAsset[][];
  /** Outcomes the image provider refused before; they use a generated award illustration. */
  refused?: boolean[];
  sprites: LibraryAsset[];
  scenes: LibraryAsset[];
  reusableScene?: LibraryAsset;
  decorations: LibraryAsset[];
};

function strip({ score: _score, ...asset }: LibraryMatch): LibraryAsset {
  return asset;
}

/** Ranks unique matches by their best score across every query. */
function rank(lists: LibraryMatch[][], threshold: number, limit: number) {
  const best = new Map<string, LibraryMatch>();
  for (const match of lists.flat())
    if (
      match.score >= threshold &&
      (best.get(match.id)?.score ?? -1) < match.score
    )
      best.set(match.id, match);
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(strip);
}

export async function findAssets(
  plan: QuizPlan,
  repository: LibraryRepository,
  options: {
    embed?: Embedder;
    signal?: AbortSignal;
    onError?: (error: unknown) => void;
  } = {},
): Promise<FoundAssets> {
  const keys = plan.outcomes.map((outcome) =>
    refusalKey(plan.outcomeCategory, outcome.name),
  );
  const report = options.onError || console.warn;
  const [exact, refusedKeys] = await Promise.all([
    repository
      .portraits(
        plan.outcomeCategory,
        plan.outcomes.map((o) => o.name),
      )
      .catch((error) => {
        report(error);
        return plan.outcomes.map(() => null);
      }),
    repository.refused(keys).catch((error) => {
      (options.onError || console.warn)(error);
      return [] as string[];
    }),
  ]);
  const refusals = new Set(refusedKeys);
  const refused = keys.map((key) => refusals.has(key));
  const found = await search(
    plan,
    exact.map((asset) => (asset && !depictsEmoji(asset.name) ? asset : null)),
    repository,
    options,
  );
  const missing = plan.outcomes.flatMap((o, index) =>
    found.outcomes[index] ? [] : [{ name: o.name, index }],
  );
  if (!missing.length) return { ...found, refused };
  const named = await repository
    .namedSprites(missing.map((o) => o.name))
    .catch((error) => {
      options.signal?.throwIfAborted();
      report(error);
      return [];
    });
  const alternatives: LibraryAsset[][] =
    found.alternatives ?? plan.outcomes.map(() => []);
  missing.forEach(({ index, name }, i) => {
    const matches = new Map(alternatives[index].map((a) => [a.id, a]));
    for (const asset of named[i] ?? [])
      if (!depictsEmoji(asset.name) && sameName(asset.name, name))
        matches.set(asset.id, asset);
    alternatives[index] = [...matches.values()].slice(0, 8);
  });
  const reserved = new Set(alternatives.flat().map((a) => a.id));
  return {
    ...found,
    alternatives,
    sprites: found.sprites.filter((a) => !reserved.has(a.id)),
    refused,
  };
}

async function search(
  plan: QuizPlan,
  exact: Array<LibraryAsset | null>,
  repository: LibraryRepository,
  options: {
    embed?: Embedder;
    signal?: AbortSignal;
    onError?: (error: unknown) => void;
  },
): Promise<FoundAssets> {
  const missing = plan.outcomes.flatMap((outcome, index) =>
    exact[index] ? [] : [{ outcome, index }],
  );
  const texts = [
    ...missing.map(({ outcome }) =>
      assetSearchText({ topic: plan.outcomeCategory, ...outcome }),
    ),
    ...plan.visualQueries.map((query) => `${plan.questionTopic} — ${query}`),
    `${plan.questionTopic} — background scene: ${plan.scene}`,
    // The kind filter already restricts this search to decorative artwork.
    plan.questionTopic,
  ];
  try {
    const embeddings = await (options.embed || embedTopics)(
      texts,
      options.signal,
    );
    const model = embeddings[0]?.model ?? getEmbeddingConfig().model;
    const outcomeCount = missing.length;
    const queryEnd = outcomeCount + plan.visualQueries.length;
    const hits = await repository.search(
      embeddings.map((embedding, index) => ({
        vector: embedding.vector,
        kind:
          index === queryEnd
            ? ("scene" as const)
            : index === queryEnd + 1
              ? ("decoration" as const)
              : ("sprite" as const),
        limit: index < outcomeCount ? 5 : index < queryEnd ? 6 : 12,
      })),
      model,
    );
    const results = hits.map((list) =>
      list.filter((asset) => !depictsEmoji(asset.name)),
    );
    const outcomes = [...exact];
    const alternatives: LibraryAsset[][] = plan.outcomes.map(() => []);
    missing.forEach(({ outcome, index }, position) => {
      const matches = results[position].filter(
        (hit) =>
          hit.score >= OUTCOME_THRESHOLD && sameName(hit.name, outcome.name),
      );
      const match = matches.find((hit) =>
        sameName(hit.topic, plan.outcomeCategory),
      );
      outcomes[index] = match ? strip(match) : null;
      if (!match) alternatives[index] = matches.map(strip);
    });
    const taken = new Set(
      outcomes.flatMap((asset) => (asset ? [asset.id] : [])),
    );
    // The result backdrop sets the mood. A change of lighting or garnish
    // in the scene brief needn't buy another café or coding desk.
    const topic = ` ${assetName(plan.questionTopic)} `;
    const scenes = results[queryEnd];
    const reusableScene = scenes.find((hit) => {
      const savedTopic = ` ${assetName(hit.topic)} `;
      const related = savedTopic.includes(topic) || topic.includes(savedTopic);
      return hit.score >= (related ? 0.76 : 0.84);
    });
    return {
      outcomes,
      alternatives,
      // Result pictures stay out of the questions, so answers never look
      // like a spoiler for an outcome.
      sprites: rank(
        results.slice(outcomeCount, queryEnd),
        CANDIDATE_THRESHOLD,
        MAX_SPRITE_CANDIDATES + taken.size,
      )
        .filter((asset) => !taken.has(asset.id))
        .slice(0, MAX_SPRITE_CANDIDATES),
      scenes: rank([scenes], 0.25, 6),
      ...(reusableScene ? { reusableScene: strip(reusableScene) } : {}),
      decorations: rank([results[queryEnd + 1]], 0.25, 10),
    };
  } catch (error) {
    options.signal?.throwIfAborted();
    // Searching is an optimisation: without it the quiz draws what it needs.
    (options.onError || console.warn)(error);
    return { outcomes: exact, sprites: [], scenes: [], decorations: [] };
  }
}
