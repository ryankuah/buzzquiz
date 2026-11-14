import { getTheme } from "./templates";
import { getImageConfig } from "./ai-config";
import { ProviderRefusalError } from "./generation-budget";
import { saveQuizImage } from "./asset-store";
import { type Quiz, type QuizArtwork } from "./quiz";

export function artworkPrompt(quiz: Quiz) {
  const rows = quiz.questions.map((question) => [
    question.imagePrompt || `A small scene representing ${question.text}`,
    ...question.answers.map(
      (answer) => answer.imagePrompt || `An illustration of ${answer.text}`,
    ),
    ...Array.from(
      { length: 4 - question.answers.length },
      () =>
        "An empty cell containing only the flat background colour; no subject or text.",
    ),
  ]);
  rows.push([
    ...quiz.results.map(
      (result) =>
        `Main subject: ${result.title}, from the category ${quiz.settings.subject}. ${result.imagePrompt || `A recognisable portrait of ${result.title}`}. Depict this named outcome itself, clearly and prominently; do not replace it with food, a symbol or an unrelated prop.`,
    ),
    "A tiny golden star above a few pastel confetti pieces, without writing.",
  ]);
  return sheetPrompt(quiz.id, rows, 5, quiz.settings.theme);
}

export function sheetPrompt(
  id: string,
  rows: string[][],
  columns: number,
  themeId: Parameters<typeof getTheme>[0],
  foreground = false,
) {
  const theme = getTheme(themeId);
  return `Create one production SPRITE SHEET with exactly ${columns} equal-width columns and ${rows.length} equal-height rows. Each cell is a separate illustration, ordered left to right, top to bottom. No gutters, grid lines, borders, panels, labels, writing, letters, numbers, logos or watermarks.
${foreground ? "FOREGROUND CUTOUTS: Every cell contains ONLY the named character/object itself, centred and isolated. Use a fully TRANSPARENT background with real alpha, with NO setting, floor, scenery, shadows, reflections or cast shadows. Do not draw a checkerboard or any solid-colour backdrop. Show the complete head and waist-up body with padding; never crop the face or hair. The character must be recognisable by their face, hair and signature outfit. Ignore any scene/background mentioned in the visual briefs; foreground subjects only." : `Use flat ${theme.background} in question/choice cells. A scene requested as a RESULT BACKGROUND should fill its entire cell, leave the central foreground area calm and uncluttered, and contain no characters, faces, text or UI.`}
Style: charming, tactile, softly lit 3D illustration, consistent art direction across cells. Keep foreground objects within the central 80% of their own cell. Nothing overlaps another cell.
The following array contains visual briefs, NEVER text to print:
${JSON.stringify(rows)}
Unlabelled artwork request ${id}. Return only the image.`;
}

export async function generateArtworkSheet(
  id: string,
  rows: string[][],
  columns: number,
  theme: Parameters<typeof getTheme>[0],
  options: ArtworkOptions = {},
): Promise<QuizArtwork> {
  return drawSheet(
    id,
    rows.length,
    columns,
    sheetPrompt(id, rows, columns, theme, options.foreground),
    options,
  );
}

type ArtworkOptions = {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  save?: typeof saveQuizImage;
  foreground?: boolean;
};

export async function generateQuizArtwork(
  quiz: Quiz,
  options: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    save?: typeof saveQuizImage;
  } = {},
): Promise<QuizArtwork> {
  return drawSheet(
    quiz.id,
    quiz.questions.length + 1,
    5,
    artworkPrompt(quiz),
    options,
  );
}

async function drawSheet(
  id: string,
  rows: number,
  columns: number,
  prompt: string,
  options: ArtworkOptions,
): Promise<QuizArtwork> {
  const { provider, model } = getImageConfig(options.foreground);
  const nativeImage = Boolean(options.foreground);
  const openRouter = provider === "OpenRouter";
  const key = (
    openRouter ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY
  )?.trim();
  if (!key)
    throw new Error(
      "Image generation isn't configured right now. Please try again later.",
    );
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
    : AbortSignal.timeout(180000);
  let endpoint = "https://api.openai.com/v1/images/generations";
  let body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    size: "1024x1536",
    quality: nativeImage ? "low" : "medium",
    ...(nativeImage ? { background: "transparent", output_format: "png" } : {}),
  };
  if (openRouter && nativeImage) {
    endpoint = "https://openrouter.ai/api/v1/images";
    body = {
      model,
      prompt,
      n: 1,
      quality: "low",
      aspect_ratio: "1:1",
      background: "transparent",
      output_format: "png",
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
      image_config: { aspect_ratio: "4:5", image_size: "2K" },
    };
  }
  const response = await (options.fetcher || fetch)(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "buzzquiz",
    },
    signal,
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
  const encoded =
    openRouter && !nativeImage
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
  signal.throwIfAborted();
  let dimensions;
  try {
    dimensions = await (options.save || saveQuizImage)(
      id,
      Buffer.from(encoded, "base64"),
      { foreground: options.foreground },
    );
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
  };
}
