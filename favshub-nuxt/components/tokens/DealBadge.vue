<template>
  <!-- 装饰层：读屏不可见（真实状态由下方 .sr-only 承载），不参与布局、不挡点击 -->
  <div
    class="deal-badge"
    :class="[`is-${tone}`, 'is-circle', 'is-anchor-top']"
    aria-hidden="true"
  >
    <span class="badge-label">{{ label }}</span>
    <span v-if="sublabel" class="badge-sub">{{ sublabel }}</span>
  </div>
  <!--
    无障碍：水印层是纯装饰（aria-hidden），但「已核验 / 待核验」「是否实名」是有意义的状态。
    用 sr-only 把状态交给读屏，避免视觉降级连带语义丢失。
    （sr-only 必须是水印层的**兄弟节点**：放进 aria-hidden 容器里会被一并隐藏。）
  -->
  <span class="sr-only">{{ srText }}</span>
</template>

<script setup lang="ts">
/**
 * 详情页「核验水印」（2026-10-30 三轮）
 *
 * ## 为什么是水印层而不是布局元素
 *
 * 用户原始需求「透明背景大徽标」被实现成正文里一块 320px 的占位元素后，
 * 实测发现它把正文推开了 —— 用户明确纠正：
 *   「我说的徽标是**以背景图的方式**显示的，上边加个**不透明度**，**不要影响正式内容显示**」
 * 所以本组件是 `position: absolute` 的背景层：
 *   - **不参与文档流**：没有 margin 推开内容、没有 flex/grid 占位、不撑大容器高度；
 *   - 容器（`.tdd-body-inner`）负责 `position: relative`（定位基准）
 *     + `isolation: isolate`（自建层叠上下文，让 `z-index:-1` 的水印落在**内容之下**、
 *     而不是掉到更外层祖先的背景后面去）；
 *   - `pointer-events: none`：不拦截任何点击；
 *   - `z-index: -1`：在容器的层叠上下文里处于负层，所有正常流内容都盖在它上面。
 *
 * ## 几何（2026-10-30 三轮重做）
 *
 * 直径 = `min(50vw, 320px)`：手机上严格等于页面宽度的一半（360→180px、375→187.5px）。
 *
 * **锚点在内容区上部**：`top: 22%`（相对 `.tdd-body-inner`）。
 * 上一版是「相对内容区垂直居中」，用户反馈「现在手机端第一屏看不到」——
 * 因为手机第一屏只有 header + 免费额度 + 接入信息，够不到容器一半高度。
 * 22% 让 360×640 的手机第一屏就能看到它。
 *
 * ## 不透明度（2026-10-30 三轮再压）
 *
 * 若对整层用 `opacity`，文字会跟着一起淡掉（`已核验` 在 16% alpha 下对比度 ≈1.1:1）；
 * 用户又要求「绿色+文字已核验」，所以拆成两层分别控制：
 *   - 圆圈本体：填充 2%、描边 9% → 极淡的印章轮廓，几乎不干扰阅读；
 *   - 文字：`opacity: 0.20` → 仍认得出「已核验」三个字，但不与正文抢注意力。
 * 完整语义同时由兄弟节点的 `.sr-only` 承载（见模板注释）。
 *
 * ## 配色
 *
 * 只用站点既有变量（`tokens.css`），亮/暗主题自动跟随。
 * 文字色把 tone 与 `--text-primary` 混一档（0.70），避免 `--warning`(#F59E0B)
 * 直接当文字色时在浅色主题下只有 ≈2.2:1。
 */
withDefaults(defineProps<{
  /** 主文案（居中显示） */
  label: string
  /** 次文案（小字，可空） */
  sublabel?: string
  /** 配色档：ok=绿 / pending=黄 / blue / purple / primary / neutral */
  tone?: 'ok' | 'pending' | 'blue' | 'purple' | 'primary' | 'neutral'
  /** 原生 title：鼠标悬停时透出完整说明（水印文字较淡，长文案靠它兜底） */
  title?: string
  /** 读屏文本：视觉上看不见，但承载真实语义（如「核验状态：已核验」） */
  srText: string
}>(), {
  sublabel: '',
  tone: 'neutral',
  title: '',
})
</script>

