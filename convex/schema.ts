import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const topicKind = v.union(
  v.literal("subject"),
  v.literal("basis"),
  v.literal("shared"),
);

export const libraryKind = v.union(
  v.literal("sprite"),
  v.literal("scene"),
  v.literal("decoration"),
);

export default defineSchema({
  content: defineTable({
    key: v.string(),
    kind: v.union(
      v.literal("outcomes"),
      v.literal("questions"),
      v.literal("reading"),
      v.literal("topic-assets"),
      v.literal("plan"),
      v.literal("quiz"),
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
    // False until the lease's first paid call charges a daily attempt.
    charged: v.optional(v.boolean()),
    textCalled: v.optional(v.boolean()),
    imageCalled: v.optional(v.boolean()),
    backgroundCalled: v.optional(v.boolean()),
    portraitCalled: v.optional(v.boolean()),
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
  // Shared artwork library. Every cutout, scene and sticker ever drawn is
  // searchable by meaning, independently of the quiz it was drawn for. Each
  // entry points at one exact cell of a packed atlas, so no pixels are copied.
  library: defineTable({
    id: v.string(),
    kind: libraryKind,
    name: v.string(),
    description: v.string(),
    topic: v.string(),
    atlas: v.object({
      url: v.string(),
      columns: v.number(),
      rows: v.number(),
      width: v.number(),
      height: v.number(),
    }),
    cell: v.number(),
    embedding: v.array(v.float64()),
    model: v.string(),
    // "kind|model", so searches only rank comparable vectors.
    search: v.string(),
    identity: v.optional(v.string()),
    nameKey: v.optional(v.string()),
    source: v.string(),
  })
    .index("by_public_id", ["id"])
    .index("by_source", ["source"])
    .index("by_identity", ["identity"])
    .index("by_name_key", ["nameKey"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 3072,
      filterFields: ["search"],
    }),
  // Result pictures the image provider refused, by category and name, so
  // later quizzes show their emoji instead of paying to be refused again.
  // Keys include the image model. A sheet refusal can't tell which subject
  // caused it, so a subject counts as refused alone or after two refusals.
  refusals: defineTable({
    key: v.string(),
    count: v.optional(v.number()),
  }).index("by_key", ["key"]),
  usage: defineTable({
    day: v.string(),
    attempts: v.number(),
    textCalls: v.number(),
    imageCalls: v.number(),
  }).index("by_day", ["day"]),
});
