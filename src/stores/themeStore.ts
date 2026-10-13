import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<'dark' | 'light'>(
    (localStorage.getItem('gv_theme') as 'dark' | 'light') || 'dark'
  )

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  watch(theme, (v) => {
    localStorage.setItem('gv_theme', v)
    document.documentElement.classList.toggle('dark', v === 'dark')
    document.documentElement.setAttribute('data-theme', v)
  }, { immediate: true })

  return { theme, toggle }
})
