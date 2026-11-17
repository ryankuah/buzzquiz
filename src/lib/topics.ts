import { createAiClient } from "./ai-client";
import { getAiConfig } from "./ai-config";
import { type GenerationInput } from "./quiz";
import {
  canonicalBasis,
  canonicalSubject,
  type TopicNames,
} from "./normalize-prompt";

export type TopicKind = keyof TopicNames;
export type TopicEmbedding = { vector: number[]; model: string };

// Must match the vector index in convex/schema.ts.
export const TOPIC_EMBEDDING_DIMENSIONS = 3072;

// Calibrated on text-embedding-3-large with bare category names. Synonyms
// ("LOTR character" / "Lord of the Rings character", "U.S. state" / "US
// state") score 0.84–0.91; the closest different categories we measured
// ("Taylor Swift album" / "song", "Disney princess" / "prince") score ≤0.80.
// Raw scores aren't probabilities. A missed synonym only costs a fresh
// generation, while a false merge serves the wrong quiz, so stay conservative.
export const TOPIC_MATCH_THRESHOLD = 0.84;

export function getEmbeddingConfig() {
  const ai = getAiConfig();
  return {
    configured: ai.configured,
    model:
      ai.provider === "OpenRouter"
        ? process.env.QUIZ_EMBEDDING_MODEL?.trim() ||
          "openai/text-embedding-3-large"
        : process.env.OPENAI_EMBEDDING_MODEL?.trim() ||
          "text-embedding-3-large",
  };
}

export interface TopicRepository {
  /** The topic a known wording belongs to. */
  findAlias(kind: TopicKind, alias: string): Promise<string | null>;
  /** The most similar saved topic of the same kind. */
  nearest(
    kind: TopicKind,
    embedding: TopicEmbedding,
  ): Promise<{ topic: string; score: number } | null>;
  /** Saves an alias, creating the topic when an embedding is supplied. */
  register(
    kind: TopicKind,
    alias: string,
    topic: string,
    embedding?: TopicEmbedding,
  ): Promise<void>;
}

export type Embedder = (
  texts: string[],
  signal?: AbortSignal,
) => Promise<TopicEmbedding[]>;

export const embedTopics: Embedder = async (texts, signal) => {
  const { configured, model } = getEmbeddingConfig();
  if (!configured) throw new Error("Embeddings aren't configured.");
  const response = await createAiClient().embeddings.create(
    { model, input: texts, encoding_format: "float" },
    { signal, timeout: 15000 },
  );
  const vectors = [...response.data]
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
  if (
    vectors.length !== texts.length ||
    vectors.some((vector) => vector.length !== TOPIC_EMBEDDING_DIMENSIONS)
  )
    throw new Error("The embedding response didn't match the topic index.");
  return vectors.map((vector) => ({ vector, model }));
};

export type ResolvedTopics = {
  names: TopicNames;
  /** Records new wording once the quiz exists. Never throws. */
  commit(): Promise<void>;
};

export function createTopicResolver(options: {
  repository: TopicRepository;
  embed?: Embedder;
  onError?: (error: unknown) => void;
}) {
  const { repository } = options;
  const embed = options.embed || embedTopics;
  const report = options.onError || ((error) => console.warn(error));

  return async function resolveTopics(
    input: GenerationInput,
    signal?: AbortSignal,
  ): Promise<ResolvedTopics> {
    const aliases: TopicNames = {
      subject: canonicalSubject(input.subject),
      basis: canonicalBasis(input.basis),
    };
    const kinds = ["subject", "basis"] as const;
    const known = await Promise.all(
      kinds.map((kind) => repository.findAlias(kind, aliases[kind])),
    );
    const names = { ...aliases };
    const pending: Array<() => Promise<void>> = [];
    const unknown = kinds.filter((_, index) => {
      if (known[index]) names[kinds[index]] = known[index]!;
      return !known[index];
    });

    if (unknown.length) {
      try {
        // One request embeds both blanks when neither wording is known yet.
        const embeddings = await embed(
          unknown.map((kind) => aliases[kind]),
          signal,
        );
        await Promise.all(
          unknown.map(async (kind, index) => {
            const embedding = embeddings[index];
            const match = await repository.nearest(kind, embedding);
            if (match && match.score >= TOPIC_MATCH_THRESHOLD) {
              names[kind] = match.topic;
              pending.push(() =>
                repository.register(kind, aliases[kind], match.topic),
              );
            } else
              pending.push(() =>
                repository.register(
                  kind,
                  aliases[kind],
                  aliases[kind],
                  embedding,
                ),
              );
          }),
        );
      } catch (error) {
        signal?.throwIfAborted();
        // Matching is an optimisation. Without it, the exact wording still works.
        report(error);
        pending.length = 0;
      }
    }

    return {
      names,
      async commit() {
        await Promise.all(
          pending.map((save) => save().catch((error) => report(error))),
        );
      },
    };
  };
}
