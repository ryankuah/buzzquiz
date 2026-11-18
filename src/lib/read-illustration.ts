import { readFile } from "node:fs/promises";
import path from "node:path";
import { illustrationAtlas } from "./quiz-illustrations";
import { portraitSheets } from "./bundled-portraits";
import { readQuizImage } from "./asset-store";

export function readIllustration(
  url: string,
  read: (id: string) => Promise<Buffer | null> = readQuizImage,
) {
  if (portraitSheets.has(url)) {
    return readFile(
      path.join(
        process.cwd(),
        "public/art/category-portraits/v1",
        path.basename(url),
      ),
    );
  }
  if (url === illustrationAtlas.url)
    return readFile(
      path.join(process.cwd(), "public/art/quiz-illustrations-v1.webp"),
    );
  return read(url.split("/").pop()!);
}
