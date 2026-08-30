<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>提示词管理</h1>
      <p>查看和管理所有用户的提示词、标签和文件夹</p>
    </header>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">提示词</div><div class="value blue">{{ promptStats.total }}</div></div>
      <div class="stat-card"><div class="label">文件夹</div><div class="value green">{{ promptStats.folders }}</div></div>
      <div class="stat-card"><div class="label">标签</div><div class="value purple">{{ promptStats.tags }}</div></div>
      <div class="stat-card"><div class="label">版本</div><div class="value orange">{{ promptStats.versions }}</div></div>
    </div>
    <div class="tab-nav">
      <button :class="{ active: tab === 'prompts' }" @click="tab = 'prompts'">提示词列表</button>
      <button :class="{ active: tab === 'folders' }" @click="tab = 'folders'">文件夹管理</button>
      <button :class="{ active: tab === 'tags' }" @click="tab = 'tags'">标签管理</button>
      <button :class="{ active: tab === 'trash' }" @click="tab = 'trash'; loadTrash()">回收站</button>
      <button :class="{ active: tab === 'history' }" @click="tab = 'history'">历史记录</button>
      <button v-if="isAdmin" :class="{ active: tab === 'reviews' }" @click="tab = 'reviews'; loadReviews()">审核请求</button>
      <button v-if="isAdmin" :class="{ active: tab === 'tdk' }" @click="tab = 'tdk'">TDK 设置</button>
      <button v-if="isAdmin" :class="{ active: tab === 'dev' }" @click="tab = 'dev'">开发工具</button>
    </div>
    <!-- 提示词列表 -->
    <div v-if="tab === 'prompts'" class="card">
      <div class="card-header"><h3>提示词列表</h3>
        <div>
          <button class="btn btn-ghost btn-sm" @click="exportJSON">导出JSON</button>
          <button class="btn btn-ghost btn-sm" @click="triggerImport">导入JSON</button>
          <input ref="importFile" type="file" accept=".json" style="display:none" @change="importJSON">
          <button class="btn btn-ghost btn-sm" @click="loadPrompts">刷新</button>
        </div>
      </div>
      <table>
        <thead><tr><th>标题</th><th>描述</th><th>文件夹</th><th>标签</th><th>用户</th><th>版本</th><th>更新时间</th><th>可见性</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="pLoading"><td colspan="10" class="empty-state">加载中...</td></tr>
          <tr v-else-if="prompts.length === 0"><td colspan="10" class="empty-state">暂无数据</td></tr>
          <tr v-for="p in prompts" :key="p.id">
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ p.title }}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ p.description || '-' }}</td>
            <td>{{ p.folder_name || '-' }}</td>
            <td><span v-for="t in (p.tags || [])" :key="t.id || t" class="tag-chip" :style="{ background: (typeof t === 'object' ? t.color : null) || 'var(--primary-light)' }">{{ typeof t === 'object' ? t.name : t }}</span></td>
            <td>{{ p.username || p.user_id }}</td>
            <td>{{ p.current_version || '1.0.0' }}</td>
            <td>{{ p.updated_at ? new Date(p.updated_at).toLocaleString() : '-' }}</td>
            <td><span class="badge" :class="p.login_required ? 'badge-private' : 'badge-public'"><i v-if="p.login_required" class="ri-lock-line"></i> {{ p.login_required ? '仅自己' : '公开' }}</span></td>
            <td class="actions">
              <button class="btn btn-ghost btn-sm" @click="viewHistory(p)">历史</button>
              <button v-if="!isAdmin && p.owner_is_admin" class="btn btn-ghost btn-sm" @click="openEdit(p)">申请修改</button>
              <button v-else class="btn btn-ghost btn-sm" @click="openEdit(p)">编辑</button>
              <button v-if="canDeletePrompt(p)" class="btn btn-danger btn-sm" @click="delPrompt(p)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="pagination" v-if="pTotalPages > 1">
        <button :disabled="pPage <= 1" @click="pPage--; loadPrompts()">上一页</button>
        <button v-for="n in pPages" :key="n" :class="{ active: n === pPage }" @click="pPage = n; loadPrompts()">{{ n }}</button>
        <button :disabled="pPage >= pTotalPages" @click="pPage++; loadPrompts()">下一页</button>
      </div>
    </div>
    <!-- 文件夹 -->
    <div v-if="tab === 'folders'" class="card">
      <div class="card-header"><h3>提示词文件夹</h3>
        <div>
          <button class="btn btn-primary btn-sm" @click="createPFolder">新建文件夹</button>
          <button class="btn btn-ghost btn-sm" @click="toggleAllPFolders">{{ allPExpanded ? '全部收缩' : '全部展开' }}</button>
          <button class="btn btn-ghost btn-sm" @click="loadPFolders">刷新</button>
        </div>
      </div>
      <div v-if="pfLoading" class="empty-state">加载中...</div>
      <div v-else-if="displayPFolders.length === 0" class="empty-state">暂无数据</div>
      <div v-else ref="pFolderListRef" class="folder-drag-list">
        <div
          v-for="f in displayPFolders"
          :key="f.id"
          :data-id="f.id"
          class="folder-drag-item"
          :style="{ paddingLeft: (f._depth * 20 + 12) + 'px' }"
        >
          <span class="folder-drag-handle" title="拖拽排序">⠿</span>
          <span v-if="f._hasChildren" class="expand-btn" @click="pCollapsedIds.has(f.id) ? pCollapsedIds.delete(f.id) : pCollapsedIds.add(f.id)"><i :class="pCollapsedIds.has(f.id) ? 'ri-arrow-right-s-fill' : 'ri-arrow-down-s-fill'"></i></span>
          <span v-else style="display:inline-block;width:16px;"></span>
          <span v-if="f.icon && isEmoji(f.icon)" style="margin-right:4px;font-size:14px;">{{ f.icon }}</span>
          <i v-else-if="f.icon" :class="f.icon" style="margin-right:4px;font-size:14px;color:var(--primary);"></i>
          <span class="folder-drag-name">{{ f.name }}</span>
          <span v-if="f.login_required" title="登录可见" style="margin-left:4px;"><i class="ri-lock-line"></i></span>
          <span class="folder-drag-meta">{{ f.parent_name || '顶级' }} · {{ f.username || f.user_id }} · {{ f.prompt_count || 0 }}个</span>
          <span class="folder-drag-actions">
            <button v-if="isAdmin || f.user_id === currentUserId" class="btn btn-ghost btn-sm" @click="openFolderEdit(f)">编辑</button>
            <button v-if="isAdmin || f.user_id === currentUserId" class="btn btn-danger btn-sm" @click="delPFolder(f)">删除</button>
            <span v-if="!isAdmin && f.user_id !== currentUserId" style="color:var(--text-tertiary);font-size:12px;"><i class="ri-lock-line"></i></span>
          </span>
        </div>
      </div>
    </div>
    <!-- 标签 -->
    <div v-if="tab === 'tags'" class="card">
      <div class="card-header"><h3>标签管理</h3>
        <button class="btn btn-primary btn-sm" @click="createTag">新建标签</button>
      </div>
      <table>
        <thead><tr><th>名称</th><th>颜色</th><th>用户</th><th>使用次数</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="tagLoading"><td colspan="5" class="empty-state">加载中...</td></tr>
          <tr v-else-if="tags.length === 0"><td colspan="5" class="empty-state">暂无数据</td></tr>
          <tr v-for="t in tags" :key="t.id">
            <td><span class="tag-chip" :style="{ background: t.color || 'var(--primary-light)' }">{{ t.name }}</span></td>
            <td>{{ t.color || '-' }}</td><td>{{ t.username || t.user_id }}</td>
            <td>{{ t.prompt_count || 0 }}</td>
            <td class="actions">
              <button v-if="isAdmin || t.user_id === currentUserId" class="btn btn-danger btn-sm" @click="delTag(t)">删除</button>
              <span v-if="!isAdmin && t.user_id !== currentUserId" style="color:var(--text-tertiary);font-size:12px;"><i class="ri-lock-line"></i> 只读</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 回收站 -->
    <div v-if="tab === 'trash'" class="card">
      <div class="card-header">
        <h3>回收站</h3>
        <div>
          <button class="btn btn-ghost btn-sm" @click="emptyTrash" :disabled="trashList.length === 0">清空回收站</button>
          <button class="btn btn-ghost btn-sm" @click="loadTrash">刷新</button>
        </div>
      </div>
      <table>
        <thead><tr><th>标题</th><th>描述</th><th>用户</th><th>删除时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="trashLoading"><td colspan="5" class="empty-state">加载中...</td></tr>
          <tr v-else-if="trashList.length === 0"><td colspan="5" class="empty-state">回收站为空</td></tr>
          <tr v-for="p in trashList" :key="p.id">
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ p.title }}</td>
            <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ p.description || '-' }}</td>
            <td>{{ p.username || p.user_id }}</td>
            <td>{{ p.deleted_at ? new Date(p.deleted_at).toLocaleString() : '-' }}</td>
            <td class="actions">
              <button class="btn btn-ghost btn-sm" @click="restorePrompt(p)">恢复</button>
              <button class="btn btn-danger btn-sm" @click="permanentDeletePrompt(p)">永久删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 历史记录 -->
    <div v-if="tab === 'history'" class="card">
      <div class="card-header"><h3>版本历史记录</h3>
        <button class="btn btn-ghost btn-sm" @click="loadHistory">刷新</button>
      </div>
      <table>
        <thead><tr><th>提示词</th><th>版本号</th><th>用户</th><th>创建时间</th><th>预览</th></tr></thead>
        <tbody>
          <tr v-if="hLoading"><td colspan="5" class="empty-state">加载中...</td></tr>
          <tr v-else-if="history.length === 0"><td colspan="5" class="empty-state">暂无数据</td></tr>
          <tr v-for="h in history" :key="h.id">
            <td>{{ h.prompt_title || '-' }}</td><td>{{ h.version_number }}</td>
            <td>{{ h.username || h.user_id }}</td>
            <td>{{ h.created_at ? new Date(h.created_at).toLocaleString() : '-' }}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ h.content?.slice(0, 80) || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 审核请求（仅管理员） -->
    <div v-if="tab === 'reviews' && isAdmin" class="card">
      <div class="card-header"><h3>审核请求</h3><button class="btn btn-ghost btn-sm" @click="loadReviews">刷新</button></div>
      <div v-if="rLoading" class="loading-sm">加载中...</div>
      <div v-else-if="reviews.length === 0" class="empty-state">暂无审核请求</div>
      <table v-else>
        <thead><tr><th>提示词</th><th>提交者</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="r in reviews" :key="r.id">
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">{{ r.prompt_title || '-' }}</td>
            <td>{{ r.submitter_name || r.user_id }}</td>
            <td>{{ r.created_at ? new Date(r.created_at).toLocaleString() : '-' }}</td>
            <td>
              <span class="badge" :class="r.status === 'pending' ? 'badge-pending' : r.status === 'approved' ? 'badge-public' : 'badge-private'">
                {{ r.status === 'pending' ? '审核中' : r.status === 'approved' ? '已通过' : '已拒绝' }}
              </span>
            </td>
            <td class="actions">
              <button @click="viewReview(r)" class="btn btn-ghost btn-sm">查看</button>
              <button v-if="r.status === 'pending'" @click="approveReview(r)" class="btn btn-primary btn-sm">通过</button>
              <button v-if="r.status === 'pending'" @click="openReject(r)" class="btn btn-danger btn-sm">拒绝</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
	    <!-- 审核详情弹窗 -->
	    <div v-if="reviewDetail" :class="['modal-overlay', { active: !!reviewDetail }]" @click.self="reviewDetail = null">
	      <div class="modal" style="max-width:800px;">
	        <div class="modal-header"><h3>审核详情</h3><button class="modal-close" @click="reviewDetail = null">&times;</button></div>
	        <div class="modal-body">
	          <div style="margin-bottom:12px;display:flex;gap:16px;color:var(--text-secondary);font-size:13px;">
	            <span>提交者: {{ reviewDetail.submitter_name || reviewDetail.user_id }}</span>
	            <span>状态: {{ reviewDetail.status === 'pending' ? '审核中' : reviewDetail.status === 'approved' ? '已通过' : '已拒绝' }}</span>
	          </div>
	          <!-- Diff 对比 -->
	          <template v-if="reviewDetail.status === 'pending' && originalPrompt">
	            <div class="fg"><label>标题</label>
	              <div class="diff-field">
	                <div class="diff-old">原: {{ originalPrompt.title }}</div>
	                <div class="diff-new">新: {{ reviewDetail.title }}</div>
	              </div>
	            </div>
	            <div class="fg"><label>描述</label>
	              <div class="diff-field">
	                <div class="diff-old">原: {{ originalPrompt.description || '-' }}</div>
	                <div class="diff-new">新: {{ reviewDetail.description || '-' }}</div>
	              </div>
	            </div>
	            <div class="fg"><label>内容 <span class="hint" style="margin-left:8px;">绿色=新增 红色=删除 灰色=未变</span></label>
	              <div class="diff-content">
	                <div v-for="(line, i) in diffLines" :key="i" class="diff-line" :class="line.type">
	                  <span class="diff-prefix">{{ line.prefix }}</span>
	                  <span class="diff-text">{{ line.text || '​' }}</span>
	                </div>
	              </div>
	            </div>
	          </template>
	          <template v-else>
	            <div class="fg"><label>标题</label><div style="padding:6px 10px;background:var(--surface-sunken);border-radius:6px;">{{ reviewDetail.title }}</div></div>
	            <div class="fg"><label>描述</label><div style="padding:6px 10px;background:var(--surface-sunken);border-radius:6px;">{{ reviewDetail.description || '-' }}</div></div>
	            <div class="fg"><label>内容</label><pre style="padding:10px;background:var(--surface-sunken);border-radius:6px;max-height:300px;overflow:auto;white-space:pre-wrap;font-size:13px;">{{ reviewDetail.content }}</pre></div>
	          </template>
	          <div v-if="reviewDetail.admin_comment" class="fg"><label>审核意见</label><div style="padding:6px 10px;background:var(--surface-sunken);border-radius:6px;color:var(--accent-red);">{{ reviewDetail.admin_comment }}</div></div>
	          <div class="form-btns" v-if="reviewDetail.status === 'pending'">
	            <button class="btn btn-ghost" @click="reviewDetail = null">取消</button>
	            <button class="btn btn-danger" @click="rejectReview(reviewDetail)">拒绝</button>
	            <button class="btn btn-primary" @click="approveReview(reviewDetail)">通过</button>
	          </div>
	        </div>
	      </div>
	    </div>
    <!-- TDK（仅管理员） -->
    <div v-if="tab === 'tdk' && isAdmin" class="setting-card">
      <h3>提示词页面 TDK 设置</h3>
      <p class="hint">留空则使用系统 TDK 设置</p>
      <div class="fg"><label>页面标题</label><input v-model="tdk.promptproTitle" placeholder="PromptPro - 提示词管理" @input="saveTdk"></div>
      <div class="fg"><label>页面描述</label><input v-model="tdk.promptproDescription" placeholder="AI提示词管理平台" @input="saveTdk"></div>
      <div class="fg"><label>关键词</label><input v-model="tdk.promptproKeywords" placeholder="提示词,AI,prompt" @input="saveTdk"></div>
    </div>
    <!-- 文件夹编辑弹窗 -->
    <div v-show="folderEditVisible" :class="['modal-overlay', { active: folderEditVisible }]" @click.self="folderEditVisible = false">
      <div class="modal">
        <div class="modal-header"><h3>{{ folderEditId ? '编辑文件夹' : '新建文件夹' }}</h3><button class="modal-close" @click="folderEditVisible = false">&times;</button></div>
        <div class="modal-body">
          <div class="fg"><label>名称</label><input v-model="folderEditForm.name" type="text" placeholder="文件夹名称"></div>
          <!-- 新建文件夹自动使用当前登录用户，无需选择 -->
          <div class="fg"><label>父文件夹</label>
            <select v-model="folderEditForm.parent_id">
              <option :value="null">无（顶级）</option>
              <option v-for="f in flatPFolders.filter(x => x.id !== folderEditId)" :key="f.id" :value="f.id">{{ '│  '.repeat(f._depth) }}{{ f.name }}</option>
            </select>
          </div>
          <div class="fg"><label>图标</label>
            <IconPicker v-model="folderEditForm.icon" />
          </div>
          <div class="fg"><label>排序</label><input v-model.number="folderEditForm.sort_order" type="number" min="0" placeholder="0"></div>
          <div class="fg toggle-row"><label>登录可见</label><label class="switch"><input type="checkbox" v-model="folderEditForm.login_required" :true-value="1" :false-value="0" :disabled="!isAdmin"><span class="slider round"></span></label></div>
          <div class="form-btns"><button class="btn btn-ghost" @click="folderEditVisible = false">取消</button><button class="btn btn-primary" @click="saveFolderEdit">保存</button></div>
        </div>
      </div>
    </div>
	    <!-- 编辑弹窗 -->
	    <div v-show="editVisible" :class="['modal-overlay', { active: editVisible }]" @click.self="editVisible = false">
	      <div class="modal">
	        <div class="modal-header"><h3>{{ ef._reviewMode ? '申请修改' : '编辑提示词' }}</h3><button class="modal-close" @click="editVisible = false">&times;</button></div>
	        <div class="modal-body">
	          <div v-if="ef._reviewMode" class="review-hint"><i class="ri-alert-line"></i> 此提示词由管理员创建，修改将提交给管理员审核</div>
	          <div class="fg"><label>标题</label><input v-model="ef.title" type="text"></div>
	          <div class="fg"><label>描述</label><input v-model="ef.description" type="text"></div>
	          <div class="fg"><label>内容</label><textarea v-model="ef.content" rows="6"></textarea></div>
	          <div class="fg"><label>文件夹</label><select v-model="ef.folder_id"><option :value="null">未分类</option><option v-for="f in flatPFolders" :key="f.id" :value="f.id">{{ '│  '.repeat(f._depth) }}{{ f.name }}</option></select></div>
	          <div class="fg toggle-row"><label>登录可见</label><label class="switch"><input type="checkbox" v-model="ef.login_required" :true-value="1" :false-value="0" :disabled="!isAdmin"><span class="slider round"></span></label></div>
	          <div class="form-btns"><button class="btn btn-ghost" @click="editVisible = false">取消</button><button class="btn btn-primary" @click="saveEdit">{{ ef._reviewMode ? '提交审核' : '保存' }}</button></div>
	        </div>
	      </div>
	    </div>
    <!-- 开发工具 -->
    <div v-if="tab === 'dev'" class="card">
      <div class="card-header"><h3>开发工具</h3></div>
      <div style="padding: 16px 20px;">
        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 8px;">填充测试数据</h4>
          <p style="color: var(--text-tertiary); font-size: 13px; margin: 0 0 12px;">一键生成 12 条示例提示词、文件夹、标签和版本历史（仅当您的提示词 ≤ 5 条时可用，避免重复填充）。</p>
          <button class="btn btn-primary btn-sm" :disabled="devLoading" @click="seedDevData">
            {{ devLoading ? '生成中...' : '填充测试数据' }}
          </button>
        </div>
        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 8px;">清空数据</h4>
          <p style="color: var(--text-tertiary); font-size: 13px; margin: 0 0 12px;">永久删除您创建的所有提示词、文件夹和标签数据，不可恢复。</p>
          <button class="btn btn-danger btn-sm" :disabled="devLoading" @click="clearDevData">
            清空全部数据
          </button>
        </div>
        <div v-if="devMsg" :class="['message', devMsgType]" style="margin-top: 8px;">{{ devMsg }}</div>
      </div>
    </div>
    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'
definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '提示词管理' })
function isEmoji(v: string) { return /[\p{Emoji}]/u.test(v) }
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
const currentUserId = computed(() => authStore.user?.id)
function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}
/** 获取认证选项（含 credentials） */
function getAuthOpts(): Record<string, any> {
  return { headers: getAuthHeaders(), credentials: 'include' as const }
}
const tab = ref('prompts')
// Prompts list
const prompts = ref<any[]>([])
const pLoading = ref(false)
const pTotal = ref(0)
const pPage = ref(1)
const pPageSize = 30
const pTotalPages = computed(() => Math.max(1, Math.ceil(pTotal.value / pPageSize)))
const pPages = computed(() => { const a: number[] = []; for (let i = Math.max(1, pPage.value - 2); i <= Math.min(pTotalPages.value, pPage.value + 2); i++) a.push(i); return a })
const promptStats = reactive({ total: 0, folders: 0, tags: 0, versions: 0 })
// 开发工具
const devLoading = ref(false)
const devMsg = ref('')
const devMsgType = ref<'success' | 'error'>('success')
async function loadPrompts() {
  pLoading.value = true
  try {
    const r = await $fetch<any>(`/api/admin/prompts?page=${pPage.value}&limit=${pPageSize}`, { headers: getAuthHeaders() })
    prompts.value = r.prompts || []
    pTotal.value = r.total || r.prompts?.length || 0
  } catch (e) {
    console.error('加载提示词失败', e)
    prompts.value = []
  } finally {
    pLoading.value = false
  }
}
async function loadStats() {
  try {
    const d = await $fetch<any>('/api/admin/stats', { headers: getAuthHeaders() })
    promptStats.total = d.prompts || 0
    promptStats.folders = d.promptFolders || 0
    promptStats.tags = d.tags || 0
    promptStats.versions = d.promptVersions || 0
  } catch (e) { console.error('加载统计失败', e) }
}
// Folders
const pFolders = ref<any[]>([])
const pfLoading = ref(false)
const folderEditVisible = ref(false)
const folderEditId = ref<string | null>(null)
const folderEditForm = reactive({ name: '', parent_id: null as string | null, icon: '', user_id: null as number | null, sort_order: 0, login_required: 0 })
import IconPicker from '~/components/common/IconPicker.vue'
// Users list (for create mode)
const users = ref<any[]>([])
async function loadUsers() { if (!isAdmin.value) { users.value = [{ id: currentUserId.value, username: '我' }]; return }; try { const r = await $fetch<any>('/api/admin/users'); users.value = r.users || [] } catch { users.value = [] } }
// Tree building for prompt folders (string IDs)
interface PFolderNode { id: string; name: string; parent_id?: string | null; parent_name?: string; username?: string; user_id?: number; prompt_count?: number; icon?: string; _depth: number; _hasChildren: boolean; children: PFolderNode[] }
function buildPTree(list: any[]): PFolderNode[] {
  const map = new Map<string, PFolderNode>()
  const roots: PFolderNode[] = []
  for (const f of list) map.set(f.id, { ...f, _depth: 0, children: [], _hasChildren: false })
  for (const n of map.values()) {
    const pid = n.parent_id
    if (pid && map.has(pid)) { map.get(pid)!.children.push(n); map.get(pid)!._hasChildren = true }
    else roots.push(n)
  }
  return roots
}
function flattenPTree(nodes: PFolderNode[], depth: number): PFolderNode[] {
  let r: PFolderNode[] = []
  for (const n of nodes) { n._depth = depth; r.push(n); if (n.children.length > 0) r = r.concat(flattenPTree(n.children, depth + 1)) }
  return r
}
const flatPFolders = computed(() => flattenPTree(buildPTree(pFolders.value), 0))
// Collapse/expand state
const allPExpanded = ref(true)
const pCollapsedIds = ref(new Set<string>())
const pFolderListRef = ref<HTMLElement | null>(null)
let pFolderSortable: any = null
const displayPFolders = computed(() => {
  const tree = buildPTree(pFolders.value)
  const result: PFolderNode[] = []
  function walk(nodes: PFolderNode[], depth: number) {
    for (const n of nodes) {
      n._depth = depth
      result.push(n)
      if (!pCollapsedIds.value.has(n.id) && n.children.length) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return result
})
function toggleAllPFolders() {
  allPExpanded.value = !allPExpanded.value
  if (allPExpanded.value) {
    pCollapsedIds.value = new Set()
  } else {
    const ids = new Set<string>()
    const tree = buildPTree(pFolders.value)
    function walk(nodes: PFolderNode[]) { for (const n of nodes) { if (n.children.length > 0) { ids.add(n.id); walk(n.children) } } }
    walk(tree)
    pCollapsedIds.value = ids
  }
}
async function loadPFolders() { pfLoading.value = true; try { const d = await $fetch<{ folders: any[] }>('/api/admin/prompt-folders', { headers: getAuthHeaders() }); pFolders.value = d.folders || [] } catch (e) { console.error('加载文件夹失败', e); pFolders.value = [] } finally { pfLoading.value = false } }
function createPFolder() { Object.assign(folderEditForm, { name: '', parent_id: null, icon: '', user_id: currentUserId.value, sort_order: 0, login_required: 0 }); folderEditId.value = null; folderEditVisible.value = true }
function openFolderEdit(f: any) { Object.assign(folderEditForm, { name: f.name, parent_id: f.parent_id || null, icon: f.icon || '', user_id: f.user_id, sort_order: f.sort_order || 0, login_required: f.login_required || 0 }); folderEditId.value = f.id; folderEditVisible.value = true }
async function saveFolderEdit() {
  if (!folderEditForm.name.trim()) return alert('请输入文件夹名称')
  try {
    if (folderEditId.value) {
      await $fetch(`/api/admin/prompt-folders/${folderEditId.value}`, { method: 'PUT', headers: getAuthHeaders(), body: { name: folderEditForm.name, parent_id: folderEditForm.parent_id, icon: folderEditForm.icon || null, sort_order: folderEditForm.sort_order, login_required: folderEditForm.login_required } })
    } else {
      await $fetch('/api/admin/prompt-folders', { method: 'POST', headers: getAuthHeaders(), body: { name: folderEditForm.name, parent_id: folderEditForm.parent_id, icon: folderEditForm.icon || null, sort_order: folderEditForm.sort_order, login_required: folderEditForm.login_required } })
    }
    folderEditVisible.value = false
    loadPFolders()
  } catch (e: any) {
    alert('保存失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
async function delPFolder(f: any) { if (!confirm(`删除「${f.name}」？`)) return; try { await $fetch(`/api/admin/prompt-folders/${f.id}`, { method: 'DELETE', headers: getAuthHeaders() }); loadPFolders() } catch (e: any) { alert('删除失败: ' + (e?.data?.error || e?.message || '未知错误')) } }
// Tags
const tags = ref<any[]>([])
const tagLoading = ref(false)
async function loadTags() { tagLoading.value = true; try { const d = await $fetch<{ tags: any[] }>('/api/admin/tags', { headers: getAuthHeaders() }); tags.value = d.tags || [] } catch (e) { console.error('加载标签失败', e); tags.value = [] } finally { tagLoading.value = false } }
async function createTag() { const n = prompt('标签名称'); if (n) { try { await $fetch('/api/tags', { method: 'POST', headers: getAuthHeaders(), body: { name: n } }); loadTags() } catch (e: any) { alert('创建失败: ' + (e?.data?.error || e?.message || '未知错误')) } } }
async function delTag(t: any) { if (!confirm(`删除标签「${t.name}」？`)) return; try { await $fetch(`/api/tags/${t.id}`, { method: 'DELETE', headers: getAuthHeaders() }); loadTags() } catch (e: any) { alert('删除失败: ' + (e?.data?.error || e?.message || '未知错误')) } }
// History
const history = ref<any[]>([])
const hLoading = ref(false)
async function loadHistory() { hLoading.value = true; try { const d = await $fetch<any>('/api/admin/prompts/history', { headers: getAuthHeaders() }); history.value = d.versions || [] } catch (e) { console.error('加载历史失败', e); history.value = [] } finally { hLoading.value = false } }
function viewHistory(p: any) { tab.value = 'history'; loadHistory() }
// Trash
const trashList = ref<any[]>([])
const trashLoading = ref(false)
async function loadTrash() {
  trashLoading.value = true
  try {
    const d = await $fetch<any>('/api/admin/prompts?deleted=1', { headers: getAuthHeaders(), credentials: 'include' })
    trashList.value = d.prompts || []
  } catch (e) {
    console.error('加载回收站失败', e)
    trashList.value = []
  } finally {
    trashLoading.value = false
  }
}
async function restorePrompt(p: any) {
  if (!confirm(`恢复提示词「${p.title}」？`)) return
  try {
    await $fetch(`/api/prompts/${p.id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: { deleted_at: null }
    })
    loadTrash()
    loadStats()
  } catch (e: any) {
    alert('恢复失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
async function permanentDeletePrompt(p: any) {
  if (!confirm(`永久删除提示词「${p.title}」？此操作不可恢复！`)) return
  try {
    await $fetch(`/api/prompts/${p.id}?permanent=1`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include'
    })
    loadTrash()
    loadStats()
  } catch (e: any) {
    alert('删除失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
async function emptyTrash() {
  if (!confirm('确定清空回收站？此操作将永久删除所有已删除的提示词，不可恢复！')) return
  trashLoading.value = true
  try {
    for (const p of trashList.value) {
      await $fetch(`/api/prompts/${p.id}?permanent=1`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'include'
      })
    }
    loadTrash()
    loadStats()
  } catch (e: any) {
    alert('清空失败: ' + (e?.data?.error || e?.message || '未知错误'))
  } finally {
    trashLoading.value = false
  }
}
// TDK
const tdk = reactive({ promptproTitle: '', promptproDescription: '', promptproKeywords: '' })
async function loadTdk() { try { const d = await $fetch<any>('/api/tdk/promptpro', { headers: getAuthHeaders() }); Object.assign(tdk, { promptproTitle: d.promptproTitle || '', promptproDescription: d.promptproDescription || '', promptproKeywords: d.promptproKeywords || '' }) } catch (e) { console.error('加载 TDK 失败', e) } }
let tdkTimer: any = null
function saveTdk() { clearTimeout(tdkTimer); tdkTimer = setTimeout(async () => { try { await $fetch('/api/admin/config', { method: 'PUT', headers: getAuthHeaders(), body: { data: { ...tdk } } }) } catch (e) { console.error('保存 TDK 失败', e) } }, 500) }
// 开发工具
async function seedDevData() {
  devLoading.value = true; devMsg.value = ''
  try {
    const res = await $fetch<any>('/api/admin/dev/seed-prompts', { method: 'POST', headers: getAuthHeaders(), credentials: 'include' })
    if (res.success) {
      devMsg.value = `已生成 ${res.data.prompts} 条提示词、${res.data.folders} 个文件夹、${res.data.tags} 个标签`
      devMsgType.value = 'success'
      loadStats(); loadPrompts()
    } else {
      devMsg.value = res.message || '填充失败'
      devMsgType.value = 'error'
    }
  } catch (e: any) { devMsg.value = '填充失败: ' + (e?.data?.error || e?.message || '未知错误'); devMsgType.value = 'error' }
  devLoading.value = false
}
async function clearDevData() {
  if (!confirm('确定清空所有提示词数据？此操作不可恢复！')) return
  devLoading.value = true; devMsg.value = ''
  try {
    const res = await $fetch<any>('/api/admin/dev/clear-prompts', { method: 'POST', headers: getAuthHeaders(), credentials: 'include' })
    devMsg.value = `已清空 ${res.deleted} 条提示词`
    devMsgType.value = 'success'
    loadStats(); loadPrompts()
  } catch (e: any) { devMsg.value = '清空失败: ' + (e?.data?.error || e?.message || '未知错误'); devMsgType.value = 'error' }
  devLoading.value = false
}
// Edit modal
const editVisible = ref(false)
const ef = reactive({ id: '', title: '', description: '', content: '', folder_id: null as string | null, login_required: 0, _reviewMode: false })
function openEdit(p: any) { 
  Object.assign(ef, { 
    id: p.id, title: p.title, description: p.description || '', content: p.content || '', 
    folder_id: p.folder_id ?? null, login_required: p.login_required || 0,
    _reviewMode: !isAdmin.value && p.owner_is_admin
  }); 
  editVisible.value = true 
}
async function saveEdit() { 
  try {
    const body = { ...ef }
    delete body._reviewMode
    const res = await $fetch(`/api/admin/prompts/${ef.id}`, { method: 'PUT', headers: getAuthHeaders(), body })
    editVisible.value = false
    if (res?.review_required) {
      alert('修改已提交审核，等待管理员审批')
    }
    loadPrompts() 
  } catch (e: any) {
    alert('保存失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
async function delPrompt(p: any) { if (!confirm(`删除「${p.title}」？`)) return; try { await $fetch(`/api/admin/prompts/${p.id}`, { method: 'DELETE', headers: getAuthHeaders() }); loadPrompts(); loadStats() } catch (e: any) { alert('删除失败: ' + (e?.data?.error || e?.message || '未知错误')) } }
function canDeletePrompt(p: any) { return isAdmin.value || p.user_id === currentUserId.value }
// Import/Export（兼容 promptpro v1.0 / v2.0 与 FavsHub 格式）
const importFile = ref<HTMLInputElement | null>(null)
function triggerImport() { importFile.value?.click() }
async function exportJSON() {
  try {
    // 拉取完整数据（promptpro v2.0 结构：prompts/folders/tags/tag_relations/versions）
    const data = await $fetch<any>('/api/prompts/export', { headers: getAuthHeaders(), credentials: 'include' })
    const exportData = {
      version: '2.0.0',
      export_date: new Date().toISOString(),
      prompts: data.prompts || [],
      folders: data.folders || [],
      tags: data.tags || [],
      tag_relations: data.tag_relations || [],
      versions: data.versions || [],
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `promptpro-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  } catch (e: any) { alert('导出失败: ' + (e?.message || '未知错误')) }
}
async function importJSON(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    const fd = new FormData()
    fd.append('file', f)
    const res = await $fetch<any>('/api/prompts/import', { method: 'POST', headers: getAuthHeaders(), credentials: 'include', body: fd })
    alert(`导入成功：${res.imported.prompts} 条提示词、${res.imported.folders} 个文件夹、${res.imported.tags} 个标签${res.skipped_prompts ? `（跳过 ${res.skipped_prompts} 条重复）` : ''}`)
    loadPrompts(); loadStats()
  } catch (err: any) {
    alert('导入失败: ' + (err?.data?.error || err?.message || '文件解析错误'))
  } finally { (e.target as HTMLInputElement).value = '' }
}
// 拖拽排序
async function onPFolderReorder(oldIndex: number, newIndex: number) {
  if (oldIndex === newIndex) return
  const list = [...displayPFolders.value]
  const [moved] = list.splice(oldIndex, 1)
  list.splice(newIndex, 0, moved)
  const items: { id: string; sort_order: number }[] = []
  const parentOrder = new Map<string, number>()
  for (const f of list) {
    const key = String(f.parent_id || 'root')
    const order = (parentOrder.get(key) || 0) + 1
    parentOrder.set(key, order)
    items.push({ id: f.id, sort_order: order })
  }
  try {
    await $fetch('/api/admin/prompt-folders/reorder', { method: 'PUT', headers: getAuthHeaders(), body: { items } })
    await loadPFolders()
  } catch (e) { console.error('排序失败', e) }
}
function initPFolderSortable() {
  if (pFolderSortable) { pFolderSortable.destroy(); pFolderSortable = null }
  const el = pFolderListRef.value
  if (!el) return
  import('sortablejs').then(({ default: Sortable }) => {
    pFolderSortable = Sortable.create(el, {
      handle: '.folder-drag-handle',
      animation: 200,
      ghostClass: 'sortable-ghost',
      onEnd(evt: any) {
        if (evt.oldIndex !== evt.newIndex) {
          onPFolderReorder(evt.oldIndex, evt.newIndex)
        }
      }
    })
  })
}
watch(displayPFolders, () => { nextTick(initPFolderSortable) }, { deep: true })
// ── 审核请求 ──────────────────────────────────────────────
const reviews = ref<any[]>([])
const rLoading = ref(false)
const reviewDetail = ref<any>(null)
const originalPrompt = ref<any>(null)
const diffLines = ref<{ type: string; prefix: string; text: string }[]>([])

async function loadReviews() { rLoading.value = true; try { const d = await $fetch<any>('/api/admin/prompts/review-requests', { headers: getAuthHeaders() }); reviews.value = d.requests || [] } catch (e) { console.error('加载审核请求失败', e); reviews.value = [] } finally { rLoading.value = false } }

async function viewReview(r: any) { 
  reviewDetail.value = r
  // 加载原提示词数据
  try {
    const d = await $fetch<any>(`/api/admin/prompts/${r.prompt_id}`, { headers: getAuthHeaders() })
    originalPrompt.value = d.prompt
    // 计算内容 diff
    if (originalPrompt.value) {
      diffLines.value = computeDiff(originalPrompt.value.content || '', r.content || '')
    }
  } catch {
    originalPrompt.value = null
    diffLines.value = []
  }
}

/** LCS 行级 diff */
function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length, n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  let i = m, j = n
  const ops: { type: 'same' | 'del' | 'add'; text: string }[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: 'same', text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'add', text: newLines[j - 1] })
      j--
    } else {
      ops.unshift({ type: 'del', text: oldLines[i - 1] })
      i--
    }
  }
  return ops.map(op => ({
    type: op.type,
    prefix: op.type === 'same' ? '  ' : op.type === 'add' ? '+ ' : '- ',
    text: op.text
  }))
}

async function approveReview(r: any) {
  if (!confirm(`通过「${r.prompt_title || r.title}」的修改请求？`)) return
  try {
    await $fetch(`/api/admin/prompts/review-requests/${r.id}/approve`, { method: 'POST', headers: getAuthHeaders() })
    reviewDetail.value = null; loadReviews(); loadPrompts()
  } catch (e: any) {
    alert('审核操作失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
async function openReject(r: any) {
  const comment = prompt('请输入拒绝原因（可选）：')
  if (comment === null) return
  try {
    await $fetch(`/api/admin/prompts/review-requests/${r.id}/reject`, { method: 'POST', headers: getAuthHeaders(), body: { comment } })
    reviewDetail.value = null; loadReviews()
  } catch (e: any) {
    alert('拒绝操作失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
async function rejectReview(r: any) {
  const comment = prompt('请输入拒绝原因（可选）：')
  if (comment === null) return
  try {
    await $fetch(`/api/admin/prompts/review-requests/${r.id}/reject`, { method: 'POST', headers: getAuthHeaders(), body: { comment } })
    reviewDetail.value = null; loadReviews()
  } catch (e: any) {
    alert('拒绝操作失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
onMounted(() => { loadPrompts(); loadStats(); loadPFolders(); loadTags(); loadHistory(); loadTdk(); loadUsers() })
</script>

<style scoped>
.folder-drag-list { display: flex; flex-direction: column; gap: 2px; }
.folder-drag-item {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; background: var(--surface-sunken);
  border-radius: 6px; cursor: default; transition: background 0.15s;
}
.folder-drag-item:hover { background: var(--surface-hover); }
.folder-drag-handle {
  cursor: grab; color: var(--text-tertiary); font-size: 14px; user-select: none;
  width: 16px; text-align: center; flex-shrink: 0;
}
.folder-drag-handle:active { cursor: grabbing; }
.folder-drag-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-drag-meta { color: var(--text-tertiary); font-size: 12px; white-space: nowrap; }
.folder-drag-actions { display: flex; gap: 4px; flex-shrink: 0; }
:deep(.sortable-ghost) { opacity: 0.4; background: var(--primary-light) !important; }
</style>
