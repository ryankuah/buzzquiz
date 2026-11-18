export class ProviderRefusalError extends Error {
  constructor() {
    super(
      "This image provider couldn't illustrate that subject. Try a different subject; saved quizzes still work.",
    );
  }
}
