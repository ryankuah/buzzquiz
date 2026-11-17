import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const topicKind = v.union(v.literal("subject"), v.literal("basis"));

export default defineSchema({
  content: defineTable({
    key: v.string(),
    kind: v.union(
      v.literal("outcomes"),
      v.literal("questions"),
      v.literal("reading"),
    ),
    status: v.union(
      v.literal("building"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    owner: v.string(),
    blocked: v.optional(v.boolean()),
    leaseUntil: v.number(),
    budgetDay: v.optional(v.string()),
    textCalled: v.optional(v.boolean()),
    imageCalled: v.optional(v.boolean()),
    backgroundCalled: v.optional(v.boolean()),
    data: v.optional(v.any()),
    artwork: v.optional(v.any()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  quizzes: defineTable({ key: v.string(), id: v.string(), quiz: v.any() })
    .index("by_key", ["key"])
    .index("by_public_id", ["id"]),
  assets: defineTable({ id: v.string(), storageId: v.id("_storage") }).index(
    "by_public_id",
    ["id"],
  ),
  // Semantic topic registry for the two blanks. Each topic keeps the wording
  // its content was first generated from, which is what its cache keys hash.
  topics: defineTable({
    kind: topicKind,
    name: v.string(),
    embedding: v.array(v.float64()),
    model: v.string(),
  })
    .index("by_kind_name", ["kind", "name"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 3072,
      filterFields: ["kind"],
    }),
  // Every wording already resolved, so repeats need no embedding request.
  topicAliases: defineTable({
    kind: topicKind,
    alias: v.string(),
    topic: v.string(),
  }).index("by_kind_alias", ["kind", "alias"]),
  usage: defineTable({
    day: v.string(),
    attempts: v.number(),
    textCalls: v.number(),
    imageCalls: v.number(),
  }).index("by_day", ["day"]),
});
