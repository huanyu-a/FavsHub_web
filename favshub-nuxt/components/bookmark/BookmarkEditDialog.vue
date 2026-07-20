<template>
  <div id="edit-dialog" class="modal" style="display:flex;" @click.self="$emit('close')">
    <div class="modal-content">
      <span class="close-button" @click="$emit('close')">&times;</span>
      <h2>{{ isNew ? '添加快捷链接' : '编辑快捷链接' }}</h2>
      <form @submit.prevent="handleSubmit">
        <label>名称：</label>
        <input v-model="form.title" type="text" required placeholder="书签名称">

        <label>描述：</label>
        <textarea v-model="form.description" placeholder="书签描述（选填）" rows="2" style="width:100%;resize:vertical;"></textarea>

        <label>网址：</label>
        <input v-model="form.url" type="url" required placeholder="https://example.com">

        <label>图标 URL：</label>
        <input v-model="form.icon" type="text" placeholder="留空自动获取 favicon">

        <label>分类</label>
        <div class="edit-category-select">
          <button type="button" class="edit-category-select-trigger" :class="{ open: folderDropdownOpen }" @click="folderDropdownOpen = !folderDropdownOpen">
            <span class="edit-category-select-text" :class="{ placeholder: form.folder_id === null }">{{ selectedFolderName }}</span>
            <span class="edit-category-select-arrow"><i class="ri-arrow-down-s-line"></i></span>
          </button>
          <div class="edit-category-select-dropdown" :class="{ open: folderDropdownOpen }">
            <button type="button" class="edit-category-select-option" :class="{ selected: form.folder_id === null }" @click="selectFolder(null)">
              <span class="edit-category-select-option-label">未分类</span>
            </button>
            <button
              v-for="f in folderTree"
              :key="f.id"
              type="button"
              class="edit-category-select-option"
              :class="{ selected: form.folder_id === f.id }"
              :style="{ paddingLeft: (f._depth || 0) * 16 + 12 + 'px' }"
              @click="selectFolder(f.id)"
            >
              <span class="edit-category-select-option-label">{{ f.name }}</span>
            </button>
          </div>
        </div>

        <div class="form-toggles">
          <div v-if="isAdmin" class="toggle-item">
            <label>需要登录才可见</label>
            <label class="switch"><input type="checkbox" v-model="form.login_required" :true-value="1" :false-value="0"><span class="slider round"></span></label>
          </div>
          <div class="toggle-item">
            <label>需要代理访问</label>
            <label class="switch"><input type="checkbox" v-model="form.need_proxy" :true-value="1" :false-value="0"><span class="slider round"></span></label>
          </div>
        </div>
        <div class="form-buttons">
          <button type="button" class="cancel-button" @click="$emit('close')">取消</button>
          <button type="submit">保存</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Folder {
  id: number
  name: string
  parent_id?: number | null
}

interface FolderNode extends Folder {
  _depth: number
  children: FolderNode[]
}

const props = defineProps<{
  bookmark?: any
  folders: Folder[]
  isNew: boolean
  isAdmin?: boolean
}>()

const emit = defineEmits<{
  save: [data: any]
  close: []
}>()

const form = reactive({
  title: props.bookmark?.title || '',
  url: props.bookmark?.url || '',
  folder_id: props.bookmark?.folder_id ?? null,
  icon: props.bookmark?.icon || '',
  login_required: props.bookmark?.login_required || 0,
  description: props.bookmark?.description || '',
  need_proxy: props.bookmark?.need_proxy || 0,
})

// Re-sync form when editing different bookmarks consecutively
watch(() => props.bookmark, (bm) => {
  Object.assign(form, {
    title: bm?.title || '',
    url: bm?.url || '',
    folder_id: bm?.folder_id ?? null,
    icon: bm?.icon || '',
    login_required: bm?.login_required || 0,
    description: bm?.description || '',
    need_proxy: bm?.need_proxy || 0,
  })
})

const folderDropdownOpen = ref(false)

const folderTree = computed(() => {
  const map = new Map<number, FolderNode>()
  const roots: FolderNode[] = []

  for (const f of props.folders) {
    map.set(f.id, { ...f, _depth: 0, children: [] })
  }

  for (const node of map.values()) {
    const pid = (node as any).parent_id
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  function flatten(nodes: FolderNode[], depth: number): FolderNode[] {
    let result: FolderNode[] = []
    for (const n of nodes) {
      n._depth = depth
      result.push(n)
      if (n.children.length > 0) {
        result = result.concat(flatten(n.children, depth + 1))
      }
    }
    return result
  }

  return flatten(roots, 0)
})

const selectedFolderName = computed(() => {
  if (form.folder_id === null || form.folder_id === undefined) return '未分类'
  const folder = props.folders.find(f => f.id === form.folder_id)
  return folder ? folder.name : '未分类'
})

function selectFolder(id: number | null) {
  form.folder_id = id
  folderDropdownOpen.value = false
}

function handleSubmit() {
  const data: any = { ...form }
  if (!props.isNew && props.bookmark?.id) {
    data.id = props.bookmark.id
  }
  emit('save', data)
}
</script>


<style scoped>
.form-toggles {
  display: flex;
  gap: 24px;
  margin-top: 4px;
}

.toggle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}

.toggle-item > label:first-child {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
</style>