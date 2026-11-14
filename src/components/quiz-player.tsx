"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { scoreQuiz, type Quiz } from "@/lib/quiz";
import {
  QuizArtwork,
  QuizTile,
  ThemeSurface,
  ResultScene,
} from "./quiz-visuals";
import {
  personalityReadingSchema,
  type PersonalityReading,
} from "@/lib/personality";

export default function QuizPlayer({
  quiz,
  onExit,
}: {
  quiz: Quiz;
  onExit: () => void;
}) {
  const [step, setStep] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [advancing, setAdvancing] = useState(false);
  const [reading, setReading] = useState<PersonalityReading | null>(null);
  const [readingError, setReadingError] = useState("");
  const [readingLimited, setReadingLimited] = useState(false);
  const [readingAttempt, setReadingAttempt] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setReadingLimited(false);
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
        if (!response.ok) {
          if (response.status === 429) {
            setReadingLimited(true);
            throw new Error(data.error);
          }
          throw new Error("Personal reading unavailable.");
        }
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

  function choose(answerId: string) {
    if (advanceTimer.current) return;
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

  return (
    <main className="player-shell page-enter" aria-label={quiz.title}>
      <ThemeSurface theme={quiz.settings.theme} className="quiz-player">
        {result ? (
          <div className="result-page scene-enter">
            <span className="quiz-kicker">YOU GOT…</span>
            <ResultScene quiz={quiz} result={result} />
            <div className="result-identity">
              <h1 ref={heading} tabIndex={-1}>
                {result.title}
              </h1>
              {(reading?.headline || result.profile?.headline) && (
                <p className="result-headline">
                  {reading?.headline || result.profile?.headline}
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
                {result.description}
              </p>
              {reading ? (
                <>
                  <div className="result-traits">
                    {reading.traits.map((trait) => (
                      <span key={trait}>{trait}</span>
                    ))}
                  </div>
                  {reading.paragraphs.map((paragraph, index) => (
                    <p className="result-description" key={index}>
                      {paragraph}
                    </p>
                  ))}
                  <blockquote className="result-evidence">
                    <span className="evidence-choice">
                      “{reading.evidence.choice}”
                    </span>
                    <p>{reading.evidence.note}</p>
                  </blockquote>
                </>
              ) : readingError ? (
                <>
                  <div className="reading-error">
                    <span>{readingError}</span>
                    {!readingLimited && (
                      <button
                        onClick={() =>
                          setReadingAttempt((attempt) => attempt + 1)
                        }
                      >
                        Retry reading
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <span className="reading-status" role="status">
                  <LoaderCircle size={14} className="spin" /> Reading your
                  answers…
                </span>
              )}
            </section>
            <div className="result-actions">
              <button className="quiz-primary" onClick={onExit}>
                Try another quiz <ArrowRight size={17} />
              </button>
              <button className="quiz-secondary" onClick={restart}>
                <RotateCcw size={15} /> Retake quiz
              </button>
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
              <QuizArtwork
                artwork={quiz.questionArtwork || quiz.artwork}
                index={step * 5}
                emoji={question.emoji}
              />
            )}
            <h1 ref={heading} tabIndex={-1}>
              {question.text}
            </h1>
            <div
              className="answer-options"
              role="group"
              aria-label={question.text}
            >
              {question.answers.map((answer, index) => (
                <button
                  key={answer.id}
                  className={`answer-option ${selections[question.id] === answer.id ? "selected" : ""}`}
                  aria-pressed={selections[question.id] === answer.id}
                  disabled={advancing}
                  onClick={() => choose(answer.id)}
                >
                  <QuizTile
                    artwork={quiz.questionArtwork || quiz.artwork}
                    index={step * 5 + index + 1}
                    emoji={answer.emoji}
                    className="answer-art"
                  />
                  <span className="answer-label">{answer.text}</span>
                  <span className="answer-check" aria-hidden="true">
                    {selections[question.id] === answer.id && (
                      <Check size={13} />
                    )}
                  </span>
                </button>
              ))}
            </div>
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
