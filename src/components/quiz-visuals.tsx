import { type CSSProperties } from "react";
import { getTheme, type ThemeId } from "@/lib/templates";
import { type QuizArtwork as GeneratedArtwork } from "@/lib/quiz";
import { type Quiz, type QuizResult } from "@/lib/quiz";

export function themeStyle(theme: ThemeId): CSSProperties {
  const palette = getTheme(theme);
  return {
    "--quiz-bg": palette.background,
    "--quiz-text": palette.foreground,
    "--quiz-accent": palette.accent,
  } as CSSProperties;
}

export function ThemeSurface({
  theme,
  className = "",
  children,
}: {
  theme: ThemeId;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`theme-surface ${className}`}
      data-theme={theme}
      style={themeStyle(theme)}
    >
      {children}
    </div>
  );
}

// Atlas positions are bound to the generated quiz order: each question owns
// a row (hero + up to four choices); unused cells stay empty on binary rows.
// The final row holds its four generated results.
export function QuizTile({
  artwork,
  index,
  emoji,
  className = "",
}: {
  artwork?: GeneratedArtwork;
  index: number;
  emoji: string;
  className?: string;
}) {
  if (!artwork)
    return (
      <span
        className={`quiz-tile legacy-emoji ${className}`}
        aria-hidden="true"
      >
        {emoji}
      </span>
    );
  const column = index % artwork.columns;
  const row = Math.floor(index / artwork.columns);
  return (
    <span
      className={`quiz-tile ${className}`}
      data-art-index={index}
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
          width: `${artwork.columns * 100}%`,
          height: `${artwork.rows * 100}%`,
          left: `${-column * 100}%`,
          top: `${-row * 100}%`,
        }}
      />
    </span>
  );
}

export function QuizArtwork({
  artwork,
  index,
  emoji,
  result = false,
}: {
  artwork?: GeneratedArtwork;
  index: number;
  emoji: string;
  result?: boolean;
}) {
  return (
    <div
      className={`quiz-artwork ${result ? "result-artwork" : "question-artwork"}`}
      aria-hidden="true"
    >
      <QuizTile
        artwork={artwork}
        index={index}
        emoji={emoji}
        className={result ? "result-tile" : "hero-tile"}
      />
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
    return (
      <QuizArtwork
        artwork={quiz.artwork}
        index={quiz.questions.length * 5 + index}
        emoji={result.emoji}
        result
      />
    );
  return (
    <div
      className="quiz-artwork result-artwork layered-result"
      aria-hidden="true"
    >
      {quiz.questionArtwork && quiz.backgroundIndex !== undefined && (
        <QuizTile
          artwork={quiz.questionArtwork}
          index={quiz.backgroundIndex}
          emoji=""
          className="result-background"
        />
      )}
      <QuizTile
        artwork={quiz.resultArtwork}
        index={index}
        emoji={result.emoji}
        className="result-tile result-foreground"
      />
    </div>
  );
}
