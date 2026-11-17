import { v } from "convex/values";

// Every library function takes the private server secret shared with Next.js.
export const secret = { secret: v.string() };
export function authorize(value: string) {
  if (
    !process.env.BUZZQUIZ_SERVER_SECRET ||
    value !== process.env.BUZZQUIZ_SERVER_SECRET
  )
    throw new Error("Unauthorized");
}
