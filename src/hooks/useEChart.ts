import { useCallback, useEffect, useMemo, type RefObject } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { createChartLifecycle } from '../lib/chartLifecycle'
import { echarts } from '../lib/echarts'

/** Chart creation stays lazy: callers update only when their data/visibility is ready. */
export function useEChart(
  elementRef: RefObject<HTMLDivElement | null>,
  theme?: string,
  resizeAfterUpdate = false,
) {
  const lifecycle = useMemo(() => createChartLifecycle<HTMLDivElement, EChartsCoreOption>(
    element => echarts.init(element, theme),
    onResize => new ResizeObserver(onResize),
  ), [theme])

  useEffect(() => () => lifecycle.dispose(), [lifecycle])

  return useCallback((option: EChartsCoreOption) => {
    lifecycle.update(elementRef.current, option, resizeAfterUpdate)
  }, [elementRef, lifecycle, resizeAfterUpdate])
}
