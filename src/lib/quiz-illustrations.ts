import type { Quiz, QuizArtwork } from "./quiz";

// The order matches the cells in the bundled, AI-illustrated sheet. It also
// gives old shared quizzes a local image when they predate illustrated choices.
export const illustrationNames = [
  "Glass beakers for an experiment",
  "Handmade prototype",
  "Route map and compass",
  "Planner and pencil",
  "Two cups on a tray",
  "Notes pinned to a board",
  "Two chairs at a shared table",
  "Field notebook and magnifier",
  "Desktop computer",
  "Wrapped parcels",
  "Cookbook and mixing bowl",
  "Small theatre stage",
  "Indigo paper award ribbon",
  "Coral paper award ribbon",
  "Golden paper award ribbon",
  "Teal paper award ribbon",
  "Decorated cake",
  "Ceramic teapot",
  "Stack of books",
  "Fairytale castle",
] as const;

export const illustrationAtlas: QuizArtwork = {
  url: "/art/quiz-illustrations-v1.webp",
  columns: 4,
  rows: 5,
  width: 1024,
  height: 1280,
  model: "bundled-illustrations-v1",
  generatedAt: "2026-11-18T00:00:00.000Z",
  packed: true,
};

const subjects: [RegExp, number][] = [
  [/\b(prototype|mockup|mock-up)\b/i, 1],
  [/\b(experiments?|beakers?|lab)\b/i, 0],
  [/\b(help(?:s|ing)?|teammates?|together|collaborat\w*)\b/i, 6],
  [
    /\b(plan\w*|goals?|milestones?|schedules?|checklist|timer|priorit\w*)\b/i,
    3,
  ],
  [/\b(notes?|feedback|brainstorm\w*|discuss\w*)\b/i, 5],
  [/\b(explor\w*|research\w*|discover\w*|investigat\w*|study)\b/i, 7],
  [/\b(maps?|route|compass|backtrack\w*|scout\w*)\b/i, 2],
  [/\b(coding|code|software|app|project|keyboard|computer|debug\w*)\b/i, 8],
  [/\b(gift\w*|pack\w*|deliver\w*|parcel\w*)\b/i, 9],
  [/\b(cakes?|frosting|rosettes?|icing)\b/i, 16],
  [/\b(tea|teapot|steep\w*)\b/i, 17],
  [/\b(coffee|teacups?|café|latte)\b/i, 4],
  [/\b(muffins?|bak\w*|cook\w*|recipes?|batter|picnic|snacks?)\b/i, 10],
  [/\b(books?|librar\w*|read\w*|chapters?)\b/i, 18],
  [/\b(castle|princess|fairytale|fairy)\b/i, 19],
  [/\b(theat\w*|concert|show|perform\w*|stage|party)\b/i, 11],
];
function subject(text: string, context = "") {
  // In a recipe a test or experiment is culinary. A baking cup is not a
  // teacup. Use the question only to disambiguate an action in the answer.
  if (
    /\b(recipes?|batter|bak(?:e|ing)|muffins?)\b/i.test(context + " " + text) &&
    /\b(test|experiment|mix(?:ing)?|measure|portion)\b/i.test(text)
  )
    return 10;
  if (
    /\b(cups?|mugs?)\b/i.test(text) &&
    /\b(coffee|tea|drink|café)\b/i.test(context)
  )
    return 4;
  return subjects.find(([pattern]) => pattern.test(text))?.[1];
}
export const awardCell = (index: number) => 12 + (index % 4);
export const illustrationCell = (cell: number) => ({
  atlas: illustrationAtlas,
  cell,
});

export function questionIllustration(text: string, basis: string) {
  return subject(basis) ?? subject(text) ?? 7;
}

// Prefer a meaningful still life. Distinct decorative ribbons keep unpictured
// choices distinguishable without depicting an invented action or result.
export function answerIllustrations(
  texts: string[],
  selected: (number | undefined)[] = [],
  context = "",
) {
  const used = new Set(selected.filter((cell) => cell !== undefined));
  // Give the cookbook to an explicit recipe before a generic snack, even
  // when the more general option appears earlier on the screen.
  const matches = texts.map((text) => subject(text, context));
  const recipe = texts.findIndex(
    (text, i) =>
      selected[i] === undefined &&
      matches[i] === 10 &&
      /\b(recipe|cookbook)s?\b/i.test(text),
  );
  return matches.map((matched, index) => {
    if (selected[index] !== undefined) return selected[index];
    const match =
      matched === 10 && recipe !== -1 && index !== recipe ? undefined : matched;
    const cell =
      match !== undefined && !used.has(match)
        ? match
        : [0, 1, 2, 3]
            .map((offset) => awardCell(index + offset))
            .find((candidate) => !used.has(candidate))!;
    used.add(cell);
    return cell;
  });
}

