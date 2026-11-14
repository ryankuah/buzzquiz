import OpenAI from "openai";
import { getAiConfig } from "./ai-config";

export function createAiClient() {
  const { provider } = getAiConfig();
  return new OpenAI({
    apiKey:
      provider === "OpenRouter"
        ? process.env.OPENROUTER_API_KEY?.trim()
        : process.env.OPENAI_API_KEY?.trim(),
    baseURL:
      provider === "OpenRouter" ? "https://openrouter.ai/api/v1" : undefined,
    defaultHeaders: { "X-Title": "buzzquiz" },
    timeout: 90000,
    maxRetries: 0,
  });
}
