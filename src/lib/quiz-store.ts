import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { assetDirectory } from "./asset-store";
import { normalizePrompt, quizPromptKey } from "./normalize-prompt";
import { parseQuiz, type GenerationInput, type Quiz } from "./quiz";

// Legacy filesystem reader retained for migrating locally generated quizzes.
// Live generation and sharing use the Convex repository.

export function quizDirectory() {
  return process.env.QUIZ_STORE_DIR || join(process.cwd(), ".quiz-library");
}

export function createQuizStore(
  options: {
    directory?: string;
    hasArtwork?: (quiz: Quiz) => Promise<boolean>;
  } = {},
) {
  const directory = options.directory || quizDirectory();
  const hasArtwork =
    options.hasArtwork ||
    (async (quiz: Quiz) => {
      if (!quiz.artwork) return false;
      try {
        await access(
          /* turbopackIgnore: true */ join(
            assetDirectory(),
            `${quiz.artwork.url.split("/").pop()}.webp`,
          ),
        );
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    });
  return {
    async find(input: GenerationInput): Promise<Quiz | null> {
      let raw: string;
      try {
        raw = await readFile(
          /* turbopackIgnore: true */ join(
            directory,
            `${quizPromptKey(input)}.json`,
          ),
          "utf8",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      let quiz: Quiz;
      try {
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== "object") return null;
        if (saved.version !== 1) return null;
        quiz = parseQuiz(saved.quiz);
        if (quizPromptKey(quiz.settings) !== quizPromptKey(input)) return null;
      } catch {
        // Bad content is replaceable; disk/permission errors above and artwork
        // access errors below must remain visible rather than spending again.
        return null;
      }
      return (await hasArtwork(quiz)) ? quiz : null;
    },
    async save(input: GenerationInput, value: Quiz) {
      const quiz = parseQuiz(value);
      if (
        quizPromptKey(quiz.settings) !== quizPromptKey(input) ||
        !(await hasArtwork(quiz))
      )
        throw new Error("Cannot save an incomplete quiz.");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = join(directory, `${quizPromptKey(input)}.json`);
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(
          temporary,
          JSON.stringify({ version: 1, prompt: normalizePrompt(input), quiz }),
          { mode: 0o600, flag: "wx" },
        );
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return quiz;
    },
  };
}
