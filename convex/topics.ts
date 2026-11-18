import { v } from "convex/values";
import {
  action,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { topicKind } from "./schema";
import { authorize, secret } from "./auth";

const embedding = v.object({ vector: v.array(v.float64()), model: v.string() });

async function aliasRow(
  ctx: Pick<QueryCtx, "db">,
  kind: "subject" | "basis" | "shared",
  alias: string,
) {
  return ctx.db
    .query("topicAliases")
    .withIndex("by_kind_alias", (q) => q.eq("kind", kind).eq("alias", alias))
    .unique();
}

export const findAlias = query({
  args: { ...secret, kind: topicKind, alias: v.string() },
  handler: async (ctx, args) => {
    authorize(args.secret);
    return (await aliasRow(ctx, args.kind, args.alias))?.topic ?? null;
  },
});

export const topicById = internalQuery({
  args: { id: v.id("topics") },
  handler: (ctx, args) => ctx.db.get(args.id),
});

// Vector search is only available in actions.
export const nearest = action({
  args: { ...secret, kind: topicKind, embedding },
  handler: async (
    ctx,
    args,
  ): Promise<{ topic: string; score: number } | null> => {
    authorize(args.secret);
    const [best] = await ctx.vectorSearch("topics", "by_embedding", {
      vector: args.embedding.vector,
      limit: 1,
      filter: (q) => q.eq("kind", args.kind),
    });
    if (!best) return null;
    const topic = await ctx.runQuery(internal.topics.topicById, {
      id: best._id,
    });
    // Scores from different embedding models aren't comparable.
    if (!topic || topic.model !== args.embedding.model) return null;
    return { topic: topic.name, score: best._score };
  },
});

export const register = mutation({
  args: {
    ...secret,
    kind: topicKind,
    alias: v.string(),
    topic: v.string(),
    embedding: v.optional(embedding),
  },
  handler: async (ctx, args) => {
    authorize(args.secret);
    // First resolution wins, so concurrent requests can't remap a wording.
    const existing = await aliasRow(ctx, args.kind, args.alias);
    if (existing) return existing.topic;
    const topic = await ctx.db
      .query("topics")
      .withIndex("by_kind_name", (q) =>
        q.eq("kind", args.kind).eq("name", args.topic),
      )
      .unique();
    if (!topic) {
      if (!args.embedding) throw new Error("Unknown topic");
      await ctx.db.insert("topics", {
        kind: args.kind,
        name: args.topic,
        embedding: args.embedding.vector,
        model: args.embedding.model,
      });
      if (args.alias !== args.topic) {
        const own = await aliasRow(ctx, args.kind, args.topic);
        if (!own)
          await ctx.db.insert("topicAliases", {
            kind: args.kind,
            alias: args.topic,
            topic: args.topic,
          });
      }
    }
    await ctx.db.insert("topicAliases", {
      kind: args.kind,
      alias: args.alias,
      topic: args.topic,
    });
    return args.topic;
  },
});

// Lists saved quiz wording so existing content can be registered as topics.
export const savedQuizTopics = query({
  args: secret,
  handler: async (ctx, args) => {
    authorize(args.secret);
    const rows = await ctx.db.query("quizzes").collect();
    return rows.map((row) => ({
      subject: row.quiz.settings.subject as string,
      basis: row.quiz.settings.basis as string,
      // Free-form quizzes (keyed by meaning) already store whole phrases.
      legacy: !row.key.startsWith("v2:"),
    }));
  },
});
