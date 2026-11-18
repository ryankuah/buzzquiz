import sharp from "sharp";
import { saveQuizImage } from "./asset-store";
import { composeAtlas, packAtlas } from "./atlas-pack";
import { cutPairs } from "./cutout-quality";
import { ProviderRefusalError } from "./generation-budget";
import { ATLAS_CELL, requestImage, sheetPrompt } from "./generate-artwork";
import { type QuizArtwork } from "./quiz";
import { type PictureToDraw } from "./write-quiz";

export const DRAW_COLUMNS = 4;

/** One paid request's result, saved as its own atlas. */
export type DrawnPart = {
  artwork: QuizArtwork;
  /** Atlas cell of each picture in this part, or null when it came back empty. */
  cells: Array<number | null>;
  /** Library IDs, assigned up front so registering twice is harmless. */
  ids: Array<string | null>;
};
export type PartName = "portrait" | "image" | "scene";
/** Finished parts. "refused" and "failed" are settled; they aren't retried. */
export type DrawnParts = Partial<
  Record<PartName, DrawnPart | "refused" | "failed">
>;

type DrawOptions = {
  signal?: AbortSignal;
  /** Parts already drawn by an earlier attempt; they are never redrawn. */
  done?: DrawnParts;
  /** Called as soon as each part settles, so it can be checkpointed. */
  onPart?: (name: PartName, part: DrawnParts[PartName]) => Promise<void>;
  /** Records each paid request before it is sent. */
  record?: (type: PartName) => Promise<void>;
  request?: typeof requestImage;
  save?: typeof saveQuizImage;
};

const brief = (picture: PictureToDraw) =>
  picture.kind === "decoration"
    ? `A small decorative sticker: ${picture.imagePrompt}`
    : `SUBJECT: ${picture.name}. ${picture.imagePrompt}`;

/** Which part draws each picture, and its position within that part. */
export function partOf(pictures: PictureToDraw[], index: number) {
  const name: PartName = pictures[index].result ? "portrait" : "image";
  const position = pictures
    .slice(0, index)
    .filter(
      (picture) => (picture.result ? "portrait" : "image") === name,
    ).length;
  return { name, position };
}

async function save(
  bytes: Buffer,
  columns: number,
  rows: number,
  model: string,
  options: DrawOptions,
): Promise<QuizArtwork> {
  const id = crypto.randomUUID();
  let dimensions;
  try {
    dimensions = await (options.save || saveQuizImage)(id, bytes, {
      packed: true,
    });
  } catch {
    throw new Error("Couldn't save the generated artwork. Please try again.");
  }
  return {
    url: `/api/quiz-assets/${id}`,
    columns,
    rows,
    ...dimensions,
    model,
    generatedAt: new Date().toISOString(),
    packed: true,
  };
}

/**
 * Draws only what the library was missing, as up to three independent paid
 * requests: result portraits, other pictures, and a scene. Providers refuse
 * some named characters, which must never blank the answers too. Each part is
 * saved and reported as soon as it settles, so a retry never pays for a part
 * twice. Refused or blank pictures leave their slot empty, and the quiz fills those cells with bundled generated illustrations instead of failing outright.
 */
export async function drawPictures(
  pictures: PictureToDraw[],
  scene: string | null,
  options: DrawOptions = {},
): Promise<DrawnParts> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
    : AbortSignal.timeout(180000);
  const request = options.request || requestImage;
  const parts: DrawnParts = { ...options.done };
  const settle = async (name: PartName, part: DrawnParts[PartName]) => {
    parts[name] = part;
    await options.onPart?.(name, part);
  };

  const sheet = async (name: "portrait" | "image") => {
    const items = pictures.filter(
      (picture) => (picture.result ? "portrait" : "image") === name,
    );
    if (!items.length || parts[name]) return;
    const columns = Math.min(DRAW_COLUMNS, items.length);
    const rows = Math.ceil(items.length / columns);
    const briefs = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => {
        const picture = items[row * columns + column];
        return picture ? brief(picture) : null;
      }),
    );
    await options.record?.(name);
    let drawn;
    try {
      drawn = await request(
        sheetPrompt(crypto.randomUUID(), briefs, columns, "basic", "cutouts"),
        { transparent: true, quality: "medium", ratio: columns / rows },
        { signal },
      );
    } catch (error) {
      if (!(error instanceof ProviderRefusalError)) throw error;
      console.warn(`The image provider refused the ${name} sheet.`);
      return settle(name, "refused");
    }
    let packed;
    try {
      // A cutout sheet must be mostly transparent; an opaque one would
      // publish blank or boxed tiles under the subjects' names.
      const { channels, isOpaque } = await sharp(drawn.bytes).stats();
      if (isOpaque || (channels[3]?.mean ?? 255) > 200)
        throw new Error("The cutout sheet had no transparent background.");
      packed = await packAtlas(
        drawn.bytes,
        {
          rows,
          columns,
          occupied: (row, column) => !!briefs[row]?.[column],
        },
        { cell: ATLAS_CELL, rejectAmbiguous: true },
      );
    } catch (error) {
      // An unreadable sheet is treated like a refusal: use the bundled illustrations.
      console.warn(`The ${name} sheet couldn't be repacked.`, error);
      return settle(name, "failed");
    }
    const bytes = await composeAtlas(
      packed.width,
      rows * ATLAS_CELL,
      packed.layers,
    );
    const suspect = await cutPairs(bytes, columns, rows);
    const cells = items.map((_, index) =>
      packed.empty.includes(index) || suspect.has(index) ? null : index,
    );
    await settle(name, {
      artwork: await save(bytes, columns, rows, drawn.model, options),
      cells,
      ids: cells.map((cell) => (cell === null ? null : crypto.randomUUID())),
    });
  };

  const backdrop = async () => {
    if (!scene || parts.scene) return;
    await options.record?.("scene");
    let part: DrawnParts["scene"];
    try {
      const drawn = await request(
        `Create one square illustration: ${scene}
It fills the whole frame edge to edge as one complete atmospheric scene in a charming, tactile, softly lit 3D style, with a calm, uncluttered centre where a picture will be placed. No people, characters, faces, text, letters, numbers, logos, borders or frames.
Unlabelled artwork request ${crypto.randomUUID()}. Return only the image.`,
        { transparent: false, quality: "medium", ratio: 1 },
        { signal },
      );
      const bytes = await sharp(drawn.bytes)
        .resize(ATLAS_CELL, ATLAS_CELL, { fit: "cover" })
        .png()
        .toBuffer();
      part = {
        artwork: await save(bytes, 1, 1, drawn.model, options),
        cells: [0],
        ids: [crypto.randomUUID()],
      };
    } catch (error) {
      // A scene is decorative; never fail the quiz over it.
      console.warn("The background scene couldn't be drawn.", error);
      part = "failed";
    }
    // Outside the catch: a failed checkpoint must surface, not erase a
    // scene that was already paid for and saved.
    await settle("scene", part);
  };

  // Let every part settle (and be checkpointed) before reporting a failure.
  const results = await Promise.allSettled([
    sheet("portrait"),
    sheet("image"),
    backdrop(),
  ]);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
  signal.throwIfAborted();
  return parts;
}
