<template>
  <Teleport to="body">
    <div v-if="visible" class="tpl-var-overlay" @click.self="cancel">
      <div class="tpl-var-modal">
        <div class="tpl-var-header">
          <h3><i class="ri-braces-line"></i> 填写模板变量</h3>
          <button class="tpl-var-close" @click="cancel"><i class="ri-close-line"></i></button>
        </div>
        <div class="tpl-var-body">
          <p class="tpl-var-hint">此提示词包含 {{ variables.length }} 个变量，请填写后复制</p>
          <div v-for="v in variables" :key="v" class="tpl-var-field">
            <label>{{ v }}</label>
            <input
              v-model="values[v]"
              type="text"
              :placeholder="`请输入 ${v}`"
              @keydown.enter="confirm"
            >
          </div>
        </div>
        <div class="tpl-var-footer">
          <button class="btn btn-ghost" @click="cancel">取消</button>
          <button class="btn btn-primary" @click="confirm">
            <i class="ri-file-copy-line"></i> 替换并复制
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { parseTemplateVariables, fillTemplateVariables } from '~/utils/template-variables'

const props = defineProps<{
  content: string
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', filledContent: string): void
  (e: 'cancel'): void
}>()

const variables = ref<string[]>([])
const values = ref<Record<string, string>>({})

watch(() => props.visible, (v) => {
  if (v) {
    variables.value = parseTemplateVariables(props.content)
    values.value = {}
  }
})

function confirm() {
  const filled = fillTemplateVariables(props.content, values.value)
  emit('confirm', filled)
}

function cancel() {
  emit('cancel')
}
</script>

<style scoped>
.tpl-var-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.tpl-var-modal {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  width: 420px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}
.tpl-var-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border, #eee);
}
.tpl-var-header h3 {
  margin: 0;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tpl-var-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-secondary, #666);
}
.tpl-var-body {
  padding: 16px 20px;
  overflow-y: auto;
}
.tpl-var-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}
.tpl-var-field {
  margin-bottom: 12px;
}
.tpl-var-field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--text-primary, #333);
}
.tpl-var-field input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border, #ddd);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-secondary, #f9f9f9);
  color: var(--text-primary, #333);
  outline: none;
  box-sizing: border-box;
}
.tpl-var-field input:focus {
  border-color: var(--primary, #10b981);
}
.tpl-var-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border, #eee);
}
</style>
