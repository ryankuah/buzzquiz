"use client";

import { quizCopy } from "@/lib/quiz-copy";
import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  RotateCcw,
  Share2,
} from "lucide-react";
import { questionImage, answerImage } from "@/lib/quiz-illustrations";
import { scoreQuiz, type Quiz } from "@/lib/quiz";
import {
  AmbientDecorations,
  DecorationBursts,
  QuizArtwork,
  PlacedStickers,
  SpaceStickers,
  QuizTile,
  ThemeSurface,
  ResultScene,
  decorationIndices,
  type Burst,
} from "./quiz-visuals";
import {
  personalityReadingSchema,
  type PersonalityReading,
} from "@/lib/personality";

export default function QuizPlayer({
  quiz,
  onExit,
  onShareResult,
}: {
  quiz: Quiz;
  onExit: () => void;
  onShareResult?: (resultId: string) => void;
}) {
  const portrait = quiz.resultArtwork || quiz.artwork;
  if (portrait) preload(portrait.url, { as: "image" });
  const [step, setStep] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [advancing, setAdvancing] = useState(false);
  const [reading, setReading] = useState<PersonalityReading | null>(null);
  const [readingError, setReadingError] = useState("");
  const [readingAttempt, setReadingAttempt] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstId = useRef(0);
  const decorated = decorationIndices(quiz).length > 0;
  const heading = useRef<HTMLHeadingElement>(null);
  const question = quiz.questions[step];
  const layout = question?.layout || quiz.settings.layout;
  const result =
    step === quiz.questions.length ? scoreQuiz(quiz, selections) : null;

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  useEffect(() => {
    setReading(null);
    setReadingError("");
    if (!result) return;
    const controller = new AbortController();
    async function loadReading() {
      try {
        const response = await fetch("/api/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quiz, selections }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(55000),
          ]),
        });
        const data = await response.json();
        if (!response.ok) throw new Error("Personal reading unavailable.");
        const personal = personalityReadingSchema.parse(data.reading);
        if (personal.resultId !== result!.id)
          throw new Error("Reading didn't match the result");
        if (!controller.signal.aborted) setReading(personal);
      } catch (error) {
        if (!controller.signal.aborted)
          setReadingError(
            error instanceof Error
              ? error.message
              : "Personal reading unavailable.",
          );
      }
    }
    void loadReading();
    return () => controller.abort();
  }, [quiz, result, selections, readingAttempt]);

  // Stickers burst from the chosen answer (skipped for reduced motion).
  function burst(element: Element | null, count: number) {
    if (
      !decorated ||
      !element ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const rect = element.getBoundingClientRect();
    const id = ++burstId.current;
    setBursts((current) => [
      ...current,
      {
        id,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        count,
      },
    ]);
  }

  useEffect(() => {
    if (step === quiz.questions.length)
      burst(document.querySelector(".result-artwork"), 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function choose(answerId: string, figure?: Element | null) {
    if (advanceTimer.current) return;
    burst(figure ?? null, 7);
    setSelections((previous) => ({ ...previous, [question.id]: answerId }));
    setAdvancing(true);
    advanceTimer.current = setTimeout(() => {
      setStep((previous) => previous + 1);
      setAdvancing(false);
      advanceTimer.current = null;
    }, 220);
  }

  function restart() {
    setSelections({});
    setStep(0);
  }

  const hasStickers = decorationIndices(quiz).length > 0;
  return (
    <main className="player-shell page-enter" aria-label={quizCopy(quiz.title)}>
      <AmbientDecorations quiz={quiz} />
      <DecorationBursts
        quiz={quiz}
        bursts={bursts}
        onDone={(id) =>
          setBursts((current) => current.filter((item) => item.id !== id))
        }
      />
      <ThemeSurface quiz={quiz} className="quiz-player">
        {result ? (
          <div className="result-page scene-enter">
            <span className="quiz-kicker">YOU GOT…</span>
            <ResultScene quiz={quiz} result={result} />
            <div className="result-identity">
              <h1 ref={heading} tabIndex={-1}>
                {quizCopy(result.title)}
              </h1>
              {(reading?.headline || result.profile?.headline) && (
                <p className="result-headline">
                  {quizCopy(
                    reading?.headline || result.profile?.headline || "",
                  )}
                </p>
              )}
            </div>
            <section
              className="result-reading"
              aria-label="Your personality reading"
              aria-live="polite"
              aria-busy={!reading && !readingError}
            >
              <p className="result-description result-introduction">
                {quizCopy(result.description)}
              </p>
              {reading ? (
                <>
                  <div className="result-traits">
                    {reading.traits.map((trait) => (
                      <span key={quizCopy(trait)}>{quizCopy(trait)}</span>
                    ))}
                  </div>
                  {reading.paragraphs.map((paragraph, index) => (
                    <p className="result-description" key={index}>
                      {quizCopy(paragraph)}
                    </p>
                  ))}
                  <blockquote className="result-evidence">
                    <span className="evidence-choice">
                      “{quizCopy(reading.evidence.choice)}”
                    </span>
                    <p>{quizCopy(reading.evidence.note)}</p>
                  </blockquote>
                </>
              ) : readingError ? (
                <>
                  <div className="reading-error">
                    <span>{readingError}</span>
                    <button
                      onClick={() =>
                        setReadingAttempt((attempt) => attempt + 1)
                      }
                    >
                      Retry reading
                    </button>
                  </div>
                </>
              ) : (
                <span className="reading-status" role="status">
                  <LoaderCircle size={14} className="spin" /> Reading your
                  answers…
                </span>
              )}
            </section>
            <div
              className={`result-actions ${onShareResult ? "with-share" : ""}`}
            >
              {onShareResult && (
                <button
                  className="quiz-primary"
                  onClick={() => onShareResult(result.id)}
                >
                  <Share2 size={17} /> Share my result
                </button>
              )}
              <div className="result-links">
                <button
                  className={onShareResult ? "quiz-secondary" : "quiz-primary"}
                  onClick={onExit}
                >
                  Try another quiz <ArrowRight size={onShareResult ? 15 : 17} />
                </button>
                <button className="quiz-secondary" onClick={restart}>
                  <RotateCcw size={15} /> Retake quiz
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            key={question.id}
            className={`question-page scene-enter layout-${layout} answers-${question.answers.length}`}
          >
            <div className="question-progress">
              <span>
                QUESTION {step + 1} OF {quiz.questions.length}
              </span>
              <span className="progress-dots" aria-hidden="true">
                {quiz.questions.map((item, index) => (
                  <i
                    key={item.id}
                    className={index <= step ? "complete" : ""}
                  />
                ))}
              </span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Quiz progress"
              aria-valuemin={0}
              aria-valuemax={quiz.questions.length}
              aria-valuenow={step}
            >
              <div
                style={{ width: `${(step / quiz.questions.length) * 100}%` }}
              />
            </div>
            {layout === "hero-grid" && (
              <QuizArtwork {...questionImage(quiz, step)}>
                {hasStickers && (
                  <PlacedStickers
                    quiz={quiz}
                    spots={["hero-tl", "hero-br"]}
                    offset={step}
                  />
                )}
              </QuizArtwork>
            )}
            <h1 ref={heading} tabIndex={-1}>
              {quizCopy(question.text)}
            </h1>
            <div
              className="answer-options"
              role="group"
              aria-label={quizCopy(question.text)}
            >
              {question.answers.map((answer, index) => (
                <button
                  key={answer.id}
                  className={`answer-option ${selections[question.id] === answer.id ? "selected" : ""}`}
                  aria-pressed={selections[question.id] === answer.id}
                  disabled={advancing}
                  onClick={(event) =>
                    choose(
                      answer.id,
                      event.currentTarget.querySelector(".answer-figure"),
                    )
                  }
                >
                  <span className="answer-figure">
                    <QuizTile
                      {...answerImage(quiz, step, index)}
                      className="answer-art"
                    />
                    <span className="answer-check" aria-hidden="true">
                      {selections[question.id] === answer.id && (
                        <Check size={13} />
                      )}
                    </span>
                  </span>
                  <span className="answer-label">{quizCopy(answer.text)}</span>
                </button>
              ))}
            </div>
            {layout !== "hero-grid" && (
              <>
                <SpaceStickers quiz={quiz} band="top" offset={step} />
                <SpaceStickers quiz={quiz} band="bottom" offset={step} />
              </>
            )}
            <div className="question-bottom">
              {step > 0 ? (
                <button
                  className="quiz-secondary"
                  disabled={advancing}
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={14} /> Previous question
                </button>
              ) : (
                <span className="quiz-meta">
                  Pick the one that feels like you.
                </span>
              )}
            </div>
          </div>
        )}
      </ThemeSurface>
    </main>
  );
}
