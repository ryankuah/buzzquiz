import { api } from "../../../../convex/_generated/api";
import { convexConnection } from "@/lib/convex-repository";
import { buildSuggestions, type Suggestions } from "@/lib/suggestions";

export const runtime = "nodejs";

// Saved quizzes change slowly; one read a minute is plenty.
let cached: { at: number; value: Promise<Suggestions> } | undefined;

export async function GET() {
  if (!cached || Date.now() - cached.at > 60_000) {
    const value = (async () => {
      const { client, secret } = convexConnection();
      return buildSuggestions(
        await client.query(api.topics.savedQuizTopics, { secret }),
      );
    })();
    cached = { at: Date.now(), value };
    value.catch(() => (cached = undefined));
  }
  try {
    return Response.json(await cached.value, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  } catch {
    return Response.json({ subjects: [], bases: [], pairs: [] });
  }
}
