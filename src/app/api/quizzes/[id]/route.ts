import { findQuizById } from "@/lib/convex-repository";
import { z } from "zod";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return Response.json({ error: "Invalid quiz link." }, { status: 400 });
  try {
    const quiz = await findQuizById(id);
    return quiz
      ? Response.json({ quiz })
      : Response.json(
          { error: "This quiz couldn't be found." },
          { status: 404 },
        );
  } catch {
    return Response.json(
      { error: "This quiz couldn't be loaded. Try again shortly." },
      { status: 503 },
    );
  }
}
