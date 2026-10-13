import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'info' | 'error'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
}

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<ToastItem[]>([])
  let nextId = 1

  function addToast(message: string, type: ToastType = 'success') {
    const id = nextId++
    toasts.value.push({ id, message, type })
    setTimeout(() => removeToast(id), 2600)
  }

  function removeToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { toasts, add: addToast, addToast, removeToast }
})
