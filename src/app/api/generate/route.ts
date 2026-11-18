import { NextResponse } from "next/server";
import OpenAI from "openai";
import { checkOrigin } from "@/lib/request-origin";
import { generationInputSchema } from "@/lib/quiz";
import { resolveQuiz, QuizBusyError } from "@/lib/resolve-quiz";
import { getAiConfig } from "@/lib/ai-config";
import { meaningText } from "@/lib/topic-text";
import {
  GENERATION_PROGRESS_HEADER,
  GENERATION_PROGRESS_VERSION,
} from "@/lib/generation-response";

export const runtime = "nodejs";
export const maxDuration = 300;
const rateWindows = new Map<string, { count: number; until: number }>();

function generationError(error: unknown) {
  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name))
  )
    return "Generation took too long. Please try again.";
  if (error instanceof OpenAI.APIError) {
    if (error.status === 402)
      return "The AI provider account has insufficient credits. Check its billing before trying again.";
    if (error.status === 429)
      return "The AI provider is busy or its quota is used up. Try later or check your API billing.";
    if (error.status === 401)
      return "The server's API key wasn't accepted. Check the provider key in .env.local.";
    return "The AI service is unavailable. Please try again shortly.";
  }
  return error instanceof Error && !("issues" in error)
    ? error.message
    : "The AI returned an invalid quiz. Please try again.";
}

export async function POST(request: Request) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  const body = await request.text();
  if (body.length > 4000)
    return NextResponse.json(
      { error: "Keep your quiz idea a little shorter." },
      { status: 413 },
    );
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: "The quiz request wasn't valid JSON." },
      { status: 400 },
    );
  }
  const parsed = generationInputSchema.safeParse(value);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  if (!meaningText(parsed.data.subject) || !meaningText(parsed.data.basis)) {
    return NextResponse.json(
      { error: "Fill in both blanks to find out." },
      { status: 400 },
    );
  }
  const beforeGenerate = () => {
    if (!getAiConfig().configured)
      throw new Error(
        "Quiz generation isn't available right now. Please try again later.",
      );
    const now = Date.now();
    for (const [key, window] of rateWindows)
      if (window.until <= now) rateWindows.delete(key);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const window = rateWindows.get(ip) ?? { count: 0, until: now + 60000 };
    if (window.count >= 5)
      throw new QuizBusyError(
        "A few quizzes are already in the oven. Try again in a minute.",
      );
    window.count += 1;
    rateWindows.set(ip, window);
  };
  if (request.headers.get("Accept")?.includes("application/x-ndjson")) {
    // Unversioned clients include both the original spinner and the first
    // progress UI. Only complete/error events are understood by both.
    const detailedProgress =
      request.headers.get(GENERATION_PROGRESS_HEADER) ===
      GENERATION_PROGRESS_VERSION;
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          signal.throwIfAborted();
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          const { quiz, reused } = await resolveQuiz(parsed.data, {
            signal,
            beforeGenerate,
            onStage: detailedProgress
              ? (progress) => send({ type: "stage", ...progress })
              : undefined,
          });
          send({ type: "complete", quiz, reused });
        } catch (error) {
          if (!signal.aborted)
            send({ type: "error", error: generationError(error) });
        } finally {
          try {
            controller.close();
          } catch {
            /* The browser may have cancelled the stream. */
          }
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }
  try {
    return NextResponse.json(
      await resolveQuiz(parsed.data, {
        signal: request.signal,
        beforeGenerate,
      }),
    );
  } catch (error) {
    const status =
      error instanceof QuizBusyError
        ? 429
        : !getAiConfig().configured
          ? 503
          : 502;
    return NextResponse.json(
      { error: generationError(error) },
      {
        status,
        ...(status === 429 ? { headers: { "Retry-After": "60" } } : {}),
      },
    );
  }
}
