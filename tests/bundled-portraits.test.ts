import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import catalogue from "../src/lib/category-portraits.json";
import { withBundledPortraits } from "../src/lib/bundled-portraits";
import type { LibraryAsset, LibraryRepository } from "../src/lib/asset-library";
import { readIllustration } from "../src/lib/read-illustration";

function library(remote: LibraryAsset[] = []) {
  const unavailable = () => {
    throw new Error("Unexpected remote call");
  };
  const repository: LibraryRepository = {
    portraits: async (topic, names) =>
      names.map(
        (name) =>
          remote.find(
            (asset) => asset.topic === topic && asset.name === name,
          ) ?? null,
      ),
    get: async (ids) =>
      ids.map((id) => remote.find((asset) => asset.id === id) ?? null),
    namedSprites: async (names) =>
      names.map((name) => remote.filter((asset) => asset.name === name)),
    search: unavailable,
    add: unavailable,
    refused: unavailable,
    refuse: unavailable,
  };
  return withBundledPortraits(repository);
}

test("every published outcome resolves to its distinct visible cell and survives lookup by saved ID", async () => {
  const assets = library();
  const ids = new Set<string>();
  for (const { categories } of catalogue) {
    for (const [row, { topic, outcomes }] of categories.entries()) {
      const portraits = await assets.portraits(
        topic,
        outcomes.map((o) => o.name),
      );
      for (const [column, portrait] of portraits.entries()) {
        assert.ok(portrait);
        assert.equal(portrait.cell, row * 4 + column);
        assert.equal(portrait.name, outcomes[column].name);
        assert.ok(!ids.has(portrait.id));
        ids.add(portrait.id);
      }
      assert.deepEqual(
        await assets.get(portraits.map((p) => p!.id)),
        portraits,
      );
    }
    const first = categories[0];
    const [portrait] = await assets.portraits(first.topic, [
      first.outcomes[0].name,
    ]);
    const bytes = await readIllustration(portrait!.atlas.url);
    assert.ok(bytes);
    const { data, info } = await sharp(bytes)
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, columns, rows } = portrait!.atlas;
    assert.deepEqual([info.width, info.height], [width, height]);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        let solid = 0;
        const left = (column * width) / columns,
          top = (row * height) / rows;
        assert.equal(data[top * width + left], 0);
        for (let y = top; y < top + height / rows; y += 4)
          for (let x = left; x < left + width / columns; x += 4)
            if (data[y * width + x] > 180) solid++;
        assert.ok(
          solid > 100,
          `Empty cell in ${portrait!.atlas.url} at ${column},${row}`,
        );
      }
    }
  }
});

test("mixed library reads preserve order, duplicate IDs and topic boundaries", async () => {
  const [brie] = await library().portraits("cheese", ["Brie"]);
  assert.ok(brie);
  const saved = { ...brie, name: "Gouda", id: "saved-gouda", topic: "cheese" };
  const assets = library([saved]);
  assert.deepEqual(
    await assets.portraits("cheese", ["Gouda", "Brie", "missing", "Gouda"]),
    [saved, brie, null, saved],
  );
  assert.deepEqual(await assets.get([brie.id, saved.id, "missing", brie.id]), [
    brie,
    saved,
    null,
    brie,
  ]);
  assert.deepEqual(await assets.portraits("actor", ["Brie"]), [null]);
  assert.deepEqual(await assets.namedSprites(["Brie"]), [[brie]]);
});
