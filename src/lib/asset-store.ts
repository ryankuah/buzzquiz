import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { convexConnection } from "./convex-repository";
import { api } from "../../convex/_generated/api";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function assetDirectory() {
  return process.env.QUIZ_ASSET_DIR || `${process.cwd()}/.quiz-assets`;
}

export async function saveQuizImage(
  id: string,
  bytes: Buffer,
  options: { foreground?: boolean } = {},
) {
  if (!uuid.test(id)) throw new Error("Invalid artwork ID.");
  const image = sharp(bytes, { limitInputPixels: 20000000 });
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    !["png", "jpeg", "webp"].includes(metadata.format || "")
  )
    throw new Error("The image provider returned an invalid image.");
  const source = options.foreground
    ? sharp(await removeForegroundMatte(bytes))
    : image;
  const { data, info } = await source
    .resize({
      width: 2048,
      height: 2560,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  if (process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL) {
    const { client, secret } = convexConnection();
    const url = await client.mutation(api.cache.uploadUrl, { secret });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "image/webp" },
      body: new Uint8Array(data),
    });
    if (!response.ok) throw new Error("Couldn't store the generated artwork.");
    const { storageId } = await response.json();
    await client.mutation(api.cache.saveAsset, { secret, id, storageId });
    return { width: info.width, height: info.height };
  }
  const directory = assetDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(`${directory}/${id}.webp`, data, {
    mode: 0o600,
    flag: "wx",
  });
  // Saved quizzes keep their artwork permanently; it is part of the quiz,
  // rather than an expiring generation cache.
  return { width: info.width, height: info.height };
}

export async function readQuizImage(id: string) {
  if (!uuid.test(id)) return null;
  if (process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL) {
    const { client, secret } = convexConnection();
    const url = await client.query(api.cache.assetUrl, { secret, id });
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  }
  try {
    return await readFile(
      /* turbopackIgnore: true */ `${assetDirectory()}/${id}.webp`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Only remove magenta connected to the sheet's outer background. Interior
// colours are preserved, including pink clothing and disconnected details.
export async function removeForegroundMatte(bytes: Buffer) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Uint8Array(info.width * info.height);
  const queue = new Int32Array(seen.length);
  let head = 0,
    tail = 0;
  const visit = (index: number) => {
    if (seen[index]) return;
    seen[index] = 1;
    const offset = index * 4;
    if (data[offset] < 210 || data[offset + 1] > 75 || data[offset + 2] < 210)
      return;
    data[offset + 3] = 0;
    queue[tail++] = index;
  };
  for (let x = 0; x < info.width; x++) {
    visit(x);
    visit((info.height - 1) * info.width + x);
  }
  for (let y = 0; y < info.height; y++) {
    visit(y * info.width);
    visit(y * info.width + info.width - 1);
  }
  while (head < tail) {
    const index = queue[head++],
      x = index % info.width;
    if (x > 0) visit(index - 1);
    if (x < info.width - 1) visit(index + 1);
    if (index >= info.width) visit(index - info.width);
    if (index < seen.length - info.width) visit(index + info.width);
  }
  let transparent = 0;
  for (let offset = 3; offset < data.length; offset += 4)
    if (data[offset] === 0) transparent++;
  if (transparent < seen.length * 0.01)
    throw new Error(
      "The foreground image didn't have a removable background. Please try again later.",
    );
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
