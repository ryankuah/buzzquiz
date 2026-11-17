import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/generate/route";
import { exampleQuiz, defaultSettings } from "../src/lib/examples";
import { parseQuiz } from "../src/lib/quiz";
import {
  GENERATION_PROGRESS_HEADER,
  GENERATION_PROGRESS_VERSION,
  readGenerationResponse,
} from "../src/lib/generation-response";

test("generation route keeps old tabs compatible and only streams requested progress versions", async (t) => {
  const saved = exampleQuiz("princess");
  const previousUrl = process.env.CONVEX_URL;
  const previousSecret = process.env.BUZZQUIZ_SERVER_SECRET;
  process.env.CONVEX_URL = "https://protocol-test.convex.cloud";
  process.env.BUZZQUIZ_SERVER_SECRET = "test-only";
  let fail = false;
  const backend = t.mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL, options?: RequestInit) => {
      assert.equal(String(url), "https://protocol-test.convex.cloud/api/query");
      const { path, args } = JSON.parse(options!.body as string);
      // Only cached reads are allowed; a retry must not generate new content.
      assert(["topics:findAlias", "cache:findQuiz"].includes(path));
      if (fail)
        return Response.json({
          status: "error",
          errorMessage: "Saved quiz unavailable",
        });
      return Response.json({
        status: "success",
        value: path === "topics:findAlias" ? args[0].alias : saved,
      });
    },
  );
  const request = (version?: string, accept = "application/x-ndjson") =>
    new Request("https://buzzquiz.test/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://buzzquiz.test",
        Accept: accept,
        ...(version ? { [GENERATION_PROGRESS_HEADER]: version } : {}),
      },
      body: JSON.stringify(defaultSettings),
    });
  try {
    for (const version of [
      undefined,
      "unsupported",
      GENERATION_PROGRESS_VERSION,
    ]) {
      // Exercise the same saved quiz twice, including on an already-open tab.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await POST(request(version));
        assert.equal(response.status, 200);
        const events = (await response.clone().text())
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const progress = events.filter((event) => event.type === "stage");
        if (version === GENERATION_PROGRESS_VERSION) {
          assert.equal(progress[0].stage, "checking");
          assert.equal(
            progress.filter((event) => event.status === "reused").length,
            4,
          );
          assert.equal(progress.at(-1).stage, "finishing");
        } else {
          // Both previously deployed readers accept this terminal-only format.
          assert.deepEqual(
            events.map((event) => event.type),
            ["complete"],
          );
        }
        assert.equal(events.at(-1).reused, true);
        assert.deepEqual(
          await readGenerationResponse(response, () => {}),
          parseQuiz(saved),
        );
      }
    }
    const json = await POST(request(undefined, "application/json"));
    assert.equal((await json.json()).quiz.id, saved.id);
    fail = true;
    const failed = await POST(request());
    const events = (await failed.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(events, [
      { type: "error", error: "Saved quiz unavailable" },
    ]);
  } finally {
    backend.mock.restore();
    if (previousUrl === undefined) delete process.env.CONVEX_URL;
    else process.env.CONVEX_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.BUZZQUIZ_SERVER_SECRET;
    else process.env.BUZZQUIZ_SERVER_SECRET = previousSecret;
  }
});
