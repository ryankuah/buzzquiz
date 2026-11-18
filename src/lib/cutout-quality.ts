import sharp from "sharp";

const SIDE = 128;
type Edge = { left: boolean; right: boolean; top: boolean; bottom: boolean };

/** Find long straight cuts on individual solid shapes, ignoring antialiasing and crumbs. */
function shapeEdges(alpha: Buffer, stride: number, x0: number, y0: number) {
  const seen = new Uint8Array(SIDE * SIDE);
  const queue = new Int32Array(seen.length);
  const shapes: Edge[] = [];
  const solid = (x: number, y: number) =>
    alpha[(y0 + y) * stride + x0 + x] >= 128;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !solid(start % SIDE, Math.floor(start / SIDE))) continue;
    let head = 0,
      size = 1,
      left = SIDE,
      right = -1,
      top = SIDE,
      bottom = -1;
    queue[0] = start;
    seen[start] = 1;
    while (head < size) {
      const pixel = queue[head++];
      const x = pixel % SIDE,
        y = Math.floor(pixel / SIDE);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(SIDE - 1, y + 1); ny++) {
        for (
          let nx = Math.max(0, x - 1);
          nx <= Math.min(SIDE - 1, x + 1);
          nx++
        ) {
          const next = ny * SIDE + nx;
          if (!seen[next] && solid(nx, ny)) {
            seen[next] = 1;
            queue[size++] = next;
          }
        }
      }
    }
    const w = right - left + 1,
      h = bottom - top + 1;
    if (
      size < SIDE * SIDE * 0.01 ||
      Math.min(w, h) < 7 ||
      size > SIDE * SIDE * 0.9
    )
      continue;
    const rowLeft = new Set<number>(),
      rowRight = new Set<number>();
    const colTop = new Set<number>(),
      colBottom = new Set<number>();
    for (let i = 0; i < size; i++) {
      const x = queue[i] % SIDE,
        y = Math.floor(queue[i] / SIDE);
      if (x <= left + 1) rowLeft.add(y);
      if (x >= right - 1) rowRight.add(y);
      if (y <= top + 1) colTop.add(x);
      if (y >= bottom - 1) colBottom.add(x);
    }
    shapes.push({
      left: rowLeft.size / h > 0.6,
      right: rowRight.size / h > 0.6,
      top: colTop.size / w > 0.6,
      bottom: colBottom.size / w > 0.6,
    });
  }
  return shapes;
}

/**
 * A chopped subject can survive in an older, already padded atlas. Its two
 * halves have complementary flat edges, with a separate subject sharing a tile.
 * A single straight-edged picture (e.g. a book) is insufficient evidence.
 */
export async function cutPairs(bytes: Buffer, columns: number, rows: number) {
  const stride = columns * SIDE;
  const alpha = await sharp(bytes)
    .resize(stride, rows * SIDE, { fit: "fill" })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
  const cells = Array.from({ length: rows * columns }, (_, i) =>
    shapeEdges(
      alpha,
      stride,
      (i % columns) * SIDE,
      Math.floor(i / columns) * SIDE,
    ),
  );
  const suspect = new Set<number>();
  const check = (a: number, b: number, end: keyof Edge, start: keyof Edge) => {
    // A book or phone naturally has two parallel straight sides. A cut
    // through a curved silhouette leaves a flat side opposite a curved one.
    if (
      (cells[a].length > 1 || cells[b].length > 1) &&
      cells[a].some((c) => c[end] && !c[start]) &&
      cells[b].some((c) => c[start] && !c[end])
    ) {
      suspect.add(a);
      suspect.add(b);
    }
  };
  for (let i = 0; i < cells.length; i++) {
    if (i % columns < columns - 1) check(i, i + 1, "right", "left");
    if (i + columns < cells.length) check(i, i + columns, "bottom", "top");
  }
  return suspect;
}
