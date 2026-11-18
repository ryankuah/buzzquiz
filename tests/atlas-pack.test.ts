import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { cutPairs } from "../src/lib/cutout-quality";
import { composeAtlas, packAtlas } from "../src/lib/atlas-pack";

const CELL = 100;

async function sheet(svg: string, width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg}</svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
}

// Counts opaque pixels by dominant colour inside one packed cell.
async function colours(atlas: Buffer, column: number, row = 0) {
  const { data } = await sharp(atlas)
    .extract({
      left: column * CELL,
      top: row * CELL,
      width: CELL,
      height: CELL,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const count = { red: 0, blue: 0, green: 0, edge: 0 };
  for (let index = 0; index < CELL * CELL; index++) {
    const [r, g, b, a] = data.subarray(index * 4, index * 4 + 4);
    if (a < 128) continue;
    const x = index % CELL,
      y = Math.floor(index / CELL);
    if (x < 4 || y < 4 || x >= CELL - 4 || y >= CELL - 4) count.edge++;
    if (r > 180 && g < 90 && b < 90) count.red++;
    if (b > 180 && r < 90 && g < 90) count.blue++;
    if (g > 120 && r < 90 && b < 90) count.green++;
  }
  return count;
}

async function pack(source: Buffer, layout: Parameters<typeof packAtlas>[1]) {
  const packed = await packAtlas(source, layout, { cell: CELL });
  return {
    ...packed,
    atlas: await composeAtlas(packed.width, layout.rows * CELL, packed.layers),
  };
}

test("objects that drift across the drawn grid stay whole, in their own cell, with clean padding", async () => {
  // The red circle spills 20px into the blue cell; a naive crop shows both.
  const source = await sheet(
    '<circle cx="140" cy="100" r="80" fill="#e22"/><rect x="250" y="40" width="110" height="120" fill="#22e"/>',
    400,
    200,
  );
  const { atlas, empty } = await pack(source, { rows: 1, columns: 2 });
  const [first, second] = [await colours(atlas, 0), await colours(atlas, 1)];
  assert.ok(first.red > 3000 && first.blue === 0, JSON.stringify(first));
  assert.ok(second.blue > 3000 && second.red === 0, JSON.stringify(second));
  assert.equal(first.edge + second.edge, 0);
  assert.deepEqual(empty, []);
});

test("an object drawn straddling two cells is split, and strays into empty slots are kept", async () => {
  // Row: [hero, answer, EMPTY]. The green bar straddles hero/answer evenly;
  // the blue square was drawn in the empty third slot.
  const source = await sheet(
    '<rect x="60" y="80" width="180" height="40" fill="#1a1"/><rect x="230" y="40" width="40" height="40" fill="#e22"/><rect x="330" y="60" width="50" height="80" fill="#22e"/>',
    450,
    200,
  );
  const { atlas, empty } = await pack(source, {
    rows: 1,
    columns: 3,
    occupied: (_row, column) => column < 2,
  });
  const cells = [
    await colours(atlas, 0),
    await colours(atlas, 1),
    await colours(atlas, 2),
  ];
  assert.ok(cells[0].green > 0 && cells[1].green > 0, JSON.stringify(cells));
  assert.ok(cells[1].red > 0 && cells[1].blue > 0, JSON.stringify(cells));
  assert.equal(cells[2].red + cells[2].green + cells[2].blue, 0);
  assert.deepEqual(empty, []);
});

test("a large subject spilling into a neighbour's art stays whole", async () => {
  // The red subject is mostly in cell 0 but reaches 30% into cell 1, which
  // holds its own blue subject: slicing it would put red into cell 1.
  const source = await sheet(
    '<rect x="40" y="60" width="225" height="80" fill="#e22"/><rect x="300" y="60" width="60" height="80" fill="#22e"/>',
    400,
    200,
  );
  const { atlas, empty } = await pack(source, { rows: 1, columns: 2 });
  const [first, second] = [await colours(atlas, 0), await colours(atlas, 1)];
  assert.ok(first.red > 2000 && first.blue === 0, JSON.stringify(first));
  assert.ok(second.blue > 1000 && second.red === 0, JSON.stringify(second));
  assert.deepEqual(empty, []);
});

test("strays from an unused slot don't stop touching subjects being split", async () => {
  // Red (cell 0) touches blue (cell 1); a green stray sits in unused cell 2
  // and is moved to cell 1, which must not make cell 1 look already drawn.
  const source = await sheet(
    '<rect x="20" y="60" width="130" height="80" fill="#e22"/><rect x="150" y="60" width="110" height="80" fill="#22e"/><rect x="330" y="80" width="40" height="40" fill="#1a1"/>',
    450,
    200,
  );
  const { atlas } = await pack(source, {
    rows: 1,
    columns: 3,
    occupied: (_row, column) => column < 2,
  });
  const [first, second] = [await colours(atlas, 0), await colours(atlas, 1)];
  assert.ok(first.red > 1000 && first.blue === 0, JSON.stringify(first));
  assert.ok(second.blue > 500 && second.red === 0, JSON.stringify(second));
});

test("cells the model left blank are reported and stay transparent", async () => {
  const source = await sheet(
    '<circle cx="50" cy="50" r="30" fill="#e22"/>',
    200,
    100,
  );
  const { atlas, empty } = await pack(source, { rows: 1, columns: 2 });
  assert.deepEqual(empty, [1]);
  const blank = await colours(atlas, 1);
  assert.equal(blank.red + blank.green + blank.blue, 0);
});

test("ambiguous touching figures leave empty library slots without losing neighbouring art", async () => {
  const source = await sheet(
    '<rect x="45" y="20" width="110" height="65" fill="#e22"/><circle cx="250" cy="50" r="36" fill="#22e"/>',
    300,
    100,
  );
  const packed = await packAtlas(
    source,
    { rows: 1, columns: 3 },
    { cell: CELL, rejectAmbiguous: true },
  );
  assert.deepEqual(packed.empty, [0, 1]);
  assert.ok(
    (await colours(await composeAtlas(packed.width, CELL, packed.layers), 2))
      .blue > 1000,
  );
});

test("the real split pretzel and the contaminated cookie are both withheld", async () => {
  // Downsampled alpha from the original dev library sheet, before the player
  // rearranged it. Popcorn, sliced pretzel, cookie with pretzel fragment, empty.
  const source = await readFile(
    new URL("./fixtures/cut-pretzel-alpha.png", import.meta.url),
  );
  assert.deepEqual([...(await cutPairs(source, 4, 1))], [1, 2]);
});

test("straight-sided objects beside an accessory are safe to reuse", async () => {
  const good = await sheet(
    '<rect x="18" y="20" rx="5" width="65" height="60" fill="red"/><rect x="114" y="22" rx="5" width="52" height="56" fill="blue"/><circle cx="182" cy="62" r="9" fill="green"/>',
    200,
    100,
  );
  assert.deepEqual([...(await cutPairs(good, 2, 1))], []);
});
