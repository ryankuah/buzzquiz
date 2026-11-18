import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { api } from "../convex/_generated/api";
import { assetSearchText, type LibraryAsset } from "../src/lib/asset-library";
import { convexConnection } from "../src/lib/convex-repository";
import { embedTopics } from "../src/lib/topics";
import portraits from "../src/lib/category-portraits.json";

const text = z.string().trim().min(1);
const choice = z.object({ name: text, description: text });
const questionSheet = (rows: number) =>
  z.object({
    categories: z
      .array(
        z.object({
          topic: text,
          question: text,
          outcomes: z.array(choice).length(4),
        }),
      )
      .length(rows),
  });
const illustrationBank = z.array(
  z.object({
    sheet: text,
    cells: z.array(choice.extend({ topic: text })),
  }),
);
type Entry = Pick<LibraryAsset, "name" | "topic" | "description">;
type Sheet = {
  source: string;
  file: string;
  kind: LibraryAsset["kind"];
  columns: number;
  entries: Entry[];
  ids: string[];
};
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function uuid(hex: string) {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "8" + hex.slice(13, 16),
    "a" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}
async function catalogue() {
  const sheets: Sheet[] = portraits.map(({ sheet, categories }) => {
    const entries = categories.flatMap((c) =>
      c.outcomes.map((o) => ({ ...o, topic: c.topic })),
    );
    return {
      source: "category-portraits/v1/" + sheet,
      kind: "sprite",
      columns: 4,
      file: `public/art/category-portraits/v1/${sheet}.webp`,
      entries,
      ids: entries.map((_, i) => `portrait-v1-${sheet}-${i}`),
    };
  });
  function add(
    source: string,
    file: string,
    kind: Sheet["kind"],
    columns: number,
    entries: Entry[],
  ) {
    sheets.push({
      source,
      file,
      kind,
      columns,
      entries,
      ids: entries.map((_, i) => uuid(hash(source + "#" + i))),
    });
  }
  for (const [bank, rows, columns] of [
    ["question-bank", 4, 4],
    ["portrait-bank", 1, 2],
  ] as const) {
    const bankRoot = path.join("assets", bank);
    for (const dir of (await readdir(bankRoot, { withFileTypes: true })).filter(
      (d) => d.isDirectory(),
    )) {
      const root = path.join(bankRoot, dir.name);
      for (const json of (await readdir(root))
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        const { categories } = questionSheet(rows).parse(
          JSON.parse(await readFile(path.join(root, json), "utf8")),
        );
        const stem = json.slice(0, -5);
        add(
          [bank, "v1", dir.name, stem].join("/"),
          path.join(root, stem + ".webp"),
          "sprite",
          columns,
          categories.flatMap((c) =>
            c.outcomes.map((o) => ({ ...o, topic: c.topic })),
          ),
        );
      }
    }
  }
  for (const [kind, folder, columns] of [
    ["scene", "scene-bank", 2],
    ["decoration", "decoration-bank", 4],
    ["sprite", "featured-subjects", 2],
    ["scene", "scene-illustrations", 1],
    ["scene", "city-scenes", 1],
    ["sprite", "place-portraits", 2],
    ["sprite", "story-portraits", 2],
  ] as const) {
    const root = path.join("assets", folder);
    const banks = illustrationBank.parse(
      JSON.parse(await readFile(path.join(root, "catalogue.json"), "utf8")),
    );
    for (const { sheet, cells } of banks)
      add(
        folder + "/v1/" + sheet,
        path.join(root, sheet + ".webp"),
        kind,
        columns,
        cells,
      );
  }
  return sheets;
}

async function readSheet(sheet: Sheet) {
  const bytes = await readFile(sheet.file);
  const image = await sharp(bytes).metadata();
  if (
    image.format !== "webp" ||
    !image.width ||
    image.width !== image.height ||
    image.width % sheet.columns ||
    sheet.entries.length !== sheet.columns ** 2
  )
    throw Error("Invalid sheet dimensions: " + sheet.file);
  if (sheet.kind !== "scene") {
    if (!image.hasAlpha) throw Error("Missing transparency: " + sheet.file);
    const side = 48,
      width = sheet.columns * side;
    const alpha = await sharp(bytes)
      .resize(width, width)
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    for (const [cell, entry] of sheet.entries.entries()) {
      const left = (cell % sheet.columns) * side,
        top = Math.floor(cell / sheet.columns) * side;
      let clear = 0,
        solid = 0;
      for (let y = top; y < top + side; y++)
        for (let x = left; x < left + side; x++) {
          const a = alpha[y * width + x];
          if (a < 16) clear++;
          if (a > 128) solid++;
        }
      if (clear < 20 || solid < 10)
        throw Error("Empty or opaque cell: " + sheet.file + " / " + entry.name);
    }
  }
  return { bytes, width: image.width, height: image.height };
}

