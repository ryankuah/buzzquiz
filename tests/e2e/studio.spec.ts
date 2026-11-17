import { test, expect, type Page } from "@playwright/test";
import { exampleQuiz } from "../../src/lib/examples";
import { createShareUrl } from "../../src/lib/library";
import { variedQuiz } from "../varied-quiz";
import { reusableFixture } from "../reusable-fixture";
import {
  illustratedQuiz,
  mockArtwork,
  mockPersonalityReading,
} from "./artwork-fixture";
import {
  GENERATION_PROGRESS_HEADER,
  GENERATION_PROGRESS_VERSION,
} from "../../src/lib/generation-response";

async function mockGeneration(page: Page) {
  await mockArtwork(page);
  await mockPersonalityReading(page);
  await page.route("**/api/generate", (route) => {
    const settings = route.request().postDataJSON();
    const quiz = illustratedQuiz(exampleQuiz("princess"));
    quiz.source = "ai";
    quiz.settings = settings;
    quiz.title = `What ${settings.subject} are you based on your favourite ${settings.basis}?`;
    return route.fulfill({ json: { quiz } });
  });
}

test("home contains only the two blanks and one action, including at 320px", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("textbox")).toHaveCount(2);
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Find out", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.getByText(
      /My quizzes|Cover preview|Give it a look|AI setup|Save quiz/,
    ),
  ).toHaveCount(0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const button = await page
      .getByRole("button", { name: "Find out" })
      .boundingBox();
    expect(button!.y + button!.height).toBeLessThan(844);
  }
});

test("existing topics are suggested as the blanks are filled", async ({
  page,
}, testInfo) => {
  await page.route("**/api/suggestions", (route) =>
    route.fulfill({
      json: {
        subjects: [
          { name: "Harry Potter house", count: 3 },
          { name: "Disney princess", count: 2 },
        ],
        bases: [
          { name: "muffins", count: 2 },
          { name: "tea", count: 1 },
        ],
        pairs: [
          [0, 1],
          [1, 0],
        ],
      },
    }),
  );
  await page.goto("/");
  const subject = page.getByRole("textbox", { name: "What are you?" });
  const basis = page.getByRole("textbox", { name: "Your favourite what?" });
  await subject.fill("");
  await subject.focus();
  const shelf = page.locator(".suggestion-shelf");
  // The prefilled "muffins" was drawn with Disney princess, so it leads.
  await expect(basis).toHaveValue("muffins");
  await expect(shelf.getByRole("button")).toHaveText([
    "Disney princess",
    "Harry Potter house",
  ]);

  await subject.pressSequentially("dis");
  await expect(shelf.getByRole("button")).toHaveText(["Disney princess"]);
  await shelf.getByRole("button", { name: "Disney princess" }).click();
  await expect(subject).toHaveValue("Disney princess");
  await expect(basis).toBeFocused();

  // The basis paired with the chosen subject in a saved quiz comes first.
  await basis.fill("");
  await expect(shelf.getByRole("button")).toHaveText(["muffins", "tea"]);
  await basis.pressSequentially("t");
  await expect(shelf.getByRole("button")).toHaveText(["tea"]);
  await shelf.getByRole("button", { name: "tea" }).click();
  await expect(basis).toHaveValue("tea");
  await expect(page.getByRole("button", { name: "Find out" })).toBeFocused();

  // With a keyboard and mouse, Tab accepts the faint completion as saved.
  if (testInfo.project.name === "desktop") {
    await subject.fill("");
    await subject.pressSequentially("ha");
    await expect(page.locator(".prompt-ghost")).toContainText(
      "rry Potter house",
    );
    await subject.press("Tab");
    await expect(subject).toHaveValue("Harry Potter house");
    await expect(subject).toBeFocused();
  }
});

