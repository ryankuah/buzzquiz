import { type GenerationInput, type Quiz, type QuizContent } from "./quiz";

type Example = {
  id: string;
  subject: string;
  basis: string;
  emoji: string;
  color: string;
  content: QuizContent;
};
const muffinQuestions = [
  {
    text: "First things first. Pick your muffin.",
    emoji: "🧁",
    options: [
      ["Blueberry, always", "🫐"],
      ["Double chocolate", "🍫"],
      ["Lemon and poppy seed", "🍋"],
      ["Apple cinnamon", "🍎"],
    ],
  },
  {
    text: "What makes a muffin worth getting out of bed for?",
    emoji: "☀️",
    options: [
      ["A familiar, comforting flavour", "🏡"],
      ["An unapologetically gooey centre", "✨"],
      ["A flavour I haven't tried yet", "🧭"],
      ["Warm spices and a crunchy top", "🍂"],
    ],
  },
  {
    text: "Your dream bakery is…",
    emoji: "🥐",
    options: [
      ["A tiny cottage with books everywhere", "📚"],
      ["A glittery patisserie open until midnight", "🌙"],
      ["A hidden spot on a road trip", "🚙"],
      ["A neighbourhood café that knows my order", "☕"],
    ],
  },
  {
    text: "You're baking muffins for a friend. What's the plan?",
    emoji: "👩‍🍳",
    options: [
      ["Use the recipe they loved last time", "💌"],
      ["Add frosting. And edible glitter", "🪩"],
      ["Invent a completely new flavour", "🧪"],
      ["Make a big batch for everyone", "🧺"],
    ],
  },
  {
    text: "Choose a drink for your muffin moment.",
    emoji: "🫖",
    options: [
      ["A proper cup of tea", "🍵"],
      ["An iced mocha with extra cream", "🧋"],
      ["Whatever the barista recommends", "🥤"],
      ["A warm cinnamon latte", "☕"],
    ],
  },
] as const;

function makeContent(
  title: string,
  description: string,
  emoji: string,
  results: QuizContent["results"],
  questions: ReadonlyArray<{
    text: string;
    emoji: string;
    options: ReadonlyArray<readonly [string, string]>;
  }>,
): QuizContent {
  return {
    title,
    description,
    emoji,
    results: results.map((result) => ({
      ...result,
      imagePrompt: `A miniature portrait of ${result.title}, no writing.`,
    })),
    questions: questions.map((q, index) => ({
      id: `q${index + 1}`,
      text: q.text,
      emoji: q.emoji,
      imagePrompt: `A small scene with objects evoking ${q.text}, no writing.`,
      answers: q.options.map(([text, emoji], i) => ({
        id: `a${i + 1}`,
        text,
        imagePrompt: `An illustration of ${text}, no writing.`,
        emoji,
        resultId: results[i].id,
        secondaryResultId: null,
      })),
    })),
  };
}

