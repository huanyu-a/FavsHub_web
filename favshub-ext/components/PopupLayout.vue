<script setup lang="ts">
// 弹窗模式固定 400×600；作为侧边栏打开时（URL 带 context=side_panel，
// 或视口明显高于 popup 上限）自适应全宽全高。
//
// ⚠️ 弹窗分支不得加「最大高度 = 100vh」这类限制（Tailwind 里那个 max-h-* 工具类即是）：
// Chrome 的 action 弹窗视口高度由「内容高度」推导，而 100vh 又反过来依赖视口高度，
// 两者互相钳制会让弹窗卡死在首次测量的小尺寸上，表现为「弹窗无法完全展开」。
// 弹窗分支必须给出确定高度（600px），Chrome 才会把弹窗撑到上限。
const params = new URLSearchParams(window.location.search);
const hasSidePanelParam = params.get('context') === 'side_panel';

// Chrome action 弹窗高度上限 600px，故视口高于 640 一定是侧边栏（留安全余量）。
const SIDE_PANEL_MIN_VIEWPORT = 640;

// 首屏先用「弹窗」这一确定高度的分支：它能稳定撑出 600px，
// 之后再用真实视口校正。反过来（先猜侧边栏）会因 h-screen 与视口互相依赖而卡住。
const isSidePanel = ref(hasSidePanelParam);

function syncMode() {
  isSidePanel.value = hasSidePanelParam || window.innerHeight > SIDE_PANEL_MIN_VIEWPORT;
}

let timer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  // 弹窗/侧栏的最终尺寸在首帧之后才定下来，故 rAF + 一次延时各校正一次
  requestAnimationFrame(syncMode);
  timer = setTimeout(syncMode, 150);
  window.addEventListener('resize', syncMode);
});

onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer);
  window.removeEventListener('resize', syncMode);
});
</script>

<template>
  <div
    class="flex flex-col overflow-hidden bg-slate-50 text-slate-900"
    :class="isSidePanel ? 'h-screen w-full' : 'h-[600px] w-[400px]'"
  >
    <slot />
  </div>
</template>
