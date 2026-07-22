<template>
  <a
    ref="cardRef"
    :href="bookmark.url"
    target="_blank"
    rel="noopener noreferrer"
    class="bookmark-card card"
    :data-id="bookmark.id"
    :title="bookmark.title"
    @contextmenu.prevent="$emit('contextmenu', $event, bookmark)"
  >
    <div class="favicon">
      <img
        v-if="iconSrc && !iconFailed"
        ref="imgRef"
        :src="iconSrc"
        :alt="bookmark.title"
        class="card-favicon-img"
        loading="lazy"
        @load="onIconLoad"
        @error="onIconError"
      >
      <span v-else class="card-icon-text">{{ initialChar }}</span>
    </div>
    <div class="card-content">
      <div class="card-title">
        {{ bookmark.title }}
        <span v-if="bookmark.need_proxy" class="proxy-badge" title="需要代理访问"><i class="ri-router-line"></i></span>
      </div>
      <div v-if="bookmark.description" class="card-description">{{ bookmark.description }}</div>
    </div>
  </a>
</template>

<script setup lang="ts">
const props = defineProps<{
  bookmark: any
}>()

defineEmits<{
  contextmenu: [event: MouseEvent, bookmark: any]
}>()

const cardRef = ref<HTMLElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
const iconFailed = ref(false)

const iconSrc = computed(() => {
  if (iconFailed.value) return null
  return resolveBookmarkIcon(props.bookmark.icon, props.bookmark.url)
})

const initialChar = computed(() => {
  const t = props.bookmark.title || props.bookmark.url || '?'
  return t.charAt(0).toUpperCase()
})

// ── Dominant color extraction (mirrors old script.js getColors / adjustColor / applyColors) ──

interface ExtractedColors {
  primary: [number, number, number]
  secondary: [number, number, number]
}

function getColors(img: HTMLImageElement): ExtractedColors {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return { primary: [200, 200, 200], secondary: [220, 220, 220] }
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  } catch {
    return { primary: [200, 200, 200], secondary: [220, 220, 220] }
  }
  const colorMap: Record<string, number> = {}
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`
    colorMap[key] = (colorMap[key] || 0) + 1
  }
  const sorted = Object.entries(colorMap).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return { primary: [200, 200, 200], secondary: [220, 220, 220] }
  const primary = sorted[0][0].split(',').map(Number) as [number, number, number]
  const secondary = sorted.length > 1
    ? sorted[1][0].split(',').map(Number) as [number, number, number]
    : primary.map(c => Math.min(255, c + 20)) as [number, number, number]
  return { primary, secondary }
}

function adjustColor(r: number, g: number, b: number) {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  let factor = 1
  if (brightness < 128) factor = 1 + (128 - brightness) / 128
  else if (brightness > 200) factor = 1 - (brightness - 200) / 55
  return {
    r: Math.min(255, Math.round(r * factor)),
    g: Math.min(255, Math.round(g * factor)),
    b: Math.min(255, Math.round(b * factor)),
  }
}

function applyColors(el: HTMLElement, colors: ExtractedColors) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const p = adjustColor(colors.primary[0], colors.primary[1], colors.primary[2])
  const s = adjustColor(colors.secondary[0], colors.secondary[1], colors.secondary[2])
  const opacity = isDark ? 0.1 : 0.06
  el.style.background = `linear-gradient(135deg, rgba(${p.r},${p.g},${p.b},${opacity}), rgba(${s.r},${s.g},${s.b},${opacity}))`
  el.style.border = `1px solid rgba(${p.r},${p.g},${p.b},${isDark ? 0.1 : 0.01})`
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

function onIconLoad() {
  if (!import.meta.client || !cardRef.value || !imgRef.value) return
  const cacheKey = `bookmark-colors-${props.bookmark.id}`
  const cached = localStorage.getItem(cacheKey)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL) {
        applyColors(cardRef.value, parsed)
        return
      }
    } catch { /* ignore */ }
  }
  const colors = getColors(imgRef.value)
  applyColors(cardRef.value, colors)
  localStorage.setItem(cacheKey, JSON.stringify({ ...colors, ts: Date.now() }))
}

function onIconError() {
  iconFailed.value = true
  if (import.meta.client && cardRef.value) {
    const defaults: ExtractedColors = { primary: [200, 200, 200], secondary: [220, 220, 220] }
    applyColors(cardRef.value, defaults)
  }
}

// Re-apply colors on theme change
onMounted(() => {
  if (!import.meta.client) return
  const cacheKey = `bookmark-colors-${props.bookmark.id}`
  const cached = localStorage.getItem(cacheKey)
  if (cached && cardRef.value) {
    try {
      const parsed = JSON.parse(cached)
      if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL) {
        applyColors(cardRef.value, parsed)
      }
    } catch { /* ignore */ }
  }
  // Watch for theme changes (re-read cache each time to avoid stale closure)
  const observer = new MutationObserver(() => {
    if (cardRef.value) {
      try {
        const fresh = localStorage.getItem(cacheKey)
        if (fresh) applyColors(cardRef.value, JSON.parse(fresh))
      } catch {}
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  onBeforeUnmount(() => observer.disconnect())
})
</script>

