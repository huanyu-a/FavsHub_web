<template>
  <!-- 装饰层：读屏不可见（真实状态由下方 .sr-only 承载），不参与布局、不挡点击 -->
  <div
    class="deal-badge"
    :class="[`is-${tone}`, 'is-circle', `is-anchor-${anchor}`, { 'is-seal-secondary': secondary }]"
    aria-hidden="true"
  >
    <!-- title 是「其他」40 字手填文案的悬停出口（圆内只显示「需实名」三个字）。
         整层 pointer-events:none，但 `.badge-label` 单独开了 pointer-events:auto
         —— 只有那几个字可悬停，圆的其他部分仍然完全穿透，不挡正文点击。 -->
    <span class="badge-label" :title="title || undefined">{{ label }}</span>
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
 *     + `isolation: isolate`（自建层叠上下文，让水印层落在**内容之下**、
 *     而不是掉到更外层祖先的背景后面去）；
 *   - `pointer-events: none`：不拦截任何点击；
 *   - 负层叠：由外层 `.tdd-seal-layer { z-index:-1 }` 承担，正常流内容盖在整层之上。
 *
 * ## 几何（2026-10-30 三轮重做）
 *
 * 直径 = `min(50vw, 320px)`：手机上严格等于页面宽度的一半（360→180px、375→187.5px）。
 *
 * **锚点在内容区上部**：`top: 8%`（相对 `.tdd-body-inner`）。
 * 上一版是「相对内容区垂直居中」，用户反馈「现在手机端第一屏看不到」——
 * 因为手机第一屏只有 header + 免费额度 + 接入信息，够不到容器一半高度。
 * 8% 让 360×640 的手机第一屏就能看到它，且更靠上（2026-10-30 用户第二次上调）。
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
  /**
   * 锚点：
   *   top       = 内容区上部、水平居中（核验水印）
   *   top-right = 内容区上部、贴右（是否实名水印）
   * 两个水印同在「标题 + 额度」这一水平带，一个居中一个贴右，互不相交。
   */
  anchor?: 'top' | 'top-right'
  /** 是否为「次要水印」：次要水印小一号，避免与核验水印相交 */
  secondary?: boolean
}>(), {
  sublabel: '',
  tone: 'neutral',
  title: '',
  anchor: 'top',
  secondary: false,
})
</script>

