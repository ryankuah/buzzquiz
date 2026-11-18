import sharp from "sharp";
import { readIllustration } from "./read-illustration";
import { readQuizImage, saveQuizImage } from "./asset-store";
import { composeAtlas } from "./atlas-pack";
import { ATLAS_CELL } from "./generate-artwork";
import { type LibraryAsset } from "./asset-library";
import { type QuizArtwork } from "./quiz";

type Cell = Pick<LibraryAsset, "atlas" | "cell"> | null;

/**
 * Crops saved library cells, from any number of source atlases, into one
 * atlas laid out for the player. Makes no AI calls.
 */
export async function composeCells(
  cells: Cell[],
  columns: number,
  rows: number,
  options: {
    read?: (id: string) => Promise<Buffer | null>;
    save?: typeof saveQuizImage;
    signal?: AbortSignal;
  } = {},
): Promise<QuizArtwork> {
  const read = options.read || readQuizImage;
  const sources = new Map<string, Promise<Buffer>>();
  const source = (url: string) => {
    if (!sources.has(url))
      sources.set(
        url,
        readIllustration(url, read).then((bytes) => {
          if (!bytes)
            throw new Error(
              "Saved artwork couldn't be loaded. Please try again.",
            );
          return bytes;
        }),
      );
    return sources.get(url)!;
  };
  const tiles = new Map<string, Promise<Buffer>>();
  const tile = ({ atlas, cell }: NonNullable<Cell>) => {
    const key = `${atlas.url}#${cell}`;
    if (!tiles.has(key))
      tiles.set(
        key,
        source(atlas.url).then(async (bytes) => {
          const width = atlas.width / atlas.columns;
          const height = atlas.height / atlas.rows;
          if (
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            cell >= atlas.columns * atlas.rows
          )
            throw new Error("Saved artwork has invalid cells.");
          return sharp(bytes)
            .extract({
              left: (cell % atlas.columns) * width,
              top: Math.floor(cell / atlas.columns) * height,
              width,
              height,
            })
            .resize(ATLAS_CELL, ATLAS_CELL)
            .png()
            .toBuffer();
        }),
      );
    return tiles.get(key)!;
  };
  const layers = await Promise.all(
    cells.flatMap((cell, target) =>
      cell
        ? [
            tile(cell).then((input) => ({
              input,
              left: (target % columns) * ATLAS_CELL,
              top: Math.floor(target / columns) * ATLAS_CELL,
            })),
          ]
        : [],
    ),
  );
  options.signal?.throwIfAborted();
  const bytes = await composeAtlas(
    columns * ATLAS_CELL,
    rows * ATLAS_CELL,
    layers,
  );
  const id = crypto.randomUUID();
  const dimensions = await (options.save || saveQuizImage)(id, bytes, {
    packed: true,
  });
  return {
    url: `/api/quiz-assets/${id}`,
    columns,
    rows,
    ...dimensions,
    model: "asset-library-v1",
    generatedAt: new Date().toISOString(),
    packed: true,
  };
}
