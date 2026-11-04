<!--
  TokenCompareTable —— 精选对比表（2026-11-04 从 pages/tokens/compare.vue 抽出）

  为什么抽组件：用户要求「compare 应放置到 /tokens 页」。原先是独立路由 /tokens/compare，
  与 /tokens 各自持有一份页头（本仓既有惯例，但重复）。抽出后：
    · /tokens 页内可内嵌（tab）
    · /tokens/compare 仍保留独立路由 —— 老链接、外链、搜索收录都指向它，
      直接删会造成 404，必须留着重定向壳。

  props.deals 由调用方提供（都在 fetch `/api/token-deals?featured=1`）。
  本组件**不发请求**，纯展示，方便在 tab 里复用同一份数据。
-->
<template>
  <div class="cmp-root">
    <!-- 加载骨架 -->
    <div v-if="pending" class="cmp-skeleton" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="cmp-sk-row">
        <div class="sk sk-line w-30"></div>
        <div class="sk sk-line w-60"></div>
        <div class="sk sk-line w-40"></div>
        <div class="sk sk-line w-50"></div>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="rows.length === 0" class="empty-state">
      <i class="ri-table-line"></i>
      <p>暂无精选条目</p>
      <span>管理员可在后台把值得对比的通告勾选为「精选对比」，之后会出现在这里</span>
    </div>

    <!-- 对比表（≤768px 由样式降级为卡片） -->
    <div v-else class="cmp-table-wrap">
      <table class="cmp-table">
        <caption class="sr-only">精选免费资源逐项对比</caption>
        <thead>
          <tr>
            <th scope="col">资源 / 接入</th>
            <th scope="col">免费额度</th>
            <th scope="col">领取与使用限制</th>
            <th scope="col">有效期</th>
            <th scope="col">最近核实</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in rows" :key="d.id">
            <td data-label="资源 / 接入">
              <a class="cmp-resource" :href="detailHref(d.id)">
                <span class="cmp-provider">{{ d.provider }}</span>
                <span v-if="domainOf(d.url)" class="cmp-domain">{{ domainOf(d.url) }}</span>
              </a>
              <span class="cmp-deal-title" :title="d.title">{{ d.title }}</span>
            </td>
            <td data-label="免费额度">
              <span class="cmp-clamp" :title="String(d.quota || '').trim() || undefined">{{ text(d.quota) }}</span>
            </td>
            <!-- 领取条件与限制合并成一列（2026-11-04 契约）：
                 两者都短，且导入数据里多数切不出独立的「领取条件」，
                 分成两列会出现整列空白。 -->
            <td data-label="领取与使用限制">
              <span class="cmp-clamp" :title="combinedTerms(d) || undefined">{{ text(combinedTerms(d)) }}</span>
            </td>
            <td data-label="有效期">{{ expiryText(d.expires_at) }}</td>
            <td data-label="最近核实">
              <span class="cmp-verify" :class="verifyClass(d)">{{ verifyText(d) }}</span>
            </td>
            <td data-label="操作">
              <a class="cmp-link" :href="detailHref(d.id)">查看详情</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface IFeaturedDeal {
  id: string
  provider: string
  title: string
  /** 领取/官网地址：对比表只用它的域名做「接入」提示 */
  url?: string
  quota?: string
  /** 领取条件（2026-11-04 新列） */
  requirements?: string
  /** 限制条款（2026-11-04 新列） */
  limits?: string
  expires_at?: number | null
  /** 1 = 进「精选对比」；服务端以 featured=1 过滤后下发 */
  featured?: number
  verified_at?: number
}

const props = withDefaults(defineProps<{
  deals?: IFeaturedDeal[]
  pending?: boolean
}>(), {
  deals: () => [],
  pending: false,
})

/**
 * 防御性归一化（2026-11-04 修的 SSR 500）。
 *
 * 调用方 `:deals="featuredDeals"` 在首帧可能是 `undefined`：
 * `computed(() => data.value?.deals || [])` 里的 `data.value` 在 SSR 期间
 * 还没 resolve 时是 undefined —— 于是 computed 确实返回 []，
 * 但**父组件尚未 hydration 完的极短窗口**里，prop 传下来的是 undefined。
 * 模板里直接 `.length` 会让整页 500（已实测：TypeError reading 'length'）。
 * 用 computed 兜住，任何输入都保证是数组。
 */
