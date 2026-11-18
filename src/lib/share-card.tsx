import { quizCopy } from "@/lib/quiz-copy";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import {
  questionImage,
  resultImage,
  illustrationAtlas,
  awardCell,
} from "./quiz-illustrations";
import { readIllustration } from "./read-illustration";
import { readQuizImage } from "./asset-store";
import { type Quiz, type QuizArtwork, typefaces } from "./quiz";
import { quizColours } from "@/components/quiz-visuals";

export const CARD_SIZE = { width: 1200, height: 630 };

/** One atlas cell as a PNG data URL, trimmed like the app trims old sheets. */
export async function atlasCellDataUrl(
  artwork: QuizArtwork,
  index: number,
  read: (id: string) => Promise<Buffer | null> = readQuizImage,
  legacyInset = 0.065,
) {
  const bytes = await readIllustration(artwork.url, read);
  if (!bytes) return null;
  const { width, height } = await sharp(bytes).metadata();
  const cellWidth = width! / artwork.columns;
  const cellHeight = height! / artwork.rows;
  const inset = artwork.packed ? 0 : legacyInset;
  const left = Math.round(((index % artwork.columns) + inset) * cellWidth);
  const top = Math.round(
    (Math.floor(index / artwork.columns) + inset) * cellHeight,
  );
  const png = await sharp(bytes)
    .extract({
      left,
      top,
      width: Math.floor(cellWidth * (1 - 2 * inset)),
      height: Math.floor(cellHeight * (1 - 2 * inset)),
    })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

// Google Fonts serves TrueType to clients that don't ask for woff2, which is
// what the card renderer needs. Fonts are cached for the server's lifetime.
const fonts = new Map<string, Promise<ArrayBuffer | null>>();
function googleFont(family: string, weight: number) {
  const key = `${family}:${weight}`;
  if (!fonts.has(key))
    fonts.set(
      key,
      (async () => {
        const css = await fetch(
          `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
          { signal: AbortSignal.timeout(4000) },
        ).then((response) => (response.ok ? response.text() : ""));
        const url = css.match(
          /src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/,
        )?.[1];
        if (!url) return null;
        const font = await fetch(url, { signal: AbortSignal.timeout(4000) });
        return font.ok ? font.arrayBuffer() : null;
      })().catch(() => {
        fonts.delete(key);
        return null;
      }),
    );
  return fonts.get(key)!;
}

const titleSize = (text: string) =>
  text.length <= 12 ? 96 : text.length <= 20 ? 80 : text.length <= 30 ? 66 : 56;

/**
 * A 1200×630 card for link previews and sharing: the result portrait on the
 * quiz's own scene, in its palette and heading typeface. Without a result it
 * advertises the quiz itself.
 */
export async function renderShareCard(
  quiz: Quiz,
  resultId?: string,
  read?: (id: string) => Promise<Buffer | null>,
) {
  const colours = quizColours(quiz);
  const resultIndex = quiz.results.findIndex((item) => item.id === resultId);
  const result = resultIndex === -1 ? undefined : quiz.results[resultIndex];
  const typeface = quiz.style?.typeface && typefaces[quiz.style.typeface];
  const heading = typeface ?? { family: "Lexend", weight: 600 };

  const scene =
    quiz.questionArtwork && quiz.backgroundIndex !== undefined
      ? // Older scenes often end in a white strip, so trim them deeper.
        atlasCellDataUrl(quiz.questionArtwork, quiz.backgroundIndex, read, 0.1)
      : null;
  const hero = result ? resultImage(quiz, resultIndex) : questionImage(quiz, 0);
  const portrait =
    result || !scene ? atlasCellDataUrl(hero.artwork, hero.index, read) : null;
  const stickerIndices = quiz.questionArtwork
    ? Array.from(
        { length: Math.min(3, quiz.style?.decorations ?? 0) },
        (_, index) => quiz.backgroundIndex! + 1 + index,
      )
    : [];
  const [sceneUrl, portraitUrl, headingFont, bodyFont, ...stickers] =
    await Promise.all([
      scene?.catch(() => null),
      portrait?.catch(() => null),
      googleFont(heading.family, heading.weight),
      googleFont("Lexend", 400),
      ...stickerIndices.map((index) =>
        atlasCellDataUrl(quiz.questionArtwork!, index, read).catch(() => null),
      ),
    ]);

  const displayPortrait =
    portraitUrl ??
    (!sceneUrl || result
      ? await atlasCellDataUrl(
          illustrationAtlas,
          awardCell(Math.max(0, resultIndex)),
          read,
        )
      : null);
  const headline = quizCopy(result ? result.title : quiz.title);
  const muted = `${colours.foreground}b3`;
  const stickerSpots = [
    { right: 40, top: 34, size: 96, rotate: 12 },
    { right: 220, bottom: 26, size: 78, rotate: -14 },
    { right: 30, bottom: 120, size: 70, rotate: 8 },
  ];

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        background: colours.background,
        color: colours.foreground,
        fontFamily: "Body",
        padding: 64,
        gap: 60,
        position: "relative",
      }}
    >
      <div
        style={{
          width: 502,
          height: 502,
          flexShrink: 0,
          display: "flex",
          position: "relative",
          borderRadius: 28,
          overflow: "hidden",
          background: `${colours.accent}33`,
        }}
      >
        {sceneUrl && (
          <img
            src={sceneUrl}
            width={502}
            height={502}
            alt=""
            style={{ position: "absolute", inset: 0, objectFit: "cover" }}
          />
        )}
        {displayPortrait && (
          <img
            src={displayPortrait}
            width={sceneUrl ? 440 : 502}
            height={sceneUrl ? 440 : 502}
            alt=""
            style={{
              position: "absolute",
              // Packed cells keep 8% padding; sit the portrait on the edge.
              bottom: quiz.resultArtwork?.packed ? -35 : 0,
              left: sceneUrl ? 31 : 0,
            }}
          />
        )}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        {result && (
          <div
            style={{
              fontSize: 26,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: muted,
              marginBottom: 14,
            }}
          >
            I got
          </div>
        )}
        <div
          style={{
            fontFamily: "Heading",
            fontSize: result ? titleSize(headline) : 54,
            lineHeight: 1.08,
            letterSpacing: -1,
          }}
        >
          {headline}
        </div>
        {result && (
          <div
            style={{
              fontSize: 27,
              lineHeight: 1.35,
              marginTop: 26,
              color: muted,
              maxWidth: 520,
            }}
          >
            {quizCopy(quiz.title)}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 40,
            fontSize: 28,
            fontFamily: "Heading",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: colours.accent,
              marginRight: 12,
            }}
          />
          {result ? "buzzquiz" : "Take it on buzzquiz"}
        </div>
      </div>
      {stickers.map((sticker, index) => {
        if (!sticker) return null;
        const { size, rotate, ...position } = stickerSpots[index];
        return (
          <img
            key={index}
            src={sticker}
            alt=""
            width={size}
            height={size}
            style={{
              position: "absolute",
              ...position,
              transform: `rotate(${rotate}deg)`,
            }}
          />
        );
      })}
    </div>,
    {
      ...CARD_SIZE,
      fonts: [
        ...(headingFont
          ? [
              {
                name: "Heading",
                data: headingFont,
                weight: heading.weight as 400,
                style: "normal" as const,
              },
            ]
          : []),
        ...(bodyFont
          ? [
              {
                name: "Body",
                data: bodyFont,
                weight: 400 as const,
                style: "normal" as const,
              },
            ]
          : []),
      ],
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    },
  );
}
