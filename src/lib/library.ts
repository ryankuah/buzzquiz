import { parseQuiz, type Quiz } from "./quiz";

// The complete, compressed quiz travels in the URL fragment. It isn't sent to
// the web server and works without a database or a recipient's local storage.
export async function createShareUrl(
  quiz: Quiz,
  origin: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parseQuiz(quiz)));
  const compressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  const encoded = btoa(String.fromCharCode(...new Uint8Array(compressed)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  if (encoded.length > 24000)
    throw new Error("This quiz is too large for a share link.");
  return `${origin}/#quiz=${encoded}`;
}
export async function readShareUrl(hash: string): Promise<Quiz | null> {
  if (!hash.startsWith("#quiz=")) return null;
  const encoded = hash.slice(6);
  if (encoded.length > 24000) throw new Error("This quiz link is too large.");
  const bytes = Uint8Array.from(
    atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 100000) {
      await reader.cancel();
      throw new Error("This quiz link contains too much data.");
    }
    chunks.push(value);
  }
  return parseQuiz(JSON.parse(await new Blob(chunks as BlobPart[]).text()));
}
