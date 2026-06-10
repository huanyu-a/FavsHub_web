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
        class="w-6 h-6 mr-2"
        loading="lazy"
        crossorigin="anonymous"
        @load="onIconLoad"
        @error="onIconError"
      >
      <span v-else class="w-6 h-6 mr-2 card-icon-text">{{ initialChar }}</span>
    </div>
    <div class="card-content">
      <div class="card-title">{{ bookmark.title }}</div>
    </div>
    <span v-if="!isGuest" class="card-actions">
      <button class="card-edit-btn" title="编辑" @click.prevent.stop="$emit('edit', bookmark)">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="card-delete-btn" title="删除" @click.prevent.stop="$emit('delete', bookmark)">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </span>
  </a>
</template>

<script setup lang="ts">
const props = defineProps<{
  bookmark: any
  isGuest?: boolean
}>()

defineEmits<{
  edit: [bookmark: any]
  delete: [bookmark: any]
  contextmenu: [event: MouseEvent, bookmark: any]
}>()

const cardRef = ref<HTMLElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
const iconFailed = ref(false)

const iconSrc = computed(() => {
  if (iconFailed.value) return null
  if (props.bookmark.icon) return props.bookmark.icon
  try {
    const url = new URL(props.bookmark.url)
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`
  } catch {
    return null
  }
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
  // Watch for theme changes
  const observer = new MutationObserver(() => {
    if (cardRef.value && cached) {
      try { applyColors(cardRef.value, JSON.parse(cached)) } catch {}
    }
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  onBeforeUnmount(() => observer.disconnect())
})
</script>

<style scoped>
/* .bookmark-card / .card / .favicon / .card-content / .card-title 全部来自 main-bundle.css。
   下面仅补充新框架特有的编辑/删除按钮（旧版无此控件），不覆盖旧版布局。 */
.bookmark-card { position: relative; }

.card-icon-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #4a90d9;
  background: rgba(74, 144, 217, 0.12);
  border-radius: 6px;
  font-size: 14px;
}

.card-actions {
  display: none;
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  gap: 2px;
  z-index: 2;
}
.bookmark-card:hover .card-actions {
  display: inline-flex;
}
.card-edit-btn,
.card-delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.15s;
}
.card-edit-btn:hover { background: rgba(102, 126, 234, 0.12); color: #667eea; }
.card-delete-btn:hover { background: rgba(231, 76, 60, 0.12); color: #e74c3c; }
</style>
