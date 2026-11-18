import sheets from "./category-portraits.json";
import { assetIdentity, assetName } from "./topic-text";
import type { LibraryAsset, LibraryRepository } from "./asset-library";

export const portraitSheets = new Set<string>();
const byId = new Map<string, LibraryAsset>();
const byIdentity = new Map<string, LibraryAsset>();
const byName = new Map<string, LibraryAsset[]>();

for (const { sheet, categories } of sheets) {
  const url = `/art/category-portraits/v1/${sheet}.webp`;
  portraitSheets.add(url);
  const atlas = { url, columns: 4, rows: 4, width: 1280, height: 1280 };
  categories.forEach(({ topic, outcomes }, row) => {
    outcomes.forEach(({ name, description }, column) => {
      const cell = row * atlas.columns + column;
      const id = `portrait-v1-${sheet}-${cell}`;
      const asset: LibraryAsset = {
        id,
        kind: "sprite",
        topic,
        name,
        description,
        atlas,
        cell,
      };
      byId.set(id, asset);
      byIdentity.set(assetIdentity(topic, name), asset);
      const key = assetName(name);
      byName.set(key, [...(byName.get(key) ?? []), asset]);
    });
  });
}

/** Keep the order (and duplicates) the library contract promises. */
async function fillMissing(
  keys: string[],
  lookup: (key: string) => LibraryAsset | undefined,
  fetch: (missing: string[]) => Promise<(LibraryAsset | null)[]>,
) {
  const local = keys.map(lookup);
  const missing = keys.filter((_, i) => !local[i]);
  const remote = missing.length ? await fetch(missing) : [];
  let next = 0;
  return local.map((asset) => asset ?? remote[next++] ?? null);
}

export function withBundledPortraits(
  library: LibraryRepository,
): LibraryRepository {
  return {
    ...library,
    portraits: (topic, names) =>
      fillMissing(
        names,
        (name) => byIdentity.get(assetIdentity(topic, name)),
        (missing) => library.portraits(topic, missing),
      ),
    async namedSprites(names) {
      const remote = await library.namedSprites(names);
      return names.map((name, index) => [
        ...(remote[index] ?? []),
        ...(byName.get(assetName(name)) ?? []),
      ]);
    },
    get: (ids) =>
      fillMissing(
        ids,
        (id) => byId.get(id),
        (missing) => library.get(missing),
      ),
  };
}
