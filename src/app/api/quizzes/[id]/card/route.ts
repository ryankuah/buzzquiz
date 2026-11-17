import { findQuizById } from "@/lib/convex-repository";
import { renderShareCard } from "@/lib/share-card";
import { z } from "zod";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return new Response("Invalid quiz link.", { status: 400 });
  const resultId =
    new URL(request.url).searchParams.get("result")?.slice(0, 40) || undefined;
  try {
    const quiz = await findQuizById(id);
    if (!quiz) return new Response("Quiz not found.", { status: 404 });
    return await renderShareCard(quiz, resultId);
  } catch (error) {
    console.error("Share card failed", error);
    return new Response("The card couldn't be drawn.", { status: 503 });
  }
}