const rows = computed<IFeaturedDeal[]>(() => Array.isArray(props.deals) ? props.deals : [])

/* 核实时间超过该天数即标「待复核」——与后端 `deal_verify_stale_days` 默认 30 天同源。
   这里写死 30 是有意的：组件是纯展示，不该为了一个徽标颜色去发一次配置请求；
   若后端调了阈值，这里应同步改（见 docs/audits 的契约表）。 */
const STALE_DAYS = 30

/**
 * 领取条件 + 限制合成一列。
 * 顺序固定「先领取、后限制」，因为读者先想知道「我够不够格」，再关心「有什么坑」。
 * 两者都为空时返回空串，由 text() 统一渲染成「—」。
 */
function combinedTerms(d: IFeaturedDeal): string {
  const req = String(d.requirements || '').trim()
  const lim = String(d.limits || '').trim()
  const parts: string[] = []
  if (req) parts.push(`领取：${req}`)
  if (lim) parts.push(`限制：${lim}`)
  return parts.join('\n')
}

/** 从 URL 取主机名做「接入」提示；取不到返回空串（不显示该行） */
function domainOf(url?: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    // 允许用户填不带协议的地址
    try {
      return new URL(`https://${raw}`).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }
}

function detailHref(id: string): string {
  return `/tokens/${id}.html`
}

/** 空值统一渲染成「—」，避免表格出现大片空白格 */
function text(v?: string): string {
  const s = String(v || '').trim()
  return s || '—'
}

/**
 * 有效期文案。
 * · 无截止 → 「长期有效 / 未标注」（不谎称永久）
 * · 已过期 → 「已过期」
 * · 7 天内 → 「剩 N 天」并用 is-soon 标红
 */
function expiryText(ts?: number | null): string {
  if (!ts) return '长期有效 / 未标注'
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return '长期有效 / 未标注'
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return '已过期'
  if (days <= 7) return `${formatDate(ts)}（剩 ${days} 天）`
  return formatDate(ts)
}

function formatDate(ts: number): string {
  const d = new Date(Number(ts))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 核实状态文案。
 * 「待复核」不等于「已失效」——只表示超过阈值没再确认，措辞要留余地，
 * 否则用户会以为资源已经挂了。
 */
function verifyText(d: IFeaturedDeal): string {
  if (!d.verified_at) return '从未核验'
  const days = Math.floor((Date.now() - Number(d.verified_at)) / 86_400_000)
  if (days > STALE_DAYS) return `待复核（${days} 天前）`
  return `已核实 ${formatDate(d.verified_at)}`
}

function verifyClass(d: IFeaturedDeal): string {
  if (!d.verified_at) return 'is-warn'
  const days = Math.floor((Date.now() - Number(d.verified_at)) / 86_400_000)
  return days > STALE_DAYS ? 'is-warn' : 'is-ok'
}
</script>

<style scoped>
.cmp-root { min-height: 120px; }

.cmp-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-raised);
}
.cmp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.cmp-table th,
.cmp-table td {
  padding: 11px 14px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
}
/* 有效期 / 最近核实两列内容都是短日期，不该被挤到换行。
   实测「2026-11-30」在默认等分下会断成「2026-11-」+「30」两行 —— 难看且易误读。 */
.cmp-table th:nth-child(4),
.cmp-table td:nth-child(4),
.cmp-table th:nth-child(5),
.cmp-table td:nth-child(5) {
  white-space: nowrap;
  width: 1%;            /* 交给内容决定宽度，把剩余空间留给长文本列 */
}
.cmp-table th:nth-child(6),
.cmp-table td:nth-child(6) {
  white-space: nowrap;
  width: 1%;
}
.cmp-table thead th {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-sunken);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}
.cmp-table tbody tr:last-child td { border-bottom: none; }
.cmp-table tbody tr:hover { background: var(--surface-hover); }

