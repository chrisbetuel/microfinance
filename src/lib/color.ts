function clamp(value: number): number {
  return Math.max(0, Math.min(255, value))
}

export function shade(hex: string, percent: number): string {
  const normalized = hex.replace('#', '')
  const num = parseInt(normalized, 16)
  const amount = Math.round(2.55 * percent)
  const r = clamp((num >> 16) + amount)
  const g = clamp(((num >> 8) & 0x00ff) + amount)
  const b = clamp((num & 0x0000ff) + amount)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

export function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const num = parseInt(normalized, 16)
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
