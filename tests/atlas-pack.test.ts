import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
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
