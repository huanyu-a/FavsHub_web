<script lang="ts" setup>
import BottomNav from '@/components/BottomNav.vue';
import PopupLayout from '@/components/PopupLayout.vue';
import PageTitle from '@/components/title.vue';
import { request } from '@/utils/request';
import { tokenStorage } from '@/utils/storage';
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
      if (node.children.length) walk(node.children, depth + 1);
    }
  }
  walk(roots, 0);
  return result;
});

const rules: FormRules = {
  url: [
    { required: true, message: '请输入链接', trigger: ['input', 'blur'] },
  ],
  title: [
    { required: true, message: '请输入标题', trigger: ['input', 'blur'] },
  ],
  folderId: [
    { required: true, type: 'number', message: '请选择分类', trigger: ['change', 'blur'] },
  ],
};

async function loadCurrentTab() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    formValue.url = activeTab?.url ?? '';
    formValue.title = activeTab?.title ?? '';
  } catch {
    message.error('读取当前页面信息失败');
  }
}

async function loadFolders() {
  try {
    const token = await tokenStorage.getValue();
    if (!token) return;

    const result = await request<{ folders: Folder[] }>('/api/folders');
    folders.value = result.folders ?? [];
  } catch {
    message.error('读取分类失败');
  }
}

async function handleSubmit() {
  if (!folders.value.length) {
    message.error('分类为空，请先在书签页加载分类');
    return;
  }

  try {
    await formRef.value?.validate();
  } catch {
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
      }),
    });

    message.success('添加书签成功');
    formValue.url = '';
    formValue.title = '';
    formValue.description = '';
    formValue.folderId = null;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '添加失败');
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
    <PageTitle title="添加书签" />

    <main class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div class="space-y-3">
        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <n-form ref="formRef" :model="formValue" :rules="rules" label-placement="top" require-mark-placement="right-hanging">
            <n-form-item label="链接" path="url">
              <n-input v-model:value="formValue.url" placeholder="https://example.com" />
            </n-form-item>

            <n-form-item label="标题" path="title">
              <n-input v-model:value="formValue.title" placeholder="请输入标题" />
            </n-form-item>

            <n-form-item label="分类" path="folderId">
              <n-select
                v-model:value="formValue.folderId"
                :options="folderOptions"
                placeholder="选择分类"
              />
            </n-form-item>

            <n-form-item label="描述" class="mb-0">
              <n-input
                v-model:value="formValue.description"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 3 }"
                placeholder="选填"
              />
            </n-form-item>
          </n-form>

          <div class="grid grid-cols-2 gap-2">
            <n-button block :loading="isRecognizing" :disabled="!formValue.url.trim() || isSubmitting" @click="handleAutoDetect">
              自动识别
            </n-button>
            <n-button block type="primary" :loading="isSubmitting" :disabled="isRecognizing" @click="handleSubmit">
              添加链接
            </n-button>
          </div>
        </section>
      </div>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
