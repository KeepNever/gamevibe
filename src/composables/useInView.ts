import { ref, onMounted, onUnmounted } from 'vue'

export function useInView(options?: { threshold?: number; rootMargin?: string }) {
  const elRef = ref<HTMLElement | null>(null)
  const isVisible = ref(false)

  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (!elRef.value) return
    observer = new IntersectionObserver(
      ([entry]) => { isVisible.value = entry.isIntersecting },
      { threshold: options?.threshold ?? 0.1, rootMargin: options?.rootMargin ?? '0px' },
    )
    observer.observe(elRef.value)
  })

  onUnmounted(() => { observer?.disconnect() })

  return { elRef, isVisible }
}
