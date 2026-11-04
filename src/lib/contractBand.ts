import type { CustomSeriesOption } from 'echarts/charts'

export interface ContractRange {
  code: string
  start: number
  end: number
}

/** Missing identities break a run; a contract returning later gets a new run. */
export function contractRanges(codes: ReadonlyArray<string | null | undefined>): ContractRange[] {
  const ranges: ContractRange[] = []
  codes.forEach((value, index) => {
    const code = value?.trim().toUpperCase().split('.')[0]
    if (!code) return
    const previous = ranges.at(-1)
    if (previous?.code === code && previous.end === index - 1) previous.end = index
    else ranges.push({ code, start: index, end: index })
  })
  return ranges
}

/** Draw below the price grid, using its category scale so zoom and resize stay aligned. */
export function contractBandSeries(codes: ReadonlyArray<string | null | undefined>): CustomSeriesOption {
  const ranges = contractRanges(codes)
  return {
    id: 'dominant-contract-band',
    name: '主力合约',
    type: 'custom',
    xAxisIndex: 0,
    yAxisIndex: 0,
    silent: true,
    clip: false,
    z: 6,
    tooltip: { show: false },
    encode: { x: [0, 1], y: -1 },
    data: ranges.map((range, index) => [range.start, range.end, range.code, index]),
    renderItem(params, api) {
      const grid = params.coordSys as unknown as { x: number; y: number; width: number; height: number }
      const half = Math.abs((api.size!([1, 0]) as number[])[0]) / 2
      const left = Math.max(grid.x, api.coord([Number(api.value(0)), 0])[0] - half)
      const right = Math.min(grid.x + grid.width, api.coord([Number(api.value(1)), 0])[0] + half)
      if (right <= left) return
      const code = String(api.value(2))
      const width = right - left
      const y = grid.y + grid.height + 3
      const children = [{
        type: 'rect' as const,
        shape: { x: left, y, width, height: 18 },
        style: { fill: Number(api.value(3)) % 2 ? '#25272a' : '#1b1d20', stroke: '#444', lineWidth: 0.6 },
      }, ...(width >= code.length * 6 + 10 ? [{
        type: 'text' as const,
        style: { text: code, x: (left + right) / 2, y: y + 9, fill: '#aeb4bd',
          align: 'center' as const, verticalAlign: 'middle' as const, fontSize: 10, fontFamily: 'monospace' },
      }] : [])]
      return { type: 'group', children }
    },
  }
}
