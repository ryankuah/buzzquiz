import { type Page } from "@playwright/test";
import { type Quiz } from "../../src/lib/quiz";

// A deterministic test-only atlas. Product requests always use the image API.
export function illustratedQuiz(quiz: Quiz): Quiz {
  return {
    ...quiz,
    artwork: {
      url: `/api/quiz-assets/${quiz.id}`,
      columns: 5,
      rows: quiz.questions.length + 1,
      width: 500,
      height: (quiz.questions.length + 1) * 100,
      model: "test-image-model",
      generatedAt: new Date().toISOString(),
    },
  };
}
export async function mockArtwork(page: Page) {
  await page.route("**/api/quiz-assets/*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="#cceaf8"/>' +
        Array.from(
          { length: 30 },
          (_, i) =>
            `<circle cx="${(i % 5) * 100 + 50}" cy="${Math.floor(i / 5) * 100 + 50}" r="28" fill="hsl(${i * 12} 65% 70%)"/>`,
        ).join("") +
        "</svg>",
    }),
  );
}

export async function mockPersonalityReading(page: Page) {
  await page.route("**/api/result", async (route) => {
    const { quiz, selections } = route.request().postDataJSON();
    const { scoreQuiz } = await import("../../src/lib/quiz");
    const result = scoreQuiz(quiz, selections);
    const question = quiz.questions[0];
    const answer = question.answers.find(
      (item: { id: string }) => item.id === selections[question.id],
    );
    return route.fulfill({
      json: {
        reading: {
          resultId: result.id,
          headline: "A soft heart. Very firm opinions.",
          traits: ["Quietly curious", "Loyal", "Comfortably stubborn"],
          paragraphs: [
            "You make little moments feel considered, and you have a wonderfully specific idea of what a good afternoon looks like.",
            `Like ${result.title}, you can be warm and determined at the same time. Comfort gives you a place to start exploring.`,
          ],
          evidence: {
            questionId: question.id,
            choice: answer.text,
            note: "You trust your own taste instead of following the crowd.",
          },
        },
      },
    });
  });
}
