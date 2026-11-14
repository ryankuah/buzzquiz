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
import { themeStyle } from "./quiz-visuals";
import { readGenerationResponse } from "@/lib/generation-response";
import { getTheme } from "@/lib/templates";

function PromptField({
  id,
  label,
  value,
  maxLength,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current!;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${field.scrollHeight}px`;
    };
    resize();
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) {
        width = field.clientWidth;
        resize();
      }
    });
    let width = field.clientWidth;
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={ref}
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
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
    </>
  );
}

export default function QuizApp() {
  const [subject, setSubject] = useState(DEFAULT_QUIZ_SETTINGS.subject);
  const [basis, setBasis] = useState(DEFAULT_QUIZ_SETTINGS.basis);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"writing" | "drawing">("writing");
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareFallback, setShareFallback] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generating = useRef(false);

  const pageBackground = quiz
    ? getTheme(quiz.settings.theme).background
    : "#f8f7f2";
  const pageColorScheme =
    quiz && ["scent", "study"].includes(quiz.settings.theme) ? "dark" : "light";
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

  async function shareQuiz() {
    if (!quiz) return;
    const url = `${window.location.origin}/?quiz=${quiz.id}`;
    try {
      if (navigator.share)
        await navigator.share({
          title: quiz.title,
          text: "Take this quiz on buzzquiz",
          url,
        });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareMessage("Quiz link copied");
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
    setStage("writing");
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
      const generated = await readGenerationResponse(response, setStage);
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
    }
  }

  return (
    <div
      className={`app ${quiz ? "is-playing" : "is-home"}`}
      style={quiz ? themeStyle(quiz.settings.theme) : undefined}
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
            <button className="text-button exit-quiz" onClick={shareQuiz}>
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
        <QuizPlayer key={quiz.id} quiz={quiz} onExit={goHome} />
      ) : (
        <main className="home-page page-enter">
          <form className="quiz-prompt" onSubmit={generate} aria-busy={busy}>
            <fieldset disabled={busy}>
              <legend className="sr-only">Your quiz</legend>
              <h1 className="sentence-builder">
                <span className="sentence-line">
                  What{" "}
                  <PromptField
                    id="subject"
                    label="What are you?"
                    value={subject}
                    maxLength={100}
                    onChange={setSubject}
                  />
                </span>
                <span className="sentence-line sentence-middle">
                  are you based on
                </span>
                <span className="sentence-line">
                  <PromptField
                    id="basis"
                    label="Based on what?"
                    value={basis}
                    maxLength={150}
                    onChange={setBasis}
                  />
                  <span className="question-mark">?</span>
                </span>
              </h1>
            </fieldset>
            <button className="generate-button" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={19} className="spin" />
                  <span>
                    {stage === "drawing"
                      ? "Drawing your artwork…"
                      : "Making your quiz…"}
                  </span>
                </>
              ) : (
                <>
                  <span>Find out</span>
                  <ArrowRight size={20} />
                </>
              )}
            </button>
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