async function main() {
  const sheets = await catalogue();
  const ids = sheets.flatMap((s) => s.ids);
  if (new Set(ids).size !== ids.length)
    throw Error("Stock art IDs must be unique.");
  const args = process.argv.slice(2);
  const prefixes = args.filter((arg) => arg !== "--check");
  const selected = prefixes.length
    ? sheets.filter((sheet) =>
        prefixes.some((prefix) => sheet.source.startsWith(prefix)),
      )
    : sheets;
  if (!selected.length)
    throw Error("No sheets match the supplied source prefixes.");
  if (args.includes("--check")) {
    const files = new Set(sheets.map((sheet) => sheet.file));
    const directories = new Set(
      selected.map((sheet) => path.dirname(sheet.file)),
    );
    for (const dir of directories) {
      for (const name of await readdir(dir)) {
        if (name.endsWith(".webp") && !files.has(path.join(dir, name)))
          throw Error("Missing catalogue entry for " + path.join(dir, name));
      }
    }
    for (const sheet of selected) await readSheet(sheet);
    const cells = selected.reduce(
      (count, sheet) => count + sheet.ids.length,
      0,
    );
    console.log(`Checked ${cells} local cells on ${selected.length} sheets.`);
    return;
  }
  const { client, secret } = convexConnection();
  async function importSheet(sheet: Sheet) {
    const { bytes, width, height } = await readSheet(sheet);
    const digest = hash(bytes),
      id = uuid(digest);
    const url = "/api/quiz-assets/" + id;
    const atlas = {
      url,
      columns: sheet.columns,
      rows: sheet.columns,
      width,
      height,
    };
    const assets = sheet.entries.map((e, cell) => ({
      ...e,
      id: sheet.ids[cell],
      source: sheet.source,
      kind: sheet.kind,
      atlas,
      cell,
    }));
    const existing = await client.query(api.library.get, {
      secret,
      ids: sheet.ids,
    });
    function validate(row: LibraryAsset, i: number) {
      const a = assets[i];
      if (
        row.id !== a.id ||
        row.cell !== i ||
        row.atlas.url !== url ||
        row.atlas.width !== atlas.width ||
        row.atlas.columns !== atlas.columns ||
        row.atlas.rows !== atlas.rows ||
        row.atlas.height !== atlas.height ||
        row.name !== a.name ||
        row.topic !== a.topic ||
        row.description !== a.description ||
        row.kind !== a.kind
      )
        throw Error("Stored entry differs: " + a.id);
    }
    existing.forEach((row, i) => {
      if (row) validate(row, i);
    });
    let stored = await client.query(api.cache.assetUrl, { secret, id });
    if (!stored) {
      const upload = await client.mutation(api.cache.uploadUrl, { secret });
      const response = await fetch(upload, {
        method: "POST",
        headers: { "Content-Type": "image/webp" },
        body: new Uint8Array(bytes),
      });
      if (!response.ok) throw Error("Storage upload HTTP " + response.status);
      const { storageId } = await response.json();
      await client.mutation(api.cache.saveAsset, { secret, id, storageId });
      stored = await client.query(api.cache.assetUrl, { secret, id });
    }
    if (!stored) throw Error("Missing stored atlas " + id);
    const download = await fetch(stored);
    if (
      !download.ok ||
      hash(Buffer.from(await download.arrayBuffer())) !== digest
    )
      throw Error("Stored image checksum mismatch: " + sheet.file);
    const missing = assets.filter((_, i) => !existing[i]);
    let added = 0;
    if (missing.length) {
      const vectors = await embedTopics(missing.map(assetSearchText));
      added = await client.mutation(api.library.add, {
        secret,
        assets: missing.map((a, i) => ({
          ...a,
          embedding: vectors[i].vector,
          model: vectors[i].model,
        })),
      });
    }
    const saved = missing.length
      ? await client.query(api.library.get, { secret, ids: sheet.ids })
      : existing;
    saved.forEach((row, i) => {
      if (!row) throw Error("Missing " + sheet.ids[i]);
      validate(row, i);
    });
    console.log(
      sheet.source,
      saved.length,
      "verified",
      missing.length,
      "requested",
    );
    return { added, verified: saved.length };
  }
  let verified = 0,
    added = 0;
  // Bound simultaneous uploads, embedding requests and Convex writes.
  const pending = selected.values();
  async function sync() {
    for (const sheet of pending) {
      const result = await importSheet(sheet);
      verified += result.verified;
      added += result.added;
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, sync));
  console.log(
    JSON.stringify({
      target: process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
      sheets: selected.length,
      added,
      verified,
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
