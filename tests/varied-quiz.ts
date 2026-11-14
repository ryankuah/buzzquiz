import { type Quiz } from "../src/lib/quiz";
import { questionTemplatePlan } from "../src/lib/templates";

export function variedQuiz(quiz: Quiz): Quiz {
  const plan = questionTemplatePlan(quiz.questions.length);
  return {
    ...quiz,
    questions: quiz.questions.map((question, index) => ({
      ...question,
      layout: plan[index].layout,
      answers:
        plan[index].answerCount === 4
          ? question.answers
          : [
              {
                ...question.answers[0],
                secondaryResultId: question.answers[1].resultId,
              },
              {
                ...question.answers[2],
                secondaryResultId: question.answers[3].resultId,
              },
            ],
    })),
  };
}
