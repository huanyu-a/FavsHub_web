<template>
  <div class="bookmark-edit-modal" @click.self="$emit('close')">
    <div class="modal-content">
      <span class="close-button" @click="$emit('close')">&times;</span>
      <h2>{{ isNew ? '添加快捷链接' : '编辑快捷链接' }}</h2>
      <form @submit.prevent="handleSubmit">
        <label>名称：</label>
        <input v-model="form.title" type="text" required placeholder="书签名称">

        <label>网址：</label>
        <input v-model="form.url" type="url" required placeholder="https://example.com">

        <label>图标 URL：</label>
        <input v-model="form.icon" type="text" placeholder="留空自动获取 favicon">

        <label>分类：</label>
        <div class="folder-select-wrapper">
          <div class="folder-select-trigger" @click="folderDropdownOpen = !folderDropdownOpen">
            <span>{{ selectedFolderName || '未分类' }}</span>
            <i class="ri-arrow-down-s-line"></i>
          </div>
          <div v-if="folderDropdownOpen" class="folder-select-dropdown" @click.self="folderDropdownOpen = false">
            <div class="folder-option" :class="{ selected: form.folder_id === null }" @click="selectFolder(null)">
              <span>未分类</span>
            </div>
            <div
              v-for="f in folderTree"
              :key="f.id"
              class="folder-option"
              :class="{ selected: form.folder_id === f.id }"
              :style="{ paddingLeft: (f._depth || 0) * 16 + 12 + 'px' }"
              @click="selectFolder(f.id)"
            >
              <i class="ri-folder-3-line"></i>
              <span>{{ f.name }}</span>
            </div>
          </div>
        </div>

        <label v-if="isAdmin">
          <input type="checkbox" v-model="form.login_required" :true-value="1" :false-value="0">
          需要登录才可见
        </label>
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
})

const folderDropdownOpen = ref(false)

// 构建层级文件夹树
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
.bookmark-edit-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  width: 420px;
  max-width: 90vw;
  position: relative;
}
.close-button {
  position: absolute;
  top: 12px;
  right: 16px;
  font-size: 24px;
  cursor: pointer;
  color: #999;
}
.close-button:hover { color: #333; }
h2 {
  margin: 0 0 20px;
  font-size: 18px;
  color: #333;
}
label {
  display: block;
  font-size: 13px;
  color: #666;
  margin: 12px 0 6px;
}
input[type="text"],
input[type="url"] {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}
input[type="text"]:focus,
input[type="url"]:focus {
  border-color: #667eea;
}
input[type="checkbox"] {
  margin-right: 6px;
}
.folder-select-wrapper {
  position: relative;
}
.folder-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1.5px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #444;
}
.folder-select-trigger:hover { border-color: #667eea; }
.folder-select-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  z-index: 10;
  margin-top: 4px;
}
.folder-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  color: #555;
  transition: background 0.1s;
}
.folder-option:hover { background: #f5f5f5; }
.folder-option.selected { background: #e3f2fd; color: #1976d2; }
.form-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.cancel-button {
  padding: 10px 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}
.form-buttons button[type="submit"] {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
</style>
