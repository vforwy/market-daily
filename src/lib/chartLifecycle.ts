export interface ManagedChart<Option> {
  setOption: (option: Option, notMerge: boolean) => void
  resize: () => void
  dispose: () => void
}

export interface ChartResizeObserver<Element> {
  observe: (element: Element) => void
  disconnect: () => void
}

export function createChartLifecycle<Element, Option>(
  createChart: (element: Element) => ManagedChart<Option>,
  createObserver: (onResize: () => void) => ChartResizeObserver<Element>,
) {
  let chart: ManagedChart<Option> | null = null
  let observedElement: Element | null = null
  let observer: ChartResizeObserver<Element> | null = null

  function dispose() {
    observer?.disconnect()
    observer = null
    chart?.dispose()
    chart = null
    observedElement = null
  }

  return {
    update(element: Element | null, option: Option, resizeAfterUpdate = false) {
      if (!element) return false
      if (!chart || observedElement !== element) {
        dispose()
        try {
          chart = createChart(element)
          observedElement = element
          observer = createObserver(() => chart?.resize())
          observer.observe(element)
        } catch (error) {
          dispose()
          throw error
        }
      }
      // Replacing the option also removes deselected or expired series.
      chart.setOption(option, true)
      if (resizeAfterUpdate) chart.resize()
      return true
    },
    resize: () => chart?.resize(),
    dispose,
  }
}
