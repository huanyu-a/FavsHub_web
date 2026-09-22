<template>
  <Teleport to="body">
    <div class="tde-backdrop" @click.self="onBackdrop">
      <div class="tde-modal" role="dialog" aria-modal="true" :aria-label="ariaLabel">
        <header class="tde-head">
          <div class="tde-head-copy">
            <h2 class="tde-title">
              <i :class="headIcon"></i>
              {{ headTitle }}
            </h2>
            <p class="tde-sub">{{ headSub }}</p>
          </div>
          <button type="button" class="tde-close" title="关闭" @click="close">
            <i class="ri-close-line"></i>
          </button>
        </header>

        <div class="tde-body">
          <!-- 基本信息 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">基本信息</legend>

            <label class="tde-field">
              <span class="field-label">服务商 <em>*</em></span>
              <input
                v-model="form.provider"
                type="text"
                :maxlength="LIMITS.provider"
                placeholder="如：智谱 AI、ModelScope、OpenRouter"
              >
              <span class="field-hint">{{ form.provider.length }} / {{ LIMITS.provider }}</span>
            </label>

            <label class="tde-field">
              <span class="field-label">通告标题 <em>*</em></span>
              <input
                v-model="form.title"
                type="text"
                :maxlength="LIMITS.title"
                placeholder="如：新用户注册送 2000 万 Tokens"
              >
              <span class="field-hint">{{ form.title.length }} / {{ LIMITS.title }}</span>
            </label>

            <label class="tde-field">
              <span class="field-label">领取地址 <em>*</em></span>
              <input
                v-model="form.url"
                type="url"
                :maxlength="LIMITS.url"
                placeholder="https://..."
              >
              <span class="field-hint">必须为 http(s) 链接，用于一键导入书签</span>
            </label>

            <label class="tde-field">
              <span class="field-label">API 调用地址</span>
              <input
                v-model="form.call_url"
                type="url"
                :maxlength="LIMITS.callUrl"
                placeholder="https://api.example.com/v1（可选）"
              >
            </label>

            <label class="tde-field">
              <span class="field-label">免费额度</span>
              <input
                v-model="form.quota"
                type="text"
                :maxlength="LIMITS.quota"
                placeholder="如：2000 万 Tokens / 每日 100 次调用 / 永久免费"
              >
            </label>
          </fieldset>

          <!-- 分级与来源 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">分级与来源</legend>

            <div class="tde-field">
              <span class="field-label">品质分级</span>
              <div class="chip-row">
                <button
                  v-for="q in QUALITY_LEVELS"
                  :key="q"
                  type="button"
                  class="chip"
                  :class="{ active: form.quality === q }"
                  @click="form.quality = q"
                >{{ q }}</button>
              </div>
            </div>

            <div class="tde-field">
              <span class="field-label">访问区域</span>
              <div class="chip-row">
                <button
                  v-for="r in REGION_OPTIONS"
                  :key="r.value"
                  type="button"
                  class="chip"
                  :class="{ active: form.region === r.value }"
                  @click="form.region = r.value"
                >{{ r.label }}</button>
              </div>
            </div>

            <div class="tde-field">
              <span class="field-label">来源标签</span>
              <div class="chip-row">
                <button
                  v-for="s in SOURCE_OPTIONS"
                  :key="s.value"
                  type="button"
                  class="chip"
                  :class="{ active: form.source_tag === s.value }"
                  @click="form.source_tag = s.value"
                >{{ s.label }}</button>
              </div>
            </div>
          </fieldset>

          <!-- 模型与有效期 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">模型与有效期</legend>

            <div class="tde-field">
              <span class="field-label">支持模型（{{ form.models.length }} / {{ LIMITS.models }}）</span>
              <div class="tag-input">
                <span v-for="(m, i) in form.models" :key="m" class="tag">
                  {{ m }}
                  <button type="button" class="tag-remove" title="移除" @click="removeModel(i)">
                    <i class="ri-close-line"></i>
                  </button>
                </span>
                <input
                  v-model="modelDraft"
                  type="text"
                  class="tag-field"
                  :maxlength="LIMITS.modelName"
                  :placeholder="form.models.length ? '继续添加...' : '如 glm-4-flash，回车添加'"
                  @keydown.enter.prevent="addModel"
                  @keydown.,.prevent="addModel"
                  @blur="addModel"
                >
              </div>
            </div>

            <label class="tde-field">
              <span class="field-label">有效期</span>
              <input v-model="expiresDate" type="date">
              <span class="field-hint">留空表示永久有效</span>
            </label>
          </fieldset>

          <!-- 备注 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">备注</legend>
            <label class="tde-field">
              <span class="field-label">补充说明</span>
              <textarea
                v-model="form.note"
                rows="3"
                :maxlength="LIMITS.note"
                placeholder="领取门槛、是否需要实名、常见坑点等"
              ></textarea>
              <span class="field-hint">{{ form.note.length }} / {{ LIMITS.note }}</span>
            </label>
          </fieldset>

          <!-- 建议修改：提交说明 + 改动清单 -->
          <fieldset v-if="isProposal" class="tde-group">
            <legend class="tde-legend">提交给审核人</legend>

            <label class="tde-field">
              <span class="field-label">修改理由</span>
              <textarea
                v-model="comment"
                rows="2"
                :maxlength="LIMITS.comment"
                placeholder="如：领取地址已变更、额度从 500 万调整为 1000 万"
              ></textarea>
              <span class="field-hint">{{ comment.length }} / {{ LIMITS.comment }}</span>
            </label>

            <div class="tde-diff">
              <div class="tde-diff-head">
                <i class="ri-git-commit-line"></i>
                本次改动 <strong>{{ changedFields.length }}</strong> 项
              </div>
              <p v-if="changedFields.length === 0" class="tde-diff-empty">
                还没有任何改动 —— 修改上面的字段后再提交。
              </p>
              <ul v-else class="tde-diff-list">
                <li v-for="c in changedFields" :key="c.field" class="tde-diff-item">
                  <span class="diff-label">{{ c.label }}</span>
                  <span class="diff-from">{{ displayValue(c.field, c.from) }}</span>
                  <i class="ri-arrow-right-line diff-arrow"></i>
                  <span class="diff-to">{{ displayValue(c.field, c.to) }}</span>
                </li>
              </ul>
            </div>
          </fieldset>

          <p v-if="errorText" class="tde-error">
            <i class="ri-error-warning-line"></i> {{ errorText }}
          </p>
        </div>

        <footer class="tde-foot">
          <button type="button" class="tde-btn ghost" :disabled="saving" @click="close">取消</button>
          <button
            type="button"
            class="tde-btn primary"
            :disabled="saving || (isProposal && changedFields.length === 0)"
            @click="submit"
          >
            <i :class="saving ? 'ri-loader-4-line spin' : 'ri-check-line'"></i>
            {{ saving ? '提交中...' : submitLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface ITokenDeal {
  id: string
  provider: string
  title: string
  url: string
  call_url?: string
  quota?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  expires_at?: number | null
  note?: string
}

const props = defineProps<{
  deal?: ITokenDeal | null
  /** 建议修改模式：预填现值、只提交改动字段、提交到建议通道而非直接编辑 */
  proposal?: boolean
}>()
const emit = defineEmits<{
  close: []
  saved: [message: string]
}>()

const authStore = useAuthStore()

const LIMITS = {
  provider: 60,
  title: 120,
  url: 500,
  callUrl: 500,
  quota: 200,
  note: 500,
  models: 20,
  modelName: 60,
  comment: 200,
}

const QUALITY_LEVELS = ['上上品', '上品', '中品', '下品', '下下品']
const REGION_OPTIONS = [
  { value: 'cn', label: '国内直连' },
  { value: 'global', label: '海外（需代理）' },
]
const SOURCE_OPTIONS = [
  { value: 'official', label: '官方直营' },
  { value: 'relay', label: '中转站' },
  { value: 'community', label: '社区转发' },
]

const REGION_LABELS: Record<string, string> = { cn: '国内直连', global: '海外（需代理）' }
const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}

const isEdit = computed(() => !!props.deal?.id)
const isProposal = computed(() => !!props.proposal)
const isAdmin = computed(() => authStore.isAdmin)

const headTitle = computed(() => {
  if (isProposal.value) return '建议修改'
  return isEdit.value ? '编辑通告' : '发布白嫖通告'
})
const headIcon = computed(() => {
  if (isProposal.value) return 'ri-lightbulb-line'
  return isEdit.value ? 'ri-edit-line' : 'ri-add-circle-line'
})
const ariaLabel = computed(() => headTitle.value)
const headSub = computed(() => {
  if (isProposal.value) {
    return '只提交你改动的字段，由通告作者或管理员审核通过后生效。'
  }
  if (isAdmin.value) return '管理员发布将直接上线，无需审核。'
  if (isEdit.value) return '作者编辑即刻生效；通告曾被驳回时会重新进入待审队列。'
  return '提交后由管理员审核，通过后公开展示。'
})
const submitLabel = computed(() => {
  if (isProposal.value) return '提交修改建议'
  return isEdit.value ? '保存修改' : '提交通告'
})

/** 与 server/utils/token-deals.ts 的 DEAL_PATCHABLE 对应 */
const PATCHABLE = [
  'provider', 'title', 'url', 'call_url', 'quota', 'models',
  'region', 'quality', 'source_tag', 'expires_at', 'note',
] as const

const FIELD_LABELS: Record<string, string> = {
  provider: '服务商',
  title: '通告标题',
  url: '领取地址',
  call_url: 'API 调用地址',
  quota: '免费额度',
  models: '支持模型',
  region: '访问区域',
  quality: '品质分级',
  source_tag: '来源标签',
  expires_at: '有效期',
  note: '备注',
}

const form = ref({
  provider: '',
  title: '',
  url: '',
  call_url: '',
  quota: '',
  models: [] as string[],
  region: 'cn',
  quality: '中品',
  source_tag: 'official',
  note: '',
})

const modelDraft = ref('')
const expiresDate = ref('')
const saving = ref(false)
const errorText = ref('')
const comment = ref('')

/** 打开时的原始值 —— 提案模式据此算 diff，只提交被改动的字段 */
const original = ref<Record<string, any>>({})

function toDateInput(ts?: number | null) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 日期 → 当日 23:59:59 的本地时间戳，避免「当天就显示已过期」 */
function toExpiresAt(value: string): number | null {
  if (!value) return null
  const ts = new Date(`${value}T23:59:59`).getTime()
  return Number.isFinite(ts) ? ts : null
}

/** 表单当前值摊平成与 patch 同形（snake_case） */
function currentPatch(): Record<string, any> {
  const f = form.value
  return {
    provider: f.provider.trim(),
    title: f.title.trim(),
    url: f.url.trim(),
    call_url: f.call_url.trim(),
    quota: f.quota.trim(),
    models: [...f.models],
    region: f.region,
    quality: f.quality,
    source_tag: f.source_tag,
    expires_at: toExpiresAt(expiresDate.value),
    note: f.note.trim(),
  }
}

/** 值语义比较（models 按数组比，expires_at 把 undefined 归一成 null） */
function sameValue(a: any, b: any) {
  const na = a === undefined ? null : a
  const nb = b === undefined ? null : b
  return JSON.stringify(na) === JSON.stringify(nb)
}

/** 改动清单 —— 提案模式据此展示与提交 */
const changedFields = computed(() => {
  if (!isProposal.value) return []
  const cur = currentPatch()
  const out: Array<{ field: string; label: string; from: any; to: any }> = []
  for (const key of PATCHABLE) {
    const prev = original.value[key] ?? null
    const next = cur[key] ?? null
    if (!sameValue(prev, next)) {
      out.push({ field: key, label: FIELD_LABELS[key] || key, from: prev, to: next })
    }
  }
  return out
})

/** diff 展示用：把枚举值与时间戳渲染成人话 */
function displayValue(field: string, value: any): string {
  if (value === null || value === undefined || value === '') return '（空）'
  if (field === 'models') return Array.isArray(value) && value.length ? value.join('、') : '（空）'
  if (field === 'region') return REGION_LABELS[value] || String(value)
  if (field === 'source_tag') return SOURCE_LABELS[value] || String(value)
  if (field === 'expires_at') {
    const ts = Number(value)
    if (!Number.isFinite(ts)) return String(value)
    return new Date(ts).toLocaleDateString('zh-CN')
  }
  return String(value)
}

function addModel() {
  const name = modelDraft.value.trim().replace(/,$/, '')
  modelDraft.value = ''
  if (!name) return
  if (form.value.models.length >= LIMITS.models) return
  if (form.value.models.includes(name)) return
  form.value.models.push(name.slice(0, LIMITS.modelName))
}

function removeModel(index: number) {
  form.value.models.splice(index, 1)
}

function close() {
  emit('close')
}

function onBackdrop() {
  close()
}

async function submit() {
  errorText.value = ''
  addModel()

  const f = form.value
  if (!f.provider.trim()) { errorText.value = '服务商名称不能为空'; return }
  if (!f.title.trim()) { errorText.value = '通告标题不能为空'; return }
  if (!f.url.trim()) { errorText.value = '领取地址不能为空'; return }

  const cur = currentPatch()

  // ── 建议修改：只提交被改动的字段 ──
  if (isProposal.value) {
    const changed = changedFields.value
    if (changed.length === 0) {
      errorText.value = '还没有任何改动，请先修改要建议的字段'
      return
    }
    const patch: Record<string, any> = {}
    for (const c of changed) patch[c.field] = cur[c.field]

    saving.value = true
    try {
      const res = await $fetch<{ success: boolean; created: boolean; message?: string }>(
        `/api/token-deals/${props.deal!.id}/edits`,
        {
          method: 'POST',
          body: { ...patch, comment: comment.value.trim() },
          credentials: 'include',
        },
      )
      emit('saved', res?.message || '修改建议已提交，等待审核')
    } catch (err: any) {
      errorText.value = err?.data?.error || err?.message || '提交失败，请稍后重试'
    } finally {
      saving.value = false
    }
    return
  }

  // ── 发布 / 编辑自己的通告 ──
  saving.value = true
  try {
    const body = { ...cur }

    const res = await $fetch<{ success: boolean; message?: string }>(
      isEdit.value ? `/api/token-deals/${props.deal!.id}` : '/api/token-deals',
      {
        method: isEdit.value ? 'PUT' : 'POST',
        body,
        credentials: 'include',
      },
    )

    emit('saved', res?.message || '')
  } catch (err: any) {
    errorText.value = err?.data?.error || err?.message || '提交失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

let prevOverflow = ''

onMounted(() => {
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)

  const d = props.deal
  if (d) {
    form.value = {
      provider: d.provider || '',
      title: d.title || '',
      url: d.url || '',
      call_url: d.call_url || '',
      quota: d.quota || '',
      models: [...(d.models || [])],
      region: d.region || 'cn',
      quality: d.quality || '中品',
      source_tag: d.source_tag || 'official',
      note: d.note || '',
    }
    expiresDate.value = toDateInput(d.expires_at)
  }

  // 快照原始值 —— 提案模式据此算 diff（必须放在表单填充之后）
  original.value = currentPatch()
})

onUnmounted(() => {
  document.body.style.overflow = prevOverflow
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.tde-backdrop {
  position: fixed;
  inset: 0;
  /* 高于移动端底部导航（9998）：移动端是贴底 sheet，避免底部按钮被底栏压住 */
  z-index: 10060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
  animation: tde-fade 0.18s ease-out;
}
@keyframes tde-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.tde-modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  max-height: 88vh;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: tde-rise 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes tde-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: none; }
}

.tde-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 0.5px solid var(--divider);
}
.tde-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.tde-title i { font-size: 17px; color: var(--primary); }
.tde-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tde-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-tertiary);
  font-size: 17px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tde-close:hover { background: var(--surface-hover); color: var(--text-primary); }

