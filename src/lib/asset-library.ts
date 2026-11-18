import { getImageConfig } from "./ai-config";
import { assetName, meaningText } from "./topic-text";
import { embedTopics, type Embedder } from "./topics";

export type LibraryKind = "sprite" | "scene" | "decoration";
export type LibraryAtlas = {
  url: string;
  columns: number;
  rows: number;
  width: number;
  height: number;
};
/** One reusable picture: an exact cell of a packed atlas. */
export type LibraryAsset = {
  id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  /** What it was drawn for, e.g. "snacks". Only used to steer search. */
  topic: string;
  atlas: LibraryAtlas;
  cell: number;
};
export type LibraryMatch = LibraryAsset & { score: number };
export type NewLibraryAsset = LibraryAsset & { source: string };

export interface LibraryRepository {
  portraits(
    topic: string,
    names: string[],
  ): Promise<Array<LibraryAsset | null>>;
  namedSprites(names: string[]): Promise<LibraryAsset[][]>;
  /** Nearest assets of each kind, one result list per query. */
  search(
    queries: Array<{ vector: number[]; kind: LibraryKind; limit: number }>,
    model: string,
  ): Promise<LibraryMatch[][]>;
  get(ids: string[]): Promise<Array<LibraryAsset | null>>;
  add(
    assets: Array<NewLibraryAsset & { embedding: number[]; model: string }>,
  ): Promise<number>;
  /** Which of these refusal keys the image provider has refused before. */
  refused(keys: string[]): Promise<string[]>;
  refuse(keys: string[]): Promise<void>;
}

/**
 * Identifies a result picture independently of how it was described. Each
 * image model has its own policy, so changing models forgets old refusals.
 */
export function refusalKey(
  category: string,
  name: string,
  model = getImageConfig(true).model,
) {
  return `${model}|${meaningText(category)}|${meaningText(name)}`;
}

/** The text an asset is found by. Its topic disambiguates names like "Muffin". */
export function assetSearchText(asset: {
  topic: string;
  name: string;
  description: string;
}) {
  return `${asset.topic} — ${asset.name}: ${asset.description}`;
}

export function sameName(a: string, b: string) {
  return assetName(a) === assetName(b);
}

/** Saves newly drawn assets so every later quiz can find them. Never throws. */
export async function addToLibrary(
  repository: LibraryRepository,
  assets: NewLibraryAsset[],
  options: {
    embed?: Embedder;
    signal?: AbortSignal;
    onError?: (error: unknown) => void;
  } = {},
) {
  if (!assets.length) return 0;
  try {
    const embeddings = await (options.embed || embedTopics)(
      assets.map(assetSearchText),
      options.signal,
    );
    return await repository.add(
      assets.map((asset, index) => ({
        ...asset,
        embedding: embeddings[index].vector,
        model: embeddings[index].model,
      })),
    );
  } catch (error) {
    // The quiz still works; its pictures just won't be offered to others.
    (options.onError || console.warn)(error);
    return 0;
  }
}
