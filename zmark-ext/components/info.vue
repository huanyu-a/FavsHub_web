<script lang="ts" setup>
import { OpenOutline, StarOutline, InformationCircleOutline, BookOutline, LogoGithub, GlobeOutline, CloseOutline } from '@vicons/ionicons5';

const emit = defineEmits<{
  close: [];
}>();

type InfoLink = {
  title: string;
  url: string;
  icon: typeof OpenOutline;
  accentClass: string;
};

const infoLinks: InfoLink[] = [
  {
    title: 'ZMark 官网',
    url: 'https://www.zmark.app/',
    icon: GlobeOutline,
    accentClass: 'from-sky-500/15 to-cyan-500/10 text-sky-700',
  },
  {
    title: '帮助文档',
    url: 'https://dwz.ovh/zmark',
    icon: BookOutline,
    accentClass: 'from-sky-500/15 to-cyan-500/10 text-sky-700',
  },
  {
    title: '扩展项目地址',
    url: 'https://github.com/helloxz/zmark-ext',
    icon: LogoGithub,
    accentClass: 'from-slate-500/15 to-slate-400/10 text-slate-700',
  },
];

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function closePanel() {
  emit('close');
}
</script>

<template>
  <div class="rounded-[28px] bg-white p-4 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
    <div class="flex items-start justify-between gap-4">
      <div>
        <div class="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-100">
          <n-icon :component="InformationCircleOutline" size="14" />
          扩展信息
        </div>
        <h2 class="mt-2.5 text-lg font-semibold tracking-tight text-slate-900">ZMark Extension</h2>
      </div>

      <n-button quaternary circle type="default" title="关闭" @click="closePanel">
        <template #icon>
          <n-icon :component="CloseOutline" size="18" />
        </template>
      </n-button>
    </div>

    <div class="mt-4 rounded-3xl bg-gradient-to-br from-sky-500 via-blue-500 to-cyan-500 p-[1px]">
      <div class="rounded-[calc(1.5rem-1px)] bg-white/95 p-3.5 backdrop-blur">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Version</div>
            <div class="mt-1 text-xl font-semibold text-slate-900">1.0.0</div>
          </div>
          <n-button strong secondary size="small" type="warning" @click="openExternal('https://dwz.ovh/jtxo')">
            <template #icon>
              <n-icon :component="StarOutline" size="15" />
            </template>
            为扩展评分
          </n-button>
        </div>
      </div>
    </div>

    <div class="mt-3 space-y-2.5">
      <button
        v-for="item in infoLinks"
        :key="item.url"
        type="button"
        class="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm"
        @click="openExternal(item.url)"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset ring-white/60" :class="item.accentClass">
          <n-icon :component="item.icon" size="18" />
        </div>
        <div class="min-w-0 flex-1 text-sm font-semibold text-slate-800">{{ item.title }}</div>
        <div class="shrink-0 text-sky-600 transition-transform group-hover:translate-x-0.5">
          <n-icon :component="OpenOutline" size="15" />
        </div>
      </button>
    </div>
  </div>
</template>