export const examples: Example[] = [
  {
    id: "princess",
    subject: "Disney princess",
    basis: "your favourite muffins",
    emoji: "🧁",
    color: "peach",
    content: makeContent(
      "What Disney princess are you based on your favourite muffins?",
      "Five very important muffin decisions. One royal revelation.",
      "🧁",
      [
        {
          id: "belle",
          title: "Belle",
          emoji: "📚",
          description:
            "Blueberry-and-a-book energy. You find magic in the little things, have strong opinions about a good story, and make people feel at home. Your ideal adventure starts with a warm muffin and an open mind.",
        },
        {
          id: "rapunzel",
          title: "Rapunzel",
          emoji: "🌸",
          description:
            "A little extra, in the very best way. You bring colour, curiosity, and double-chocolate enthusiasm to everything. You'd absolutely turn a casual baking afternoon into an event. Please invite us.",
        },
        {
          id: "moana",
          title: "Moana",
          emoji: "🌊",
          description:
            "You follow your curiosity, even when it leads to a wildly unexpected flavour combination. Brave, independent, and always up for something new, you're the friend who says 'let's try it' and actually means it.",
        },
        {
          id: "tiana",
          title: "Tiana",
          emoji: "👑",
          description:
            "Warm cinnamon, big dreams, and a recipe you've perfected yourself. You're thoughtful, determined, and happiest when the people you love are well fed. Your secret ingredient is showing up.",
        },
      ],
      muffinQuestions,
    ),
  },
  {
    id: "cat",
    subject: "cat",
    basis: "your coffee order",
    emoji: "🐈",
    color: "lavender",
    content: makeContent(
      "What cat are you based on your coffee order?",
      "Your coffee order has whiskers. Let's find them.",
      "🐈",
      [
        {
          id: "tabby",
          title: "The cosy tabby",
          emoji: "🐈",
          description:
            "Reliable flat-white energy. You're easy to be around, quietly loyal, and excellent at finding the sunniest seat. A good routine is your love language.",
        },
        {
          id: "orange",
          title: "The chaotic orange cat",
          emoji: "🐱",
          description:
            "Extra shot, extra personality. You act first, think later, and somehow make it all work. Your friends never know what you're about to do, but they always want to come along.",
        },
        {
          id: "black",
          title: "The mysterious black cat",
          emoji: "🐈‍⬛",
          description:
            "Espresso, no explanation. You have impeccable taste and a small circle of favourite people. Beneath that cool exterior is a deeply affectionate little weirdo.",
        },
        {
          id: "ragdoll",
          title: "The soft-hearted ragdoll",
          emoji: "🤍",
          description:
            "Sweet latte energy, right down to the foam art. You're warm, generous, and always ready to listen. People come for a coffee and stay for your company.",
        },
      ],
      [
        {
          text: "What's your usual coffee order?",
          emoji: "☕",
          options: [
            ["A flat white", "☕"],
            ["Triple-shot iced latte", "🧊"],
            ["Straight espresso", "🖤"],
            ["Vanilla oat latte", "🤍"],
          ],
        },
        {
          text: "Pick your café seat.",
          emoji: "🪑",
          options: [
            ["The sunny window", "☀️"],
            ["Wherever my friends are", "🎉"],
            ["A quiet corner", "📖"],
            ["The comfy sofa", "🛋️"],
          ],
        },
        {
          text: "The barista got your order wrong. You…",
          emoji: "🙃",
          options: [
            ["Politely ask for my usual", "🙂"],
            ["Discover my new favourite drink", "🤩"],
            ["Raise one very expressive eyebrow", "🤨"],
            ["Drink it anyway, it's a busy morning", "🫶"],
          ],
        },
        {
          text: "What comes with your coffee?",
          emoji: "🥐",
          options: [
            ["A classic croissant", "🥐"],
            ["A pastry I've never heard of", "🎲"],
            ["Nothing. Coffee is the point", "✋"],
            ["A cookie to share", "🍪"],
          ],
        },
        {
          text: "Your ideal coffee date is…",
          emoji: "💬",
          options: [
            ["A weekly catch-up", "🗓️"],
            ["An entirely spontaneous adventure", "🛼"],
            ["Reading together in comfortable silence", "📚"],
            ["A long chat about absolutely everything", "💌"],
          ],
        },
      ],
    ),
  },
  {
    id: "city",
    subject: "city",
    basis: "your perfect weekend",
    emoji: "🛵",
    color: "mint",
    content: makeContent(
      "What city are you based on your perfect weekend?",
      "No passport required. Just some strong weekend opinions.",
      "🛵",
      [
        {
          id: "melbourne",
          title: "Melbourne",
          emoji: "☕",
          description:
            "Slow coffee, hidden bookshops, and a suspiciously good brunch. You're creative, quietly curious, and know that the best plans leave room for a detour.",
        },
        {
          id: "tokyo",
          title: "Tokyo",
          emoji: "🗼",
          description:
            "You're equal parts big-city energy and tiny, carefully chosen details. You can turn an ordinary Saturday into a full itinerary and still find something unexpected along the way.",
        },
        {
          id: "lisbon",
          title: "Lisbon",
          emoji: "🌅",
          description:
            "Sunshine and no urgent plans. You make room for the good stuff: long lunches, winding walks, and staying out just a little later than you meant to.",
        },
        {
          id: "copenhagen",
          title: "Copenhagen",
          emoji: "🚲",
          description:
            "A bike ride, a good pastry, and people you love. You make simple things feel special. Your weekends are proof that doing less can feel like having everything.",
        },
      ],
      [
        {
          text: "Saturday morning starts with…",
          emoji: "🌤️",
          options: [
            ["Finding a new brunch spot", "🥑"],
            ["An early start and a full itinerary", "🗺️"],
            ["Sleeping in with the window open", "🛌"],
            ["Cycling to get fresh pastries", "🚲"],
          ],
        },
        {
          text: "You've got a free afternoon. Where to?",
          emoji: "🧭",
          options: [
            ["An indie bookshop", "📚"],
            ["The busiest street market", "🏮"],
            ["Somewhere with an ocean view", "🌊"],
            ["The park with a picnic", "🧺"],
          ],
        },
        {
          text: "Pick your weekend food.",
          emoji: "🍽️",
          options: [
            ["Something from a tiny neighbourhood café", "☕"],
            ["Street food, lots of it", "🍜"],
            ["Seafood and a long lunch", "🦐"],
            ["Homemade dinner with friends", "🥘"],
          ],
        },
        {
          text: "Saturday night looks like…",
          emoji: "🌙",
          options: [
            ["Live music in a small venue", "🎸"],
            ["Bright lights and one more stop", "🎮"],
            ["Watching the sunset turn into evening", "🌅"],
            ["Board games and candles", "🕯️"],
          ],
        },
        {
          text: "Sunday's one non-negotiable?",
          emoji: "💛",
          options: [
            ["A really good coffee", "☕"],
            ["Trying something completely new", "✨"],
            ["Absolutely no rush", "🌴"],
            ["Time with my favourite people", "🫶"],
          ],
        },
      ],
    ),
  },
];

export const defaultSettings: GenerationInput = {
  subject: examples[0].subject,
  basis: examples[0].basis,
  questionCount: 5,
  tone: "playful",
  layout: "card-grid",
  theme: "basic",
};

export function exampleQuiz(
  id: string,
  presentation: Pick<GenerationInput, "theme" | "layout"> = defaultSettings,
): Quiz {
  const example = examples.find((item) => item.id === id) ?? examples[0];
  return {
    ...structuredClone(example.content),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "example",
    settings: {
      ...defaultSettings,
      ...presentation,
      subject: example.subject,
      basis: example.basis,
    },
  };
}