.cmp-resource {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-decoration: none;
  color: inherit;
}
.cmp-provider { font-weight: 600; color: var(--text); }
.cmp-resource:hover .cmp-provider { color: var(--primary); }
.cmp-domain { font-size: 12px; color: var(--text-muted); }
.cmp-deal-title {
  display: block;
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted);
  /* 标题最多两行，超出省略——表格里不该被长标题撑开 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 单元格内容限高：旧版是 3 行截断，实测「领取与使用限制」被切成
   「按自然日刷新，当日未用…」——这条恰好是读者最需要看的限制条款，
   截断在关键处等于没写。改为不截断，让行高自然增长；
   长表格里靠 tr:hover 高亮维持可读性，比强行截断更好。 */
.cmp-clamp {
  display: block;
  white-space: pre-line;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.cmp-verify {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
}
.cmp-verify.is-ok { background: var(--success-soft, #e7f6ec); color: var(--success, #0f7b3f); }
.cmp-verify.is-warn { background: var(--warning-soft, #fff4e0); color: var(--warning, #9a6200); }

.cmp-link {
  color: var(--primary);
  text-decoration: none;
  white-space: nowrap;
  font-size: 13px;
}
.cmp-link:hover { text-decoration: underline; }

/* 骨架 */
.cmp-skeleton { display: flex; flex-direction: column; gap: 10px; }
.cmp-sk-row {
  display: grid;
  grid-template-columns: 2fr 3fr 2fr 2.5fr;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.sk-line { height: 12px; border-radius: 4px; background: var(--surface-sunken); }
.w-30 { width: 30%; } .w-40 { width: 40%; } .w-50 { width: 50%; } .w-60 { width: 60%; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 24px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--text-muted);
  text-align: center;
}
.empty-state i { font-size: 30px; opacity: .5; }
.empty-state p { margin: 0; font-size: 15px; color: var(--text); }
.empty-state span { font-size: 13px; max-width: 42ch; line-height: 1.6; }

.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ≤768px：表格降级为卡片（每行一张卡，data-label 当字段名） */
@media (max-width: 768px) {
  .cmp-table-wrap { overflow: visible; border: none; background: transparent; }
  .cmp-table, .cmp-table tbody, .cmp-table tr, .cmp-table td { display: block; width: 100%; }
  .cmp-table thead { display: none; }
  .cmp-table tbody tr {
    margin-bottom: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-raised);
    overflow: hidden;
  }
  .cmp-table td {
    display: flex;
    gap: 10px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
  }
  .cmp-table td:last-child { border-bottom: none; }
  .cmp-table td::before {
    content: attr(data-label);
    flex: 0 0 84px;
    font-size: 12px;
    color: var(--text-muted);
    padding-top: 1px;
  }
  /* 首列（资源名）与末列（操作）不需要字段名前缀，读起来更像卡片标题 */
  .cmp-table td:first-child::before,
  .cmp-table td:last-child::before { content: none; }
  .cmp-table td:first-child { padding-top: 13px; }
  .cmp-table td:last-child { justify-content: flex-end; }
  /* 首列（资源名+域名+标题）不能和额度列挤在一行：
     实测 390px 屏上「码道CodeArts」与「新用户 4000…」会并排互相挤压。
     卡片形态下首列独占整行、内容纵向排列更易读。 */
  .cmp-table td:first-child {
    display: block;
    padding-bottom: 4px;
  }
  .cmp-table td:first-child::before { display: none; }
  /* 末列（操作）必须能完整显示「查看详情」：
     实测在 390px 下被裁成只剩「情」字，因为 flex 容器没有约束右边界。
     改为整行、左对齐、不换行，链接自然靠左完整呈现。 */
  .cmp-table td:last-child {
    justify-content: flex-start;
    padding-top: 4px;
    padding-bottom: 12px;
  }
  .cmp-table td:last-child::before { display: none; }
  .cmp-link { display: inline-block; padding: 4px 0; }
  /* 移动端恢复完整内容：桌面端的 nowrap 会让日期/操作列溢出 */
  .cmp-table td:nth-child(4),
  .cmp-table td:nth-child(5),
  .cmp-table td:nth-child(6) {
    white-space: normal;
    width: auto;
  }
  .cmp-clamp { -webkit-line-clamp: unset; }
  /* 卡片形态下标题应完整显示：桌面端为了对齐表格限了 2 行，
     移动端独占整行后没有宽度压力，截断反而丢信息。 */
  .cmp-deal-title { -webkit-line-clamp: unset; display: block; }
  .cmp-table th { position: static; }
}
</style>