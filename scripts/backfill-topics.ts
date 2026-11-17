import { api } from "../convex/_generated/api";
import {
  convexConnection,
  createConvexTopicRepository,
} from "../src/lib/convex-repository";
import { canonicalBasis, canonicalSubject } from "../src/lib/normalize-prompt";
import { embedTopics, type TopicKind } from "../src/lib/topics";

// Registers the wording of every saved quiz as its own topic, so different
// names typed later can match content that predates topic matching. Each saved
// wording keeps its own topic (they are never merged with each other), which
// keeps every existing content key reachable. Uses one embedding request per
// batch of new wording and no generation quota.
// Run with Node's --env-file=.env.local and optionally override CONVEX_URL.
async function main() {
  const { client, secret } = convexConnection();
  const topics = createConvexTopicRepository();
  const saved = await client.query(api.topics.savedQuizTopics, { secret });
  const pending: Array<{ kind: TopicKind; name: string }> = [];
  const seen = new Set<string>();
  for (const quiz of saved) {
    for (const [kind, name] of [
      ["subject", canonicalSubject(quiz.subject)],
      ["basis", canonicalBasis(quiz.basis)],
    ] as const) {
      if (!name || seen.has(`${kind}:${name}`)) continue;
      seen.add(`${kind}:${name}`);
      if (!(await topics.findAlias(kind, name))) pending.push({ kind, name });
    }
  }
  for (let index = 0; index < pending.length; index += 50) {
    const batch = pending.slice(index, index + 50);
    const embeddings = await embedTopics(batch.map((topic) => topic.name));
    for (const [position, { kind, name }] of batch.entries())
      await topics.register(kind, name, name, embeddings[position]);
  }
  console.log(
    `Registered ${pending.length} new topics from ${saved.length} saved quizzes.`,
  );
  for (const topic of pending) console.log(`  ${topic.kind}: ${topic.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
