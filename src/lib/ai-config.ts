export function getAiConfig() {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    return {
      configured: true,
      provider: "OpenRouter",
      model: process.env.QUIZ_AI_MODEL?.trim() || "openai/gpt-6.1-terra",
      readingModel:
        process.env.QUIZ_READING_MODEL?.trim() || "openai/gpt-6-luna",
    } as const;
  }
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
  return {
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    provider: "OpenAI",
    model,
    readingModel: model,
  } as const;
}

export function getImageConfig(foreground = false) {
  const ai = getAiConfig();
  return {
    provider: ai.provider,
    configured: ai.configured,
    model:
      ai.provider === "OpenRouter"
        ? foreground
          ? process.env.QUIZ_FOREGROUND_MODEL?.trim() ||
            "openai/gpt-image-2.6-flare"
          : process.env.QUIZ_IMAGE_MODEL?.trim() ||
            "google/gemini-3.1-flash-lite-image"
        : process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2",
  };
}
