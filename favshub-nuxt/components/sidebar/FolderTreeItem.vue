<script setup lang="ts">
import { computed } from 'vue'
import FolderTreeItem from './FolderTreeItem.vue'

interface FolderNode {
  id: number | string
  name: string
  icon?: string
  parent_id?: number | string | null
  login_required?: number
  _depth: number
  _count: number
  _hasChildren: boolean
  children: FolderNode[]
}

const props = defineProps<{
  node: FolderNode
  currentFolderId?: number | string | null
  expandedIds: Set<number | string>
}>()

const emit = defineEmits<{
  'select-folder': [id: number | string]
  'toggle-expand': [id: number | string]
  'contextmenu-folder': [e: MouseEvent, node: FolderNode]
}>()

const isExpanded = computed(() => props.expandedIds.has(props.node.id))
const isSelected = computed(() => props.currentFolderId === props.node.id)
const paddingLeft = computed(() => `${8 + props.node._depth * 20}px`)

const iconClass = computed(() => {
  if (props.node.icon) return props.node.icon
  const iconList = ['ri-folder-line','ri-folder-2-line','ri-folder-3-line','ri-folder-4-line','ri-bookmark-line','ri-star-line']
  let h = 0
  for (let i = 0; i < props.node.name.length; i++) h = ((h << 5) - h) + props.node.name.charCodeAt(i)
  return iconList[Math.abs(h) % iconList.length]
})

const isEmoji = computed(() => {
  return props.node.icon && /[\p{Emoji}]/u.test(props.node.icon) && !/ri-/.test(props.node.icon)
})

function onClick() {
  emit('select-folder', props.node.id)
  if (props.node._hasChildren) emit('toggle-expand', props.node.id)
}

function toggleExpand(e: Event) {
  e.stopPropagation()
  emit('toggle-expand', props.node.id)
}
</script>

<template>
  <!-- 文件夹项：li 节点 -->
  <li
    class="folder-tree-item"
    :class="{ selected: isSelected }"
    :style="{ paddingLeft, position: 'relative' }"
    @click="onClick"
    @contextmenu.prevent="emit('contextmenu-folder', $event, node)"
  >
    <span v-if="isEmoji" style="font-size:16px;flex-shrink:0;width:20px;text-align:center;">{{ node.icon }}</span>
    <i v-else :class="iconClass" style="font-size:16px;color:var(--primary);flex-shrink:0;width:20px;text-align:center;"></i>
    <span :title="node.name" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ node.name }}</span>
    <span v-if="node.login_required" title="登录可见" style="flex-shrink:0;font-size:11px;margin-left:2px;">🔒</span>
    <span
      v-if="node._hasChildren"
      style="cursor:pointer;display:inline-flex;align-items:center;flex-shrink:0;margin-left:2px;"
      @click="toggleExpand"
    >
      <!-- eslint-disable-next-line vue/no-v-html -->
      <svg v-if="isExpanded" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M480-541.85 317.08-378.92q-8.31 8.3-20.89 8.5-12.57.19-21.27-8.5-8.69-8.7-8.69-21.08 0-12.38 8.69-21.08l179.77-179.77q10.85-10.84 25.31-10.84 14.46 0 25.31 10.84l179.77 179.77q8.3 8.31 8.5 20.89.19 12.57-8.5 21.27-8.7 8.69-21.08 8.69-12.38 0-21.08-8.69L480-541.85Z"/></svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M517.85-480 354.92-642.92q-8.3-8.31-8.5-20.89-.19-12.57 8.5-21.27 8.7-8.69 21.08-8.69 12.38 0 21.08 8.69l179.77 179.77q5.61 5.62 7.92 11.85 2.31 6.23 2.31 13.46t-2.31 13.46q-2.31 6.23-7.92 11.85L397.08-274.92q-8.31 8.3-20.89 8.5-12.57.19-21.27-8.5-8.69-8.69-8.69-21.08 0-12.38 8.69-21.08L517.85-480Z"/></svg>
    </span>
  </li>
  <!-- 子文件夹：嵌套 ul -->
  <ul v-if="node._hasChildren && isExpanded && node.children.length > 0" class="pl-4 space-y-2">
    <FolderTreeItem
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :current-folder-id="currentFolderId"
      :expanded-ids="expandedIds"
      @select-folder="(id: number | string) => emit('select-folder', id)"
      @toggle-expand="(id: number | string) => emit('toggle-expand', id)"
      @contextmenu-folder="(e: MouseEvent, n: FolderNode) => emit('contextmenu-folder', e, n)"
    />
  </ul>
</template>

<style scoped>
.folder-tree-item {
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  font-weight: bold;
  color: var(--text-primary);
  transition: background 0.15s;
}

.folder-tree-item:hover {
  background: var(--surface-selected);
}

.folder-tree-item.selected {
  background: var(--primary);
  color: var(--text-inverse);
}
</style>
