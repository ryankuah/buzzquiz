import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { type Doc } from "./_generated/dataModel";
import { libraryKind } from "./schema";
import { authorize, secret } from "./auth";
import { assetIdentity, assetName } from "../src/lib/topic-text";

const atlas = v.object({
  url: v.string(),
  columns: v.number(),
  rows: v.number(),
  width: v.number(),
  height: v.number(),
});

// Embeddings stay server-side; callers only need what to draw and where.
function publicAsset(row: Doc<"library">) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    topic: row.topic,
    atlas: row.atlas,
    cell: row.cell,
  };
}

type PublicAsset = ReturnType<typeof publicAsset>;
type SearchHit = PublicAsset & { score: number };

export const rowsById = internalQuery({
  args: { ids: v.array(v.id("library")) },
  handler: async (ctx, args) =>
    (await Promise.all(args.ids.map((id) => ctx.db.get(id)))).map((row) =>
      row ? { ...publicAsset(row), model: row.model } : null,
    ),
});

// Vector search is only available in actions. One call answers every query
// of a quiz plan, so a search costs a single round trip.
export const search = action({
  args: {
    ...secret,
    model: v.string(),
    queries: v.array(
      v.object({
        vector: v.array(v.float64()),
        kind: libraryKind,
        limit: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<SearchHit[][]> => {
    authorize(args.secret);
    const hits = await Promise.all(
      args.queries.map((item) =>
        ctx.vectorSearch("library", "by_embedding", {
          vector: item.vector,
          limit: Math.max(1, Math.min(64, item.limit)),
          filter: (q) => q.eq("search", `${item.kind}|${args.model}`),
        }),
      ),
    );
    const ids = [...new Set(hits.flat().map((hit) => hit._id))];
    const rows: Array<(PublicAsset & { model: string }) | null> = ids.length
      ? await ctx.runQuery(internal.library.rowsById, { ids })
      : [];
    const byId = new Map(ids.map((id, index) => [id, rows[index]]));
    return hits.map((list) =>
      list.flatMap((hit) => {
        const row = byId.get(hit._id);
        // Scores from different embedding models aren't comparable.
        if (!row || row.model !== args.model) return [];
        const { model: _model, ...asset } = row;
        return [{ ...asset, score: hit._score }];
      }),
    );
  },
});

export const get = query({
  args: { ...secret, ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    return Promise.all(
      args.ids.map(async (id) => {
        const row = await ctx.db
          .query("library")
          .withIndex("by_public_id", (q) => q.eq("id", id))
          .unique();
        return row ? publicAsset(row) : null;
      }),
    );
  },
});

/** Exact identities compare names and categories, independent of embedding model. */
export const portraits = query({
  args: { ...secret, topic: v.string(), names: v.array(v.string()) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    return Promise.all(
      args.names.map(async (name) => {
        const row = await ctx.db
          .query("library")
          .withIndex("by_identity", (q) =>
            q.eq("identity", assetIdentity(args.topic, name)),
          )
          .first();
        return row ? publicAsset(row) : null;
      }),
    );
  },
});

/** Other depictions of a name. The quiz writer checks what each actually shows. */
export const namedSprites = query({
  args: { ...secret, names: v.array(v.string()) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    return Promise.all(
      args.names.map(async (name) => {
        const rows = await ctx.db
          .query("library")
          .withIndex("by_name_key", (q) => q.eq("nameKey", assetName(name)))
          .take(8);
        return rows.map(publicAsset);
      }),
    );
  },
});

// Existing sprites can gain exact identities without recomputing their embeddings.
export const indexIdentities = mutation({
  args: { ...secret, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const { page, isDone, continueCursor } = await ctx.db
      .query("library")
      .paginate({ cursor: args.cursor, numItems: 64 });
    let indexed = 0;
    for (const asset of page) {
      if (asset.kind !== "sprite" || (asset.identity && asset.nameKey))
        continue;
      await ctx.db.patch(asset._id, {
        identity: assetIdentity(asset.topic, asset.name),
        nameKey: assetName(asset.name),
      });
      indexed++;
    }
    return { isDone, continueCursor, indexed };
  },
});

export const add = mutation({
  args: {
    ...secret,
    assets: v.array(
      v.object({
        id: v.string(),
        kind: libraryKind,
        name: v.string(),
        description: v.string(),
        topic: v.string(),
        atlas,
        cell: v.number(),
        embedding: v.array(v.float64()),
        model: v.string(),
        source: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    authorize(args.secret);
    let added = 0;
    for (const asset of args.assets) {
      const current = await ctx.db
        .query("library")
        .withIndex("by_public_id", (q) => q.eq("id", asset.id))
        .unique();
      if (current) continue;
      await ctx.db.insert("library", {
        ...asset,
        ...(asset.kind === "sprite"
          ? {
              identity: assetIdentity(asset.topic, asset.name),
              nameKey: assetName(asset.name),
            }
          : {}),
        search: `${asset.kind}|${asset.model}`,
      });
      added++;
    }
    return added;
  },
});

/** Sources already indexed, so the library backfill can be re-run safely. */
export const indexedSources = query({
  args: { ...secret, sources: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    if (args.sources) {
      const rows = await Promise.all(
        args.sources.map((source) =>
          ctx.db
            .query("library")
            .withIndex("by_source", (q) => q.eq("source", source))
            .first(),
        ),
      );
      return rows.flatMap((row) => (row ? [row.source] : []));
    }
    // Older importers request the entire list. Skip past each source in the
    // index so a large set of 3,072-dimensional embeddings is never scanned.
    const sources: string[] = [];
    let row = await ctx.db.query("library").withIndex("by_source").first();
    while (row) {
      const source = row.source;
      sources.push(source);
      row = await ctx.db
        .query("library")
        .withIndex("by_source", (q) => q.gt("source", source))
        .first();
    }
    return sources;
  },
});

/** Ready content sets whose packed artwork can seed the library. */
export const packedContent = query({
  args: secret,
  handler: async (ctx, args) => {
    authorize(args.secret);
    const quizzes = await ctx.db.query("quizzes").collect();
    // Content sets don't record their topic; the quizzes using them do.
    const topicFor = (url: string) => {
      for (const { quiz } of quizzes) {
        if (quiz.resultArtwork?.url === url) return quiz.settings.subject;
        if (quiz.questionArtwork?.url === url) return quiz.settings.basis;
      }
      return null;
    };
    const rows = await ctx.db.query("content").collect();
    return rows.flatMap((row) =>
      row.status === "ready" &&
      row.artwork?.packed &&
      (row.kind === "outcomes" || row.kind === "questions")
        ? [
            {
              key: row.key,
              kind: row.kind,
              data: row.data,
              artwork: row.artwork,
              topic: topicFor(row.artwork.url) as string | null,
            },
          ]
        : [],
    );
  },
});

export const refused = query({
  args: { ...secret, keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const found = await Promise.all(
      args.keys.map((key) =>
        ctx.db
          .query("refusals")
          .withIndex("by_key", (q) => q.eq("key", key))
          .unique(),
      ),
    );
    // Rows saved before counts existed were single refusals.
    return args.keys.filter((_, index) => {
      const row = found[index];
      return !!row && (row.count ?? 2) >= 2;
    });
  },
});

export const refuse = mutation({
  args: { ...secret, keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    // A refused single subject is certain; one of several is only suspect.
    const weight = args.keys.length === 1 ? 2 : 1;
    for (const key of args.keys) {
      const current = await ctx.db
        .query("refusals")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (current)
        await ctx.db.patch(current._id, {
          count: (current.count ?? 2) + weight,
        });
      else await ctx.db.insert("refusals", { key, count: weight });
    }
  },
});
