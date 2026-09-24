const DRAFT = /^-?\d*\.?\d*$/

/** 输入过程中允许的草稿：空、负号、小数点、未写完的小数。 */
export function isNumericDraft(raw: string): boolean {
  return DRAFT.test(raw)
}

/** 能提交到模型的数字；空/未写完返回 null。 */
export function parseNumericDraft(raw: string): number | null {
  const text = raw.trim()
  if (text === '' || text === '-' || text === '.' || text === '-.') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** 未完成的输入恢复编辑前的值，不能把删除文字当成输入零。 */
export function commitNumericDraft(raw: string, original: number): number {
  return parseNumericDraft(raw) ?? original
}

export function clampNumber(n: number, min?: number, max?: number): number {
  let next = n
  if (min != null && next < min) next = min
  if (max != null && next > max) next = max
  return next
}

/** 按小数位四舍五入；`precision <= 0` 收成整数。 */
export function quantizeNumber(n: number, precision = 3): number {
  if (!Number.isFinite(n)) return 0
  if (precision <= 0) return Math.round(n)
  const factor = 10 ** precision
  return Math.round(n * factor) / factor
}

export function formatScrubNumber(n: number, precision = 3, fixed = false): string {
  const q = quantizeNumber(n, precision)
  return fixed && precision > 0 ? q.toFixed(precision) : String(q)
}

export function formatAxisNumber(n: number): string {
  return formatScrubNumber(n, 3)
}

/** 指针横向 scrub：`startVal + dx * step`，再夹紧并按精度取整。 */
export function scrubNumericValue(
  startVal: number,
  dx: number,
  step: number,
  opts?: { min?: number; max?: number; precision?: number },
): number {
  return quantizeNumber(clampNumber(startVal + dx * step, opts?.min, opts?.max), opts?.precision ?? 3)
}
