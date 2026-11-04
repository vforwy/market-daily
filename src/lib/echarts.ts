import * as echarts from 'echarts/core'
import { CandlestickChart, BarChart, LineChart, CustomChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
  MarkLineComponent,
  TitleComponent,
  LegendComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { LabelLayout } from 'echarts/features'

echarts.use([
  CandlestickChart,
  BarChart,
  LineChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
  MarkLineComponent,
  TitleComponent,
  LegendComponent,
  CanvasRenderer,
  LabelLayout,
])

export { echarts }
export type { ECharts } from 'echarts/core'
