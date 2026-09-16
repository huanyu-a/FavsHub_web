<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>API 令牌</h1>
      <p>创建个人访问令牌（PAT），供 AI 助手或脚本安全地读写你的数据</p>
    </header>

    <div class="card">
      <div class="card-header">
        <h3>我的令牌</h3>
        <div>
          <button class="btn btn-primary btn-sm" @click="openCreate">创建令牌</button>
          <button class="btn btn-ghost btn-sm" @click="load">刷新</button>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>名称</th><th>前缀</th><th>权限</th><th>状态</th><th>创建时间</th><th>最后使用</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="7" class="empty-state">加载中...</td></tr>
          <tr v-else-if="tokens.length === 0"><td colspan="7" class="empty-state">还没有令牌，点击右上角「创建令牌」开始</td></tr>
          <tr v-for="t in tokens" :key="t.id">
            <td>{{ t.name }}</td>
            <td><code class="mono">{{ t.prefix }}</code></td>
            <td>
              <span v-for="s in t.scopes" :key="s" class="badge" :class="scopeBadge(s)">{{ s }}</span>
            </td>
            <td>
              <span v-if="t.status === 'active'" class="badge badge-public">有效</span>
              <span v-else-if="t.status === 'expired'" class="badge badge-pending">已过期</span>
              <span v-else class="badge badge-private">已吊销</span>
            </td>
            <td>{{ fmt(t.created_at) }}</td>
            <td>{{ t.last_used_at ? fmt(t.last_used_at) : '从未使用' }}</td>
            <td class="actions">
              <button v-if="t.status !== 'revoked'" class="btn btn-danger btn-sm" @click="revoke(t)">吊销</button>
              <span v-else style="color:var(--text-tertiary);font-size:12px;">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card card-tips">
      <div class="card-header"><h3>安全说明</h3></div>
      <ul class="tips">
        <li><strong>明文只显示一次</strong>：令牌创建后立即复制保存，站点只存哈希，遗失后无法找回，只能重新创建。</li>
        <li><strong>权限分级</strong>：<code class="mono">read</code> 查询 → <code class="mono">write</code> 创建与更新 → <code class="mono">delete</code> 删除（高等级包含低等级）。</li>
        <li><strong>删除权限仅管理员</strong>：含 <code class="mono">delete</code> 的令牌仅管理员可创建；且删除接口必须携带确认标志。</li>
        <li><strong>数据隔离</strong>：令牌只能操作你本人的数据，无法访问其他账号，也无法访问登录、用户管理等普通接口。</li>
        <li><strong>随时可撤销</strong>：吊销后立即失效；建议为不同用途创建独立令牌，便于单独回收。</li>
      </ul>
      <div class="usage">
        <div class="usage-title">调用示例</div>
        <pre class="mono usage-code">curl -H "Authorization: Bearer &lt;你的令牌&gt;" \
  {{ baseUrl }}/api/ai/describe</pre>
        <p class="usage-note">
          首个调用建议访问 <code class="mono">/api/ai/describe</code>，它会返回完整的能力清单与字段字典。
          也支持 MCP 通道：<code class="mono">{{ baseUrl }}/api/mcp</code>。
        </p>
      </div>
    </div>

    <!-- 创建令牌 -->
    <div v-show="createVisible" :class="['modal-overlay', { active: createVisible }]" @click.self="createVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>创建 API 令牌</h3>
          <button class="modal-close" @click="createVisible = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="fg">
            <label>令牌名称</label>
            <input v-model="form.name" maxlength="64" placeholder="例如：布谷助手 / 本地脚本">
          </div>
          <div class="fg">
            <label>权限范围</label>
            <div class="scope-list">
              <label class="scope-item">
                <input type="checkbox" value="read" v-model="form.scopes">
                <span><strong>read</strong> 查询数据</span>
              </label>
              <label class="scope-item">
                <input type="checkbox" value="write" v-model="form.scopes">
                <span><strong>write</strong> 创建与更新（含 read）</span>
              </label>
              <label class="scope-item" :class="{ disabled: !isAdmin }">
                <input type="checkbox" value="delete" v-model="form.scopes" :disabled="!isAdmin">
                <span>
                  <strong>delete</strong> 删除数据（含 read/write）
                  <em v-if="!isAdmin" class="scope-lock">仅管理员可授予</em>
                </span>
              </label>
            </div>
          </div>
          <div class="fg">
            <label>有效期（天，留空表示永久）</label>
            <input v-model="form.expires_in_days" type="number" min="1" max="3650" placeholder="留空 = 永久有效">
          </div>
          <p v-if="errorMsg" class="err-msg">{{ errorMsg }}</p>
          <div class="form-btns">
            <button class="btn btn-ghost" @click="createVisible = false">取消</button>
            <button class="btn btn-primary" :disabled="creating" @click="submitCreate">
              {{ creating ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 明文令牌（仅此一次） -->
    <div v-show="plainVisible" :class="['modal-overlay', { active: plainVisible }]" @click.self="closePlain">
      <div class="modal">
        <div class="modal-header">
          <h3>令牌已创建</h3>
          <button class="modal-close" @click="closePlain">&times;</button>
        </div>
        <div class="modal-body">
          <p class="warn-msg">请立即复制保存。关闭本窗口后将无法再次查看明文。</p>
          <div class="token-box">
            <code class="mono token-plain">{{ plainToken }}</code>
            <button class="btn btn-primary btn-sm" @click="copyToken">{{ copied ? '已复制' : '复制' }}</button>
          </div>
          <div class="form-btns">
            <button class="btn btn-ghost" @click="closePlain">我已保存</button>
          </div>
        </div>
      </div>
    </div>

    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ middleware: 'admin', layout: 'admin', ssr: false })
