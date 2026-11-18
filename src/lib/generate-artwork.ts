import sharp from "sharp";
import { getTheme } from "./templates";
import { getImageConfig } from "./ai-config";
import { ProviderRefusalError } from "./generation-budget";
import { removeForegroundMatte, saveQuizImage } from "./asset-store";
import { composeAtlas, packAtlas } from "./atlas-pack";
import { type Quiz, type QuizArtwork } from "./quiz";

// Legacy single-sheet artwork for a whole quiz (kept for older quiz links).
export function artworkPrompt(quiz: Quiz) {
  const rows: SheetCell[][] = quiz.questions.map((question) => [
    question.imagePrompt || `A small scene representing ${question.text}`,
    ...question.answers.map(
      (answer) => answer.imagePrompt || `An illustration of ${answer.text}`,
    ),
    ...Array.from({ length: 4 - question.answers.length }, () => EMPTY_CELL),
  ]);
  rows.push([
    ...quiz.results.map(
      (result) =>
        `Main subject: ${result.title}, from the category ${quiz.settings.subject}. ${result.imagePrompt || `A recognisable portrait of ${result.title}`}. Depict this named outcome itself, clearly and prominently; do not replace it with a symbol or an unrelated prop.`,
    ),
    "A tiny golden star above a few pastel confetti pieces, without writing.",
  ]);
  return sheetPrompt(quiz.id, rows, 5, quiz.settings.theme);
}

export const EMPTY_CELL = null;
export type SheetCell = string | typeof EMPTY_CELL;

export function sheetPrompt(
  id: string,
  rows: SheetCell[][],
  columns: number,
  themeId: Parameters<typeof getTheme>[0],
  kind: "opaque" | "objects" | "portraits" | "cutouts" = "opaque",
) {
  const theme = getTheme(themeId);
  const briefs = rows.map((row) =>
    row.map(
      (cell) =>
        cell ??
        (kind === "opaque"
          ? "An empty cell containing only the flat background colour; no subject or text."
          : "EMPTY: leave this cell completely transparent."),
    ),
  );
  const direction = {
    opaque: `Use flat ${theme.background} in question/choice cells. A scene requested as a RESULT BACKGROUND should fill its entire cell, leave the central foreground area calm and uncluttered, and contain no characters, faces, text or UI.`,
    objects:
      "TRANSPARENT CUTOUTS: Every cell contains ONLY the described object or small group of objects, centred and isolated, on a fully TRANSPARENT background with real alpha. Nothing underneath or behind the objects: no table, tabletop, board, slab, surface, floor, backdrop, scenery, frame, vignette, cast shadow or reflection. A plate, napkin or dish only when the brief names one. Do not draw a checkerboard or any solid-colour backdrop. Ignore any setting mentioned in a brief; draw only its objects. Leave clear empty space around every object so nothing touches the cell edges or another cell's art.",
    portraits:
      "FOREGROUND CUTOUTS: Every cell contains ONLY the named subject itself, centred and isolated. Use a fully TRANSPARENT background with real alpha, with NO setting, floor, scenery, shadows, reflections or cast shadows. Do not draw a checkerboard or any solid-colour backdrop. A character is shown complete and uncropped with padding, recognisable by its own signature features (a person by face, hair and outfit; a creature, robot or object-like character by its own shape and markings); never invent human anatomy for it. An object, food, animal or place is shown as the thing itself, complete and uncropped. Ignore any scene/background mentioned in the visual briefs; foreground subjects only.",
    cutouts:
      "TRANSPARENT CUTOUTS: Every cell contains ONLY its described subject, centred and isolated, on a fully TRANSPARENT background with real alpha. Nothing behind it: no table, surface, floor, scenery, frame, vignette, cast shadow or reflection, and no checkerboard or solid-colour backdrop. A character is shown complete and uncropped, recognisable by its own signature features (a person by face, hair and outfit; a creature, robot or object-like character by its own shape and markings); never invent human anatomy for it. An object, food, animal or place is shown as the thing itself, complete and uncropped. Leave clear empty space around every subject so nothing touches the cell edges or another cell's art.",
  }[kind];
  return `Create one production SPRITE SHEET with exactly ${columns} equal-width columns and ${rows.length} equal-height rows. Each cell is a separate illustration, ordered left to right, top to bottom. No gutters, grid lines, borders, panels, labels, writing, letters, numbers, logos or watermarks.
${direction}
Style: charming, tactile, softly lit 3D illustration, consistent art direction and lighting across cells. Depict reactions through original illustrations of gestures or objects. Never draw emoji glyphs or emoji-style icons. Keep each subject within the central 75% of its own cell. Nothing overlaps another cell.
The following array contains visual briefs, NEVER text to print:
${JSON.stringify(briefs)}
Unlabelled artwork request ${id}. Return only the image.`;
}

