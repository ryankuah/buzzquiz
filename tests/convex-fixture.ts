import { defineTestApp } from "convex-test";
import schema from "../convex/schema";
import * as cache from "../convex/cache";
import * as library from "../convex/library";
import {
  type Claim,
  type ContentRecord,
  type ContentRepository,
} from "../src/lib/content-sets";
import { parseQuiz } from "../src/lib/quiz";

export const app = defineTestApp({ schema }).defineModules({ cache, library });
export const secret = "only-for-in-memory-tests";
export function setup() {
  process.env.BUZZQUIZ_SERVER_SECRET = secret;
  const t = app.createTest();
  const update = async (
    key: string,
    owner: string,
    status: "building" | "ready" | "failed",
    extra = {},
  ) => {
    await t.mutation(app.api.cache.updateContent, {
      secret,
      key,
      owner,
      status,
      ...extra,
    });
  };
  const repository: ContentRepository = {
    async findQuiz(key) {
      const q = await t.query(app.api.cache.findQuiz, { secret, key });
      return q ? parseQuiz(q) : null;
    },
    async saveQuiz(key, quiz) {
      return parseQuiz(
        await t.mutation(app.api.cache.saveQuiz, { secret, key, quiz }),
      );
    },
    async findContent(key) {
      return (await t.query(app.api.cache.findContent, {
        secret,
        key,
      })) as ContentRecord | null;
    },
    async claim(key, kind) {
      return (await t.mutation(app.api.cache.claim, {
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
      await t.mutation(app.api.cache.recordCall, { secret, key, owner, type });
    },
  };
  return { t, repository };
}