<style scoped>
.deal-badge {
  /* 直径：页面宽度的一半，320px 封顶。
     （水印要像「盖在纸上的印章」，铺得太满就成了色块，反而抢正文注意力。） */
  --badge-size: min(50vw, 320px);
  /* 默认中性色，由下面各 tone 类覆盖 */
  --badge-tone: var(--text-tertiary);

  /* ── 水印层：脱流、不可点、在内容之下 ──
     z-index:-1 只有在「容器自建层叠上下文」时才安全地落在内容之下；
     否则会掉到祖先背景后面而整层不可见。容器（.tdd-body）已加 isolation:isolate。 */
  position: absolute;
  z-index: -1;
  pointer-events: none;

  box-sizing: border-box;
  width: var(--badge-size);
  /* 极窄容器兜底：容器比 50vw 还窄时也不横向溢出（水印同样不该露出容器外） */
  max-width: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;

  /* ── 视觉强度（2026-10-30 三轮：用户要求「是否核验的徽标水印透明度再往低调」）──
   水印要像纸上的浅印章。三档继续压低：
     圆圈填充 3.5% → 2%，描边 14% → 9%，文字 opacity 0.30/0.26 → 0.20/0.17。
   文字仍用实色（不透空）：用户要求「绿色+文字已核验 / 黄色+文字待核验」，
   0.20 下仍认得出「已核验」三个字；它是装饰性水印，完整语义由 sr-only 承载。 */
  background: color-mix(in srgb, var(--badge-tone) 2%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--badge-tone) 9%, transparent);
  color: color-mix(in srgb, var(--badge-tone) 70%, var(--text-primary));
}

/* ── 形态：圆形（显式类，由模板绑定 'is-circle'）──
   为什么做成独立的类而不是合并进 `.deal-badge`：这样「元素到底带没带上几何」
   可以被 SSR/DOM 上的 class 断言住。之前把几何并进基础规则后，
   模板 class 绑定一缩水，几何就静默失效了（实测渲染成 320×89 直角方块）。 */
.deal-badge.is-circle {
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  padding: calc(var(--badge-size) * 0.12);
  gap: calc(var(--badge-size) * 0.02);
}

/* ── 锚点：内容区上部（显式类，由模板绑定 'is-anchor-top'）──
   用户原话：「高度再往上调，现在手机端第一屏看不到」。
   上一版是「圆心相对内容区居中」，但手机上第一屏只有 header + 免费额度 + 接入信息，
   够不到容器一半高度 —— 水印整块落在首屏之外，所以看不到。
   现在改为**相对容器顶部**锚定：
     顶边 = 22% × 容器高，圆直径 min(50vw, 320px)。
   360×640 手机：容器高约 576（弹窗 max-height 92vh 减 header/footer），
     顶边 ≈ 127px，圆底边 ≈ 127 + 180 = 307px —— 完整落在首屏 640 内，
     位置正好在「免费额度」到「接入信息」之间。
   不再有尾部方章，原「圆心居中 + 尾部留白联动」的推导整套作废。 */
.deal-badge.is-anchor-top {
  top: 22%;
  left: 50%;
  transform: translate(-50%, 0);
}

.badge-label,
.badge-sub {
  max-width: 100%;
  /* 长文案（「其他」的手填说明上限 40 字）必须能换行且不撑破徽标 */
  overflow-wrap: anywhere;
}
.badge-label {
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0.04em;
}
.badge-sub {
  line-height: 1.3;
}
/* 文字层的不透明度（2026-10-30 三轮：0.30/0.26 → 0.20/0.17）
   —— 用户要求「透明度再往低调」，但仍要认得出「已核验 / 待核验」 */
.badge-label { opacity: 0.20; }
.badge-sub { opacity: 0.17; }

.deal-badge .badge-label { font-size: calc(var(--badge-size) * 0.165); }
.deal-badge .badge-sub { font-size: calc(var(--badge-size) * 0.062); }

/* 配色档：只换 --badge-tone，几何与透明度全部共用 */
.deal-badge.is-ok { --badge-tone: var(--success); }
.deal-badge.is-pending { --badge-tone: var(--warning); }
.deal-badge.is-blue { --badge-tone: var(--accent-blue); }
.deal-badge.is-purple { --badge-tone: var(--accent-purple); }
.deal-badge.is-primary { --badge-tone: var(--primary); }
.deal-badge.is-neutral { --badge-tone: var(--text-tertiary); }

/* 读屏专用：视觉隐藏但仍可被辅助技术读取（与本仓 TokenFilterBar / keys.vue 的写法一致）。
   必须是 1px + clip 而不是 display:none —— 后者会让读屏也读不到。 */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>