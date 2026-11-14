// Adapted from VisionVerse shared/appTemplates.ts. Layouts and themes are
// independent from quiz content; switching either never changes the scoring.
export const layouts = [
  {
    id: "hero-grid",
    name: "Picture & grid",
    description: "A visual, then the choices",
  },
  {
    id: "card-grid",
    name: "Answer cards",
    description: "Big, expressive choices",
  },
  {
    id: "stack",
    name: "Answer list",
    description: "Simple and straight to it",
  },
] as const;

export const themes = [
  {
    id: "basic",
    name: "Basic",
    background: "#fffdf7",
    foreground: "#26251f",
    accent: "#ee542d",
  },
  {
    id: "scent",
    name: "Scent",
    background: "#0a0d33",
    foreground: "#ffffff",
    accent: "#c6bbfc",
  },
  {
    id: "study",
    name: "Study",
    background: "#072540",
    foreground: "#b8f7d3",
    accent: "#04bf68",
  },
  {
    id: "foodie",
    name: "Foodie",
    background: "#cceaf8",
    foreground: "#600800",
    accent: "#ff9e70",
  },
] as const;

export type LayoutId = (typeof layouts)[number]["id"];
export type ThemeId = (typeof themes)[number]["id"];
// A fixed rhythm makes every saved quiz varied without adding player settings.
export function questionTemplatePlan(count: number) {
  const cycle: Array<{ layout: LayoutId; answerCount: 2 | 4 }> = [
    { layout: "hero-grid", answerCount: 4 },
    { layout: "card-grid", answerCount: 2 },
    { layout: "stack", answerCount: 4 },
    { layout: "hero-grid", answerCount: 2 },
    { layout: "card-grid", answerCount: 4 },
    { layout: "stack", answerCount: 2 },
  ];
  return Array.from(
    { length: count },
    (_, index) => cycle[index % cycle.length],
  );
}
export const getTheme = (id: ThemeId) =>
  themes.find((theme) => theme.id === id)!;