type ArtworkOptions = {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  save?: typeof saveQuizImage;
};

// Packed atlases use exact square cells, so tiles never show their neighbours.
export const ATLAS_CELL = 512;

/**
 * Draws transparent cutouts on one sprite sheet, then repacks every object
 * into an exact, padded grid. An optional background scene is drawn as its
 * own opaque image (so there is no grid to crop) and stored at the start of
 * an extra final row.
 */
export async function generateArtworkSheet(
  id: string,
  rows: SheetCell[][],
  columns: number,
  theme: Parameters<typeof getTheme>[0],
  options: ArtworkOptions & {
    /** Character portraits rather than objects. */
    foreground?: boolean;
    /** Reusable inventories cannot promise sprites the model left blank. */
    requireAllCells?: boolean;
    /** A full scene for the result page, stored at the start of `row`. */
    background?: { prompt: string; row: number };
  } = {},
): Promise<QuizArtwork> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
    : AbortSignal.timeout(180000);
  const request = { fetcher: options.fetcher, signal };
  const [sheet, scene] = await Promise.all([
    requestImage(
      sheetPrompt(
        id,
        rows,
        columns,
        theme,
        options.foreground ? "portraits" : "objects",
      ),
      {
        transparent: true,
        quality: options.foreground ? "low" : "medium",
        ratio: columns / rows.length,
      },
      request,
    ),
    options.background
      ? requestImage(
          `Create one square illustration: ${options.background.prompt}
It fills the whole frame edge to edge as one complete atmospheric scene in a charming, tactile, softly lit 3D style, with a calm, uncluttered centre where a character will be placed. No people, characters, faces, text, letters, numbers, logos, borders or frames.
Unlabelled artwork request ${id}. Return only the image.`,
          { transparent: false, quality: "medium", ratio: 1 },
          request,
        )
      : undefined,
  ]);
  signal.throwIfAborted();
  const totalRows = Math.max(
    rows.length,
    scene && options.background ? options.background.row + 1 : 0,
  );
  let atlas: Buffer;
  try {
    // Native transparency has nothing to remove; older magenta mattes do.
    const cutouts = options.foreground
      ? await removeForegroundMatte(sheet.bytes).catch(() => sheet.bytes)
      : sheet.bytes;
    const packed = await packAtlas(
      cutouts,
      {
        rows: rows.length,
        columns,
        occupied: (row, column) => rows[row]?.[column] != null,
      },
      { cell: ATLAS_CELL },
    );
    if (options.requireAllCells && packed.empty.length)
      throw new Error("The image provider left required sprites empty.");
    const layers = [...packed.layers];
    if (scene)
      layers.push({
        input: await sharp(scene.bytes)
          .resize(ATLAS_CELL, ATLAS_CELL, { fit: "cover" })
          .png()
          .toBuffer(),
        left: 0,
        top: options.background!.row * ATLAS_CELL,
      });
    atlas = await composeAtlas(packed.width, totalRows * ATLAS_CELL, layers);
  } catch {
    throw new Error(
      "The image provider didn't return usable artwork. Please try again.",
    );
  }
  let dimensions;
  try {
    dimensions = await (options.save || saveQuizImage)(id, atlas, {
      packed: true,
    });
  } catch {
    throw new Error("Couldn't save the generated artwork. Please try again.");
  }
  return {
    url: `/api/quiz-assets/${id}`,
    columns,
    rows: totalRows,
    ...dimensions,
    model: [sheet.model, scene?.model].filter(Boolean).join(" + "),
    generatedAt: new Date().toISOString(),
    packed: true,
  };
}

