import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync(chrome) ? chrome : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3210",
    launchOptions: { executablePath },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1050 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run start -- --port 3210",
    url: "http://127.0.0.1:3210",
    reuseExistingServer: false,
    env: {
      CONVEX_URL: "",
      NEXT_PUBLIC_CONVEX_URL: "",
      BUZZQUIZ_SERVER_SECRET: "",
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      QUIZ_STORE_DIR: join(process.cwd(), "test-results", "quiz-library"),
      QUIZ_ASSET_DIR: join(process.cwd(), "test-results", "quiz-assets"),
    },
  },
});
