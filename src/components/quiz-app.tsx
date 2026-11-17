"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Asterisk,
  LoaderCircle,
  Share2,
} from "lucide-react";
import {
  DEFAULT_QUIZ_SETTINGS,
  generationInputSchema,
  parseQuiz,
  type Quiz,
} from "@/lib/quiz";
import { readShareUrl } from "@/lib/library";
import QuizPlayer from "./quiz-player";
import { loadQuizTypeface, quizColours, themeStyle } from "./quiz-visuals";
import {
  generationSteps,
  readGenerationResponse,
  type GenerationSteps,
} from "@/lib/generation-response";
import GenerationProgress from "./generation-progress";
import {
  completion,
  rankSuggestions,
  type Suggestions,
} from "@/lib/suggestions";

type Blank = "subject" | "basis";

function PromptField({
  id,
  label,
  value,
  maxLength,
  completeTo = "",
  onChange,
  onFocus,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  /** A saved name the typed text starts; its rest shows faintly, and Tab or
   * → accepts it in its saved casing. */
  completeTo?: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  // The hidden copy of the value (see .prompt-field::after) sizes the field,
  // so the box and its underline hug the text and wrap only when needed. It
  // includes the ghost completion, which is drawn in the same cell.
  const ghost = completeTo.slice(value.length);
  return (
    <span className="prompt-field" data-value={value + ghost}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      {ghost && (
        <span className="prompt-ghost" aria-hidden="true">
          <span className="ghost-typed">{value}</span>
          {ghost}
        </span>
      )}
      <textarea
        id={id}
        name={id}
        rows={1}
        required
        minLength={2}
        maxLength={maxLength}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(event) => {
          const field = event.currentTarget;
          const atEnd =
            field.selectionStart === value.length &&
            field.selectionEnd === value.length;
          if (
            ghost &&
            atEnd &&
            ((event.key === "Tab" && !event.shiftKey) ||
              event.key === "ArrowRight")
          ) {
            event.preventDefault();
            onChange(completeTo);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
    </span>
  );
}

export default function QuizApp() {
  const [subject, setSubject] = useState(DEFAULT_QUIZ_SETTINGS.subject);
  const [basis, setBasis] = useState(DEFAULT_QUIZ_SETTINGS.basis);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenerationSteps | null>(null);
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareFallback, setShareFallback] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generating = useRef(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  // The blank the suggestions are for; it stays put while a suggestion is
  // being clicked, so the line doesn't flicker on blur.
  const [activeBlank, setActiveBlank] = useState<Blank>("subject");
  const [focusedBlank, setFocusedBlank] = useState<Blank | null>(null);
  const [canGhost, setCanGhost] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/suggestions", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Suggestions | null) => data && setSuggestions(data))
      .catch(() => {});
    // Inline completion needs a keyboard; touch screens use the list.
    setCanGhost(matchMedia("(hover: hover) and (pointer: fine)").matches);
    return () => controller.abort();
  }, []);

  function suggestionsFor(blank: Blank, limit: number) {
    if (!suggestions) return [];
    const own = blank === "subject" ? suggestions.subjects : suggestions.bases;
    const other =
      blank === "subject" ? suggestions.bases : suggestions.subjects;
    const otherValue = (blank === "subject" ? basis : subject)
      .trim()
      .toLowerCase();
    // Prefer ones already saved together with the other blank's answer.
    const otherIndex = other.findIndex(
      (item) => item.name.toLowerCase() === otherValue,
    );
    const favoured = new Set(
      suggestions.pairs
        .filter((pair) => pair[blank === "subject" ? 1 : 0] === otherIndex)
        .map((pair) => pair[blank === "subject" ? 0 : 1]),
    );
    return rankSuggestions(
      own,
      blank === "subject" ? subject : basis,
      favoured,
      limit,
    );
  }
  const ghostFor = (blank: Blank) =>
    canGhost && focusedBlank === blank
      ? completion(
          suggestionsFor(blank, 12),
          blank === "subject" ? subject : basis,
        )
      : "";
  const shelf = suggestionsFor(activeBlank, 4);

  function pickSuggestion(name: string) {
    if (activeBlank === "subject") {
      setSubject(name);
      document.getElementById("basis")?.focus();
    } else {
      setBasis(name);
      document.querySelector<HTMLButtonElement>(".generate-button")?.focus();
    }
  }

  const colours = quiz ? quizColours(quiz) : undefined;
  const pageBackground = colours?.background ?? "#f8f7f2";
  const pageColorScheme = colours?.dark ? "dark" : "light";
  useLayoutEffect(() => {
    // Safari paints its safe areas and overscroll from the document background,
    // rather than the narrower quiz panel. Keep both roots and browser tint in sync.
    const root = document.documentElement;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const schemeMeta = document.querySelector('meta[name="color-scheme"]');
    root.style.setProperty("--page-background", pageBackground);
    root.style.setProperty("--page-color-scheme", pageColorScheme);
    themeMeta?.setAttribute("content", pageBackground);
    schemeMeta?.setAttribute("content", pageColorScheme);
    return () => {
      root.style.removeProperty("--page-background");
      root.style.removeProperty("--page-color-scheme");
      themeMeta?.setAttribute("content", "#f8f7f2");
      schemeMeta?.setAttribute("content", "light");
    };
  }, [pageBackground, pageColorScheme]);

  useEffect(() => {
    let active = true;
    async function openSharedQuiz() {
      try {
        const id = new URLSearchParams(window.location.search).get("quiz");
        let shared: Quiz | null;
        if (id) {
          setBusy(true);
          const response = await fetch(
            `/api/quizzes/${encodeURIComponent(id)}`,
          );
          if (!response.ok) throw new Error("Quiz not found");
          shared = parseQuiz((await response.json()).quiz);
        } else shared = await readShareUrl(window.location.hash);
        if (active && shared) {
          await loadQuizTypeface(shared);
          setQuiz(shared);
          setError("");
        }
      } catch {
        if (active)
          setError(
            "This quiz link couldn't be opened. Generate a new one below.",
          );
      } finally {
        if (active) setBusy(false);
      }
    }
    void openSharedQuiz();
    window.addEventListener("hashchange", openSharedQuiz);
    return () => {
      active = false;
      controller.current?.abort();
      window.removeEventListener("hashchange", openSharedQuiz);
    };
  }, []);

  function goHome() {
    setQuiz(null);
    setError("");
    setShareMessage("");
    setShareFallback("");
    if (window.location.hash || window.location.search)
      window.history.replaceState(null, "", window.location.pathname);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // Result links still open the quiz unanswered; `got` only picks the
  // preview card that link previews show ("I got Belle").
  async function shareQuiz(resultId?: string) {
    if (!quiz) return;
    const result = quiz.results.find((item) => item.id === resultId);
    const url = `${window.location.origin}/?quiz=${quiz.id}${result ? `&got=${encodeURIComponent(result.id)}` : ""}`;
    const text = result
      ? `I got ${result.title}! ${quiz.title}`
      : "Take this quiz on buzzquiz";
    try {
      if (navigator.share) {
        // Phones can share the result card itself, with the link.
        let files: File[] = [];
        if (result) {
          const card = await fetch(
            `/api/quizzes/${quiz.id}/card?result=${encodeURIComponent(result.id)}`,
          ).catch(() => null);
          if (card?.ok) {
            const file = new File([await card.blob()], "buzzquiz-result.png", {
              type: "image/png",
            });
            if (navigator.canShare?.({ files: [file] })) files = [file];
          }
        }
        await navigator.share({
          title: quiz.title,
          text,
          url,
          ...(files.length ? { files } : {}),
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareMessage(result ? "Result link copied" : "Quiz link copied");
        setTimeout(() => setShareMessage(""), 3000);
      } else {
        setShareMessage("Copy this quiz link");
        setShareFallback(url);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setShareMessage("Copy this quiz link");
      setShareFallback(url);
    }
  }

  async function generate(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (generating.current) return;
    const checked = generationInputSchema.safeParse({
      ...DEFAULT_QUIZ_SETTINGS,
      subject,
      basis,
    });
    if (!checked.success) {
      setError("Fill in both blanks to find out.");
      return;
    }
    generating.current = true;
    setBusy(true);
    setProgress({ checking: "active" });
    setError("");
    const requestController = new AbortController();
    controller.current = requestController;
    const timeout = setTimeout(() => requestController.abort(), 295000);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(checked.data),
        signal: requestController.signal,
      });
      const generated = await readGenerationResponse(response, (update) => {
        setProgress((current) => ({
          ...current,
          [update.stage]: update.status,
        }));
      });
      // The final step includes loading the actual artwork and heading font.
      // This also covers non-streamed responses without inventing timed progress.
      setProgress(
        (current) =>
          Object.fromEntries(
            generationSteps.map(({ id }) => [
              id,
              id === "finishing"
                ? "active"
                : current?.[id] === "reused"
                  ? "reused"
                  : "complete",
            ]),
          ) as GenerationSteps,
      );
      const artworkUrls = [
        ...new Set(
          [
            generated.questionArtwork?.url,
            generated.resultArtwork?.url,
            generated.artwork?.url,
          ].filter((url): url is string => Boolean(url)),
        ),
      ];
      await Promise.all(
        artworkUrls.map(
          (url) =>
            new Promise<void>((resolve, reject) => {
              const image = new window.Image();
              const timeout = setTimeout(
                () =>
                  reject(
                    new Error(
                      "The quiz artwork couldn't be loaded. Please try again.",
                    ),
                  ),
                20000,
              );
              image.onload = () => {
                clearTimeout(timeout);
                resolve();
              };
              image.onerror = () => {
                clearTimeout(timeout);
                reject(
                  new Error(
                    "The quiz artwork couldn't be loaded. Please try again.",
                  ),
                );
              };
              image.src = url;
            }),
        ),
      );
      await loadQuizTypeface(generated);
      setQuiz(generated);
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (err) {
      if (
        !requestController.signal.aborted ||
        controller.current === requestController
      ) {
        setError(
          err instanceof Error && err.name === "AbortError"
            ? "That took too long. Your idea is still here — try again."
            : err instanceof Error
              ? err.message
              : "Couldn't connect. Please try again.",
        );
      }
    } finally {
      clearTimeout(timeout);
      generating.current = false;
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div
      className={`app ${quiz ? "is-playing" : "is-home"}`}
      style={quiz ? themeStyle(quiz) : undefined}
    >
      <header className="site-header">
        <a
          href="/"
          className="wordmark"
          aria-label="buzzquiz home"
          onClick={(event) => {
            event.preventDefault();
            if (!busy) goHome();
          }}
        >
          <span className="brand-icon">
            <Asterisk size={26} strokeWidth={2.6} />
          </span>
          buzzquiz<span className="brand-period">.</span>
        </a>
        {quiz && (
          <div className="quiz-header-actions">
            <button
              className="text-button exit-quiz"
              onClick={() => void shareQuiz()}
            >
              <Share2 size={14} /> Share
            </button>
            <button className="text-button exit-quiz" onClick={goHome}>
              <ArrowLeft size={14} /> New quiz
            </button>
          </div>
        )}
      </header>
      {shareMessage && (
        <div className="share-feedback" role="status">
          {shareMessage}
          {shareFallback && (
            <input
              aria-label="Quiz share link"
              readOnly
              value={shareFallback}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </div>
      )}
      {quiz ? (
        <QuizPlayer
          key={quiz.id}
          quiz={quiz}
          onExit={goHome}
          onShareResult={(resultId) => void shareQuiz(resultId)}
        />
      ) : (
        <main className="home-page page-enter">
          <form
            className={`quiz-prompt${progress ? " is-generating" : ""}`}
            onSubmit={generate}
          >
            <fieldset disabled={busy} aria-busy={busy}>
              <legend className="sr-only">Your quiz</legend>
              <h1 className="sentence-builder">
                <span className="sentence-line">What</span>
                <span className="sentence-line">
                  <PromptField
                    id="subject"
                    label="What are you?"
                    value={subject}
                    maxLength={60}
                    completeTo={ghostFor("subject")}
                    onChange={setSubject}
                    onFocus={() => {
                      setActiveBlank("subject");
                      setFocusedBlank("subject");
                    }}
                    onBlur={() => setFocusedBlank(null)}
                  />
                </span>
                <span className="sentence-line sentence-middle">
                  are you based on your favourite
                </span>
                <span className="sentence-line sentence-last">
                  <PromptField
                    id="basis"
                    label="Your favourite what?"
                    value={basis}
                    maxLength={60}
                    completeTo={ghostFor("basis")}
                    onChange={setBasis}
                    onFocus={() => {
                      setActiveBlank("basis");
                      setFocusedBlank("basis");
                    }}
                    onBlur={() => setFocusedBlank(null)}
                  />
                  <span className="question-mark">?</span>
                </span>
              </h1>
              {/* Existing topics, offered as an aside rather than a menu:
                  they already have artwork, so they're ready at once. */}
              <p className="suggestion-shelf" aria-live="polite">
                {shelf.length > 0 && (
                  <>
                    <span className="shelf-label" key={activeBlank}>
                      {activeBlank === "subject"
                        ? "Already on buzzquiz"
                        : "Favourites already drawn"}
                    </span>
                    {shelf.map((name, index) => (
                      <button
                        key={`${activeBlank}-${name}`}
                        type="button"
                        className="suggestion"
                        style={{ "--i": index } as React.CSSProperties}
                        // Keep the blank focused, so its ghost and place stay.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pickSuggestion(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </>
                )}
              </p>
            </fieldset>
            {progress ? (
              <GenerationProgress steps={progress} />
            ) : busy ? (
              <p className="opening-quiz" role="status">
                <LoaderCircle size={19} className="spin" aria-hidden="true" />
                Opening quiz…
              </p>
            ) : (
              <button className="generate-button" type="submit">
                <span>Find out</span>
                <ArrowRight size={20} />
              </button>
            )}
            <div className="home-message" aria-live="polite">
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
            </div>
          </form>
        </main>
      )}
    </div>
  );
}
