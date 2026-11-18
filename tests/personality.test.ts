import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import OpenAI from "openai";
import { exampleQuiz } from "../src/lib/examples";
import { generatePersonalityReading } from "../src/lib/generate-reading";
import { POST } from "../src/app/api/result/route";

const draft = {
  headline: "A soft heart. Very firm opinions.",
  traits: ["Quietly curious", "Loyal", "Comfortably stubborn"],
  paragraphs: [
    "You make a simple moment feel considered. You notice the little things, and yes, you have a very specific idea of how a relaxing afternoon should go.",
    "Like Belle, you're warm without being a pushover. Familiar comforts are your launchpad for curiosity, not an excuse to stop asking questions.",
  ],
  evidence: {
    questionId: "q1",
    note: "You know what feels good to you, and you don't need to dress it up to make it count.",
  },
};

test("personal reading uses the reading model, actual selected answers, correct winner, and a validated choice callback", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    OPENROUTER_API_KEY: "test-only",
    QUIZ_AI_MODEL: "test-quiz-model",
    QUIZ_READING_MODEL: "",
  });
  const quiz = exampleQuiz("princess");
  const selected = Object.fromEntries(
    quiz.questions.map((q) => [
      q.id,
      q.answers.find((a) => a.resultId === "belle")!.id,
    ]),
  );
  const inputs: Array<{
    picks: Array<{ questionId: string; answer: string }>;
    outcome: { title: string };
  }> = [];
  let invalidEvidence = false;
  const requestedModels: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requestedModels.push(body.model);
    inputs.push(JSON.parse(body.input[1].content));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_reading",
        object: "response",
        created_at: 1,
        status: "completed",
        model: "mock-model",
        output: [
          {
            id: "msg_reading",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  ...draft,
                  evidence: {
                    ...draft.evidence,
                    questionId: invalidEvidence ? "made-up-question" : "q1",
                  },
                }),
                annotations: [],
              },
            ],
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new OpenAI({
    apiKey: "test-only",
    baseURL: `http://127.0.0.1:${address.port}`,
    maxRetries: 0,
  });
  try {
    const reading = await generatePersonalityReading(quiz, selected, client);
    assert.equal(requestedModels[0], "openai/gpt-6-luna");
    assert.equal(reading.resultId, "belle");
    assert.equal(reading.evidence.choice, "Blueberry, always");
    assert.equal(inputs[0].outcome.title, "Belle");
    assert.equal(inputs[0].picks.length, 5);
    assert.equal(inputs[0].picks[0].answer, "Blueberry, always");
    const alternate = { ...selected, q1: "a2" };
    process.env.QUIZ_READING_MODEL = "test-reading-model";
    const changed = await generatePersonalityReading(quiz, alternate, client);
    assert.equal(requestedModels[1], "test-reading-model");
    assert.equal(changed.resultId, "belle");
    assert.equal(changed.evidence.choice, "Double chocolate");
    assert.notDeepEqual(inputs[0].picks, inputs[1].picks);
    invalidEvidence = true;
    await assert.rejects(
      () => generatePersonalityReading(quiz, selected, client),
      /didn't match/,
    );
    await assert.rejects(
      () => generatePersonalityReading(quiz, {}, client),
      /Answer every question/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("result endpoint rejects incomplete answers and cross-origin calls before making an AI request", async () => {
  const quiz = exampleQuiz("princess");
  const incomplete = await POST(
    new Request("http://localhost/api/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quiz, selections: {} }),
    }),
  );
  assert.equal(incomplete.status, 400);
  const crossOrigin = await POST(
    new Request("http://localhost/api/result", {
      method: "POST",
      headers: { Origin: "https://another-site.example", Host: "localhost" },
      body: "{}",
    }),
  );
  assert.equal(crossOrigin.status, 403);
});
