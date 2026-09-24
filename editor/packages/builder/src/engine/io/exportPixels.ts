/** WebGL 原点在左下，2D canvas 在左上；导出行必须翻一次。 */
export function flipRgbaRows(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const row = width * 4
  const out = new Uint8Array(pixels.length)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * row
    out.set(pixels.subarray(src, src + row), y * row)
  }
  return out
}