test("generation goes straight to the first question, answers advance, and result can be replayed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockGeneration(page);
  await page.goto("/");
  await page
    .getByLabel("What are you?", { exact: true })
    .fill("Disney princess");
  await page
    .getByLabel("Your favourite what?", { exact: true })
    .fill("muffins");
  const requestPromise = page.waitForRequest("**/api/generate");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  expect((await requestPromise).postDataJSON()).toEqual({
    subject: "Disney princess",
    basis: "muffins",
    questionCount: 5,
    tone: "playful",
    layout: "hero-grid",
    theme: "foodie",
  });
  await expect(
    page.getByRole("heading", {
      name: "First things first. Pick your muffin.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Let.s find out|Play quiz|Save quiz|Next question/,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Blueberry, always", exact: true })
    .click();
  await expect(
    page.getByText("QUESTION 2 OF 5", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Previous question", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Blueberry, always" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (let index = 0; index < 5; index++) {
    await expect(
      page.getByText(`QUESTION ${index + 1} OF 5`, { exact: true }),
    ).toBeVisible();
    await page.locator(".answer-option").first().click();
  }
  await expect(
    page.getByRole("heading", { name: "Belle", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retake quiz", exact: true }).click();
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Blueberry, always" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "New quiz", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Find out", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Your favourite what?", { exact: true }),
  ).toHaveValue("muffins");
  expect(errors).toEqual([]);
});

test("loading prevents duplicate requests and keyboard submission starts the quiz", async ({
  page,
}) => {
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/generate", async (route) => {
    requests++;
    await gate;
    return route.fulfill({ json: { quiz: exampleQuiz("princess") } });
  });
  await page.goto("/");
  await page.getByLabel("Your favourite what?", { exact: true }).press("Enter");
  await expect(
    page.getByRole("progressbar", { name: "Quiz generation" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(
    page.getByRole("button", { name: "Find out", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("What are you?", { exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(1);
  release();
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
});

test("generation errors preserve the idea and allow a retry", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("What are you?", { exact: true })
    .fill("mythical creature");
  await page
    .getByLabel("Your favourite what?", { exact: true })
    .fill("breakfasts");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "isn't available" }),
  ).toBeVisible();
  await expect(page.getByLabel("What are you?", { exact: true })).toHaveValue(
    "mythical creature",
  );
  await expect(
    page.getByLabel("Your favourite what?", { exact: true }),
  ).toHaveValue("breakfasts");
  await mockGeneration(page);
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
});

test("the same saved quiz opens twice despite unfamiliar progress messages", async ({
  page,
}) => {
  const quiz = illustratedQuiz(exampleQuiz("princess"));
  await mockArtwork(page);
  let requests = 0;
  await page.route("**/api/generate", (route) => {
    requests++;
    expect(
      route.request().headers()[GENERATION_PROGRESS_HEADER.toLowerCase()],
    ).toBe(GENERATION_PROGRESS_VERSION);
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: [
        { type: "stage", stage: "checking", status: "complete" },
        { type: "stage", stage: "a-new-server-step", status: "active" },
        { type: "complete", quiz, reused: true },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    });
  });
  await page.goto("/");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Find out", exact: true }).click();
    await expect(
      page.getByText("QUESTION 1 OF 5", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.home-message [role="alert"]')).toHaveCount(0);
    if (attempt === 0)
      await page.getByRole("button", { name: "New quiz", exact: true }).click();
  }
  expect(requests).toBe(2);
});

test("existing quiz links open directly at the first question", async ({
  page,
  baseURL,
}) => {
  const quiz = exampleQuiz("cat");
  await page.goto(await createShareUrl(quiz, baseURL!));
  await expect(
    page.getByRole("heading", { name: quiz.questions[0].text }),
  ).toBeVisible();
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("damaged links recover to the home page and long blanks wrap without overflow", async ({
  page,
}) => {
  await page.goto("/#quiz=broken");
  await expect(
    page.getByRole("alert").filter({ hasText: "couldn't be opened" }),
  ).toBeVisible();
  await page
    .getByLabel("What are you?", { exact: true })
    .fill("a character from your favourite childhood cartoon");
  await page
    .getByLabel("Your favourite what?", { exact: true })
    .fill("extremely specific breakfast and late-night snack combos");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("illustrated phone template fits every question and result on small, tall, and landscape screens", async ({
  page,
}) => {
  test.setTimeout(60000);
  await mockGeneration(page);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Find out", exact: true }).click();
    for (let index = 0; index < 5; index++) {
      await expect(
        page.getByText(`QUESTION ${index + 1} OF 5`, { exact: true }),
      ).toBeVisible();
      const metrics = await page.evaluate(() => {
        const buttons = [
          ...document.querySelectorAll<HTMLElement>(".answer-option"),
        ];
        return {
          overflow:
            document.documentElement.scrollHeight > innerHeight + 1 ||
            document.documentElement.scrollWidth > innerWidth,
          buttonsFit: buttons.every((button) => {
            const box = button.getBoundingClientRect();
            const label = button
              .querySelector(".answer-label")!
              .getBoundingClientRect();
            return (
              box.top >= 0 &&
              box.bottom <= innerHeight + 1 &&
              label.top >= box.top &&
              label.bottom <= box.bottom + 1
            );
          }),
          illustratedAnswers: document.querySelectorAll(
            ".answer-option .quiz-tile img",
          ).length,
        };
      });
      expect(
        metrics,
        JSON.stringify({ viewport, question: index + 1 }),
      ).toEqual({ overflow: false, buttonsFit: true, illustratedAnswers: 4 });
      await page.locator(".answer-option").first().click();
    }
    await expect(
      page.getByRole("button", { name: "Try another quiz", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        pageFits: document.documentElement.scrollHeight <= innerHeight + 1,
        readingInsideTemplate:
          document.querySelector(".result-reading")!.getBoundingClientRect()
            .bottom <=
          innerHeight + 1,
        actionsFit:
          document.querySelector(".result-actions")!.getBoundingClientRect()
            .bottom <=
          innerHeight + 1,
      })),
      JSON.stringify(viewport),
    ).toEqual({
      pageFits: true,
      readingInsideTemplate: true,
      actionsFit: true,
    });
    await expect(page.locator(".result-artwork img")).toHaveAttribute(
      "src",
      /\/api\/quiz-assets\/[a-f0-9-]{36}/,
    );
    await expect
      .poll(() =>
        page
          .locator(".result-artwork img")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }
});

test("generation progress follows streamed steps and waits for artwork before opening", async ({
  page,
}, testInfo) => {
  const quiz = illustratedQuiz(exampleQuiz("princess"));
  quiz.settings.layout = "hero-grid";
  quiz.settings.theme = "foodie";
  await mockArtwork(page);
  let releaseArtwork!: () => void;
  const artworkGate = new Promise<void>((resolve) => {
    releaseArtwork = resolve;
  });
  await page.route("**/api/quiz-assets/*", async (route) => {
    await artworkGate;
    await route.fallback();
  });
  await page.addInitScript((generated) => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (input === "/api/generate")
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(
                  encoder.encode(
                    '{"type":"stage","stage":"checking","status":"active"}\n',
                  ),
                );
                (
                  window as typeof window & {
                    advanceGeneration?: (
                      events: Array<{ stage: string; status: string }>,
                    ) => void;
                  }
                ).advanceGeneration = (events) => {
                  for (const event of events)
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({ type: "stage", ...event }) + "\n",
                      ),
                    );
                };
                (
                  window as typeof window & { releaseQuiz?: () => void }
                ).releaseQuiz = () => {
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({ type: "complete", quiz: generated }) +
                        "\n",
                    ),
                  );
                  controller.close();
                };
              },
            }),
            { headers: { "Content-Type": "application/x-ndjson" } },
          ),
        );
      return original(input, init);
    };
  }, quiz);
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  const progress = page.getByRole("progressbar", { name: "Quiz generation" });
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(
    page.locator('.generation-steps [aria-current="step"]'),
  ).toHaveText(/Checking saved quizzes/);
  const advance = (events: Array<{ stage: string; status: string }>) =>
    page.evaluate((events) => {
      (
        window as typeof window & {
          advanceGeneration: (
            events: Array<{ stage: string; status: string }>,
          ) => void;
        }
      ).advanceGeneration(events);
    }, events);
  await advance([
    { stage: "checking", status: "complete" },
    { stage: "results", status: "reused" },
    { stage: "result-artwork", status: "reused" },
    { stage: "questions", status: "active" },
  ]);
  await expect(progress).toHaveAttribute("aria-valuenow", "3");
  await expect(page.locator(".generation-step-saved")).toHaveCount(2);
  await advance([
    { stage: "questions", status: "complete" },
    { stage: "question-artwork", status: "active" },
  ]);
  await expect(progress).toHaveAttribute("aria-valuenow", "4");
  await expect(
    page.locator('.generation-steps [aria-current="step"]'),
  ).toHaveText(/Creating question artwork/);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".generation-progress")).toBeInViewport({
      ratio: 1,
    });
    await page.screenshot({
      path: testInfo.outputPath(`generation-progress-${viewport.width}.png`),
      animations: "disabled",
    });
  }
  await page.screenshot({
    path: testInfo.outputPath("generation-progress.png"),
  });
  await expect(page.getByText("QUESTION 1 OF 5", { exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() =>
    (window as typeof window & { releaseQuiz: () => void }).releaseQuiz(),
  );
  await expect(progress).toHaveAttribute("aria-valuenow", "5");
  await expect(
    page.locator('.generation-steps [aria-current="step"]'),
  ).toHaveText(/Getting your quiz ready/);
  await expect(page.getByText("QUESTION 1 OF 5", { exact: true })).toHaveCount(
    0,
  );
  releaseArtwork();
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".answer-option img")).toHaveCount(4);
  await expect(
    page.locator(".answer-option").first().locator(".quiz-tile"),
  ).toHaveAttribute("data-art-index", "1");
  await page.locator(".answer-option").first().click();
  await expect(
    page.getByText("QUESTION 2 OF 5", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".answer-option").first().locator(".quiz-tile"),
  ).toHaveAttribute("data-art-index", "6");
});

