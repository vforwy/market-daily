import type { Bar } from '../api'

/** ECharts candlestick: [open, close, low, high] */
export type OhlcTuple = [number, number, number, number]

export function hasZeroOhl(bar: Bar): boolean {
  return bar.o === 0 || bar.h === 0 || bar.l === 0
}

/** 开/高/低任一为 0 时按有效收盘价画横线，避免 y 轴被 0 拉穿 */
export function barToChartOhlc(bar: Bar): OhlcTuple {
  const { o, c, l, h } = bar
  if (!hasZeroOhl(bar)) return [o, c, l, h]

  const ref = c > 0 ? c : (h > 0 ? h : o > 0 ? o : l)
  if (ref > 0) return [ref, ref, ref, ref]
  return [o, c, l, h]
}

export function barsToChartOhlc(bars: Bar[]): OhlcTuple[] {
  return bars.map(barToChartOhlc)
}

export function volumeBarIsUp(bar: Bar): boolean {
  const open = bar.o > 0 ? bar.o : bar.c
  return bar.c >= open
}
