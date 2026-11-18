import { resultImage } from "@/lib/quiz-illustrations";
import { type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getTheme } from "@/lib/templates";
import { type QuizArtwork as GeneratedArtwork, typefaces } from "@/lib/quiz";
import { type Quiz, type QuizResult } from "@/lib/quiz";

/** The quiz's own colours, or its preset theme for older quizzes. */
export function quizColours(quiz: Quiz) {
  const palette = quiz.style?.palette;
  if (palette) return palette;
  const preset = getTheme(quiz.settings.theme);
  return {
    background: preset.background,
    foreground: preset.foreground,
    accent: preset.accent,
    dark: preset.id === "scent" || preset.id === "study",
  };
}

export function themeStyle(quiz: Quiz): CSSProperties {
  const colours = quizColours(quiz);
  const typeface = quiz.style?.typeface && typefaces[quiz.style.typeface];
  return {
    "--quiz-bg": colours.background,
    "--quiz-text": colours.foreground,
    "--quiz-accent": colours.accent,
    ...(typeface
      ? {
          "--quiz-heading": `"${typeface.family}", var(--sans)`,
          "--quiz-heading-weight": typeface.weight,
        }
      : {}),
  } as CSSProperties;
}

/**
 * Loads only the quiz's heading typeface from Google Fonts. Resolves once it
 * is ready, or after a short wait so a slow font never blocks the quiz.
 */