const stockImage = (index: number) => ({ artwork: illustrationAtlas, index });

export function depictsEmoji(subject?: string) {
  return (
    !!subject &&
    /\bemojis?\b|\p{Emoji_Presentation}|\uFE0F/u.test(
      subject
        .toLowerCase()
        .replace(
          /\b(?:no|without|never (?:use|draw))\s+(?:(?:text|letters?|lettering|labels?|icons?|symbols?|logos?|pictograms?|numbers?|borders?|writing|watermarks?)\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+))*emojis?\b/g,
          "",
        ),
    )
  );
}

export function questionImage(quiz: Quiz, index: number) {
  const q = quiz.questions[index],
    atlas = quiz.questionArtwork ?? quiz.artwork;
  if (atlas && !q.imageless && !depictsEmoji(q.imagePrompt))
    return { artwork: atlas, index: index * 5 };
  // For a composed library atlas a derived palette confirms the background
  // was drawn. Its scene can set up the question without repeating an option.
  if (
    quiz.questionArtwork?.model === "asset-library-v1" &&
    quiz.style?.palette &&
    quiz.backgroundIndex !== undefined &&
    quiz.backgroundIndex <
      quiz.questionArtwork.columns * quiz.questionArtwork.rows
  )
    return { artwork: quiz.questionArtwork, index: quiz.backgroundIndex };
  return stockImage(questionIllustration(q.text, quiz.settings.basis));
}

const label = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");

// Old answers store a picture ID but usually lack its original visual brief.
// A serving of a named object is evidence of what the picture shows. Keep
// compound names intact so a tub of peach muffins cannot become a peach.
function namedObject(text: string) {
  return label(text)
    .replace(/^(?:a|an|the)\s+/, "")
    .replace(/^(?:tub|bowl|bag|handful|basket|bunch|plate) of\s+/, "")
    .replace(
      /\s+(?:for\b.*|to (?:share|pass|give|take)\b.*|in (?:an? |the )?(?:new|unfamiliar|surprising) flavou?r)$/,
      "",
    );
}

function otherAnswerCell(quiz: Quiz, qi: number, ai: number) {
  const answers = quiz.questions[qi].answers,
    target = answers[ai],
    name = namedObject(target.text);
  const siblings = answers.filter((_, i) => i !== ai);
  if (!name || siblings.some((a) => namedObject(a.text) === name)) return;
  let found: { assetId: string; cell: number } | undefined;
  for (const [i, question] of quiz.questions.entries()) {
    if (i === qi) continue;
    for (const [j, candidate] of question.answers.entries()) {
      if (
        !candidate.assetId ||
        candidate.imageless ||
        depictsEmoji(candidate.imagePrompt) ||
        siblings.some((a) => a.assetId === candidate.assetId)
      )
        continue;
      const sameBrief =
        target.imagePrompt &&
        label(target.imagePrompt) === label(candidate.imagePrompt ?? "");
      const sameObject =
        name === namedObject(candidate.text) &&
        (/^(?:a|an|the)\s/i.test(candidate.text) ||
          label(candidate.text) === name);
      if (
        target.assetId === candidate.assetId ||
        sameBrief ||
        (!target.imagePrompt &&
          (label(target.text) === label(candidate.text) || sameObject))
      ) {
        if (found && found.assetId !== candidate.assetId) return;
        found = { assetId: candidate.assetId, cell: 5 * i + j + 1 };
      }
    }
  }
  return found?.cell;
}

export function answerImage(quiz: Quiz, qi: number, ai: number) {
  const q = quiz.questions[qi],
    atlas = quiz.questionArtwork ?? quiz.artwork;
  if (
    atlas &&
    !q.answers[ai].imageless &&
    !depictsEmoji(q.answers[ai].imagePrompt)
  )
    return { artwork: atlas, index: qi * 5 + ai + 1 };
  if (atlas) {
    const index = otherAnswerCell(quiz, qi, ai);
    if (index !== undefined) return { artwork: atlas, index };
  }
  return stockImage(
    answerIllustrations(
      q.answers.map((a) => a.text),
      [],
      q.text + " " + quiz.settings.basis,
    )[ai],
  );
}

export function resultImage(quiz: Quiz, index: number) {
  const atlas = quiz.resultArtwork ?? quiz.artwork;
  return atlas &&
    !quiz.results[index].imageless &&
    !depictsEmoji(quiz.results[index].imagePrompt)
    ? {
        artwork: atlas,
        index: quiz.resultArtwork ? index : quiz.questions.length * 5 + index,
      }
    : stockImage(awardCell(index));
}
