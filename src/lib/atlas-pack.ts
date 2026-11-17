import sharp, { type OverlayOptions } from "sharp";

export type PackLayout = {
  rows: number;
  columns: number;
  /** Cells that should contain art; others (e.g. unused binary slots) stay empty. */
  occupied?: (row: number, column: number) => boolean;
};

const SOLID = 16; // Alpha that counts as part of an object.
const MIN_PIXELS = 4; // Smaller specks are compression noise.
const SPLIT_SHARE = 0.2; // An object this shared across cells was drawn overlapping.

/**
 * Image models never draw a sprite sheet on an exact grid: objects drift and
 * overlap neighbouring cells, so cropping by fixed fractions leaves slivers of
 * other art. This finds every object by its alpha, gives it to the cell it was
 * drawn for, and re-centres each cell's art with padding in an exact grid.
 */
export async function packAtlas(
  sheet: Buffer,
  layout: PackLayout,
  options: { cell?: number; padding?: number } = {},
) {
  const cell = options.cell ?? 512;
  const padding = options.padding ?? 0.08;
  const { rows, columns } = layout;
  const occupied = (row: number, column: number) =>
    layout.occupied ? layout.occupied(row, column) : true;
  const { data, info } = await sharp(sheet)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const cells = rows * columns;
  const nominal = (x: number, y: number) =>
    Math.min(rows - 1, Math.floor((y * rows) / height)) * columns +
    Math.min(columns - 1, Math.floor((x * columns) / width));
  const isOccupied = (index: number) =>
    occupied(Math.floor(index / columns), index % columns);

  // 1. Connected components of solid pixels (8-connected).
  const label = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  const components: Array<{ counts: Int32Array; size: number }> = [];
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] <= SOLID) continue;
    const id = components.length;
    const counts = new Int32Array(cells);
    let head = 0,
      tail = 0;
    label[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width,
        y = (index - x) / width;
      counts[nominal(x, y)]++;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (label[next] !== -1 || data[next * 4 + 3] <= SOLID) continue;
          label[next] = id;
          queue[tail++] = next;
        }
      }
    }
    components.push({ counts, size: tail });
  }

  // 2. Each object belongs to the cell holding most of it. Art that strays
  // into an empty slot goes to the nearest cell of its row that wants art.
  const nearestOccupied = (index: number) => {
    if (isOccupied(index)) return index;
    const row = Math.floor(index / columns),
      column = index % columns;
    for (let distance = 1; distance < columns; distance++)
      for (const candidate of [column - distance, column + distance])
        if (candidate >= 0 && candidate < columns && occupied(row, candidate))
          return row * columns + candidate;
    return -1;
  };
  const owner = components.map(({ counts, size }) => {
    if (size < MIN_PIXELS) return { cell: -1, split: false };
    let best = 0,
      second = -1;
    for (let index = 1; index < cells; index++) {
      if (counts[index] > counts[best]) {
        second = best;
        best = index;
      } else if (second === -1 || counts[index] > counts[second])
        second = index;
    }
    const split =
      second !== -1 &&
      counts[second] > size * SPLIT_SHARE &&
      isOccupied(best) &&
      isOccupied(second);
    return { cell: nearestOccupied(best), split };
  });

  // 3. Assign pixels, including faint anti-aliased edges next to an object.
  const assigned = new Int16Array(width * height).fill(-1);
  const bounds = Array.from({ length: cells }, () => ({
    left: width,
    top: height,
    right: -1,
    bottom: -1,
  }));
  const assign = (index: number, target: number) => {
    assigned[index] = target;
    const x = index % width,
      y = (index - x) / width,
      box = bounds[target];
    if (x < box.left) box.left = x;
    if (x > box.right) box.right = x;
    if (y < box.top) box.top = y;
    if (y > box.bottom) box.bottom = y;
  };
  for (let index = 0; index < label.length; index++) {
    const component = label[index];
    if (component === -1) continue;
    const { cell: home, split } = owner[component];
    if (home === -1) continue;
    let target = home;
    if (split) {
      const x = index % width;
      const own = nominal(x, (index - x) / width);
      if (isOccupied(own)) target = own;
    }
    assign(index, target);
  }
  for (let index = 0; index < label.length; index++) {
    if (assigned[index] !== -1 || data[index * 4 + 3] === 0) continue;
    const x = index % width,
      y = (index - x) / width;
    for (let dy = -1; dy <= 1 && assigned[index] === -1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = assigned[ny * width + nx];
        if (neighbour !== -1 && label[ny * width + nx] !== -1) {
          assign(index, neighbour);
          break;
        }
      }
  }

  // 4. Re-centre each cell's art, scaled to fit inside the padded tile.
  const inner = Math.round(cell * (1 - 2 * padding));
  const layers: OverlayOptions[] = [];
  const empty: number[] = [];
  for (let index = 0; index < cells; index++) {
    const box = bounds[index];
    if (box.right < 0) {
      if (isOccupied(index)) empty.push(index);
      continue;
    }
    const w = box.right - box.left + 1,
      h = box.bottom - box.top + 1;
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const source = (box.top + y) * width + box.left + x;
        if (assigned[source] !== index) continue;
        data.copy(pixels, (y * w + x) * 4, source * 4, source * 4 + 4);
      }
    const art = await sharp(pixels, {
      raw: { width: w, height: h, channels: 4 },
    })
      .resize({
        width: inner,
        height: inner,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    layers.push({
      input: art,
      left: (index % columns) * cell + Math.round((cell - inner) / 2),
      top: Math.floor(index / columns) * cell + Math.round((cell - inner) / 2),
    });
  }
  return { layers, width: columns * cell, cell, empty };
}

/** Composes packed cells (plus any extra layers) into one transparent atlas. */
export async function composeAtlas(
  width: number,
  height: number,
  layers: OverlayOptions[],
) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
}
