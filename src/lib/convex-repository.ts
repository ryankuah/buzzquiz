import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { parseQuiz } from "./quiz";
import { type TopicRepository } from "./topics";
import { type LibraryRepository } from "./asset-library";
import { withBundledPortraits } from "./bundled-portraits";
import {
  type Claim,
  type ContentRecord,
  type ContentRepository,
} from "./content-sets";

export function convexConnection() {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.BUZZQUIZ_SERVER_SECRET;
  if (!url || !secret)
    throw new Error(
      "The quiz library isn't available right now. Please try again later.",
    );
  return { client: new ConvexHttpClient(url), secret };
}

export function createConvexRepository(): ContentRepository {
  const { client, secret } = convexConnection();
  const update = async (
    key: string,
    owner: string,
    status: "building" | "ready" | "failed",
    extra: { data?: unknown; artwork?: unknown; blocked?: boolean } = {},
  ) => {
    await client.mutation(api.cache.updateContent, {
      secret,
      key,
      owner,
      status,
      ...extra,
    });
  };
  return {
    async findQuiz(key) {
      const quiz = await client.query(api.cache.findQuiz, { secret, key });
      return quiz ? parseQuiz(quiz) : null;
    },
    async saveQuiz(key, quiz) {
      return parseQuiz(
        await client.mutation(api.cache.saveQuiz, {
          secret,
          key,
          quiz: parseQuiz(quiz),
        }),
      );
    },
    async findContent(key) {
      return (await client.query(api.cache.findContent, {
        secret,
        key,
      })) as ContentRecord | null;
    },
    async claim(key, kind) {
      return (await client.mutation(api.cache.claim, {
        secret,
        key,
        kind,
        owner: crypto.randomUUID(),
      })) as Claim;
    },
    checkpoint: (key, owner, data) => update(key, owner, "building", { data }),
    complete: (key, owner, content) => update(key, owner, "ready", content),
    fail: (key, owner, blocked = false) =>
      update(key, owner, "failed", { blocked }),
    async recordCall(key, owner, type) {
      await client.mutation(api.cache.recordCall, { secret, key, owner, type });
    },
  };
}

export function createConvexTopicRepository(): TopicRepository {
  const { client, secret } = convexConnection();
  return {
    findAlias: (kind, alias) =>
      client.query(api.topics.findAlias, { secret, kind, alias }),
    nearest: (kind, embedding) =>
      client.action(api.topics.nearest, { secret, kind, embedding }),
    async register(kind, alias, topic, embedding) {
      await client.mutation(api.topics.register, {
        secret,
        kind,
        alias,
        topic,
        ...(embedding ? { embedding } : {}),
      });
    },
  };
}

export function createConvexLibraryRepository(): LibraryRepository {
  const { client, secret } = convexConnection();
  return withBundledPortraits({
    portraits: (topic, names) =>
      client.query(api.library.portraits, { secret, topic, names }),
    namedSprites: (names) =>
      client.query(api.library.namedSprites, { secret, names }),
    search: (queries, model) =>
      client.action(api.library.search, { secret, queries, model }),
    get: (ids) => client.query(api.library.get, { secret, ids }),
    add: (assets) => client.mutation(api.library.add, { secret, assets }),
    refused: (keys) => client.query(api.library.refused, { secret, keys }),
    async refuse(keys) {
      await client.mutation(api.library.refuse, { secret, keys });
    },
  });
}

export async function findQuizById(id: string) {
  const { client, secret } = convexConnection();
  const quiz = await client.query(api.cache.findQuiz, { secret, id });
  return quiz ? parseQuiz(quiz) : null;
}
