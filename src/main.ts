import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useThemeStore } from './stores/themeStore'
import './index.css'
import './styles/animations.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// 主题必须在挂载前实例化一次：themeStore 靠 watch(immediate) 把 .dark 挂到 <html> 上，
// 而登录 / 注册 / 找回密码这几个页面不在 Layout 内，没人触发 store，dark class 就永远加不上，
// 表现为「整站深色，这几页纯白」。放在这里同时消除首屏闪烁。
useThemeStore(pinia)

app.use(router)
app.mount('#root')