.tde-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
}

.tde-group {
  border: none;
  margin: 0 0 18px;
  padding: 0;
}
.tde-group:last-of-type { margin-bottom: 0; }
.tde-legend {
  padding: 0;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.tde-field {
  display: block;
  position: relative;
  margin-bottom: 12px;
}
.tde-field:last-child { margin-bottom: 0; }
.field-label {
  display: block;
  margin-bottom: 5px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.field-label em {
  color: var(--danger);
  font-style: normal;
}
.tde-field input[type="text"],
.tde-field input[type="url"],
.tde-field input[type="date"],
.tde-field textarea {
  width: 100%;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color 0.15s;
}
.tde-field textarea { resize: vertical; }
.tde-field input:focus,
.tde-field textarea:focus { border-color: var(--border-focus); }
.tde-field input::placeholder,
.tde-field textarea::placeholder { color: var(--text-tertiary); }
.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  padding: 5px 12px;
  font-size: 12.5px;
  border-radius: 999px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.chip:hover { background: var(--surface-hover); color: var(--text-primary); }
.chip.active {
  background: var(--primary-light);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 500;
}

.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  min-height: 40px;
}
.tag-input:focus-within { border-color: var(--border-focus); }
.tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px 3px 9px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
}
.tag-remove {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 0;
  font-size: 13px;
  color: var(--text-tertiary);
  cursor: pointer;
}
.tag-remove:hover { color: var(--danger); }
.tag-field {
  flex: 1;
  min-width: 130px;
  border: none;
  outline: none;
  background: none;
  font-size: 12.5px;
  color: var(--text-primary);
}
.tag-field::placeholder { color: var(--text-tertiary); }

.tde-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

/* 建议修改：改动清单 */
.tde-diff {
  margin-top: 4px;
  padding: 10px 12px;
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.tde-diff-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.tde-diff-head i { color: var(--primary); font-size: 14px; }
.tde-diff-head strong { color: var(--primary); font-weight: 600; }
.tde-diff-empty {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tde-diff-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tde-diff-item {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 12px;
  line-height: 1.5;
}
.diff-label {
  flex-shrink: 0;
  min-width: 62px;
  color: var(--text-tertiary);
}
.diff-from {
  color: var(--text-tertiary);
  text-decoration: line-through;
  word-break: break-all;
}
.diff-arrow { color: var(--text-tertiary); font-size: 13px; flex-shrink: 0; }
.diff-to {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}

.tde-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 0.5px solid var(--divider);
  background: var(--surface-raised);
}
.tde-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 18px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.tde-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.tde-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.tde-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--text-inverse);
}
.tde-btn.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.spin { animation: tde-spin 1s linear infinite; }
@keyframes tde-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .tde-backdrop { padding: 0; align-items: flex-end; }
  .tde-modal {
    max-width: none;
    max-height: 92vh;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  .tde-foot .tde-btn { flex: 1; justify-content: center; }
  .tde-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
}
</style>
