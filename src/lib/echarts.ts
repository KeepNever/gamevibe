// ECharts 模块注册（按需引入，配合 vue-echarts 使用）
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  RadarChart,
  BarChart,
  LineChart,
  PieChart,
} from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  RadarComponent,
  DatasetComponent,
} from 'echarts/components'

use([
  CanvasRenderer,
  RadarChart,
  BarChart,
  LineChart,
  PieChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  RadarComponent,
  DatasetComponent,
])

// 主题色板（与 CSS 变量保持一致，适配暗色主题）
export const CHART_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#fb7185']
export const CHART_TEXT = '#94a3b8'
export const CHART_BORDER = '#334155'
export const CHART_AXIS = '#475569'