export async function generateQuizArtwork(
  quiz: Quiz,
  options: ArtworkOptions = {},
): Promise<QuizArtwork> {
  const { provider, model } = getImageConfig();
  const openRouter = provider === "OpenRouter";
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
    : AbortSignal.timeout(180000);
  const prompt = artworkPrompt(quiz);
  const bytes = await fetchImage(
    openRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/images/generations",
    providerKey(openRouter),
    openRouter
      ? {
          model,
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
          provider: { allow_fallbacks: false },
          max_tokens: 8192,
          image_config: { aspect_ratio: "4:5", image_size: "2K" },
        }
      : { model, prompt, n: 1, size: "1024x1536", quality: "medium" },
    openRouter,
    { fetcher: options.fetcher, signal },
  );
  let dimensions;
  try {
    dimensions = await (options.save || saveQuizImage)(quiz.id, bytes);
  } catch {
    throw new Error("Couldn't save the generated artwork. Please try again.");
  }
  return {
    url: `/api/quiz-assets/${quiz.id}`,
    columns: 5,
    rows: quiz.questions.length + 1,
    ...dimensions,
    model,
    generatedAt: new Date().toISOString(),
  };
}

function providerKey(openRouter: boolean) {
  const key = (
    openRouter ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY
  )?.trim();
  if (!key)
    throw new Error(
      "Image generation isn't configured right now. Please try again later.",
    );
  return key;
}

// Shapes each endpoint accepts; the closest to the sheet's shape is used.
const NATIVE_RATIOS = ["1:1", "2:3", "3:4", "9:16", "3:2", "4:3", "16:9"];
const OPENAI_SIZES = ["1024x1024", "1024x1536", "1536x1024"];
function closest(options: string[], ratio: number, separator: string) {
  const distance = (option: string) => {
    const [width, height] = option.split(separator).map(Number);
    return Math.abs(Math.log(width / height / ratio));
  };
  return options.reduce((best, option) =>
    distance(option) < distance(best) ? option : best,
  );
}

export async function requestImage(
  prompt: string,
  spec: { transparent: boolean; quality: "low" | "medium"; ratio: number },
  options: { fetcher?: typeof fetch; signal: AbortSignal },
) {
  // Transparency needs a native image endpoint; scenes use the sheet model.
  const { provider, model } = getImageConfig(spec.transparent);
  const openRouter = provider === "OpenRouter";
  const key = providerKey(openRouter);
  const transparency = spec.transparent
    ? { background: "transparent", output_format: "png" }
    : {};
  let endpoint = "https://api.openai.com/v1/images/generations";
  let body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    size: closest(OPENAI_SIZES, spec.ratio, "x"),
    quality: spec.quality,
    ...transparency,
  };
  if (openRouter && spec.transparent) {
    endpoint = "https://openrouter.ai/api/v1/images";
    body = {
      model,
      prompt,
      n: 1,
      quality: spec.quality,
      aspect_ratio: closest(NATIVE_RATIOS, spec.ratio, ":"),
      ...transparency,
      provider: { allow_fallbacks: false },
    };
  } else if (openRouter) {
    endpoint = "https://openrouter.ai/api/v1/chat/completions";
    body = {
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
      provider: { allow_fallbacks: false },
      max_tokens: 8192,
      image_config: { aspect_ratio: "1:1", image_size: "1K" },
    };
  }
  const chat = openRouter && !spec.transparent;
  return { bytes: await fetchImage(endpoint, key, body, chat, options), model };
}

async function fetchImage(
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
  chat: boolean,
  options: { fetcher?: typeof fetch; signal: AbortSignal },
) {
  const response = await (options.fetcher || fetch)(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "buzzquiz",
    },
    signal: options.signal,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    if (
      typeof errorBody.error?.message === "string" &&
      /safety|content_filter|content policy/i.test(errorBody.error.message)
    )
      throw new ProviderRefusalError();
    if (response.status === 402)
      throw new Error(
        "The image provider account needs more credits before your quiz artwork can be drawn.",
      );
    if (response.status === 429)
      throw new Error(
        "The image provider is busy. Please try your quiz again in a minute.",
      );
    throw new Error(
      "Couldn't draw the artwork for this quiz. Please try again.",
    );
  }
  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
    choices?: Array<{
      finish_reason?: string;
      message?: { images?: Array<{ image_url?: { url?: string } }> };
    }>;
  };
  if (data.choices?.[0]?.finish_reason === "content_filter")
    throw new ProviderRefusalError();
  const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const encoded = chat
    ? imageUrl?.match(
        /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/,
      )?.[1]
    : data.data?.[0]?.b64_json;
  if (
    !encoded ||
    encoded.length > 24000000 ||
    !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)
  )
    throw new Error(
      "The image provider didn't return usable artwork. Please try again.",
    );
  options.signal.throwIfAborted();
  return Buffer.from(encoded, "base64");
}