export function loadQuizTypeface(quiz: Quiz, timeout = 1500) {
  const id = quiz.style?.typeface;
  if (!id || typeof document === "undefined") return Promise.resolve();
  const { family, weight } = typefaces[id];
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  if (!document.querySelector(`link[data-quiz-typeface="${id}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.quizTypeface = id;
    document.head.appendChild(link);
  }
  return Promise.race([
    new Promise<void>((resolve) => {
      const link = document.querySelector<HTMLLinkElement>(
        `link[data-quiz-typeface="${id}"]`,
      )!;
      const load = () =>
        document.fonts.load(`${weight} 1em "${family}"`).then(
          () => resolve(),
          () => resolve(),
        );
      if (link.sheet) void load();
      else link.addEventListener("load", () => void load(), { once: true });
      link.addEventListener("error", () => resolve(), { once: true });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, timeout)),
  ]);
}

export function ThemeSurface({
  quiz,
  className = "",
  children,
}: {
  quiz: Quiz;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`theme-surface ${quiz.style?.typeface ? "has-typeface" : ""} ${className}`}
      data-theme={quiz.style?.palette ? "custom" : quiz.settings.theme}
      style={themeStyle(quiz)}
    >
      {children}
    </div>
  );
}

/** Atlas indices of the quiz's decorative cutouts, if it has any. */
export function decorationIndices(quiz: Quiz) {
  const count = quiz.style?.decorations ?? 0;
  if (!count || !quiz.questionArtwork || quiz.backgroundIndex === undefined)
    return [];
  return Array.from(
    { length: count },
    (_, index) => quiz.backgroundIndex! + 1 + index,
  );
}

// Spots in the empty side margins: `across` is the share of the margin
// between the screen edge and the quiz, so they never overlap it.
const AMBIENT_SPOTS = [
  { side: "left", across: 0.3, y: 18, size: 92, turn: -12 },
  { side: "left", across: 0.62, y: 52, size: 70, turn: 9 },
  { side: "left", across: 0.28, y: 80, size: 84, turn: 14 },
  { side: "right", across: 0.32, y: 22, size: 78, turn: 11 },
  { side: "right", across: 0.6, y: 58, size: 96, turn: -8 },
  { side: "right", across: 0.27, y: 84, size: 68, turn: -15 },
] as const;

// The player animates in with a transform, which would make fixed layers
// position against the quiz column rather than the viewport.
const toBody = (layer: ReactNode) =>
  typeof document === "undefined" ? null : createPortal(layer, document.body);

/** Stickers drifting in the page margins, shown only where there is room. */
export function AmbientDecorations({ quiz }: { quiz: Quiz }) {
  const indices = decorationIndices(quiz);
  if (!indices.length) return null;
  return toBody(
    <div className="ambient-decor" aria-hidden="true">
      {AMBIENT_SPOTS.map((spot, index) => (
        <span
          key={index}
          className={`ambient-sticker ${spot.side}`}
          style={
            {
              top: `${spot.y}%`,
              "--across": spot.across,
              "--size": `${spot.size}px`,
              "--turn": `${spot.turn}deg`,
              "--delay": `${index * -1.3}s`,
            } as CSSProperties
          }
        >
          <QuizTile
            artwork={quiz.questionArtwork}
            index={indices[index % indices.length]}
          />
        </span>
      ))}
    </div>,
  );
}

/**
 * A few of the quiz's stickers stuck onto the quiz itself, at named spots
 * (corners of the hero picture, the bottom row, the result picture). Each
 * `offset` shows a different pair, so questions don't repeat the same ones.
 */
export function PlacedStickers({
  quiz,
  spots,
  offset = 0,
}: {
  quiz: Quiz;
  spots: string[];
  offset?: number;
}) {
  const indices = decorationIndices(quiz);
  if (!indices.length) return null;
  return spots.map((spot, index) => (
    <span
      key={spot}
      className={`placed-sticker ${spot}`}
      aria-hidden="true"
      style={{ "--delay": `${0.15 + index * 0.12}s` } as CSSProperties}
    >
      <QuizTile
        artwork={quiz.questionArtwork}
        index={indices[(offset + index * 2) % indices.length]}
      />
    </span>
  ));
}

// Loose clusters for the spare bands above and below a question without a
// hero picture. x/y are positions in the band; s scales with its height.
const SPACE_SPOTS = {
  top: [
    { x: 14, y: 58, s: 0.9, turn: -14 },
    { x: 48, y: 30, s: 0.55, turn: 8 },
    { x: 84, y: 54, s: 1, turn: 12 },
  ],
  bottom: [
    { x: 17, y: 44, s: 1, turn: 10 },
    { x: 54, y: 68, s: 0.55, turn: -8 },
    { x: 86, y: 40, s: 0.8, turn: -13 },
  ],
} as const;

/**
 * Stickers filling a spare band of the question page. CSS shows them only on
 * narrow screens, sizes them to the band, and hides them when it is tight.
 */
export function SpaceStickers({
  quiz,
  band,
  offset = 0,
}: {
  quiz: Quiz;
  band: keyof typeof SPACE_SPOTS;
  offset?: number;
}) {
  const indices = decorationIndices(quiz);
  if (!indices.length) return null;
  const start = band === "top" ? 0 : SPACE_SPOTS.top.length;
  return (
    <div className={`space-decor ${band}`} aria-hidden="true">
      {SPACE_SPOTS[band].map((spot, index) => (
        <span
          key={index}
          className="space-sticker"
          style={
            {
              "--x": `${spot.x}%`,
              "--y": `${spot.y}%`,
              "--s": spot.s,
              "--turn": `${spot.turn}deg`,
              "--delay": `${0.12 + (start + index) * 0.07}s`,
              "--float": `${(start + index) * -1.7}s`,
            } as CSSProperties
          }
        >
          <QuizTile
            artwork={quiz.questionArtwork}
            index={indices[(offset + start + index) % indices.length]}
          />
        </span>
      ))}
    </div>
  );
}

export type Burst = { id: number; x: number; y: number; count: number };

/** A small shower of the quiz's stickers, e.g. when an answer is chosen. */
export function DecorationBursts({
  quiz,
  bursts,
  onDone,
}: {
  quiz: Quiz;
  bursts: Burst[];
  onDone: (id: number) => void;
}) {
  const indices = decorationIndices(quiz);
  if (!indices.length) return null;
  return toBody(
    <div className="decor-bursts" aria-hidden="true">
      {bursts.map((burst) =>
        Array.from({ length: burst.count }, (_, index) => {
          // Deterministic spread per burst, so re-renders don't jump.
          const seed = (burst.id * 97 + index * 31) % 360;
          const angle =
            ((index / burst.count) * 360 + seed / 6 - 90) * (Math.PI / 180);
          const distance = 70 + ((seed * 7) % 70);
          return (
            <span
              key={`${burst.id}-${index}`}
              className="burst-sticker"
              onAnimationEnd={index === 0 ? () => onDone(burst.id) : undefined}
              style={
                {
                  left: burst.x,
                  top: burst.y,
                  "--dx": `${Math.cos(angle) * distance}px`,
                  "--dy": `${Math.sin(angle) * distance}px`,
                  "--spin": `${(seed % 90) - 45}deg`,
                  "--size": `${34 + (seed % 22)}px`,
                } as CSSProperties
              }
            >
              <QuizTile
                artwork={quiz.questionArtwork}
                index={indices[(index + burst.id) % indices.length]}
              />
            </span>
          );
        }),
      )}
    </div>,
  );
}

// Atlas positions are bound to the generated quiz order: each question owns
// a row (hero + up to four choices); unused cells stay empty on binary rows.
// The final row holds its four generated results.
export function QuizTile({
  artwork,
  index,
  className = "",
}: {
  artwork?: GeneratedArtwork;
  index: number;
  className?: string;
}) {
  if (!artwork) return null;
  const column = index % artwork.columns;
  const row = Math.floor(index / artwork.columns);
  // Older sheets were cropped on a nominal grid the model never drew exactly,
  // so trim each cell's edges to hide slivers of its neighbours. Packed
  // atlases have exact cells with transparent padding and need no trim.
  const inset = artwork.packed ? 0 : 0.065;
  const visible = 1 - 2 * inset;
  return (
    <span
      className={`quiz-tile ${className}`}
      data-art-index={index}
      data-packed={artwork.packed ? "" : undefined}
      aria-hidden="true"
      style={{
        aspectRatio: `${artwork.width * artwork.rows} / ${artwork.height * artwork.columns}`,
      }}
    >
      <img
        src={artwork.url}
        alt=""
        draggable={false}
        className="atlas-image"
        loading="eager"
        style={{
          width: `${(artwork.columns / visible) * 100}%`,
          height: `${(artwork.rows / visible) * 100}%`,
          left: `${(-(column + inset) / visible) * 100}%`,
          top: `${(-(row + inset) / visible) * 100}%`,
        }}
      />
    </span>
  );
}

export function QuizArtwork({
  artwork,
  index,
  result = false,
  children,
}: {
  artwork?: GeneratedArtwork;
  index: number;
  result?: boolean;
  /** Stickers placed around the picture, inside a frame sized to it. */
  children?: ReactNode;
}) {
  const tile = (
    <QuizTile
      artwork={artwork}
      index={index}
      className={result ? "result-tile" : "hero-tile"}
    />
  );
  return (
    <div
      className={`quiz-artwork ${result ? "result-artwork" : "question-artwork"}`}
      aria-hidden="true"
    >
      {children ? (
        <span className="art-frame">
          {tile}
          {children}
        </span>
      ) : (
        tile
      )}
    </div>
  );
}

export function ResultScene({
  quiz,
  result,
}: {
  quiz: Quiz;
  result: QuizResult;
}) {
  const index = quiz.results.findIndex((item) => item.id === result.id);
  if (!quiz.resultArtwork)
    return <QuizArtwork {...resultImage(quiz, index)} result />;
  return (
    <div
      className="quiz-artwork result-artwork layered-result"
      aria-hidden="true"
    >
      {quiz.questionArtwork && quiz.backgroundIndex !== undefined && (
        <QuizTile
          artwork={quiz.questionArtwork}
          index={quiz.backgroundIndex}
          className="result-background"
        />
      )}
      <QuizTile
        {...resultImage(quiz, index)}
        className="result-tile result-foreground"
      />
      <PlacedStickers quiz={quiz} spots={["result-tl", "result-tr"]} />
    </div>
  );
}
