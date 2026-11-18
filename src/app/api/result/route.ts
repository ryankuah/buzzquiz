import { NextResponse } from "next/server";
import { z } from "zod";
import { scoreQuiz } from "@/lib/quiz";
import { findQuizById } from "@/lib/convex-repository";
import { resolveReading } from "@/lib/resolve-reading";
import { checkOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const maxDuration = 60;
const inputSchema = z.object({
  quiz: z.object({ id: z.string().uuid() }),
  selections: z.record(z.string().max(40), z.string().max(40)),
});

export async function POST(request: Request) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  let input;
  try {
    const body = await request.text();
    if (body.length > 75000)
      return NextResponse.json(
        { error: "The quiz was too large." },
        { status: 413 },
      );
    input = inputSchema.parse(JSON.parse(body));
    if (!Object.keys(input.selections).length)
      throw new Error("Incomplete answers");
  } catch {
    return NextResponse.json(
      { error: "Finish every question to get your reading." },
      { status: 400 },
    );
  }
  try {
    // Always use the saved quiz. A caller cannot submit arbitrary AI instructions
    // or create readings for quizzes which have never been generated here.
    const quiz = await findQuizById(input.quiz.id);
    if (!quiz)
      return NextResponse.json(
        { error: "This saved quiz couldn't be found." },
        { status: 404 },
      );
    try {
      scoreQuiz(quiz, input.selections);
    } catch {
      return NextResponse.json(
        { error: "Finish every question to get your reading." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      reading: await resolveReading(quiz, input.selections),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Your personal reading couldn't be loaded. Your saved result is still available.",
      },
      { status: 502 },
    );
  }
}
