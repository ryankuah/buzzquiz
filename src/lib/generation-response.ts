export type GenerationStage = "writing" | "drawing";
import { parseQuiz, type Quiz } from "./quiz";

export async function readGenerationResponse(
  response: Response,
  onStage: (stage: "writing" | "drawing") => void,
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
    if (
      event.type === "stage" &&
      (event.stage === "writing" || event.stage === "drawing")
    )
      onStage(event.stage);
    else if (event.type === "complete") {
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