useHead({ title: 'API 令牌' })

const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)

const tokens = ref<any[]>([])
const loading = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const errorMsg = ref('')

const form = reactive({ name: '', scopes: ['read', 'write'] as string[], expires_in_days: '' })

// 明文令牌只保存在内存，绝不写入 localStorage / 任何持久化存储
const plainToken = ref('')
const plainVisible = ref(false)
const copied = ref(false)

const baseUrl = computed(() => (import.meta.client ? window.location.origin : ''))

function fmt(ts?: number | null) {
  if (!ts) return '-'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function scopeBadge(scope: string) {
  if (scope === 'delete') return 'badge-danger'
  if (scope === 'write') return 'badge-pending'
  return 'badge-public'
}

async function load() {
  loading.value = true
  try {
    const d = await $fetch<{ tokens: any[] }>('/api/user/api-tokens', { credentials: 'include' })
    tokens.value = d.tokens || []
  } catch (err: any) {
    errorMsg.value = err?.data?.error || err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.name = ''
  form.scopes = ['read', 'write']
  form.expires_in_days = ''
  errorMsg.value = ''
  createVisible.value = true
}

async function submitCreate() {
  errorMsg.value = ''
  if (!form.name.trim()) { errorMsg.value = '请填写令牌名称'; return }
  if (form.scopes.length === 0) { errorMsg.value = '至少选择一个权限'; return }

  creating.value = true
  try {
    const body: any = { name: form.name.trim(), scopes: form.scopes }
    if (form.expires_in_days !== '' && form.expires_in_days != null) {
      body.expires_in_days = Number(form.expires_in_days)
    }
    const d = await $fetch<{ token: string }>('/api/user/api-tokens', {
      method: 'POST', body, credentials: 'include',
    })
    plainToken.value = d.token
    copied.value = false
    createVisible.value = false
    plainVisible.value = true
    await load()
  } catch (err: any) {
    errorMsg.value = err?.data?.error || err?.message || '创建失败'
  } finally {
    creating.value = false
  }
}

function closePlain() {
  plainVisible.value = false
  // 关闭即从内存丢弃明文
  plainToken.value = ''
  copied.value = false
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(plainToken.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    errorMsg.value = '复制失败，请手动选中复制'
  }
}

async function revoke(t: any) {
  if (!confirm(`确定吊销令牌「${t.name}」吗？使用该令牌的 AI 或脚本将立即失去访问权限。`)) return
  try {
    await $fetch(`/api/user/api-tokens/${t.id}`, { method: 'DELETE', credentials: 'include' })
    await load()
  } catch (err: any) {
    alert('吊销失败: ' + (err?.data?.error || err?.message || '未知错误'))
  }
}

onMounted(load)
</script>

<style scoped>
.card-tips { margin-top: 16px; }
.tips { margin: 0; padding: 0 0 0 18px; color: var(--text-secondary); font-size: 13px; line-height: 1.9; }
.tips li { margin-bottom: 2px; }
.usage { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--divider); }
.usage-title { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
.usage-code {
  margin: 0; padding: 12px; border-radius: var(--radius-md);
  background: var(--surface-sunken); color: var(--text-primary);
  font-size: 12px; line-height: 1.7; overflow-x: auto; white-space: pre;
}
.usage-note { margin: 8px 0 0; font-size: 12px; color: var(--text-tertiary); line-height: 1.7; }
.mono { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; }
.scope-list { display: flex; flex-direction: column; gap: 8px; }
.scope-item { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
.scope-item.disabled { opacity: .55; cursor: not-allowed; }
.scope-item strong { color: var(--text-primary); font-family: var(--font-mono, monospace); }
.scope-lock { display: block; font-style: normal; font-size: 12px; color: var(--text-tertiary); }
.err-msg { margin: 8px 0 0; color: var(--danger); font-size: 13px; }
.warn-msg { margin: 0 0 12px; color: var(--warning, #d97706); font-size: 13px; line-height: 1.7; }
.token-box { display: flex; gap: 8px; align-items: center; }
.token-plain {
  flex: 1; padding: 10px 12px; border-radius: var(--radius-md);
  background: var(--surface-sunken); color: var(--text-primary);
  word-break: break-all; user-select: all;
}
.badge-danger { background: var(--danger); color: #fff; }
</style>