test("image generation failure shows a retry message without opening a stock-art quiz", async ({
  page,
}) => {
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: '{"type":"stage","stage":"result-artwork","status":"active"}\n{"type":"error","error":"Could not draw your quiz artwork. Try again."}\n',
    }),
  );
  const stockRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/quiz-art/")) stockRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not draw your quiz artwork" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find out", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("progressbar", { name: "Quiz generation" }),
  ).toHaveCount(0);
  await expect(page.locator(".quiz-player")).toHaveCount(0);
  expect(stockRequests).toEqual([]);
});

test("document background and browser tint follow the quiz theme and reset on returning home", async ({
  page,
  baseURL,
}) => {
  await mockGeneration(page);
  await page.goto("/");
  const pageColors = () =>
    page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      tint: document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }));
  await expect.poll(pageColors).toEqual({
    html: "rgb(248, 247, 242)",
    body: "rgb(248, 247, 242)",
    tint: "#f8f7f2",
    scheme: "light",
  });
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  await expect.poll(pageColors).toEqual({
    html: "rgb(204, 234, 248)",
    body: "rgb(204, 234, 248)",
    tint: "#cceaf8",
    scheme: "light",
  });
  await page.getByRole("button", { name: "New quiz", exact: true }).click();
  await expect.poll(pageColors).toEqual({
    html: "rgb(248, 247, 242)",
    body: "rgb(248, 247, 242)",
    tint: "#f8f7f2",
    scheme: "light",
  });
  const dark = exampleQuiz("cat", { layout: "hero-grid", theme: "scent" });
  await page.goto(await createShareUrl(dark, baseURL!));
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  await expect.poll(pageColors).toEqual({
    html: "rgb(10, 13, 51)",
    body: "rgb(10, 13, 51)",
    tint: "#0a0d33",
    scheme: "dark",
  });
});

