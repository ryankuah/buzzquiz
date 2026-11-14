import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { parseQuiz } from "../src/lib/quiz";
import { archetypes, questionSetSchema } from "../src/lib/content-sets";
import { contentKeys, quizPromptKey } from "../src/lib/normalize-prompt";
import { convexConnection } from "../src/lib/convex-repository";
import { saveQuizImage } from "../src/lib/asset-store";
import { api } from "../convex/_generated/api";

// Run with Node's --env-file=.env.local and optionally override CONVEX_URL for
// production. This migration copies existing work and never calls an AI service.
async function main() {
  const { client, secret } = convexConnection();
  const directory =
    process.env.QUIZ_STORE_DIR || join(process.cwd(), ".quiz-library");
  const images =
    process.env.QUIZ_ASSET_DIR || join(process.cwd(), ".quiz-assets");
  const files = (await readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );
  let quizzes = 0,
    questionSets = 0;
  for (const name of files) {
    const quiz = parseQuiz(
      JSON.parse(await readFile(join(directory, name), "utf8")).quiz,
    );
    if (!quiz.artwork) continue;
    const bytes = await readFile(
      join(images, `${quiz.artwork.url.split("/").pop()}.webp`),
    );
    const existingAsset = await client.query(api.cache.assetUrl, {
      secret,
      id: quiz.id,
    });
    if (!existingAsset) await saveQuizImage(quiz.id, bytes);
    await client.mutation(api.cache.saveQuiz, {
      secret,
      key: `legacy:${quizPromptKey(quiz.settings)}`,
      quiz,
    });
    quizzes++;
    const key = contentKeys(quiz.settings).questions;
    if (
      (await client.query(api.cache.findContent, { secret, key }))?.status ===
      "ready"
    )
      continue;
    const mapping = new Map(
      quiz.results.map((result, index) => [result.id, archetypes[index]]),
    );
    const notes = {
      curious:
        "You look for the unexpected details and enjoy a little discovery.",
      bold: "You follow your curiosity into a choice with a little extra drama.",
      warm: "You make room for comfort, connection and the people around you.",
      driven:
        "You know what works for you and give the little decisions some care.",
    };
    const data = questionSetSchema.parse({
      backgroundPrompt:
        quiz.questions[quiz.questions.length - 2].imagePrompt ||
        "A cosy scene inspired by the quiz topic, without people or text.",
      questions: quiz.questions.map((question) => ({
        ...question,
        answers: question.answers.map((answer) => ({
          ...answer,
          resultId: mapping.get(answer.resultId),
          secondaryResultId: answer.secondaryResultId
            ? mapping.get(answer.secondaryResultId)
            : null,
          personalityNote: notes[mapping.get(answer.resultId)!],
        })),
      })),
    });
    // Keep every existing choice tile; turn a saved still-life into the reusable
    // result background in the last row. No new image generation is needed.
    const metadata = await sharp(bytes).metadata();
    const width = metadata.width!,
      cellHeight = Math.floor(metadata.height! / quiz.artwork.rows);
    const cellWidth = Math.floor(width / 5);
    const hero = await sharp(bytes)
      .extract({
        left: 0,
        top: (quiz.questions.length - 2) * cellHeight,
        width: cellWidth,
        height: cellHeight,
      })
      .png()
      .toBuffer();
    const sheet = await sharp(bytes)
      .extract({
        left: 0,
        top: 0,
        width,
        height: quiz.questions.length * cellHeight,
      })
      .extend({ bottom: cellHeight, background: "#cceaf8" })
      .composite([
        { input: hero, left: 0, top: quiz.questions.length * cellHeight },
      ])
      .png()
      .toBuffer();
    const id = crypto.randomUUID();
    const dimensions = await saveQuizImage(id, sheet);
    const artwork = {
      ...quiz.artwork,
      ...dimensions,
      url: `/api/quiz-assets/${id}`,
      model: `${quiz.artwork.model} (migrated)`,
      generatedAt: new Date().toISOString(),
    };
    await client.mutation(api.cache.seedContent, {
      secret,
      key,
      kind: "questions",
      data,
      artwork,
    });
    questionSets++;
  }
  console.log(
    JSON.stringify({
      migratedQuizzes: quizzes,
      migratedQuestionSets: questionSets,
      aiRequests: 0,
    }),
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
