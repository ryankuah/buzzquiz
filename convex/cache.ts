import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { dailyGenerationLimit } from "../src/lib/generation-budget";
import { authorize, secret } from "./auth";

export const findContent = query({
  args: { ...secret, key: v.string() },
  handler: async (ctx, args) => {
    authorize(args.secret);
    return ctx.db
      .query("content")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
  },
});
export const claim = mutation({
  args: {
    ...secret,
    key: v.string(),
    kind: v.union(
      v.literal("outcomes"),
      v.literal("questions"),
      v.literal("reading"),
    ),
    owner: v.string(),
  },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const current = await ctx.db
      .query("content")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (current?.status === "ready")
      return {
        state: "ready" as const,
        content: {
          data: current.data,
          ...(current.artwork ? { artwork: current.artwork } : {}),
        },
      };
    if (current?.blocked) return { state: "blocked" as const };
    const now = Date.now();
    if (current?.status === "building" && current.leaseUntil > now)
      return { state: "wait" as const };
    const day = new Date(now).toISOString().slice(0, 10);
    const usage = await ctx.db
      .query("usage")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    if (
      (usage?.attempts || 0) >=
      dailyGenerationLimit(process.env.DAILY_GENERATION_LIMIT)
    )
      return { state: "limited" as const };
    if (usage) await ctx.db.patch(usage._id, { attempts: usage.attempts + 1 });
    else
      await ctx.db.insert("usage", {
        day,
        attempts: 1,
        textCalls: 0,
        imageCalls: 0,
      });
    const update = {
      status: "building" as const,
      owner: args.owner,
      leaseUntil: now + 300000,
      updatedAt: now,
      budgetDay: day,
      textCalled: false,
      imageCalled: false,
      backgroundCalled: false,
    };
    if (current) await ctx.db.patch(current._id, update);
    else
      await ctx.db.insert("content", {
        key: args.key,
        kind: args.kind,
        ...update,
      });
    return {
      state: "claimed" as const,
      owner: args.owner,
      ...(current?.data ? { draft: current.data } : {}),
    };
  },
});
export const updateContent = mutation({
  args: {
    ...secret,
    key: v.string(),
    owner: v.string(),
    status: v.union(
      v.literal("building"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    data: v.optional(v.any()),
    artwork: v.optional(v.any()),
    blocked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const current = await ctx.db
      .query("content")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (
      !current ||
      current.owner !== args.owner ||
      current.status !== "building"
    )
      throw new Error("Generation lease lost");
    await ctx.db.patch(current._id, {
      status: args.status,
      ...(args.blocked !== undefined ? { blocked: args.blocked } : {}),
      updatedAt: Date.now(),
      ...(args.data !== undefined ? { data: args.data } : {}),
      ...(args.artwork ? { artwork: args.artwork } : {}),
    });
  },
});
export const recordCall = mutation({
  args: {
    ...secret,
    key: v.string(),
    owner: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("background"),
    ),
  },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const job = await ctx.db
      .query("content")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (
      !job ||
      job.owner !== args.owner ||
      job.status !== "building" ||
      job.leaseUntil <= Date.now()
    )
      throw new Error("Generation lease lost");
    // Each attempt allows at most one text request, one image request, and one
    // background scene, even if a caller accidentally retries. Counters live
    // in Convex, across Vercel instances.
    const called = (
      {
        text: "textCalled",
        image: "imageCalled",
        background: "backgroundCalled",
      } as const
    )[args.type];
    if (job[called]) throw new Error("This AI call was already used");
    await ctx.db.patch(job._id, { [called]: true });
    const day = job.budgetDay || new Date().toISOString().slice(0, 10);
    const usage = await ctx.db
      .query("usage")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    const field = args.type === "text" ? "textCalls" : "imageCalls";
    if (usage) await ctx.db.patch(usage._id, { [field]: usage[field] + 1 });
  },
});
export const findQuiz = query({
  args: { ...secret, key: v.optional(v.string()), id: v.optional(v.string()) },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const row = args.id
      ? await ctx.db
          .query("quizzes")
          .withIndex("by_public_id", (q) => q.eq("id", args.id!))
          .unique()
      : await ctx.db
          .query("quizzes")
          .withIndex("by_key", (q) => q.eq("key", args.key!))
          .unique();
    return row?.quiz ?? null;
  },
});
export const saveQuiz = mutation({
  args: { ...secret, key: v.string(), quiz: v.any() },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const current = await ctx.db
      .query("quizzes")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (current) return current.quiz;
    await ctx.db.insert("quizzes", {
      key: args.key,
      id: args.quiz.id,
      quiz: args.quiz,
    });
    return args.quiz;
  },
});
export const uploadUrl = mutation({
  args: secret,
  handler: async (ctx, args) => {
    authorize(args.secret);
    return ctx.storage.generateUploadUrl();
  },
});
export const saveAsset = mutation({
  args: { ...secret, id: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const current = await ctx.db
      .query("assets")
      .withIndex("by_public_id", (q) => q.eq("id", args.id))
      .unique();
    if (current) throw new Error("Artwork IDs are immutable");
    await ctx.db.insert("assets", { id: args.id, storageId: args.storageId });
  },
});
export const assetUrl = query({
  args: { ...secret, id: v.string() },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const row = await ctx.db
      .query("assets")
      .withIndex("by_public_id", (q) => q.eq("id", args.id))
      .unique();
    return row ? ctx.storage.getUrl(row.storageId) : null;
  },
});
export const usage = query({
  args: secret,
  handler: async (ctx, args) => {
    authorize(args.secret);
    const day = new Date().toISOString().slice(0, 10);
    const usage = await ctx.db
      .query("usage")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    return {
      day,
      limit: dailyGenerationLimit(process.env.DAILY_GENERATION_LIMIT),
      attempts: usage?.attempts || 0,
      textCalls: usage?.textCalls || 0,
      imageCalls: usage?.imageCalls || 0,
    };
  },
});

// Import previously generated local content without spending generation quota.
// This uses the same private server credential as all other library writes.
export const seedContent = mutation({
  args: {
    ...secret,
    key: v.string(),
    kind: v.union(
      v.literal("outcomes"),
      v.literal("questions"),
      v.literal("reading"),
    ),
    data: v.any(),
    artwork: v.optional(v.any()),
    replaceFailed: v.optional(v.boolean()),
    replaceReading: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    authorize(args.secret);
    const current = await ctx.db
      .query("content")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (
      current &&
      !(args.replaceFailed && current.status === "failed") &&
      !(
        args.replaceReading &&
        args.kind === "reading" &&
        current.kind === "reading"
      )
    )
      return false;
    const data = {
      key: args.key,
      kind: args.kind,
      data: args.data,
      ...(args.artwork ? { artwork: args.artwork } : {}),
      status:
        args.artwork || args.kind === "reading"
          ? ("ready" as const)
          : ("failed" as const),
      blocked: false,
      owner: "migration",
      leaseUntil: 0,
      updatedAt: Date.now(),
    };
    if (current) await ctx.db.patch(current._id, data);
    else await ctx.db.insert("content", data);
    return true;
  },
});
