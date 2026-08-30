<script lang="ts" setup>
import BottomNav from '@/components/BottomNav.vue';
import PopupLayout from '@/components/PopupLayout.vue';
import PageTitle from '@/components/title.vue';
import { request } from '@/utils/request';
import { tokenStorage } from '@/utils/storage';
import { isSafeUrl } from '@/utils/safe-url';
import { t } from '@/i18n';
import type { FormInst, FormRules } from 'naive-ui';

interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
}

type SelectOption = {
  label: string;
  value: number;
};

const message = useMessage();
const formRef = ref<FormInst | null>(null);
const isSubmitting = ref(false);
const isRecognizing = ref(false);
const folders = ref<Folder[]>([]);
const formValue = reactive({
  url: '',
  title: '',
  description: '',
  folderId: null as number | null,
});

const folderOptions = computed<SelectOption[]>(() => {
  // 构建树形结构并扁平化，带缩进
  const map = new Map<number, Folder & { children: Folder[] }>();
  const roots: (Folder & { children: Folder[] })[] = [];
  for (const f of folders.value) {
    map.set(f.id, { ...f, children: [] });
  }
  for (const f of folders.value) {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const result: SelectOption[] = [];
  function walk(nodes: (Folder & { children: Folder[] })[], depth: number) {
    for (const node of nodes) {
      result.push({ label: '　'.repeat(depth) + node.name, value: node.id });
      if (node.children.length) walk(node.children as (Folder & { children: Folder[] })[], depth + 1);
    }
  }
  walk(roots, 0);
  return result;
});

// 校验消息走 t()，用 computed 保持语言切换后提示同步更新
const rules = computed<FormRules>(() => ({
  url: [
    { required: true, message: t('ui.add.url_required'), trigger: ['input', 'blur'] },
  ],
  title: [
    { required: true, message: t('ui.add.title_required'), trigger: ['input', 'blur'] },
  ],
  folderId: [
    { required: true, type: 'number', message: t('ui.add.folder_required'), trigger: ['change', 'blur'] },
  ],
}));

async function loadCurrentTab() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    formValue.url = activeTab?.url ?? '';
    formValue.title = activeTab?.title ?? '';
  } catch {
    message.error(t('ui.add.load_tab_failed'));
  }
}

async function loadFolders() {
  try {
    const token = await tokenStorage.getValue();
    if (!token) return;

    const result = await request<{ folders: Folder[] }>('/api/folders');
    folders.value = result.folders ?? [];
  } catch {
    message.error(t('ui.add.load_folders_failed'));
  }
}

async function handleSubmit() {
  if (!folders.value.length) {
    message.error(t('ui.add.no_folders'));
    return;
  }

  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  // 客户端协议白名单：防止 javascript: 等伪协议入库
  if (!isSafeUrl(formValue.url.trim())) {
    message.error(t('ui.add.invalid_url_protocol'));
    return;
  }

  isSubmitting.value = true;

  try {
    await request('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formValue.title.trim(),
        url: formValue.url.trim(),
        folder_id: formValue.folderId,
        description: formValue.description.trim() || undefined,
      }),
    });

    message.success(t('ui.add.success'));
    formValue.url = '';
    formValue.title = '';
    formValue.description = '';
    formValue.folderId = null;
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('ui.add.failed'));
  } finally {
    isSubmitting.value = false;
  }
}

async function handleAutoDetect() {
  if (!formValue.url) return;
  isRecognizing.value = true;

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      formValue.url = activeTab.url ?? '';
      formValue.title = activeTab.title ?? '';
    }
  } catch {
    // Ignore
  } finally {
    isRecognizing.value = false;
  }
}

onMounted(() => {
  void loadCurrentTab();
  void loadFolders();
});
</script>

<template>
  <PopupLayout>
    <PageTitle :title="t('ui.add.title')" />

    <main class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div class="space-y-3">
        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <n-form ref="formRef" :model="formValue" :rules="rules" label-placement="top" require-mark-placement="right-hanging">
            <n-form-item :label="t('ui.add.label_url')" path="url">
              <n-input v-model:value="formValue.url" placeholder="https://example.com" @keyup.enter="handleSubmit" />
            </n-form-item>

            <n-form-item :label="t('ui.add.label_title')" path="title">
              <n-input v-model:value="formValue.title" :placeholder="t('ui.add.placeholder_title')" />
            </n-form-item>

            <n-form-item :label="t('ui.add.label_folder')" path="folderId">
              <n-select
                v-model:value="formValue.folderId"
                :options="folderOptions"
                :placeholder="t('ui.add.placeholder_folder')"
              />
            </n-form-item>

            <n-form-item :label="t('ui.add.label_description')" class="mb-0">
              <n-input
                v-model:value="formValue.description"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 3 }"
                :placeholder="t('ui.add.placeholder_description')"
              />
            </n-form-item>
          </n-form>

          <div class="grid grid-cols-2 gap-2">
            <n-button block :loading="isRecognizing" :disabled="!formValue.url.trim() || isSubmitting" @click="handleAutoDetect">
              {{ t('ui.add.auto_detect') }}
            </n-button>
            <n-button block type="primary" :loading="isSubmitting" :disabled="isRecognizing" @click="handleSubmit">
              {{ t('ui.add.submit') }}
            </n-button>
          </div>
        </section>
      </div>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
