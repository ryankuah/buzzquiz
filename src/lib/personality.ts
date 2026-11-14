import { z } from "zod";

const shortText = (max: number) => z.string().trim().min(1).max(max);
export const readingDraftSchema = z.object({
  headline: shortText(70),
  traits: z
    .array(shortText(22).regex(/^[A-Za-z0-9][A-Za-z0-9 &’'-]*[A-Za-z0-9]$/))
    .length(3),
  paragraphs: z.array(shortText(210)).length(2),
  evidence: z.object({ questionId: shortText(40), note: shortText(150) }),
});
export const personalityReadingSchema = readingDraftSchema.extend({
  resultId: shortText(40),
  evidence: readingDraftSchema.shape.evidence.extend({
    choice: shortText(180),
  }),
});
export type PersonalityReading = z.infer<typeof personalityReadingSchema>;
