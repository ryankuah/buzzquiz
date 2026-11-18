import { createHash } from "node:crypto";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { createAiClient } from "./ai-client";
import { getAiConfig } from "./ai-config";
import { meaningText } from "./normalize-prompt";
import { typefaceSchema, type GenerationInput } from "./quiz";
import { archetypeSchema } from "./content-sets";
import { questionTemplatePlan } from "./templates";
import {
  archetypeInstructions,
  cutoutInstructions,
  topicInstructions,
  typefaceInstructions,
} from "./generation-prompts";

const text = (max: number) => z.string().trim().min(1).max(max);
// Older saved plans contain the meaning and outcomes, but no quiz questions.
export const ideaSchema = z.object({
  title: text(100),
  outcomeCategory: text(60),
  outcomeRelation: text(60),
  questionTopic: text(60),
  questionAngle: text(60),
  outcomes: z
    .array(
      z.object({
        name: text(45),
        description: text(200),
        imagePrompt: text(240),
      }),
    )
    .length(4),
  visualQueries: z.array(text(80)).min(6).max(16),
  scene: text(240),
  typeface: typefaceSchema,
});
const plannedAnswer = z.object({
  text: z.string().trim().min(1),
  resultId: archetypeSchema,
  secondaryResultId: archetypeSchema.nullable(),
});
export const quizPlanSchema = ideaSchema.extend({
  outcomes: z
    .array(
      ideaSchema.shape.outcomes.element.extend({
        archetype: archetypeSchema.optional(),
      }),
    )
    .length(4),
  questions: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        neutralSubject: text(50).nullable(),
        answers: z.union([
          z.array(plannedAnswer).length(2),
          z.array(plannedAnswer).length(4),
        ]),
      }),
    )
    .min(5)
    .max(10),
});
export type QuizPlan = z.infer<typeof quizPlanSchema>;
export { meaningText };
// Constrained decoding at a mobile character limit can produce half a word.
// Request concise prose and enforce storage bounds after the whole string exists.
const newPlanSchema = quizPlanSchema.omit({ visualQueries: true }).extend({
  outcomes: z
    .array(
      ideaSchema.shape.outcomes.element.extend({ archetype: archetypeSchema }),
    )
    .length(4),
  visualQueries: ideaSchema.shape.visualQueries,
});

export function validateQuizPlan(value: unknown, count?: number): QuizPlan {
  const plan = quizPlanSchema.parse(value);
  if (
    new Set(plan.outcomes.map((outcome) => meaningText(outcome.name))).size !==
    4
  )
    throw new Error("The quiz needs four different results.");
  const roles = plan.outcomes.flatMap((o) =>
    o.archetype ? [o.archetype] : [],
  );
  if (roles.length && new Set(roles).size !== 4)
    throw new Error("The four results need distinct scoring archetypes.");
  const layout = questionTemplatePlan(count ?? plan.questions.length);
  if (plan.questions.length !== layout.length)
    throw new Error("The plan has the wrong number of questions.");
  const decisions = new Set<string>();
  for (const [index, q] of plan.questions.entries()) {
    if (q.text.length > 240 || q.answers.some((a) => a.text.length > 180))
      throw new Error("The quiz wording is too long to display.");
    const labels = q.answers.map((a) => meaningText(a.text));
    const choiceSet = [...labels].sort().join("|");
    if (new Set(labels).size !== labels.length || decisions.has(choiceSet))
      throw new Error("The plan repeats a set of choices.");
    decisions.add(choiceSet);
    const votes = q.answers.flatMap((a) =>
      a.secondaryResultId ? [a.resultId, a.secondaryResultId] : [a.resultId],
    );
    if (
      q.answers.length !== layout[index].answerCount ||
      votes.length !== 4 ||
      new Set(votes).size !== 4 ||
      q.answers.some(
        (a) => (q.answers.length === 2) !== (a.secondaryResultId !== null),
      )
    )
      throw new Error("The planned choices don't cover four distinct results.");
  }
  return plan;
}

/**
 * The meaning of a quiz, independent of its wording. Two phrasings that plan
 * to the same categories, relation and angle share one saved quiz.
 */
export function planQuizKey(
  plan: z.infer<typeof ideaSchema>,
  input: GenerationInput,
) {
  return `v2:${createHash("sha256")
    .update(
      JSON.stringify([
        meaningText(plan.outcomeCategory),
        meaningText(plan.outcomeRelation),
        meaningText(plan.questionTopic),
        meaningText(plan.questionAngle),
        input.questionCount,
        input.tone,
      ]),
    )
    .digest("hex")}`;
}

