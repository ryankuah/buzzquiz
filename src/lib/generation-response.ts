import { parseQuiz, type Quiz } from "./quiz";

// Older open tabs only understand the original writing/drawing events.
// Detailed progress is opt-in; terminal quiz/error events stay compatible.
export const GENERATION_PROGRESS_HEADER = "X-Quiz-Progress-Version";
export const GENERATION_PROGRESS_VERSION = "1";

export const generationSteps = [
  { id: "checking", label: "Checking saved quizzes" },
  { id: "results", label: "Preparing results" },
  { id: "result-artwork", label: "Creating result artwork" },
  { id: "questions", label: "Preparing questions" },
  { id: "question-artwork", label: "Creating question artwork" },
  { id: "finishing", label: "Getting your quiz ready" },
] as const;
export type GenerationStage = (typeof generationSteps)[number]["id"];
export type GenerationProgress = {
  stage: GenerationStage;
  status: "active" | "complete" | "reused";
};
export type GenerationSteps = Partial<
  Record<GenerationStage, GenerationProgress["status"]>
>;

export async function readGenerationResponse(
  response: Response,
  onStage: (progress: GenerationProgress) => void,
): Promise<Quiz> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error || "Couldn't generate your quiz. Please try again.",
    );
  }
  if (!response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    const body = await response.json();
    if (body.error) throw new Error(body.error);
    try {
      return parseQuiz(body.quiz);
    } catch {
      throw new Error("The quiz response wasn't valid. Please try again.");
    }
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error("The quiz response was empty. Please try again.");
  const decoder = new TextDecoder();
  let buffer = "";
  let quiz: Quiz | null = null;
  function consume(line: string) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("The quiz response wasn't valid. Please try again.");
    }
    if (!event || typeof event !== "object")
      throw new Error("The quiz response wasn't valid. Please try again.");
    if (event.type === "stage") {
      // Progress is advisory. A newer/older server's stage names must never
      // turn an otherwise valid saved quiz into a validation error.
      if (
        generationSteps.some((step) => step.id === event.stage) &&
        ["active", "complete", "reused"].includes(event.status)
      )
        onStage({ stage: event.stage, status: event.status });
    } else if (event.type === "complete") {
      try {
        quiz = parseQuiz(event.quiz);
      } catch {
        throw new Error("The quiz response wasn't valid. Please try again.");
      }
    } else if (event.type === "error")
      throw new Error(
        typeof event.error === "string"
          ? event.error
          : "Couldn't generate the quiz artwork. Please try again.",
      );
    else throw new Error("The quiz response wasn't valid. Please try again.");
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 150000)
        throw new Error("The quiz response was too large.");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!quiz)
      throw new Error(
        "Generation stopped before the quiz was ready. Please try again.",
      );
    return quiz;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
