import type { Metadata } from "next";
import { headers } from "next/headers";
import QuizApp from "@/components/quiz-app";
import { findQuizById } from "@/lib/convex-repository";

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Shared links (/?quiz=…&got=…) preview as the quiz's own result card.
export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const { quiz: quizParam, got } = await searchParams;
  const id = typeof quizParam === "string" ? quizParam : undefined;
  if (!id || !uuid.test(id)) return {};
  const quiz = await findQuizById(id).catch(() => null);
  if (!quiz) return {};
  const result = quiz.results.find((item) => item.id === got);
  const host = (await headers()).get("host");
  const protocol = host?.startsWith("localhost") ? "http" : "https";
  const card = `/api/quizzes/${quiz.id}/card${result ? `?result=${encodeURIComponent(result.id)}` : ""}`;
  const title = result ? `I got ${result.title}! ${quiz.title}` : quiz.title;
  const description = result
    ? "Take the quiz and see what you get."
    : quiz.description;
  const image = { url: card, width: 1200, height: 630, alt: title };
  return {
    ...(host ? { metadataBase: new URL(`${protocol}://${host}`) } : {}),
    title: `${title} · buzzquiz`,
    description,
    openGraph: { title, description, images: [image], type: "website" },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function Home() {
  return <QuizApp />;
}