<style scoped>
.deal-badge {
  /* 直径：**容器宽**的一半，320px 封顶；45cqh 是「容器高」的上限（见下方尺寸注释）。
     ⚠️ 这里必须用 `cqw`（容器宽）而不是 `vw`（视口宽）—— 2026-10-30 七轮浏览器实测抓到的 bug：
     水印放在 W 宽的容器里，而 `50vw` 是按视口算的。当容器比视口窄时
     （弹窗 max-width:680、手机视口被 padding 吃掉），`50vw` 会大于 W，
     于是 `max-width:100%` 把圆压成整行宽 `[0,W]` ——
     右侧贴右的实名水印 `[W−d2, W]` 就整块落在核验圆内，两个水印相交
     （实测 320/360/375/414 宽下横向间隙分别为 −46/−49/−45/−31px）。
     改用 `50cqw` 后，直径恒为 W/2，圆永远不撑满整行，
     留给右侧水印的空间恒为 W/4 = 25cqw > 16cqw（次水印）→ 恒不相交。
     降级链：先声明不含 cqh 的版本 —— 不支持容器查询的浏览器会整条丢弃含 cqh 的声明，
     回落到 `min(50cqw, 320px)`；若连 cqw 都不支持，再回落到 `min(50vw, 320px)`
     （此时失去「按容器宽/高自适应」的保护，但水印仍能显示，不会消失、不会塌）。 */
  --badge-size: min(50vw, 320px);
  --badge-size: min(50cqw, 320px);
  --badge-size: min(50cqw, 320px, 45cqh);
  /* 默认中性色，由下面各 tone 类覆盖 */
  --badge-tone: var(--text-tertiary);

  /* ── 水印层：脱流、不可点、在内容之下 ──
     2026-10-30 五轮：水印现在被放进 `.tdd-seal-layer`（一个 `z-index:-1` 的绝对定位
     覆盖层）。「压在正文之下」这件事由那个层统一负责，所以本元素**不再需要**自己的
     负 z-index —— 若仍写 -1，会沉到层自身背景之下（等于在负层里再负一层），
     在某些渲染路径下会看不见。这里留 `z-index:0`（层内默认层）。
     定位基准仍是 `.tdd-seal-layer`（position:absolute），它的高 = 内容区高度。 */
  position: absolute;
  z-index: 0;
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

/* ── 锚点 top：内容区上部、**水平居中**（核验水印）──
   上一版是「相对内容区居中」，用户反馈「手机端第一屏看不到」——
   因为第一屏只有 header + 免费额度 + 接入信息，够不到容器一半高度。
   改到顶部 8% 后：360×640（容器高 ≈ 0.88×640 − 126 ≈ 437）顶边 ≈ 35px，
   圆直径 min(180, 320, 45cqh≈197) ≈ 180px → 底边 ≈ 215px，
   完整落在首屏内、位置正好在「免费额度」到「接入信息」之间。 */
.deal-badge.is-anchor-top {
  top: 8%;
  left: 50%;
  transform: translate(-50%, 0);
}

/* ── 锚点 top-right：内容区上部、**贴右**（是否实名水印，2026-10-30 七轮）──
   用户原话：「实名不要徽章，要不占位的水印」，位置在「标题与额度区最右侧」。
   所以它和核验水印同在 `top: 8%` 这一水平带，但一个居中、一个贴右。
   不相交的充要条件（几何推导见尺寸注释）：
     核验占 [(W − d1)/2, (W + d1)/2]，实名占 [W − d2, W]
     → 需要 d2 < (W − d1)/2
   `left:auto` 必须显式写：基础规则里没有 left，但 `is-anchor-top` 有 left:50%，
   两条类同时命中时必须让本类覆盖（模板不会同时给两个 anchor，这里只是防御）。
   `transform:none` 同理 —— 不能继承居中用的 translate(-50%,0)。 */
.deal-badge.is-anchor-top-right {
  top: 8%;
  right: 0;
  left: auto;
  transform: none;
}

/* ── 次水印尺寸（是否实名）：用 cqw（容器宽），比核验水印小一号 ──
   不相交条件是 d2 < (W − d1)/2，其中 W 是**容器宽**、d1 是核验直径。
   (W − d1)/2 是个「小屏很紧」的量：桌面约 213~262px、320 手机只有 55~73px。
   用 vw 的话窄屏下 d2 跟着视口缩，但 W 比视口更窄、(W−d1)/2 缩得更快 → 易越界。
   用 cqw 让 d2 直接按容器宽取比例，与分母同一量纲。

   **恒不相交的证明**（改用 cqw 后不再依赖视口，只依赖容器宽 W 与容器高 H）：
     d1 = min(0.5W, 320, 0.45H)，d2 = min(0.16W, 140)，判据 d2 < (W−d1)/2
     情况 A：0.5W 生效（W ≤ 640）
       → d1 = 0.5W → (W−d1)/2 = 0.25W；d2 = 0.16W → 0.25W > 0.16W ✓
     情况 B：320 封顶（W > 640）
       → (W−320)/2 ≥ (640−320)/2 = 160；d2 ≤ 160（封顶）→ 160 > 160 ✗ 边界相等！
       所以 B 分支必须用 W 的真实下界：W > 640 时 (W−320)/2 > 160，
       而 d2 = min(0.22W, 160) 在 W ≤ 727 时仍是 0.22W < (W−320)/2；
       W > 727 时 d2 触 160 封顶，(W−320)/2 > (727−320)/2 = 203.5 > 160 ✓
       即：W∈(640,727] 由 0.22W 递增保证、W>727 由 160 封顶保证。
     情况 C：0.45H 生效（H 很小）
       → d1 比 0.5W 更小 → 余量更大 ✓
     三种情况覆盖全部取值 → 对任意 W、H 恒不相交 ✅

   为什么是 22cqw（2026-10-30 八轮定稿）：16cqw 在窄屏 360 下只有 52px，
   圆内字号 ≈ 8.6px，「无需实名」四字在截图里已接近不可辨 —— 提系数是为了可读性。
   窄屏分支下 d1 = 0.5W，上限恒为 (W−0.5W)/2 = 0.25W → k 的理论上限就是 0.250。
   取 k = 0.22 留 3% 安全余量：余量 = 0.25W − 0.22W = 0.03W > 0（对任意 W 恒成立）。
   实测各档余量：W=286 → 8.6px、326 → 9.8px、341 → 10.2px、614 → 18.4px、746 → 53.7px。
   桌面触到 160 封顶（原 140），余量反而更宽松。
   窄屏字号从 8.6px 提到 11.8px（+37%），这是本次提系数的直接目的。 */
.deal-badge.is-seal-secondary {
  --badge-size: min(22cqw, 160px);
}
/* ── 尺寸：跟着**容器高**（cqh），不是视口高 ──
   主水印（核验）：min(50vw, 320px, 45cqh)
   次水印（是否实名）：min(38vw, 240px, 34cqh) —— 比主水印小一号。
   **透明度完全沿用主水印**（填充 2% / 描边 9% / 文字 0.20），不另设一套。

   为什么用 cqh 而不是 vh（2026-10-30 五轮，Lead 实测指出）：
   两种形态下「容器高」的来源完全不同 ——
     弹窗  ：`.tdd-modal { max-height: 88vh }`，容器高 ≈ 0.88×视口高 − header/footer；
     落地页：`.tdd-modal { max-height: none }`，容器高 = **内容自然高**，与视口无关。
   vh 只对弹窗成立；落地页下内容少的通告容器高可能只有 300~500px，
   而视口 900 时 vh 仍按 900 算 → 水印过大 → 两个圆重叠（Lead 实测 gap 到 −183px）。
   cqh 直接测量「内容区高度」，两种形态自动正确。

   系数推导（对任意 H 恒成立，不依赖任何形态假设）：
     间距 gap = 0.84H − d1 − d2（两个水印各占 8% 边距）
     把 d1、d2 都按 H 的比例取：d1 = k1·H、d2 = k2·H
     → gap = (0.84 − k1 − k2)·H
     只要 k1 + k2 < 0.84，**对任意容器高 H 都恒为正**。
   取 k1 = 0.45、k2 = 0.34 → 和为 0.79 < 0.84 → gap = 0.05·H（恒正）。
   为什么不取 Lead 建议的 0.26 / 0.16（和为 0.42，gap 更宽松）：
   那样桌面 H=679 时主水印只有 0.26×679 ≈ 177px，比 320px 封顶缩掉一半，
   明显偏离用户「直径要占页面宽度的一半」的要求。0.45/0.34 在保证恒不相交的前提下
   让水印在常见容器高（≥712px）时仍能吃到 vw 封顶；比值 0.34/0.45 ≈ 0.756，
   与「次水印 240 / 主水印 320 = 0.75」一致。 */
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
  /* 只有文字本身接收指针事件（这样 title 能悬停弹出）；
     圆的其他区域仍是 pointer-events:none，完全穿透、不挡正文点击与选中。 */
  pointer-events: auto;
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