/** Caches the plan by exact wording, so repeats never re-interpret. */
export function wordingKey(input: GenerationInput, version: 2 | 3 = 3) {
  return `plan:v${version}:${createHash("sha256")
    .update(
      JSON.stringify([
        meaningText(input.subject),
        meaningText(input.basis),
        input.questionCount,
        input.tone,
      ]),
    )
    .digest("hex")}`;
}

export async function planQuiz(
  input: GenerationInput,
  signal?: AbortSignal,
  client = createAiClient(),
): Promise<QuizPlan> {
  const config = getAiConfig();
  const response = await client.responses.parse(
    {
      model: config.model,
      store: false,
      max_output_tokens: 5200,
      ...(config.provider === "OpenRouter"
        ? { provider: { require_parameters: true, allow_fallbacks: false } }
        : {}),
      input: [
        {
          role: "system",
          content: `Interpret a playful personality quiz idea written as "Find out FIND_OUT based on BASED_ON".
${topicInstructions}
FIND_OUT names what the result reveals; it decides the outcome category. BASED_ON names what the questions ask about. Either may be any category, including food, places, animals, characters or objects. Never substitute a different category: if FIND_OUT is muffins, the results are kinds of muffin.
title: a natural, grammatical quiz headline (max 100 chars) that keeps the person's meaning, e.g. "Which Disney Princess Are You, Based on Your Snack Choices?".
outcomeCategory: the singular category the results belong to, e.g. "Disney princess", "city", "muffin". outcomeRelation: how a result relates to the player in 2-5 lowercase words, e.g. "you are", "should be your best friend", "you should live in".
questionTopic: the singular subject of the questions, e.g. "snack". questionAngle: what about it the questions explore, in 1-4 lowercase words, e.g. "choices", "least favourite", "habits".
outcomes: exactly four distinct, real members of outcomeCategory with recognisably different personalities. Give their actual names. description states what the image depicts. ${cutoutInstructions} A place is shown by a recognisable landmark.
${archetypeInstructions}
Assign one different archetype to each named outcome. Base the scoring on why that outcome fits the player.
Write the FINAL questions and answer choices now. They must make sense out loud, with all pictures hidden. Each question asks a different decision about BASED_ON. Keep scenarios self-contained: give the player any information needed to choose. If you ask about strength or frequency, all options must describe that same measure. A behaviour should reveal its scored trait through a meaningful choice; owning an object alone doesn't reveal a personality. Use the given answer counts. Four answers award one distinct archetype each with secondaryResultId=null. Two answers award disjoint pairs that cover all four. Vary their order. Do not reveal outcomes, internal traits, or scoring in the wording. Check the choices against each other for overlap, repetition and contradictions.
Use short, complete copy that fits a phone. Aim for questions under 80 characters and answers of 3–9 words, usually under 50 characters. Finish each thought naturally. Shorten the whole sentence when needed. Preserve names and the user's language.
Each question starts a fresh situation: two choices made on different screens must be compatible. If players choose incompatible coffee drinks or preparations, set them on separate visits. Ground every option in the setup. If the question asks what you would say, every option must be something you could say. If the choices describe actions, ask what you would do. Give behavioural context when a bare preference such as temperature would say little about a trait.
neutralSubject is an optional concrete object explicitly named in the question's setup BEFORE the decision. Only name one if an isolated picture would be fair to every answer. Never name a person performing an action, the resolution of a situation or something that suggests one choice. Use null whenever in doubt.
visualQueries: after writing the questions, list 6–16 short search terms drawn from the actual choices, neutral subjects and setting. Use the names of what would be visible in those pictures.
scene: an atmospheric background scene inspired by the questions, with no people or characters and a calm centre.
typeface: ${typefaceInstructions}
Tone: ${input.tone}. This is entertainment: no sensitive inferences, insults or real private individuals.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            findOut: input.subject,
            basedOn: input.basis,
            answerCounts: questionTemplatePlan(input.questionCount).map(
              (q) => q.answerCount,
            ),
          }),
        },
      ],
      text: { format: zodTextFormat(newPlanSchema, "quiz_plan") },
    },
    { signal },
  );
  if (!response.output_parsed)
    throw new Error(
      "That quiz idea couldn't be understood. Try wording it differently.",
    );
  return validateQuizPlan(response.output_parsed, input.questionCount);
}