test("princess result includes her portrait, personality reading, and the player's real choice", async ({
  page,
}) => {
  await mockGeneration(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  const readingRequest = page.waitForRequest("**/api/result");
  for (let index = 0; index < 5; index++) {
    await expect(
      page.getByText(`QUESTION ${index + 1} OF 5`, { exact: true }),
    ).toBeVisible();
    await page.locator(".answer-option").first().click();
  }
  const sent = (await readingRequest).postDataJSON();
  expect(Object.keys(sent.selections)).toHaveLength(5);
  await expect(
    page.getByRole("heading", { name: "Belle", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".result-tile")).toHaveAttribute(
    "data-art-index",
    "25",
  );
  await expect(page.locator(".result-tile img")).toHaveAttribute(
    "src",
    /\/api\/quiz-assets\//,
  );
  await expect(page.locator(".result-headline")).toHaveText(
    "A soft heart. Very firm opinions.",
  );
  await expect(page.locator(".result-traits span")).toHaveCount(3);
  await expect(page.locator(".evidence-choice")).toHaveText(
    "“Blueberry, always”",
  );
  await expect(page.getByLabel("Your personality reading")).toContainText(
    "Like Belle",
  );
  await expect(page.locator(".result-description")).toHaveCount(3);
});

test("a reading failure keeps the princess result and allows retrying the personal reading", async ({
  page,
}) => {
  await mockGeneration(page);
  await page.route(
    "**/api/result",
    (route) =>
      route.fulfill({ status: 502, json: { error: "Reading unavailable" } }),
    { times: 1 },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  for (let index = 0; index < 5; index++) {
    await expect(
      page.getByText(`QUESTION ${index + 1} OF 5`, { exact: true }),
    ).toBeVisible();
    await page.locator(".answer-option").first().click();
  }
  await expect(
    page.getByRole("heading", { name: "Belle", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Personal reading unavailable.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry reading", exact: true })
    .click();
  await expect(page.locator(".result-traits span")).toHaveCount(3);
  await expect(page.locator(".reading-error")).toHaveCount(0);
});

test("hero artwork and stickers stay clear of readable desktop answers", async ({
  page,
}) => {
  const { quiz } = reusableFixture();
  quiz.questionArtwork!.packed = true;
  quiz.style = {
    decorations: 4,
    palette: {
      background: "#301909",
      foreground: "#f9e3d6",
      accent: "#d4b702",
      dark: true,
    },
  };
  quiz.questions[0].text = "A drinks cart rolls by. What catches your eye?";
  const answers = [
    "Mulled cider with a cinnamon stick",
    "A chili-rimmed margarita with lime",
    "A violet gin fizz with an unusual garnish",
    "Neat whiskey in a heavy tumbler",
  ];
  quiz.questions[0].answers.forEach((answer, index) => {
    answer.text = answers[index];
  });
  await mockArtwork(page);
  await page.route("**/api/generate", (route) =>
    route.fulfill({ json: { quiz } }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  await expect(page.locator(".placed-sticker")).toHaveCount(2);
  for (const viewport of [
    { width: 1024, height: 640 },
    { width: 1428, height: 858 },
    { width: 1440, height: 1050 },
  ]) {
    await page.setViewportSize(viewport);
    // Measure the full-size stickers, after the entry animation finishes.
    await page.evaluate(() =>
      document.getAnimations().forEach((animation) => {
        if (Number.isFinite(animation.effect?.getComputedTiming().iterations))
          animation.finish();
      }),
    );
    const metrics = await page.evaluate(() => {
      const column = document
        .querySelector(".question-artwork")!
        .getBoundingClientRect();
      const decorations = [
        ...document.querySelectorAll(".hero-tile, .placed-sticker"),
      ].map((element) => element.getBoundingClientRect());
      const inside = (box: DOMRect, parent: DOMRect) =>
        box.left >= parent.left - 1 &&
        box.right <= parent.right + 1 &&
        box.top >= parent.top - 1 &&
        box.bottom <= parent.bottom + 1;
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top;
      return {
        artworkContained: decorations.every((box) => inside(box, column)),
        answersClear: [...document.querySelectorAll(".answer-option")].every(
          (button) => {
            const label = button.querySelector(".answer-label")!;
            const text = label.getBoundingClientRect();
            return (
              inside(text, button.getBoundingClientRect()) &&
              !decorations.some((box) => overlaps(text, box)) &&
              !overlaps(
                text,
                button.querySelector(".answer-art")!.getBoundingClientRect(),
              ) &&
              parseFloat(getComputedStyle(label).fontSize) >= 16
            );
          },
        ),
        pageFits:
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      };
    });
    expect(metrics, JSON.stringify(viewport)).toEqual({
      artworkContained: true,
      answersClear: true,
      pageFits: true,
    });
  }
});

test("varied two- and four-choice templates fit phone and landscape screens", async ({
  page,
}) => {
  test.setTimeout(60000);
  await mockArtwork(page);
  await mockPersonalityReading(page);
  const quiz = illustratedQuiz(variedQuiz(exampleQuiz("princess")));
  await page.route("**/api/generate", (route) =>
    route.fulfill({ json: { quiz, reused: true } }),
  );
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Find out", exact: true }).click();
    for (const [index, question] of quiz.questions.entries()) {
      await expect(
        page.getByText(`QUESTION ${index + 1} OF 5`, { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".question-page")).toHaveClass(
        new RegExp(`layout-${question.layout}`),
      );
      await expect(page.locator(".answer-option")).toHaveCount(
        question.answers.length,
      );
      const metrics = await page.evaluate(() => ({
        pageFits:
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          document.documentElement.scrollWidth <= innerWidth,
        choicesFit: [
          ...document.querySelectorAll<HTMLElement>(".answer-option"),
        ].every((button) => {
          const box = button.getBoundingClientRect();
          const label = button
            .querySelector(".answer-label")!
            .getBoundingClientRect();
          return (
            box.height >= 44 &&
            box.top >= 0 &&
            box.bottom <= innerHeight + 1 &&
            label.top >= box.top &&
            label.bottom <= box.bottom + 1
          );
        }),
      }));
      expect(
        metrics,
        JSON.stringify({
          viewport,
          layout: question.layout,
          count: question.answers.length,
        }),
      ).toEqual({ pageFits: true, choicesFit: true });
      await expect(
        page.locator(".answer-option .quiz-tile").first(),
      ).toHaveAttribute("data-art-index", String(index * 5 + 1));
      await page.locator(".answer-option").first().click();
    }
    await expect(page.locator(".result-traits")).toBeVisible();
  }
});

test("layered results combine the subject foreground with the basis background, preserve the intro, and survive the daily limit", async ({
  page,
}) => {
  const { quiz } = reusableFixture();
  await mockArtwork(page);
  await page.route("**/api/generate", (route) =>
    route.fulfill({ json: { quiz, reused: true } }),
  );
  await page.route("**/api/result", (route) =>
    route.fulfill({
      status: 429,
      json: {
        error:
          "Today's new-content limit has been reached. Saved quizzes still work.",
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  for (let index = 0; index < 5; index++) {
    await expect(
      page.getByText(`QUESTION ${index + 1} OF 5`, { exact: true }),
    ).toBeVisible();
    await page.locator(".answer-option").first().click();
  }
  await expect(
    page.locator(".layered-result .result-background img"),
  ).toHaveAttribute("src", quiz.questionArtwork!.url);
  await expect(
    page.locator(".layered-result .result-foreground img"),
  ).toHaveAttribute("src", quiz.resultArtwork!.url);
  await expect(page.locator(".result-background")).toHaveAttribute(
    "data-art-index",
    "25",
  );
  await expect(page.locator(".result-introduction")).toHaveText(
    quiz.results[0].description,
  );
  await expect(page.locator(".reading-error")).toContainText(
    "Today's new-content limit",
  );
  await expect(page.getByRole("button", { name: "Retry reading" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toBeVisible();
});

test("sharing copies a short saved-quiz link, and a recipient starts with no answers selected", async ({
  page,
  context,
}) => {
  const { quiz } = reusableFixture();
  await mockArtwork(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (url: string) => {
          (window as typeof window & { copiedQuizUrl?: string }).copiedQuizUrl =
            url;
        },
      },
    });
  });
  await page.route("**/api/generate", (route) =>
    route.fulfill({ json: { quiz } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  await expect(
    page.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  await page.locator(".answer-option").first().click();
  await expect(
    page.getByText("QUESTION 2 OF 5", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Quiz link copied");
  const url = await page.evaluate(
    () => (window as typeof window & { copiedQuizUrl: string }).copiedQuizUrl,
  );
  expect(new URL(url).searchParams.get("quiz")).toBe(quiz.id);
  expect(url.length).toBeLessThan(100);
  const recipient = await context.newPage();
  await mockArtwork(recipient);
  await recipient.route("**/api/quizzes/*", (route) =>
    route.fulfill({ json: { quiz } }),
  );
  await recipient.goto(url);
  await expect(
    recipient.getByText("QUESTION 1 OF 5", { exact: true }),
  ).toBeVisible();
  await expect(
    recipient.locator('.answer-option[aria-pressed="true"]'),
  ).toHaveCount(0);
  await recipient
    .getByRole("button", { name: "New quiz", exact: true })
    .click();
  expect(new URL(recipient.url()).search).toBe("");
  await recipient.close();
});

test("sharing a result links to the quiz with the result's preview card", async ({
  page,
}) => {
  const { quiz } = reusableFixture();
  await mockArtwork(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (url: string) => {
          (window as typeof window & { copiedQuizUrl?: string }).copiedQuizUrl =
            url;
        },
      },
    });
  });
  await page.route("**/api/generate", (route) =>
    route.fulfill({ json: { quiz } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Find out", exact: true }).click();
  for (let index = 1; index <= quiz.questions.length; index++) {
    await expect(
      page.getByText(`QUESTION ${index} OF 5`, { exact: true }),
    ).toBeVisible();
    await page.locator(".answer-option").first().click();
  }
  await page.getByRole("button", { name: "Share my result" }).click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Result link copied",
  );
  const url = new URL(
    await page.evaluate(
      () => (window as typeof window & { copiedQuizUrl: string }).copiedQuizUrl,
    ),
  );
  expect(url.searchParams.get("quiz")).toBe(quiz.id);
  expect(quiz.results.map((result) => result.id)).toContain(
    url.searchParams.get("got"),
  );
});
