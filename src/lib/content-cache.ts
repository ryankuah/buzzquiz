import {
  type ContentKind,
  type ContentRepository,
  type ReadyContent,
} from "./content-sets";
import { ProviderRefusalError } from "./generation-budget";

export async function resolveContent(
  repository: ContentRepository,
  key: string,
  kind: ContentKind,
  generate: (owner: string, draft?: unknown) => Promise<ReadyContent>,
  options: {
    signal?: AbortSignal;
    beforeGenerate?: () => void;
    wait?: () => Promise<void>;
  } = {},
): Promise<ReadyContent> {
  const signal = options.signal || AbortSignal.timeout(285000);
  while (true) {
    signal.throwIfAborted();
    const existing = await repository.findContent(key);
    if (existing?.blocked) throw new ProviderRefusalError();
    if (existing?.status === "ready")
      return {
        data: existing.data,
        ...(existing.artwork ? { artwork: existing.artwork } : {}),
      };
    if (
      !existing ||
      existing.status !== "building" ||
      existing.leaseUntil <= Date.now()
    )
      options.beforeGenerate?.();
    const claim = await repository.claim(key, kind);
    if (claim.state === "ready") return claim.content;
    if (claim.state === "blocked") throw new ProviderRefusalError();
    if (claim.state === "wait") {
      await (
        options.wait ||
        (() => new Promise((resolve) => setTimeout(resolve, 750)))
      )();
      continue;
    }
    try {
      const content = await generate(claim.owner, claim.draft);
      await repository.complete(key, claim.owner, content);
      return content;
    } catch (error) {
      await repository
        .fail(key, claim.owner, error instanceof ProviderRefusalError)
        .catch(() => {});
      throw error;
    }
  }
}
