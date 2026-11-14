export function dailyGenerationLimit(value?: string): number {
  const limit = Number(value ?? "5");
  // Invalid configuration closes generation rather than enabling unlimited spend.
  return Number.isInteger(limit) && limit >= 0 && limit <= 100 ? limit : 0;
}
export class GenerationLimitError extends Error {
  constructor() {
    super(
      "Today's new-content limit has been reached. Saved quizzes still work. Try a saved combination or come back tomorrow.",
    );
  }
}
export class ProviderRefusalError extends Error {
  constructor() {
    super(
      "This image provider couldn't illustrate that subject. Try a different subject; saved quizzes still work.",
    );
  }
}
