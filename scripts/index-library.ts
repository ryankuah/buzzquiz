import { api } from "../convex/_generated/api";
import {
  convexConnection,
  createConvexLibraryRepository,
} from "../src/lib/convex-repository";
import { addToLibrary, type NewLibraryAsset } from "../src/lib/asset-library";
import { questionSetSchema, validateOutcomeSet } from "../src/lib/content-sets";
import { readQuizImage } from "../src/lib/asset-store";
import sharp from "sharp";
import { cutPairs } from "../src/lib/cutout-quality";

/** Cells the image model left empty must never be offered as pictures. */
async function visibleCells(
  url: string,
  columns: number,
  rows: number,
): Promise<Set<number>> {
  const bytes = await readQuizImage(url.split("/").pop()!);
  if (!bytes) throw new Error(`Missing artwork ${url}`);
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width / columns;
  const height = info.height / rows;
  const visible = new Set<number>();
  const suspect = await cutPairs(bytes, columns, rows);
  for (let cell = 0; cell < columns * rows; cell++) {
    if (suspect.has(cell)) continue;
    let solid = 0;
    const left = (cell % columns) * width;
    const top = Math.floor(cell / columns) * height;
    for (let y = top; y < top + height && solid < 400; y += 2)
      for (let x = left; x < left + width && solid < 400; x += 2)
        if (data[(y * info.width + x) * 4 + 3] > 16) solid++;
    if (solid >= 400) visible.add(cell);
  }
  return visible;
}

// Adds the pictures of every packed (transparent-cutout) content set saved
// before the shared library existed, so new quizzes can reuse them. Older
// opaque atlases are skipped: their cells carry a flat painted background.
// Uses embedding requests only, no generation quota, and skips sets already
// indexed, so it can be re-run safely.
// Run with Node's --env-file=.env.local and optionally override CONVEX_URL.
async function main() {
  const { client, secret } = convexConnection();
  let cursor: string | null = null;
  let indexed = 0;
  do {
    const batch: { indexed: number; isDone: boolean; continueCursor: string } =
      await client.mutation(api.library.indexIdentities, { secret, cursor });
    indexed += batch.indexed;
    cursor = batch.isDone ? null : batch.continueCursor;
  } while (cursor !== null);
  console.log(`Indexed exact names for ${indexed} existing pictures.`);
  const library = createConvexLibraryRepository();
  const sets = await client.query(api.library.packedContent, { secret });
  const done = new Set<string>();
  for (let start = 0; start < sets.length; start += 32) {
    const sources = sets.slice(start, start + 32).map((set) => set.key);
    for (const source of await client.query(api.library.indexedSources, {
      secret,
      sources,
    }))
      done.add(source);
  }
  let added = 0;
  for (const set of sets) {
    if (done.has(set.key)) continue;
    const atlas = {
      url: set.artwork.url,
      columns: set.artwork.columns,
      rows: set.artwork.rows,
      width: set.artwork.width,
      height: set.artwork.height,
    };
    const topic = set.topic ?? "general";
    const assets: NewLibraryAsset[] = [];
    const visible = await visibleCells(atlas.url, atlas.columns, atlas.rows);
    const add = (
      kind: NewLibraryAsset["kind"],
      name: string,
      description: string,
      cell: number,
    ) =>
      visible.has(cell) &&
      assets.push({
        id: crypto.randomUUID(),
        kind,
        name: name.slice(0, 45),
        description,
        topic,
        atlas,
        cell,
        source: set.key,
      });
    if (set.kind === "outcomes") {
      for (const [index, result] of validateOutcomeSet(
        set.data,
      ).results.entries())
        add("sprite", result.title, result.imagePrompt || result.title, index);
    } else {
      const data = questionSetSchema.parse(set.data);
      const answers = new Set<string>();
      for (const [row, question] of data.questions.entries()) {
        add("sprite", question.imagePrompt, question.imagePrompt, row * 5);
        for (const [index, answer] of question.answers.entries())
          if (
            !answers.has(answer.imagePrompt) &&
            add("sprite", answer.text, answer.imagePrompt, row * 5 + index + 1)
          )
            answers.add(answer.imagePrompt);
      }
      const background = data.questions.length * 5;
      add("scene", data.backgroundPrompt, data.backgroundPrompt, background);
      for (const [index, motif] of (data.decorations ?? []).entries())
        add("decoration", motif, motif, background + 1 + index);
    }
    const count = await addToLibrary(library, assets, {
      onError: (error) => {
        throw error;
      },
    });
    added += count;
    console.log(`  ${set.kind} "${topic}": ${count} pictures`);
  }
  console.log(`Indexed ${added} pictures from ${sets.length} packed sets.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
