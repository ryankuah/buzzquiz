// Older saved quizzes can include a literal reaction in a label or reading.
// Convert only at display time so IDs, stored answers and cache keys stay stable.
import data from "unicode-emoji-json/data-by-emoji.json";
const names: Record<string, { name: string }> = data;
const symbols =
  /(?:\p{Regional_Indicator}{1,2}|[0-9#*]\uFE0F?\u20E3|\p{Emoji_Modifier}|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)/gu;
const skinTones = [
  "light skin tone",
  "medium-light skin tone",
  "medium skin tone",
  "medium-dark skin tone",
  "dark skin tone",
];
export function quizCopy(text: string) {
  return text.replace(symbols, (glyph, offset: number) => {
    const base = glyph.replace(/\p{Emoji_Modifier}/gu, "");
    const tones = [...glyph.matchAll(/\p{Emoji_Modifier}/gu)].map(
      ([c]) => skinTones[c.codePointAt(0)! - 0x1f3fb],
    );
    const label =
      names[glyph]?.name ??
      [names[base]?.name ?? names[base + "\uFE0F"]?.name, ...tones]
        .filter(Boolean)
        .join(", ");
    if (!label && !/\p{Emoji_Presentation}|\uFE0F/u.test(glyph)) return glyph;
    const left = offset && /[\p{L}\p{N}]/u.test(text[offset - 1]) ? " " : "";
    const right = /[\p{L}\p{N}]/u.test(text[offset + glyph.length] ?? "")
      ? " "
      : "";
    return left + (label || "symbol") + right;
  });
}
