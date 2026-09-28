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
/* ── 有限梯度局部变量 ── */
.tpl-var-overlay {
  --radius-xs: 6px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --duration-slow: 240ms;
  --ease-standard: cubic-bezier(0.22, 1, 0.36, 1);

  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.tpl-var-modal {
  background: var(--surface-raised);
  border-radius: var(--radius-md);
  width: 420px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: tpl-modal-in var(--duration-slow) var(--ease-standard);
}
@keyframes tpl-modal-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.tpl-var-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.tpl-var-header h3 {
  margin: 0;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
}
.tpl-var-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  padding: 4px;
  transition: background var(--duration-fast) var(--ease-standard),
              color var(--duration-fast) var(--ease-standard);
}
.tpl-var-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.tpl-var-close:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tpl-var-close:active {
  background: var(--surface-active);
  transform: scale(0.98);
}
.tpl-var-body {
  padding: 16px 20px;
  overflow-y: auto;
}
.tpl-var-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
}
.tpl-var-field {
  margin-bottom: 12px;
}
.tpl-var-field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--text-primary);
}
.tpl-var-field input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  font-size: 14px;
  background: var(--surface-sunken);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard);
}
.tpl-var-field input:hover {
  border-color: var(--border-focus);
}
.tpl-var-field input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}
.tpl-var-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
}
/* 取消按钮 */
.tpl-var-footer .btn-ghost {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard),
              color var(--duration-fast) var(--ease-standard),
              border-color var(--duration-fast) var(--ease-standard);
}
.tpl-var-footer .btn-ghost:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
  border-color: var(--border-focus);
}
.tpl-var-footer .btn-ghost:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tpl-var-footer .btn-ghost:active {
  background: var(--surface-active);
  transform: scale(0.98);
}
/* 确认按钮 */
.tpl-var-footer .btn-primary {
  background: var(--primary);
  border: 1px solid var(--primary);
  color: var(--text-inverse);
  border-radius: var(--radius-xs);
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard),
              transform var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard);
}
.tpl-var-footer .btn-primary:hover {
  background: var(--primary-hover);
  box-shadow: var(--shadow-md);
}
.tpl-var-footer .btn-primary:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tpl-var-footer .btn-primary:active {
  background: var(--primary-dark);
  transform: scale(0.98);
}
</style>
