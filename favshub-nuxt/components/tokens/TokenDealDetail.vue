<!--
  TokenDealDetail.vue — 通告详情（列表页弹层 variant="modal" / 伪静态落地页 variant="page"）

  ══ 2026-11-04 信息架构改版（W2 / task-3）══
  本次只做「插入新块 + 调整顺序 + 视觉打磨」，既有区块（接入信息 / 邀请码 / 支持模型 /
  备注 / 我的修改建议 / 待我审核 / 社区健康度 / 游客评测 / 登录评测 / 评测列表 / footer）
  的行为与事件（@close / @edit / @changed、props deal-id / variant / initial / initialReviews）
  全部保持不变。

  ── 依赖的服务端契约（W1 / task-1）与未就绪时的退化路径 ──
  1) 详情 GET /api/token-deals/:id 新增下发：
     summary / limits / limits_html / requirements / requirements_html / verify_scope /
     faq([{q,a}]) / featured。
     → 本组件对以上字段**一律 v-if 兜底**：字段缺失（旧数据或接口未落地）时对应区块不渲染，
       不出现空白框。其中 `faq` 实测已由 W1 的 `parseFaq` 解析成数组
       （`[{q,a}]`）；本组件仍保留「JSON 字符串」形态的兼容分支 —— 原因是
       `server/api/token-deals/[id].get.ts` 用 `...row` 展开原始列，
       任何一处漏调 `parseFaq` 都会让 `faq` 退化成字符串，兼容分支保证那种时候
       FAQ 照样渲染（而不是静默消失）。
  2) 列表 GET /api/token-deals 的新参数 `exclude=<dealId>`（相关推荐排除当前条目）。
     ✅ **该参数已落地**（W1 已合并 `index.get.ts` 的 exclude 分支，实测
        `?exclude=<id>` 返回结果里不含该 id）→ `loadRelated()` 直接依赖它。
        同时仍保留**客户端二次过滤**（`.filter(item => item.id !== <本条目 id>)`）作为纵深防御：
        服务端若因回滚/降级忽略该参数，也不会把当前条目推给自己（代价只是少一格推荐位）。
  3) 收藏依赖 W3 的 `~/composables/useDealFavorites`（已落盘；签名
     `useDealFavorites(): { favorites, isFavorite(id), toggleFavorite(id) }`）。

  ── 两条**数据事实**（别当成 bug）──
  a) `requirements` 可能为空是**正常状态**。对标站导入的 138 条渠道里只有 15 条能切出
     独立的「领取条件」，其余 123 条的条件与使用限制本来就写在同一句里（对方站点自己也是
     合并的：详情页标题叫「限制」，对比表列名是「领取与使用限制」）。因此信息面板对
     「条件类」格子用三态规则（两格 / 一格跨行「限制与领取条件」/ 实名兜底），
     详见 `specCells` 的注释 —— 目的是「不许出现空白格，也不许两格显示同一段文本」。
  b) `verify_scope` 大多数条目为空（138 条里约 134 条），所以「核实情况」区块
     **大部分条目不会渲染** —— 这是预期行为。该区块只在真有核实信息时出现，
     不会留下「只有标题」的半截空壳（见 `verifyBlock`）。
-->
<template>
  <Teleport to="body" :disabled="isPage">
    <div class="tdd-backdrop" :class="{ 'is-page': isPage }" @click.self="onBackdrop">
      <div
        class="tdd-modal"
        :role="isPage ? undefined : 'dialog'"
        :aria-modal="isPage ? undefined : 'true'"
        :aria-label="deal?.title || '通告详情'"
      >
        <!-- 头部 -->
        <header class="tdd-head">
          <div class="tdd-head-main">
            <img
              v-if="icon && !iconFailed"
              :src="icon"
              class="tdd-icon"
              alt=""
              @error="iconFailed = true"
            >
            <span v-else class="tdd-icon tdd-icon-fallback">{{ initial }}</span>
            <div class="tdd-head-copy">
              <h2 class="tdd-provider">
                {{ deal?.provider || '加载中' }}
                <i v-if="deal?.pinned" class="ri-pushpin-2-fill tdd-pin" title="已置顶"></i>
              </h2>
              <p class="tdd-meta">
                <span>{{ regionLabel }}</span>
                <span class="tdd-dot">·</span>
                <span>{{ sourceLabel }}</span>
                <span class="tdd-dot">·</span>
                <span :class="{ 'is-warn': deal?.is_expired }">{{ expiryText }}</span>
              </p>
            </div>
          </div>
          <div class="tdd-head-side">
            <!-- 分类（2026-10-30）：从正文事实区移到 header，改用彩色徽标 -->
            <span
              v-if="deal"
              class="tdd-category"
              :class="`is-${categoryMeta.tone}`"
            >{{ categoryMeta.label }}</span>
            <span v-if="deal" class="tdd-quality" :class="qualityClass">{{ deal.quality }}</span>
            <!-- 是否实名徽标（2026-10-30 九轮）：用户原话「是否实名不要水印了，改为徽章放置到
                 header/div[2]」—— 即 `.tdd-head-side` 这一排（分类 · 品质 · 实名 · 关闭）。
                 放在品质之后、关闭之前：让「分类/品质/实名」三个**信息徽标**聚在一起，
                 关闭按钮留在最右（按钮是操作，不该混进信息组）。
                 视觉语言与 `.tdd-category` 完全一致（12px / 圆角 6px / 600 字重 / 同一套 color-mix 调色板）。
                 徽标内只显示 2~3 字短标签；「其他」的 40 字手填说明走 title + sr-only。
                 `real_name === ''` 不渲染（存量 67 条空串保持静默）。 -->
            <span
              v-if="realNameBadge"
              class="tdd-realname"
              :class="`is-${realNameBadge.tone}`"
              :title="realNameBadge.title"
            >{{ realNameBadge.label }}</span>
            <span v-if="realNameBadge" class="sr-only">{{ realNameBadge.srText }}</span>
            <button type="button" class="tdd-close" :title="isPage ? '返回通告列表' : '关闭'" @click="close">
              <i class="ri-close-line"></i>
            </button>
          </div>
        </header>

        <!-- 加载 / 错误 -->
        <div v-if="loading" class="tdd-state">
          <i class="ri-loader-4-line spin"></i>
          <p>加载中...</p>
        </div>
        <div v-else-if="loadError" class="tdd-state">
          <i class="ri-error-warning-line"></i>
          <p>{{ loadError }}</p>
          <button type="button" class="tdd-btn ghost" @click="loadDeal">重试</button>
        </div>

        <div v-else-if="deal" class="tdd-body">
          <div class="tdd-body-inner">
            <!-- 生命周期提示：已失效 / 已过期 / 已删除（仅作者与管理员能打开这类条目） -->
            <div v-if="deal.is_deleted || deal.is_invalid || deal.is_expired" class="tdd-status is-invalid">
              <i class="ri-forbid-2-line"></i>
              <div>
                <strong>
                  {{ deal.is_deleted ? '已删除' : (deal.is_invalid ? (deal.invalid_reason_label || '已失效') : '已过期') }}
                </strong>
                <p v-if="deal.is_deleted">
                  该通告已从公开列表移除，投票、评测与修改建议均已保留。恢复请联系管理员。
                </p>
                <p v-else-if="deal.is_invalid">
                  该通告已被判定失效，不再对外展示，也不再接收新的投票与评测。
                  <template v-if="deal.is_owner">如为误判，可联系管理员复核。</template>
                </p>
                <p v-else>
                  有效期已结束，该通告不再对外展示。
                  <template v-if="deal.can_edit">编辑并把有效期延后即可重新上架。</template>
                </p>
              </div>
            </div>

            <!-- 审核状态提示 -->
            <div v-if="deal.status !== 'approved'" class="tdd-status" :class="`is-${deal.status}`">
              <i :class="deal.status === 'pending' ? 'ri-time-line' : 'ri-close-circle-line'"></i>
              <div>
                <strong>{{ deal.status === 'pending' ? '待审核' : '未通过审核' }}</strong>
                <p v-if="deal.status === 'pending'">该通告仅你与管理员可见，通过审核后将公开展示。</p>
                <p v-else>{{ deal.reject_reason || '未提供驳回原因' }}</p>
              </div>
            </div>

            <h3 class="tdd-title">{{ deal.title }}</h3>

            <!-- 一句话摘要（2026-11-04 改版）：W1 新增列 summary，旧数据无此列 → 整段不渲染。
                 纯文本插值（{{ }} 由 Vue 转义），运营侧只许写一句话，不含富文本。 -->
            <p v-if="summaryText" class="tdd-summary">{{ summaryText }}</p>

            <!-- ── 结构化信息面板（2026-11-04 改版，核心区块）──
                 对齐对标站「额度 / 限制 / 有效期」的信息密度：读者第一眼就能判断
                 「给多少、要不要满足条件、有什么坑、什么时候结束」。
                 设计要点：
                  1. 格子由 `specCells` 计算（见 script）：**空值格子不入列**，
                     所以旧数据（无 requirements / limits 列）不会留空框；
                     全空时连整块都不渲染（`v-if="specCells.length"`）。
                  2.「领取条件 / 限制」是**三态**的（lead 2026-11-04 决策）：
                     两字段都有且不同 → 两格；否则合并成**一格跨满整行**「限制与领取条件」；
                     都空但有实名标签 → 一格「领取条件」。
                     数据事实：导入的 138 条渠道里只有 15 条能切出独立「领取条件」，
                     `requirements` 为空是**正常状态**（来源本身把条件与限制写在一句里），
                     不是数据缺失；合并态让这一格 100% 有内容，且不会两格显示同一段文本。
                  3. `.tdd-facts` 这个类名**刻意保留**（外层网格容器）：它是既有的
                     「关键信息」区块，样式与「水印半透明（方案 A）」规则都挂在它上面；
                     `.tdd-spec` 只做「统一形态」的补充命名，不另起一套色板。
                  4. 领取条件 / 限制 是**普通用户可写**字段 → 富文本只吃服务端消毒后的
                     `requirements_html` / `limits_html`（与 note_html 同一路 renderRichText）。
                     前端绝不自己 marked 解析原文；无 HTML 时只做**纯文本转义渲染**兜底。
                  5. 是否实名徽标已移至 header（2026-10-30 九轮），不再占本区块位置。 -->
            <div v-if="specCells.length" class="tdd-facts tdd-spec">
              <div
                v-for="cell in specCells"
                :key="cell.key"
                class="tdd-fact"
                :class="[`is-${cell.key}`, { 'is-wide': cell.wide }]"
              >
                <span class="fact-label">
                  <i :class="cell.icon" aria-hidden="true"></i>{{ cell.label }}
                </span>
                <!-- 服务端已消毒的 HTML：用 :deep() 命中（scoped 样式管不到 v-html 节点） -->
                <div v-if="cell.html" class="fact-value tdd-rich" v-html="cell.html"></div>
                <span v-else class="fact-value">{{ cell.text }}</span>
              </div>
            </div>

            <!-- ── 核实范围 + 核验时点（2026-11-04 改版）──
                 情报站与「纯聚合站」的区别就在这段诚实披露：说清这次核实**看了什么、
                 没验证什么**，读者才不会把「官网页面上确实这么写」误读成「我实测能领到」。
                 - `verify_scope`（W1 新增，≤500）：核实范围文案；
                 - `verified_at` / `verify_note` / `verify_stale`：既有字段，迁到这里集中展示；
                 - `verified_by` **任何身份都不读**（服务端已下发空串，见 CLAUDE.md「核验人永不出现在前端」）。
                 四类信息全缺时整块不渲染（旧数据不留空框）。 -->
            <section v-if="verifyBlock" class="tdd-section tdd-verify">
              <h4 class="section-title"><i class="ri-shield-check-line"></i> 核实情况</h4>
              <div class="verify-head">
                <span class="verify-state" :class="verifyBlock.stale ? 'is-pending' : 'is-ok'">
                  <i :class="verifyBlock.stale ? 'ri-time-line' : 'ri-checkbox-circle-line'" aria-hidden="true"></i>
                  {{ verifyBlock.stale ? '待复核' : '已核实' }}
                </span>
                <span v-if="verifyBlock.date" class="verify-date">核实日期 {{ verifyBlock.date }}</span>
                <span v-else class="verify-date">尚无核实记录</span>
              </div>
              <div v-if="verifyBlock.scope" class="verify-scope">
                <span class="verify-scope-label">核实范围</span>
                <p class="verify-scope-text">{{ verifyBlock.scope }}</p>
              </div>
              <p v-if="verifyBlock.stale" class="verify-hint">
                {{ verifyBlock.date
                  ? `距上次核实已 ${verifyBlock.days > 0 ? verifyBlock.days : '多'} 天，条款可能已有调整，领取前请以官方页面为准。`
                  : '站点尚未人工核实过这条通告，信息来自公开渠道整理，领取前请以官方页面为准。' }}
              </p>
              <p v-if="verifyBlock.note" class="verify-note">
                <i class="ri-chat-quote-line" aria-hidden="true"></i> {{ verifyBlock.note }}
              </p>
            </section>

            <!-- 接入信息 -->
            <section class="tdd-section">
              <h4 class="section-title"><i class="ri-link"></i> 接入信息</h4>
              <!-- `v-if` 在**整行**上，不在 `<a>` 上（2026-10-30 四轮）：
                   原先只把 v-if 挂在 `<a>` 上，于是「模板含 {邀请码} 但当前没有可用码」时
                   `<a>` 不渲染、`.tdd-row` 照旧渲染 → 只剩一个孤零零的「领取地址」标签，
                   下面紧跟 API 地址行，读起来像「地址丢了」。整行一起隐藏才是对的。
                   三种隐藏情形都归到 `claimReady` 为空：
                     1. 模板含占位符且没抽到码（码池空 / 全部用满 / 全部停用 / 抽码请求失败）；
                     2. 模板含占位符且抽到了码，但服务端没给 claim_url（防御：宁可不显示也不给坏链接）；
                     3. 原文本身就是空串（无 url 可展示）。
                   占位符是后端程序变量，不能让访客看到；用户也明确要求「没有码就什么都不显示」。 -->
              <div v-if="claimReady" class="tdd-row">
                <span class="row-label">领取地址</span>
                <!-- 位置/样式还原为改动前的原样（`<a :href>` + 原文链接）。
                     唯一的升级：值优先用服务端拼好的成品链接 `claimResolved`（= claim_url），
                     抽中码后显示的就是已替换好邀请码的完整可用地址，而不是带占位符的模板原文。 -->
                <a
                  :href="claimReady"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="row-link"
                >{{ claimReady }}</a>
              </div>
              <div v-if="showApiRow && apiReady" class="tdd-row">
                <span class="row-label">API 地址</span>
                <code class="row-code">{{ apiReady }}</code>
                <button type="button" class="tdd-btn tiny" @click="copy(apiReady)">复制</button>
              </div>
            </section>

            <!-- 邀请码（2026-10-30）：通告可配多个码，服务端按展现比例加权随机只下发一个。
                 2026-10-30 三轮：位置与样式**还原为改动前的原样**（用户要求）。
                 已拼好的成品链接不在这里重复展示 —— 它在「接入信息 → 领取地址」那一行，
                 用户要的是「位置还原 + 链接值升级」，不是多一块面板。 -->
            <section v-if="inviteCode" class="tdd-section">
              <h4 class="section-title"><i class="ri-coupon-3-line"></i> 邀请码</h4>
              <div class="invite-row">
                <code class="invite-code">{{ inviteCode.code }}</code>
                <button type="button" class="tdd-btn tiny" @click="copyInviteCode">
                  <i :class="inviteCopied ? 'ri-check-line' : 'ri-file-copy-line'"></i>
                  {{ inviteCopied ? '已复制' : '复制' }}
                </button>
              </div>
              <p v-if="inviteCode.label" class="invite-label">{{ inviteCode.label }}</p>
            </section>

            <!-- ── 水印层（2026-10-30 五轮）──
                 为什么需要这层额外的覆盖容器：
                 水印尺寸要用「容器高」（cqh）来算，才能同时覆盖**弹窗**（容器高由
                 `max-height:88vh` 决定）和**落地页**（`max-height:none`，容器高 = 内容
                 自然高，与视口完全无关）两种形态。若把 `container-type:size` 直接放在
                 `.tdd-body-inner` 上，size containment 会让它「按无内容计算自身尺寸」，
                 而它的高度恰恰来自内容 —— 落地页下父级高度是 auto，`min-height:100%`
                 解析为 0，整块会塌成 0 高、水印随之消失。
                 所以单独加这一层绝对定位容器：它的高由 `inset:0` 从 `.tdd-body-inner`
                 解析而来（不依赖自己的内容），`container-type:size` 在此完全安全，
                 内层 `cqh` 也因此精确等于「内容区高度」。
                 层本身 `z-index:-1` → 整层压在正文之下；`pointer-events:none` → 不挡交互。 -->
            <!-- ⚠️ 这里**不能**加 aria-hidden：DealBadge 的 sr-only 文本是该组件的兄弟
                 节点（视觉隐藏但读屏可读），若被本层的 aria-hidden 包住会连语义一起丢。
                 装饰性由各水印自身的 aria-hidden 承担，本层只负责定位与容器查询。 -->
            <div class="tdd-seal-layer">
              <!-- 核验状态水印：内容区上部、水平居中 -->
              <DealBadge
                v-if="deal"
                :tone="verifyState.tone"
                :label="verifyState.label"
                :sublabel="verifyState.sublabel"
                :title="verifyState.title"
                :sr-text="verifyState.srText"
              />
            </div>

            <!-- 支持模型 -->
            <section v-if="deal.models && deal.models.length" class="tdd-section">
              <h4 class="section-title"><i class="ri-cpu-line"></i> 支持模型</h4>
              <div class="tdd-models">
                <span v-for="m in deal.models" :key="m" class="model-chip">{{ m }}</span>
              </div>
            </section>

            <!-- 备注 -->
            <section v-if="deal.note_html || deal.note" class="tdd-section">
              <h4 class="section-title"><i class="ri-sticky-note-line"></i> 备注</h4>
              <!-- 2026-10-30：备注升级为富文本（Markdown / HTML / 图片），上限 2000 字。
                   这里渲染的是**服务端已白名单消毒**的 note_html，不是用户原文 ——
                   备注是普通用户可写字段，对原文直接 v-html 等于开 XSS 口子。 -->
              <div v-if="deal.note_html" class="tdd-note markdown-body" v-html="deal.note_html"></div>
              <p v-else class="tdd-note">{{ deal.note }}</p>
            </section>

            <!-- ── 常见问题 FAQ（2026-11-04 改版）──
                 W1 新增列 `faq`，服务端已 parse 成 `[{q,a}]`（≤10 条）。
                 用原生 <details>/<summary> 而不是受控展开：零 JS 状态、SSR 直出、
                 键盘与读屏默认可达（自定义折叠要自己补 role/aria-expanded，容易漏）。
                 q/a 均为纯文本插值（Vue 转义），服务端字段没有对应的 *_html。
                 条数上限 10 由 `faqList` 兜底（服务端校验之外的第二道闸）。
                 旧数据（无该列 / 空数组 / 结构非法）→ 整块不渲染。 -->
            <section v-if="faqList.length" class="tdd-section tdd-faq">
              <h4 class="section-title"><i class="ri-question-answer-line"></i> 常见问题</h4>
              <!-- GEO / SEO（2026-11-04）：`open` 默认展开全部问答。
                   原先是折叠的 —— 折叠内容的正文不在可见文本里，搜索引擎与 AI 抓取
                   拿到的只是问题、拿不到答案，等于白写。展开后答案进入首屏文本，
                   同时仍保留 <details> 语义（读屏可折叠、无 JS 也能用）。
                   若担心长列表占屏，可在 .faq-item 上限制高度并加滚动，但不要收回折叠。 -->
              <details v-for="(item, i) in faqList" :key="`${i}-${item.q}`" class="faq-item" open>
                <summary class="faq-q">{{ item.q }}</summary>
                <p class="faq-a">{{ item.a }}</p>
              </details>
            </section>

            <!-- 我的修改建议状态 -->
            <section v-if="myEdit" class="tdd-section tdd-edit-mine">
              <h4 class="section-title"><i class="ri-lightbulb-line"></i> 我的修改建议</h4>
              <p class="edit-mine-hint">
                已于 {{ formatTime(myEdit.created_at) }} 提交 {{ myEdit.diff.length }} 项修改，等待审核。
              </p>
              <ul class="edit-diff-list">
                <li v-for="c in myEdit.diff" :key="c.field" class="edit-diff-item">
                  <span class="diff-label">{{ c.label }}</span>
                  <span class="diff-from">{{ displayFieldValue(c.field, c.from) }}</span>
                  <i class="ri-arrow-right-line diff-arrow"></i>
                  <span class="diff-to">{{ displayFieldValue(c.field, c.to) }}</span>
                </li>
              </ul>
              <p v-if="myEdit.comment" class="edit-mine-comment">
                <i class="ri-chat-quote-line"></i> {{ myEdit.comment }}
              </p>
              <div class="edit-mine-actions">
                <button type="button" class="tdd-btn ghost tiny" :disabled="editBusy" @click="openProposal">
                  <i class="ri-edit-line"></i> 继续修改
                </button>
                <button type="button" class="tdd-btn danger tiny" :disabled="editBusy" @click="withdrawMyEdit">
                  <i class="ri-close-line"></i> 撤回建议
                </button>
              </div>
            </section>

            <!-- 待我审核的修改建议 -->
            <section v-if="deal.can_review && pendingEdits.length" class="tdd-section tdd-edit-review">
              <h4 class="section-title">
                <i class="ri-inbox-unarchive-line"></i> 待审核的修改建议
                <span class="review-count">{{ pendingEdits.length }}</span>
              </h4>
              <ul class="review-list-edit">
                <li v-for="e in pendingEdits" :key="e.id" class="review-edit-item">
                  <div class="review-edit-head">
                    <span class="review-edit-author">
                      <i class="ri-user-line"></i> {{ e.proposer }}
                    </span>
                    <span class="review-edit-time">{{ formatTime(e.created_at) }}</span>
                  </div>
                  <p v-if="e.comment" class="review-edit-comment">{{ e.comment }}</p>
                  <p v-if="e.is_noop" class="review-edit-noop">
                    该建议与当前内容已无差异，可直接驳回。
                  </p>
                  <ul v-else class="edit-diff-list">
                    <li v-for="c in e.diff" :key="c.field" class="edit-diff-item">
                      <span class="diff-label">{{ c.label }}</span>
                      <span class="diff-from">{{ displayFieldValue(c.field, c.from) }}</span>
                      <i class="ri-arrow-right-line diff-arrow"></i>
                      <span class="diff-to">{{ displayFieldValue(c.field, c.to) }}</span>
                    </li>
                  </ul>
                  <div class="review-edit-actions">
                    <button
                      type="button"
                      class="tdd-btn primary tiny"
                      :disabled="editBusy || e.is_noop"
                      @click="reviewEdit(e, 'approve')"
                    >
                      <i class="ri-check-line"></i> 通过
                    </button>
                    <button
                      type="button"
                      class="tdd-btn danger tiny"
                      :disabled="editBusy"
                      @click="rejectTarget = e"
                    >
                      <i class="ri-close-line"></i> 驳回
                    </button>
                  </div>
                </li>
              </ul>
            </section>

            <!-- 社区健康度 -->
            <section class="tdd-section">
              <h4 class="section-title"><i class="ri-pulse-line"></i> 社区健康度</h4>
              <div class="tdd-health">
                <button
                  type="button"
                  class="vote-btn is-up"
                  :class="{ active: myVote === 'up' }"
                  :disabled="voting"
                  @click="vote('up')"
                >
                  <i class="ri-thumb-up-line"></i>
                  <span class="vote-label">还能用</span>
                  <span class="vote-count">{{ deal.vote_up }}</span>
                </button>
                <button
                  type="button"
                  class="vote-btn is-down"
                  :class="{ active: myVote === 'down' }"
                  :disabled="voting"
                  @click="vote('down')"
                >
                  <i class="ri-thumb-down-line"></i>
                  <span class="vote-label">已失效</span>
                  <span class="vote-count">{{ deal.vote_down }}</span>
                </button>
                <div class="health-rating">
                  <div class="rating-score">
                    <span class="score-num">{{ average ?? '—' }}</span>
                    <span class="score-max">/ 5</span>
                  </div>
                  <div class="rating-stars">
                    <i
                      v-for="n in 5"
                      :key="n"
                      :class="n <= Math.round(average || 0) ? 'ri-star-fill' : 'ri-star-line'"
                    ></i>
                  </div>
                  <span class="rating-count">{{ deal.rating_count }} 人评测</span>
                </div>
              </div>
              <div v-if="deal.rating_count > 0" class="tdd-distribution">
                <div v-for="n in [5, 4, 3, 2, 1]" :key="n" class="dist-row">
                  <span class="dist-label">{{ n }} 星</span>
                  <span class="dist-bar"><span class="dist-fill" :style="{ width: distPercent(n) }"></span></span>
                  <span class="dist-count">{{ distribution[n] || 0 }}</span>
                </div>
              </div>
              <p v-if="!authStore.isLoggedIn" class="tdd-hint">
                无需登录即可参与 —— 投票、写评测、给评测打「有用」标都直接生效
                （评测经审核后公开并计入评分）。
              </p>
            </section>

            <!-- 游客评测：无需登录 -->
            <section v-if="!authStore.isLoggedIn" class="tdd-section">
              <h4 class="section-title">
                <i class="ri-chat-smile-2-line"></i> 游客评测（无需登录）
              </h4>

              <!-- 已有待审评测 → 回显状态 -->
              <div v-if="myGuestReview" class="guest-status">
                <div class="guest-status-head">
                  <span class="guest-badge" :class="myGuestReview.status">
                    {{ myGuestReview.status === 'pending' ? '审核中' : '已驳回' }}
                  </span>
                  <span class="guest-status-nick">{{ myGuestReview.nickname }}</span>
                  <span class="guest-stars">
                    <i
                      v-for="n in 5"
                      :key="n"
                      :class="n <= myGuestReview.rating ? 'ri-star-fill' : 'ri-star-line'"
                    ></i>
                  </span>
                </div>
                <p class="guest-status-content">{{ myGuestReview.content }}</p>
                <p v-if="myGuestReview.status === 'pending'" class="guest-status-tip">
                  评测已提交，等待作者或管理员审核。通过后会公开显示并计入评分。
                </p>
                <p v-else class="guest-status-tip err">
                  未通过审核<template v-if="myGuestReview.reject_reason">：{{ myGuestReview.reject_reason }}</template>。
                  你可以修改后重新提交。
                </p>
                <div class="guest-status-actions">
                  <button
                    v-if="myGuestReview.status === 'pending'"
                    type="button"
                    class="tdd-btn ghost"
                    :disabled="guestSubmitting"
                    @click="withdrawGuestReview"
                  >
                    撤回评测
                  </button>
                  <button
                    v-else
                    type="button"
                    class="tdd-btn ghost"
                    @click="guestFormOpen = true"
                  >
                    重新提交
                  </button>
                </div>
              </div>

              <!-- 未提交 / 被驳回后重填 -->
              <template v-else>
                <button
                  v-if="!guestFormOpen"
                  type="button"
                  class="tdd-btn primary guest-open-btn"
                  @click="openGuestForm"
                >
                  <i class="ri-chat-smile-2-line"></i> 写一条游客评测
                </button>

                <div v-else class="review-form guest-form">
                  <div class="guest-row">
                    <label class="guest-field">
                      <span class="guest-label">昵称 <em>*</em></span>
                      <input
                        v-model="guestNickname"
                        type="text"
                        class="guest-input"
                        :maxlength="24"
                        placeholder="展示用的名字"
                      >
                    </label>
                    <label class="guest-field">
                      <span class="guest-label">QQ 号（可选，用于头像）</span>
                      <input
                        v-model="guestQQ"
                        type="text"
                        class="guest-input"
                        inputmode="numeric"
                        :maxlength="11"
                        placeholder="填了才显示 QQ 头像"
                      >
                    </label>
                  </div>
                  <p class="guest-privacy-tip">
                    <i class="ri-shield-check-line"></i>
                    QQ 号仅用于服务端获取头像，加密存储、不会公开展示，页面源码中也看不到。
                  </p>
                  <div v-if="guestAvatarPreview" class="guest-avatar-preview">
                    <img :src="guestAvatarPreview" alt="头像预览" @error="guestAvatarBroken = true">
                    <span>头像预览</span>
                  </div>

                  <div class="star-input">
                    <button
                      v-for="n in 5"
                      :key="n"
                      type="button"
                      class="star-btn"
                      :class="{ active: n <= guestRating }"
                      :title="`${n} 星`"
                      @click="guestRating = n"
                    >
                      <i :class="n <= guestRating ? 'ri-star-fill' : 'ri-star-line'"></i>
                    </button>
                    <span class="star-text">{{ RATING_TEXTS[guestRating] || '' }}</span>
                  </div>

                  <textarea
                    v-model="guestContent"
                    class="review-input"
                    rows="3"
                    :maxlength="1000"
                    placeholder="说说实际体验：延迟、稳定性、额度是否到账、有没有隐藏门槛..."
                  ></textarea>

                  <!-- 人机校验（fail-closed：挂件失败即拒绝提交，无算术题降级） -->
                  <div class="guest-challenge">
                    <span class="guest-label">人机校验 <em>*</em></span>
                    <TurnstileBox
                      v-if="challengeProvider === 'turnstile'"
                      ref="turnstileRef"
                      :site-key="turnstileSiteKey"
                      @success="onTurnstileSuccess"
                      @expired="onTurnstileExpired"
                      @fail="onTurnstileFail"
                    />
                    <p v-else-if="challengeProvider === 'disabled'" class="challenge-note">{{ challengeDisabledText }}</p>
                    <p v-if="challengeRetryable" class="challenge-note">
                      <button type="button" class="challenge-retry" @click="loadChallenge">重试加载</button>
                    </p>
                    <p v-if="challengeNote" class="challenge-note">{{ challengeNote }}</p>
                    <button v-if="challengeFailed" type="button" class="challenge-retry" @click="retryTurnstile">
                      <i class="ri-refresh-line"></i> 重新加载验证
                    </button>
                  </div>

                  <div class="review-actions">
                    <span class="char-count">{{ guestContent.length }} / 1000</span>
                    <button
                      type="button"
                      class="tdd-btn ghost"
                      @click="guestFormOpen = false"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="tdd-btn primary"
                      :disabled="guestSubmitting || guestSubmitBlocked"
                      @click="submitGuestReview"
                    >
                      {{ guestSubmitting ? '提交中...' : '提交评测' }}
                    </button>
                  </div>
                </div>
              </template>
            </section>

            <!-- 我的评测 -->
            <section v-if="authStore.isLoggedIn" class="tdd-section">
              <h4 class="section-title">
                <i class="ri-chat-3-line"></i> {{ myReview ? '修改我的评测' : '写下我的评测' }}
              </h4>
              <div class="review-form">
                <div class="star-input">
                  <button
                    v-for="n in 5"
                    :key="n"
                    type="button"
                    class="star-btn"
                    :class="{ active: n <= formRating }"
                    :title="`${n} 星`"
                    @click="formRating = n"
                  >
                    <i :class="n <= formRating ? 'ri-star-fill' : 'ri-star-line'"></i>
                  </button>
                  <span class="star-text">{{ ratingText }}</span>
                </div>
                <textarea
                  v-model="formContent"
                  class="review-input"
                  rows="3"
                  :maxlength="1000"
                  placeholder="说说实际体验：延迟、稳定性、额度是否到账、有没有隐藏门槛..."
                ></textarea>
                <div class="review-actions">
                  <span class="char-count">{{ formContent.length }} / 1000</span>
                  <button type="button" class="tdd-btn primary" :disabled="submitting" @click="submitReview">
                    {{ submitting ? '提交中...' : (myReview ? '更新评测' : '提交评测') }}
                  </button>
                </div>
              </div>
            </section>

            <!-- 评测列表 -->
            <section class="tdd-section">
              <h4 class="section-title"><i class="ri-list-check"></i> 社区评测（{{ reviewTotal }}）</h4>
              <div v-if="reviewsLoading" class="tdd-state small">
                <i class="ri-loader-4-line spin"></i>
              </div>
              <p v-else-if="reviews.length === 0" class="tdd-empty">还没有人评测，来写第一条吧。</p>
              <ul v-else class="review-list">
                <li v-for="r in reviews" :key="r.id" class="review-item">
                  <div class="review-head">
                    <span class="review-avatar" :class="{ 'has-img': r.avatar }">
                      <!-- alt="" 而非作者名：紧邻的 `.review-author` 已经把名字念出来了，
                           重复播报等于读两遍。装饰性头像就该空 alt（与卡片 favicon 同口径）。 -->
                      <img
                        v-if="r.avatar && !brokenAvatars.has(String(r.id))"
                        :src="r.avatar"
                        alt=""
                        loading="lazy"
                        @error="markAvatarBroken(r.id)"
                      >
                      <template v-else>{{ initialOf(r.author) }}</template>
                    </span>
                    <span class="review-author">{{ r.author }}</span>
                    <span v-if="r.source === 'guest'" class="review-tag" title="游客评测">游客</span>
                    <span class="review-stars">
                      <i
                        v-for="n in 5"
                        :key="n"
                        :class="n <= r.rating ? 'ri-star-fill' : 'ri-star-line'"
                      ></i>
                    </span>
                    <span class="review-time">{{ formatTime(r.updated_at || r.created_at) }}</span>
                  </div>
                  <p class="review-content">{{ r.content }}</p>
                  <div class="review-foot">
                    <button
                      type="button"
                      class="mark-btn"
                      :class="{ active: r.my_marked }"
                      :disabled="markingIds.has(String(r.id))"
                      :title="r.my_marked ? '取消「有用」标记' : '标记这条评测有用'"
                      @click="toggleMark(r)"
                    >
                      <i :class="r.my_marked ? 'ri-thumb-up-fill' : 'ri-thumb-up-line'"></i>
                      <span class="mark-text">有用</span>
                      <span v-if="r.mark_count" class="mark-count">{{ r.mark_count }}</span>
                    </button>
                    <span v-if="!r.mark_count" class="mark-hint">还没人标过</span>
                  </div>
                </li>
              </ul>
              <button
                v-if="reviewPage < reviewPagination.totalPages"
                type="button"
                class="tdd-btn ghost more-btn"
                :disabled="reviewsLoading"
                @click="loadMoreReviews"
              >
                加载更多评测
              </button>
            </section>

            <!-- ── 相关推荐（2026-11-04 改版）──
                 「薅完这个，接着逛」：同分类再推 6 条，把读完一条的流量留在板块内。
                 数据来自 `loadRelated()`（见 script）：同 category、`limit=8`、
                 带 `exclude=<本条目 id>`；**无论服务端是否已支持 exclude，前端都会再过滤一次**，
                 所以 be 的新参数未就绪时只是少拿几条、不会把当前这条推给自己。
                 加载失败 / 无结果 → 整块不渲染（不留空标题）。 -->
            <section v-if="related.length" class="tdd-section tdd-related">
              <h4 class="section-title"><i class="ri-compass-3-line"></i> 薅完这个，接着逛</h4>
              <div class="related-strip">
                <NuxtLink
                  v-for="item in related"
                  :key="item.id"
                  :to="`/tokens/${item.id}.html`"
                  class="related-card"
                >
                  <span class="related-provider">{{ item.provider }}</span>
                  <span class="related-title">{{ item.title }}</span>
                  <span class="related-desc">{{ item.summary || item.quota || '查看详情' }}</span>
                </NuxtLink>
              </div>
            </section>

            <!-- 底部导航（2026-11-04）：通往各分类落地页。
                 用 NuxtLink（客户端路由）而非 <a>，避免整页刷新。
                 「精选对比」不再作为导航项（对比表已内嵌在 /tokens 页底部）。 -->
            <nav class="tdd-nav" aria-label="白嫖资源分类导航">
              <NuxtLink to="/tokens/api" class="tdd-nav-link">
                <i class="ri-code-s-slash-line" aria-hidden="true"></i> 免费 API / 模型
              </NuxtLink>
              <NuxtLink to="/tokens/server" class="tdd-nav-link">
                <i class="ri-server-line" aria-hidden="true"></i> 免费服务器 / VPS
              </NuxtLink>
              <NuxtLink to="/tokens/domain" class="tdd-nav-link">
                <i class="ri-global-line" aria-hidden="true"></i> 免费域名
              </NuxtLink>
              <!-- 2026-11-04 补：客户端额度此前漏在这一处（与首页分类卡同一个疏漏），
                   导致 4 条 client 通告在详情页底部也没有入口。 -->
              <NuxtLink to="/tokens/client" class="tdd-nav-link">
                <i class="ri-apps-2-line" aria-hidden="true"></i> 客户端额度
              </NuxtLink>
              <!-- 精选对比（2026-11-04）：此处不再列出。对比表已内嵌在 /tokens 页底部，
                   以分类导航形式再挂一个入口层级重复；/tokens/compare 路由仍保留，
                   老链接与搜索收录不受影响。 -->
            </nav>

            </div>
        </div>

        <!-- 底部操作 -->
        <footer v-if="deal" class="tdd-foot">
          <div class="tdd-foot-left">
            <button type="button" class="tdd-btn primary" :disabled="importing" @click="importDeal">
              <i class="ri-bookmark-line"></i>
              {{ importing ? '导入中...' : '导入我的书签' }}
            </button>
            <!-- 抽中码后用服务端拼好的成品链接；未抽中且原文含程序占位符时降级为不可点（避免打开坏页面） -->
            <a
              v-if="!goBlocked"
              :href="claimResolved || deal.url"
              target="_blank"
              rel="noopener noreferrer"
              class="tdd-btn ghost"
            >
              <i class="ri-external-link-line"></i> 前往领取
            </a>
            <span
              v-else
              class="tdd-btn ghost is-disabled"
              title="该平台需邀请码，抽取后自动生成领取地址"
            >
              <i class="ri-external-link-line"></i> 前往领取
            </span>
            <button
              v-if="deal.status === 'approved'"
              type="button"
              class="tdd-btn ghost"
              title="分享：生成信息卡 / 复制链接"
              @click="shareOpen = true"
            >
              <i class="ri-share-line"></i> 分享
            </button>
            <!-- ── 收藏 / 已收藏（2026-11-04 改版）──
                 状态来自 W3 的 `composables/useDealFavorites.ts`（localStorage 单例 ref）。
                 该 composable 的 SSR 约定：服务端与 hydration 首帧 favorites 恒为 []，
                 `isFavorite()` 返回 false，客户端 onMounted 后自动翻成真实状态 ——
                 因此**首屏渲染「收藏」不是 bug**，也不会 hydration mismatch（两边首帧一致）。
                 这里不自己维护本地 state，跨组件（卡片/筛选）天然同步。 -->
            <button
              type="button"
              class="tdd-btn ghost"
              :class="{ 'is-fav': favActive }"
              :aria-pressed="favActive"
              :title="favActive ? '取消收藏（仅存本地）' : '收藏到本地，方便下次查找'"
              @click="toggleFav"
            >
              <i :class="favActive ? 'ri-heart-fill' : 'ri-heart-line'"></i>
              {{ favActive ? '已收藏' : '收藏' }}
            </button>
          </div>
          <div class="tdd-foot-right">
            <!-- 非作者也能改：走建议通道，由作者或管理员审核 -->
            <button
              v-if="deal.status === 'approved' && !deal.can_edit && !myEdit"
              type="button"
              class="tdd-btn ghost"
              title="发现信息有误？提交修改建议"
              @click="openProposal"
            >
              <i class="ri-lightbulb-line"></i> 建议修改
            </button>
            <button v-if="deal.can_edit" type="button" class="tdd-btn ghost" @click="$emit('edit', deal)">
              <i class="ri-edit-line"></i> 编辑
            </button>
            <button v-if="deal.can_edit" type="button" class="tdd-btn danger" :disabled="deleting" @click="removeDeal">
              <i class="ri-delete-bin-line"></i> {{ deleting ? '删除中...' : '删除' }}
            </button>
          </div>
        </footer>

        <!-- 建议修改面板 -->
        <TokenDealEditor
          v-if="proposalOpen && deal"
          :deal="deal"
          proposal
          @close="proposalOpen = false"
          @saved="onProposalSaved"
        />

        <!-- 驳回修改建议弹窗 -->
        <Teleport to="body">
          <div v-if="rejectTarget" class="tdd-reject-backdrop" @click.self="rejectTarget = null">
            <div class="tdd-reject-modal">
              <h3 class="reject-title">驳回修改建议</h3>
              <p class="reject-sub">
                来自「{{ rejectTarget.proposer }}」的 {{ rejectTarget.diff.length }} 项修改将不予采纳。
              </p>
              <textarea
                v-model="rejectReason"
                rows="3"
                maxlength="200"
                placeholder="说明驳回理由，便于对方改进（选填）"
              ></textarea>
              <span class="reject-hint">{{ rejectReason.length }} / 200</span>
              <div class="reject-actions">
                <button type="button" class="tdd-btn ghost" @click="rejectTarget = null">取消</button>
                <button
                  type="button"
                  class="tdd-btn danger"
                  :disabled="editBusy"
                  @click="confirmReject"
                >
                  <i class="ri-close-line"></i> 确认驳回
                </button>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- 分享面板 -->
        <TokenShareSheet v-if="shareOpen && deal" :deal="deal" @close="shareOpen = false" />

        <!-- 轻提示 -->
        <Transition name="toast">
          <div v-if="message" class="tdd-toast" :class="messageType">{{ message }}</div>
        </Transition>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { REGION_LABELS as DEAL_REGION_LABELS, SOURCE_LABELS as DEAL_SOURCE_LABELS } from '~/utils/deal-fields'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { copyText } from '~/utils/clipboard'
import { dealCategoryMeta } from '~/utils/deal-categories'
import { fallbackProxyIcon } from '~/utils/favicon'
import TokenShareSheet from '~/components/tokens/TokenShareSheet.vue'
import TokenDealEditor from '~/components/tokens/TokenDealEditor.vue'
import DealBadge from '~/components/tokens/DealBadge.vue'
// 收藏（2026-11-04 改版）：状态托管在 W3 的 composable 单例里，本组件不自持一份 state。
// 显式导入而非依赖自动导入 —— 该文件由 task-4 提供，显式路径能让「模块缺失」在 build 期
// 直接定位到这一行，而不是在模板里报一个含糊的 auto-import 错误。
import { useDealFavorites } from '~/composables/useDealFavorites'

interface ITokenDeal {
  id: string
  provider: string
  title: string
  url: string
  call_url?: string
  quota?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  category?: string
  expires_at?: number | null
  pinned?: number
  note?: string
  /** 2026-10-30：服务端渲染并消毒后的备注 HTML（前端直接 v-html，勿自行渲染 note） */
  note_html?: string
  // ── 2026-11-04 改版新增（W1 / task-1 契约）──
  /** 一句话摘要（≤200），标题下方 TL;DR；旧数据为默认空串 → 不渲染 */
  summary?: string
  /** 限制条款**原文**（≤2000）—— 普通用户可写，前端**只读不渲染**（渲染走 limits_html） */
  limits?: string
  /** 服务端 renderRichText() 渲染并消毒后的限制 HTML（与 note_html 同一路） */
  limits_html?: string
  /** 领取条件**原文**（≤2000）—— 同上，只读不渲染 */
  requirements?: string
  /** 服务端渲染并消毒后的领取条件 HTML */
  requirements_html?: string
  /** 核实范围说明（≤500）：本次核实看了什么、没验证什么（旧数据为空串 → 不渲染） */
  verify_scope?: string
  /**
   * FAQ（≤10 条）。契约是服务端已 parse 好的 `[{q,a}]`；
   * 类型里保留 `string` 是兼容 W1 的 parseFaq 落地前详情端点 `...row` 展开出的原始 JSON 串
   * （见 normalizeFaq() 的防御性解析）。
   */
  faq?: Array<{ q: string; a: string }> | string
  /** 1 = 进「精选对比」（W3 的 /tokens/compare 用；本组件只透传不展示） */
  featured?: number
  /** 2026-10-30：是否还有可用邀请码（码池不下发，码本身走 /invite-code 单独抽） */
  has_invite_code?: boolean
  /**
   * 是否实名（2026-10-30，契约见 T2）：''（未填）| 'no' | 'id_card' | 'face' | 'other'
   * 注意：存量数据迁移后是**空串**，空串一律不渲染徽标。
   */
  real_name?: string
  /** 「其他」的手填文案（服务端仅在 real_name==='other' 时保留，上限 40 字） */
  real_name_other?: string
  /**
   * 领取地址里的 {邀请码} 占位符（2026-10-30）：
   * 详情只回答「这条要不要先抽码」，**永远不下发码、也不下发 claim_url**；
   * 替换后的成品地址只出现在 GET /:id/invite-code「已抽中」的那次响应里。
   */
  claim_url_source?: 'call_url' | 'url'
  claim_url_has_placeholder?: boolean
  status?: string
  reject_reason?: string
  /** 公开接口不再下发 username（避免泄露账号名），这里保留可选仅作历史兼容 */
  nickname?: string
  is_expired?: boolean
  is_invalid?: boolean
  is_deleted?: boolean
  invalid_reason_label?: string
  // 人工核验时间轴（2026-10-20）
  verified_at?: number
  /** 2026-10-30 前端脱敏：公开接口一律下发空串（核验人不下发到前端），保留字段仅为类型兼容 */
  verified_by?: string
  verify_note?: string
  verify_age_days?: number
  verify_stale?: boolean
  is_owner?: boolean
  can_edit?: boolean
  can_moderate?: boolean
  vote_up?: number
  vote_down?: number
  rating_sum?: number
  rating_count?: number
  nexus?: {
    enabled: boolean
    eval_ok: number
    eval_total: number
    eval_avg_ms: number
  } | null
}

/** 一条核验记录 */
interface IVerification {
  action: string
  action_label: string
  note: string
  actor: string
  created_at: number
}

/** 单条字段差异 */
interface IFieldDiff {
  field: string
  label: string
  from: any
  to: any
}

/** 修改建议 */
interface IDealEdit {
  id: string
  deal_id: string
  user_id: number
  proposer: string
  comment: string
  status: string
  reject_reason?: string
  payload: Record<string, any>
  diff: IFieldDiff[]
  is_noop: boolean
  created_at: number
  updated_at: number
}

/** 详情端点附带的建议摘要 */
interface IEditsSummary {
  can_review: boolean
  pending_edit_count: number
  my_edit: IDealEdit | null
  is_author: boolean
}

interface IReview {
  id: string | number
  rating: number
  content: string
  created_at: number
  updated_at: number | null
  author: string
  /** 头像 URL（/avatar/<加密令牌>.jpg）；未填 QQ 号时为 null → 回退首字母色块 */
  avatar?: string | null
  /** user = 登录用户评测；guest = 游客评测（已通过审核） */
  source?: 'user' | 'guest'
  /** 被多少人标了「有用」（社区健康度第三维） */
  mark_count?: number
  /** 当前访客是否已标过 —— 决定按钮高亮态 */
  my_marked?: boolean
}

/** 当前访客自己的待审游客评测（按 IP+UA 指纹识别，未登录也能回显） */
interface IGuestReview {
  id: string
  nickname: string
  rating: number
  content: string
  status: string
  reject_reason?: string
  avatar?: string | null
}

/** 详情载荷：SSR 预取（伪静态落地页）与客户端 $fetch（列表页弹窗）共用同一形状 */
interface IDealDetailPayload {
  deal: ITokenDeal
  verifications: IVerification[]
  edits: IEditsSummary | null
  guest_review: IGuestReview | null
  my_vote: string | null
  my_review: { rating: number; content: string } | null
}

/** 评测第一页载荷（落地页 SSR 预取，避免「社区评测」区块首屏空白） */
interface IReviewsPayload {
  reviews: IReview[]
  distribution: Record<number, number>
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

const props = defineProps<{
  dealId: string
  /**
   * modal（默认）：列表页弹窗形态 —— 固定定位遮罩、锁 body 滚动、Esc 关闭。
   * page：伪静态详情页形态 —— 内容就地流式排布随页面滚动，
   *       「关闭」= 返回 /tokens 列表（地址栏不残留查询参数）。
   */
  variant?: 'modal' | 'page'
  /**
   * SSR 已预取的详情载荷：有值时首帧（服务端渲染的 HTML）就带正文，
   * 不再客户端 $fetch —— 这正是伪静态页面对爬虫有意义的前提。
   */
  initial?: IDealDetailPayload | null
  /** SSR 已预取的第一页评测 */
  initialReviews?: IReviewsPayload | null
}>()
const emit = defineEmits<{
  close: []
  edit: [deal: ITokenDeal]
  changed: []
}>()
const authStore = useAuthStore()

/** 落地页形态：不使用遮罩定位与滚动锁定，「关闭」改为返回列表 */
const isPage = computed(() => props.variant === 'page')

// 地区 / 来源标签来自真源（`utils/deal-fields.ts`）
const REGION_LABELS = DEAL_REGION_LABELS
const SOURCE_LABELS = DEAL_SOURCE_LABELS
const RATING_TEXTS: Record<number, string> = {
  1: '很差',
  2: '较差',
  3: '一般',
  4: '不错',
  5: '很好',
}

const deal = ref<ITokenDeal | null>(props.initial?.deal ?? null)
const loading = ref(!props.initial)
const loadError = ref('')

const myVote = ref<string | null>(null)
const myReview = ref<{ rating: number; content: string } | null>(null)
const voting = ref(false)
const deleting = ref(false)
const importing = ref(false)
const submitting = ref(false)
const shareOpen = ref(false)

// ── 邀请码（2026-10-30）──
// 码池**不会**随详情下发，这里拿到的永远是服务端按展现比例加权随机抽中的**那一个**
// `t` 是抽中凭证：复制上报时必须带上，否则服务端无法确认「确实刚发过这个码」
// `claim_url` 是「已替换好 {邀请码} 的成品领取地址」（未抽中 / 模板无占位符时为空串），
// `claim_url_source` 说明这个模板取自 call_url 还是 url —— 前端只呈现，绝不自己替换。
const inviteCode = ref<{
  id: number
  code: string
  label: string
  t: string
  claim_url: string
  claim_url_source: 'call_url' | 'url' | ''
} | null>(null)
const inviteCopied = ref(false)

// ── 修改建议 ──
const myEdit = ref<IDealEdit | null>(null)
const pendingEdits = ref<IDealEdit[]>([])
const proposalOpen = ref(false)
const editBusy = ref(false)
const rejectTarget = ref<IDealEdit | null>(null)
const rejectReason = ref('')

const formRating = ref(5)
const formContent = ref('')

// ── 游客评测（无需登录）──
const myGuestReview = ref<IGuestReview | null>(null)
const guestFormOpen = ref(false)
const guestNickname = ref('')
const guestQQ = ref('')
const guestRating = ref(5)
const guestContent = ref('')
const guestSubmitting = ref(false)
// 人机校验方式：loading（配置未返回，先不挂载挂件，避免空 site key 触发误报）
// / turnstile（Cloudflare 挂件）/ disabled（未启用，游客通道关闭）
const challengeProvider = ref<'loading' | 'turnstile' | 'disabled'>('loading')
const turnstileSiteKey = ref('')
const turnstileToken = ref('')
const challengeNote = ref('')
const challengeFailed = ref(false)
const challengeDisabledText = ref('')
/** 仅「挑战配置获取失败」为真：给一个「重试加载」按钮（通道未启用时无从重试） */
const challengeRetryable = ref(false)
const turnstileRef = ref<any>(null)

/** 游客通道被挡（未启用 / 挂件失败 / 还没通过验证）时禁用提交按钮 */
const guestSubmitBlocked = computed(() =>
  challengeProvider.value !== 'turnstile' || challengeFailed.value || !turnstileToken.value,
)
/** 头像预览：本地拼 QQ 头像直链仅用于即时预览，提交后走服务端代理（QQ 号不外露） */
const guestAvatarBroken = ref(false)
const guestAvatarPreview = computed(() => {
  const qq = guestQQ.value.trim()
  if (!/^[1-9]\d{4,10}$/.test(qq) || guestAvatarBroken.value) return null
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=100`
})

/** 头像加载失败的评测 id 集合 → 回退首字母色块（QQ 头像接口对无效号会返回默认图，但网络失败仍需兜底） */
const brokenAvatars = ref<Set<string>>(new Set())
function markAvatarBroken(id: string | number) {
  brokenAvatars.value.add(String(id))
}
function initialOf(name: string) {
  return (name || '?')[0].toUpperCase()
}

const reviews = ref<IReview[]>([])
/** 正在提交打标的评测 id 集合 —— 防连点重复请求，并给按钮禁用态 */
const markingIds = ref<Set<string>>(new Set())
const distribution = ref<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
const reviewPage = ref(1)
const reviewsLoading = ref(false)
const reviewTotal = ref(0)
const reviewPagination = ref({ page: 1, limit: 20, total: 0, totalPages: 1 })

const iconFailed = ref(false)
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')
let messageTimer: ReturnType<typeof setTimeout> | null = null

const icon = computed(() => (deal.value ? fallbackProxyIcon('', deal.value.url) || '' : ''))
const initial = computed(() => (deal.value?.provider || '?').trim().charAt(0).toUpperCase())
const regionLabel = computed(() => REGION_LABELS[deal.value?.region || 'cn'] || '国内直连')
const sourceLabel = computed(() => SOURCE_LABELS[deal.value?.source_tag || 'official'] || '官方直营')
const isCloud = computed(() => deal.value?.category === 'cloud')

/**
 * 分类徽标（2026-10-30）：分类从正文事实区移到 header，并按分类给不同颜色。
 * 三种取值都要有徽标（默认的 token 也要）—— 否则正文那条「分类」被移走后，
 * 大多数通告的分类信息就整个消失了。配色全部走站点既有变量（tokens.css）。
 */
// 分类徽标（标签 + 色调）直接取真源，不再手抄一份：
// 原先这里是一份独立副本，domain 加进来时就得手动补一档（注释还在），
// 而每多一个副本就多一次漏改的机会。色调取自站点既有变量，不引入新色板。
const categoryMeta = computed(() => dealCategoryMeta(deal.value?.category))

const qualityClass = computed(() => {
  const map: Record<string, string> = {
    上上品: 'q-top',
    上品: 'q-high',
    中品: 'q-mid',
    下品: 'q-low',
    下下品: 'q-bottom',
  }
  return map[deal.value?.quality || '中品'] || 'q-mid'
})

const average = computed(() => {
  const d = deal.value
  if (!d || !d.rating_count) return null
  return Number(((d.rating_sum || 0) / d.rating_count).toFixed(1))
})

/**
 * 核验状态大徽标（2026-10-30）
 *
 * 原来这里是「最近核验 N 天前」文字事实行 + 正文里的「人工核验」时间线区块，现已全部删除，
 * 改为详情正文中部一个圆形大徽标（见模板）。判定口径与列表卡片一致：
 *   - 从未核验（verify_age_days < 0）或超过新鲜度阈值（verify_stale）→ 待核验（黄）
 *   - 其余 → 已核验（绿）
 * 徽标内保留一行小字说明新鲜度（「N 天前」），否则「最近核验」的信息就彻底没了。
 */
const verifyState = computed(() => {
  const d = deal.value
  const days = Number(d?.verify_age_days ?? -1)
  const never = !d || !Number.isFinite(days) || days < 0
  const pending = never || !!d?.verify_stale
  const fresh = never
    ? '从未核验'
    : (days <= 0 ? '今日核验' : `${days} 天前核验`)
  // 核验备注（verify_note）原来是「人工核验」区块里的一段正文，该区块按需求整块删除了；
  // 这里把它挪进徽标的 title，内容不丢，但不再占正文版面（移动端无 hover，故只作兜底）。
  const note = String(d?.verify_note || '').trim()
  const base = pending
    ? `站点尚未确认该通告当前可用（${fresh}）`
    : `站点已人工确认该通告当前可用（${fresh}）`
  return {
    tone: pending ? 'pending' : 'ok',
    label: pending ? '待核验' : '已核验',
    sublabel: fresh,
    title: note ? `${base}：${note}` : base,
    // 读屏文本：水印层是装饰（aria-hidden），真实状态靠这段文字传达，
    // 否则视觉降级会连带把「是否已核验」这个有意义的状态从无障碍树里抹掉。
    srText: `核验状态：${pending ? '待核验' : '已核验'}（${fresh}）`,
  }
})

// ── 是否实名徽标（2026-10-30）────────────────────────────────
// 契约（T2）：real_name ∈ '' | 'no' | 'id_card' | 'face' | 'other'；'' = 未填 → **不渲染徽标**
// （存量数据迁移后全是空串，无条件渲染会一次性冒出几十个空徽标）。
// real_name_other 仅在 other 时有意义（服务端在其它取值时强制清空），上限 40 字。
const REAL_NAME_META: Record<string, { label: string; tone: string }> = {
  no: { label: '无需实名', tone: 'ok' },
  id_card: { label: '需身份证', tone: 'blue' },
  face: { label: '需人脸', tone: 'purple' },
  other: { label: '需实名', tone: 'pending' },
}
/**
 * 是否实名（2026-10-30 三轮）：从底部方形水印改为 `.tdd-facts` 里的**小号彩色徽标**
 * （用户要求「需实名应放置在红框这个位置」——红框在「免费额度」那行右侧）。
 *
 * 小徽标只能放 2~3 个字，所以「其他」的手填 40 字说明这样承载：
 *   - `title`：鼠标悬停看到全文；
 *   - `srText`：读屏完整读取（视觉简、语义全）；
 *   - 徽标本体只显示「需实名」。
 * `real_name === ''` 时返回 null → 不渲染（存量 80 条空串，必须保持静默）。
 */
const realNameBadge = computed(() => {
  const key = String(deal.value?.real_name || '')
  const meta = REAL_NAME_META[key]
  if (!meta) return null
  const other = key === 'other' ? String(deal.value?.real_name_other || '').trim() : ''
  return {
    tone: meta.tone,
    label: meta.label,
    title: other ? `${meta.label}：${other}` : meta.label,
    srText: other ? `是否实名：${meta.label}（${other}）` : `是否实名：${meta.label}`,
  }
})

// ════════════════════════════════════════════════════════════════════════════
// ── 结构化信息面板 / 核实范围 / FAQ / 相关推荐（2026-11-04 改版）────────────
// ════════════════════════════════════════════════════════════════════════════

/** FAQ 条数上限（与 W1 的 LIMITS.faq 一致）—— 服务端已校验，这里是第二道闸 */
const FAQ_LIMIT = 10
/** 相关推荐的展示条数 */
const RELATED_LIMIT = 6

/** 一句话摘要（W1 新增 summary）；空串 → 模板整段不渲染 */
const summaryText = computed(() => String(deal.value?.summary || '').trim())

/**
 * 「领取条件」的兜底文案（`requirements` 与 `limits` 都为空时才用得上）。
 *
 * 对 API / 云资源来说「要不要实名」本身就是最关键的领取条件，比留空更有信息量。
 * `real_name === ''`（存量数据的默认值）返回空串 → 该格不入列（不留空框）。
 */
const realNameRequirementText = computed(() => {
  switch (String(deal.value?.real_name || '')) {
    case 'no': return '无需实名'
    case 'id_card': return '需实名认证（身份证）'
    case 'face': return '需实名认证（人脸识别）'
    case 'other': {
      const other = String(deal.value?.real_name_other || '').trim()
      return other ? `需实名认证（${other}）` : '需实名认证'
    }
    default: return ''
  }
})

/**
 * 富文本单元格取值（「领取条件」与「限制」共用）。
 *
 * ⚠️ 安全约束（CLAUDE.md「富文本备注与 HTML 消毒」）：
 *   `requirements` / `limits` 都是**普通用户可写**字段，消毒点必须在服务端唯一入口
 *   （`server/utils/rich-text.ts` 的 `renderRichText()`）。
 *   所以这里**只**把服务端下发的 `*_html` 交给 `v-html`；
 *   原文**绝不**做 marked 解析（那等于前端自己开一个 XSS 口子，且每个消费方都得记得消毒一次）。
 *   仅在 `*_html` 缺失时以**纯文本插值**兜底 —— `{{ }}` 由 Vue 转义，不存在注入面。
 *   该兜底只覆盖 W1 落地前的短暂窗口（落地后恒走 HTML 分支），也覆盖脚本直连 DB 导入的行。
 */
function richCell(html?: string, raw?: string): { html?: string; text?: string } | null {
  const safeHtml = String(html || '').trim()
  if (safeHtml) return { html: safeHtml }
  const plain = String(raw || '').trim()
  return plain ? { text: plain } : null
}

/**
 * 有效期文案：由 `expires_at` 推导。
 * 绝对日期一律走 `formatTime()`（固定 Asia/Shanghai），否则 SSR 与客户端可能算出不同日期。
 * 无 `expires_at` → 「长期有效（未标注截止）」，与 header 的 `expiryText` 口径一致。
 */
const validityText = computed(() => {
  const ts = Number(deal.value?.expires_at || 0)
  if (!ts) return '长期有效（未标注截止）'
  const date = formatTime(ts)
  const diff = ts - Date.now()
  if (diff <= 0) return `已于 ${date} 过期`
  const days = Math.ceil(diff / 86400000)
  if (days <= 1) return `${date} 截止 · 今天到期`
  return `${date} 截止 · 剩 ${days} 天`
})

/**
 * 四格结构化面板的数据源：额度 / 领取条件 / 限制 / 有效期。
 *
 * **空值格子不入列** —— 这就是「旧数据不留空框」的实现方式：不是渲染一个空占位，
 * 而是根本不产生这一格。四格全空时数组为空 → 模板整块 `v-if` 掉。
 * 「有效期」恒有值（无 expires_at 时是「长期有效…」），所以正常情况下至少出一格。
 *
 * ── 「条件类」格子的三态规则（2026-11-04 lead 决策，**改设计不改数据**）──
 * 数据事实：对标站导入的 138 条渠道里只有 15 条能切出**独立**的「领取条件」，
 * 其余 123 条的领取条件与使用限制本来就揉在同一句里（对方站点自己也是合并的 ——
 * 详情页标题叫「限制」，对比表列名是「领取与使用限制」）。
 * 所以 `requirements` 为空是**正常状态**，不是数据缺失，更不是 bug；硬拆只会得到
 * 「一个空格子 + 一段重复文本」。规则：
 *
 *   1. `requirements` 非空 **且** 与 `limits` 不同 → 两格：「领取条件」+「限制」；
 *   2. 否则 `limits` 非空 → **一格占满整行**，标题「限制与领取条件」（`.is-wide`
 *      跨列，避免出现半行空白）；这一条让 138 条渠道的该格信息 100% 有内容；
 *   3. 否则 `real_name` 有值 → 一格「领取条件」，用既有中文标签拼一句
 *      （`no` → 「无需实名」/ `id_card` → 「需实名认证（身份证）」…）；
 *   4. 都不满足 → 不产生这一格。
 *
 * 两种「合并成一句」的情形（`requirements === limits`，或 `requirements` 为空）
 * 都收敛到规则 2，因此**不会出现两格显示同一段文本**，也不会出现空白格。
 */
const specCells = computed(() => {
  const d = deal.value
  const cells: Array<{
    key: string
    icon: string
    label: string
    html?: string
    text?: string
    /** 跨满整行（合并态的「限制与领取条件」用） */
    wide?: boolean
  }> = []
  if (!d) return cells

  const quota = String(d.quota || '').trim()
  if (quota) cells.push({ key: 'quota', icon: 'ri-coin-line', label: '免费额度', text: quota })

  // ── 条件类格子（三态，见上方注释）──
  const reqRaw = String(d.requirements || '').trim()
  const limRaw = String(d.limits || '').trim()
  const reqCell = richCell(d.requirements_html, d.requirements)
  const limCell = richCell(d.limits_html, d.limits)
  if (reqRaw && reqRaw !== limRaw && reqCell) {
    cells.push({ key: 'requirements', icon: 'ri-user-follow-line', label: '领取条件', ...reqCell })
    if (limCell) cells.push({ key: 'limits', icon: 'ri-forbid-2-line', label: '限制', ...limCell })
  } else if (limCell) {
    cells.push({
      key: 'limits',
      icon: 'ri-forbid-2-line',
      label: '限制与领取条件',
      ...limCell,
      wide: true,
    })
  } else if (realNameRequirementText.value) {
    cells.push({
      key: 'requirements',
      icon: 'ri-user-follow-line',
      label: '领取条件',
      text: realNameRequirementText.value,
    })
  }

  cells.push({ key: 'validity', icon: 'ri-calendar-check-line', label: '有效期', text: validityText.value })
  return cells
})

/**
 * 核实情况（核实范围 + 核验时点）。
 *
 * 触发条件：**有实质核实信息**（`verify_scope` / `verified_at` / `verify_note` 任一非空）。
 * 全缺 → null → 整块不渲染 —— 存量「从未补充过新字段、也从未人工核验」的旧数据因此
 * 与改版前完全一致，不会多出一块只有「尚无核实记录」的空壳。
 * 注：`verify_stale`（待复核）**刻意不作为触发条件** —— 它是「已有核验但过期了」的提示，
 * 没有核验日期/范围时它没有任何可承载的内容；「从未核验」这个状态本来就由水印徽标传达
 * （见 `verifyState`），不需要第二块地方重复说一遍。
 *
 * ⚠️ 刻意**不读** `verified_by`：CLAUDE.md 规定核验人任何身份都不下发，
 *    前端也不得渲染。即使服务端将来漏了脱敏，这里也没有渲染路径（纵深防御）。
 */
const verifyBlock = computed(() => {
  const d = deal.value
  if (!d) return null
  const scope = String(d.verify_scope || '').trim()
  const note = String(d.verify_note || '').trim()
  const ts = Number(d.verified_at || 0)
  if (!scope && !note && !ts) return null
  const days = Number(d.verify_age_days ?? -1)
  return {
    scope,
    note,
    stale: !!d.verify_stale,
    days: Number.isFinite(days) ? days : -1,
    date: ts > 0 ? formatTime(ts) : '',
  }
})

/**
 * FAQ 归一化：只接受 `[{q,a}]`，逐条要求 q / a 都非空，硬截断到 `FAQ_LIMIT` 条。
 *
 * 兼容「JSON 字符串」的原因见文件头：详情端点用 `...row` 展开全列，
 * 在 W1 的 `parseFaq()` 落地前 `faq` 会是数据库里的原始串。
 * 这里做一次防御性 JSON.parse 只为让新旧两种响应都能渲染；解析失败一律降级成 `[]`
 * （不抛错、不留空块）。q / a 均按**纯文本**插值渲染，不存在注入面。
 */
function normalizeFaq(raw: unknown): Array<{ q: string; a: string }> {
  let value: unknown = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return value
    .map((item: any) => ({ q: String(item?.q ?? '').trim(), a: String(item?.a ?? '').trim() }))
    .filter(item => item.q && item.a)
    .slice(0, FAQ_LIMIT)
}
const faqList = computed(() => normalizeFaq(deal.value?.faq))

/** 相关推荐卡片的最小形状（列表接口下发全量行，这里只取展示需要的几个字段） */
interface IRelatedDeal {
  id: string
  provider: string
  title: string
  quota: string
  summary: string
}

const related = ref<IRelatedDeal[]>([])
const relatedLoading = ref(false)
/** 已成功加载过的 deal id —— 弹窗反复开关时不重复请求 */
const relatedLoadedFor = ref('')

/**
 * 拉「同分类的相关推荐」。
 *
 * 请求带 W1 新增的 `exclude=<本条目 id>`。**该参数未落地时服务端会忽略它**，
 * 所以拿到结果后**再按 id 过滤一次** —— 正常路径与退化路径都保证「不推荐自己」。
 * limit 取 `RELATED_LIMIT + 2` 正是给这层过滤留余量。
 * 任何异常都静默降级为空列表：推荐位不值得打扰读者，也绝不能因此让详情页报错。
 */
async function loadRelated() {
  const id = String(deal.value?.id || '')
  if (!id || relatedLoading.value || relatedLoadedFor.value === id) return
  relatedLoading.value = true
  try {
    const res = await $fetch<{ deals?: any[] }>('/api/token-deals', {
      params: {
        category: deal.value?.category || 'token',
        limit: RELATED_LIMIT + 2,
        exclude: id,
      },
      credentials: 'include',
    })
    const list = Array.isArray(res?.deals) ? res.deals : []
    related.value = list
      // 客户端二次过滤 = be 的 exclude 参数未就绪时的退化路径（也是纵深防御）
      .filter((item: any) => String(item?.id || '') && String(item.id) !== id)
      .slice(0, RELATED_LIMIT)
      .map((item: any) => ({
        id: String(item.id),
        provider: String(item.provider || '未注明'),
        title: String(item.title || ''),
        quota: String(item.quota || '').trim(),
        summary: String(item.summary || '').trim(),
      }))
    relatedLoadedFor.value = id
  } catch {
    related.value = []
  } finally {
    relatedLoading.value = false
  }
}

// ── 收藏（2026-11-04 改版）──────────────────────────────────────────────
// 状态完全托管在 W3 的 composable 单例里（模块级 ref + localStorage），
// 本组件不另持一份 state —— 否则卡片/筛选/详情三处会各自漂移。
const { isFavorite, toggleFavorite } = useDealFavorites()
const favActive = computed(() => isFavorite(String(deal.value?.id || '')))

function toggleFav() {
  const id = String(deal.value?.id || '')
  if (!id) return
  toggleFavorite(id)
  // 提示语按 toggle 之后的真实状态给：favorites 是 ref，计算属性在同一 tick 内就已更新。
  toast(favActive.value ? '已收藏，可在列表页「只看收藏」里找到' : '已取消收藏')
}

// ── 领取地址的 {邀请码} 占位符（2026-10-30）──────────────────
/**
 * 与 server/utils/invite-codes.ts 的 CLAIM_PLACEHOLDER_PATTERN 同形：
 * `{邀请码}` / `{code}` / `{invite_code}`，半角与全角花括号都认。
 *
 * ⚠️ 这里**只用于「要不要把它渲染成可点链接」的显示判定，绝不做替换**。
 * 替换只发生在服务端、只在「确实抽中该码」的那次响应里（那是唯一会让码进入响应的地方）。
 * 这层判定是兜底：详情接口的 `claim_url_has_placeholder` 只看 claim 模板（call_url 优先），
 * 万一占位符写在了另一个字段上，这层能保证前端不会把带 `{邀请码}` 的原文做成链接给用户点。
 */
const CLAIM_PLACEHOLDER_RE = /[｛{](?:邀请码|code|invite_code)[｝}]/

/** claim 模板取自哪个字段（详情接口给，缺省按 url） */
const claimSource = computed<'call_url' | 'url'>(
  () => (deal.value?.claim_url_source === 'call_url' ? 'call_url' : 'url'),
)
/** claim 模板原文（source 指向的那个字段；call_url 为空时服务端口径会回落到 url） */
const claimRaw = computed(() => {
  const d = deal.value
  if (!d) return ''
  const callUrl = String(d.call_url || '').trim()
  if (claimSource.value === 'call_url' && callUrl) return callUrl
  return String(d.url || '').trim()
})
/** 模板里是否还有未替换的占位符（服务端标记 + 本地兜底判定，任一为真即视为「要先抽码」） */
const claimHasPlaceholder = computed(() =>
  !!deal.value?.claim_url_has_placeholder || CLAIM_PLACEHOLDER_RE.test(claimRaw.value),
)
/** 服务端替换好的成品链接；没有占位符时不用它（那时它等于原文，展示原文即可） */
const claimResolved = computed(() =>
  claimHasPlaceholder.value ? String(inviteCode.value?.claim_url || '') : '',
)

/**
 * 「领取地址」那一行要显示的**成品链接**（2026-10-30 三轮：位置还原 + 值升级）。
 *
 * 优先级：
 *   1. 已抽中 → 服务端拼好的 `claim_url`（完整可用，已做 URL 编码）；
 *   2. 模板无占位符 → 原文（`url`），与改动前的展示一致；
 *   3. 模板有占位符但还没抽中 → 空串 → 整行不渲染。
 *      占位符是后端程序变量，不能让访客看到；用户也明确要求「没有码就什么都不显示」。
 */
const claimReady = computed(() => {
  if (claimResolved.value) return claimResolved.value
  if (claimHasPlaceholder.value) return ''
  return String(deal.value?.url || '').trim()
})
/**
 * 「API 地址」那一行是否要渲染（2026-10-30 四轮修正）。
 *
 * ⚠️ 判据是「**领取地址那一行实际显示的值**是否已经就是 call_url」，
 * 而不是「服务端说 claim 模板取自 call_url」—— 后者是本轮修掉的 bug：
 *
 * `claimUrlTemplateOf()` 在**没有占位符**时也会把 `claim_url_source` 指成 `'call_url'`
 * （它的选序是「call_url 有占位符 → url 有占位符 → call_url 非空则用 call_url」，
 * 第三步与占位符无关）。于是任何「填了 call_url、但没写占位符」的通告，
 * 旧的 `claimSource !== 'call_url'` 判据都会命中「已重复，不必再显示」分支 ——
 * 可「领取地址」那行此时显示的是 `url`（`claimReady` 无占位符时回退到 `deal.url`），
 * `call_url` 根本没出现在页面上 → **两个地址都不完整**（实测生产 39/46 条受影响）。
 *
 * 改成比对**成品值**后，各情形都自洽：
 *   - call_url 含占位符且已抽中 → claimReady 就是替换后的 call_url → 相等 → 不重复；
 *   - call_url 含占位符但没抽中   → claimReady 为 ''（apiReady 也为 ''）→ 最终不渲染；
 *   - call_url 无占位符           → claimReady 是 url（或 ''）→ 不等 → 正常显示 API 行；
 *   - url 与 call_url 完全相同    → 相等 → 不重复（与旧行为一致）。
 */
const showApiRow = computed(() => {
  const callUrl = String(deal.value?.call_url || '').trim()
  if (!callUrl) return false
  return claimReady.value !== callUrl
})
/**
 * 「API 地址」那一行要显示的值。
 * 占位符也可能写在 `call_url` 上（服务端 claim_url_source 会指过来）：
 * 此时若还按原文显示 `call_url`，就会把 `{邀请码}` 字面泄给访客 —— 所以同上三级降级。
 */
const apiReady = computed(() => {
  const callUrl = String(deal.value?.call_url || '').trim()
  if (!callUrl) return ''
  if (claimSource.value !== 'call_url') return callUrl
  if (claimResolved.value) return claimResolved.value
  return claimHasPlaceholder.value ? '' : callUrl
})
/** 底部「前往领取」是否会被坏链接带偏（模板含未替换占位符且还没抽到码） */
const goBlocked = computed(() => claimHasPlaceholder.value && !claimResolved.value)

const expiryText = computed(() => {
  const ts = deal.value?.expires_at
  if (!ts) return '永久有效'
  const diff = ts - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.ceil(diff / 86400000)
  if (days <= 1) return '今天到期'
  if (days <= 30) return `${days} 天后到期`
  // 远期过期时间用固定时区的绝对日期（与 formatTime 同口径，避免 SSR/客户端不一致）
  return formatTime(ts)
})

const ratingText = computed(() => RATING_TEXTS[formRating.value] || '')

function distPercent(n: number) {
  const total = deal.value?.rating_count || 0
  if (!total) return '0%'
  return `${Math.round(((distribution.value[n] || 0) / total) * 100)}%`
}

/**
 * 绝对日期统一按站点固定时区格式化为 `YYYY-MM-DD`。
 *
 * 为什么必须固定时区：详情页现在是**服务端渲染**的，如果沿用 `new Date(ts).getFullYear()`
 * 这类本地时区分支，服务端（服务器时区）与浏览器（用户时区）可能算出**不同的日期**，
 * 于是 hydration 时文本对不上（dev 构建会报 Hydration text content mismatch，
 * 生产构建则静默改成客户端结果，出现一次可见的文本跳变）。
 * 站点面向中文用户（hao.bx9y.com.cn），固定成 Asia/Shanghai 对绝大多数访客显示不变，
 * 且服务端/客户端结果恒定一致。
 */
const SITE_TIME_ZONE = 'Asia/Shanghai'
const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SITE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

function formatTime(ts: number) {
  if (!ts) return ''
  const parts = DATE_FMT.formatToParts(new Date(ts))
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** diff 展示用：把枚举值与时间戳渲染成人话 */
function displayFieldValue(field: string, value: any): string {
  if (value === null || value === undefined || value === '') return '（空）'
  if (field === 'models') return Array.isArray(value) && value.length ? value.join('、') : '（空）'
  if (field === 'region') return REGION_LABELS[value] || String(value)
  if (field === 'source_tag') return SOURCE_LABELS[value] || String(value)
  if (field === 'expires_at') {
    const ts = Number(value)
    if (!Number.isFinite(ts)) return String(value)
    // 固定时区（formatTime 同口径）：diff 表会进入 SSR 输出，不能依赖服务器/浏览器本地时区
    return formatTime(ts)
  }
  return String(value)
}

function toast(text: string, type: 'ok' | 'err' = 'ok') {
  message.value = text
  messageType.value = type
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.value = '' }, 2600)
}

function close() {
  if (isPage.value) {
    // 落地页形态：「关闭」= 回列表页（干净地址，不残留 ?deal= 之类查询参数）
    navigateTo('/tokens')
    return
  }
  emit('close')
}

function onBackdrop() {
  // 落地页形态没有遮罩，点空白处不应把用户弹走
  if (isPage.value) return
  close()
}

/** 把详情载荷写入各响应式状态（SSR 预取与客户端拉取共用同一份逻辑） */
function applyDealPayload(data: IDealDetailPayload) {
  deal.value = data.deal
  // 2026-10-30：载荷里的 verifications 不再渲染（核验时间线整块已删除，改为状态大徽标），
  // 接口仍按原样返回该字段，这里只是不再读写它。
  myVote.value = data.my_vote
  myReview.value = data.my_review
  myEdit.value = data.edits?.my_edit ?? null
  myGuestReview.value = data.guest_review ?? null
  // 回填游客表单：被驳回后重填时预填上次内容，减少重复输入
  if (data.guest_review && data.guest_review.status === 'rejected') {
    guestNickname.value = data.guest_review.nickname || ''
    guestRating.value = data.guest_review.rating || 5
    guestContent.value = data.guest_review.content || ''
  }
  if (data.my_review) {
    formRating.value = data.my_review.rating
    formContent.value = data.my_review.content
  }
}

/** 审核人需要提案明细 → 单独拉一次列表（详情端点只给摘要） */
async function syncPendingEdits(data: IDealDetailPayload) {
  if (data.edits?.can_review && data.edits.pending_edit_count > 0) {
    await loadPendingEdits()
  } else {
    pendingEdits.value = []
  }
}

async function loadDeal() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await $fetch<IDealDetailPayload>(
      `/api/token-deals/${props.dealId}`,
      { credentials: 'include' },
    )
    applyDealPayload(data)
    // 邀请码与详情并行拉取，不阻塞弹层渲染
    void loadInviteCode()
    await syncPendingEdits(data)
  } catch (err: any) {
    loadError.value = err?.data?.error || '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 拉取本通告的待审提案（仅作者/管理员有权限，其他人拿到的是空/自己的） */
async function loadPendingEdits() {
  try {
    const res = await $fetch<{ edits: IDealEdit[]; can_review: boolean }>(
      `/api/token-deals/${props.dealId}/edits`,
      { query: { status: 'pending' }, credentials: 'include' },
    )
    pendingEdits.value = res.can_review ? res.edits : []
  } catch {
    pendingEdits.value = []
  }
}

// ── 游客评测 ──────────────────────────────────────────────────

/** 打开游客评测表单：每次打开都重新拉一次人机校验方式（令牌是一次性的） */
function openGuestForm() {
  guestFormOpen.value = true
  guestAvatarBroken.value = false
  loadChallenge()
}

/**
 * 获取人机校验方式（fail-closed）。
 * Turnstile 已配置 → 渲染挂件；未配置/已关闭 → 游客通道关闭，直接提示不可提交。
 */
async function loadChallenge() {
  turnstileToken.value = ''
  challengeFailed.value = false
  challengeNote.value = ''
  challengeRetryable.value = false
  try {
    const res = await $fetch<any>(
      `/api/token-deals/${props.dealId}/guest-review-challenge`,
      { credentials: 'include' },
    )
    if (res?.provider === 'turnstile') {
      challengeProvider.value = 'turnstile'
      turnstileSiteKey.value = String(res.site_key || '')
    } else {
      challengeProvider.value = 'disabled'
      challengeDisabledText.value = res?.message || '人机校验未启用，暂不接受游客提交'
    }
  } catch (err: any) {
    challengeProvider.value = 'disabled'
    challengeDisabledText.value = '人机校验配置获取失败，请刷新页面重试'
    challengeRetryable.value = true
    toast(err?.data?.error || '人机校验配置获取失败', 'err')
  }
}

function onTurnstileSuccess(token: string) {
  turnstileToken.value = token
  challengeNote.value = ''
  challengeFailed.value = false
}

function onTurnstileExpired() {
  turnstileToken.value = ''
  challengeNote.value = '人机验证已过期，请重新点击验证'
}

/**
 * 挂件加载/渲染/校验失败：**不降级**，挡住提交并给出重试入口。
 * 110200 = 该域名不在挂件允许列表里（需在 Cloudflare 后台给挂件加域名）
 */
function onTurnstileFail(reason: string) {
  turnstileToken.value = ''
  challengeFailed.value = true
  challengeNote.value = reason.includes('110200')
    ? '人机验证未对当前域名开放，暂时无法提交（需站长在 Cloudflare 后台授权本站域名）'
    : `${reason || '人机验证组件加载失败'}，暂时无法提交，请检查网络后重试`
}

/** 重新加载挂件（脚本加载失败时已移除坏标签，可重试） */
function retryTurnstile() {
  challengeFailed.value = false
  challengeNote.value = ''
  turnstileToken.value = ''
  turnstileRef.value?.retry?.()
}

function resetTurnstile() {
  turnstileToken.value = ''
  turnstileRef.value?.reset?.()
}

async function submitGuestReview() {
  if (guestSubmitting.value) return
  const nickname = guestNickname.value.trim()
  if (!nickname) {
    toast('请填写昵称', 'err')
    return
  }
  if (!guestContent.value.trim()) {
    toast('请填写评测内容', 'err')
    return
  }
  if (challengeProvider.value === 'disabled') {
    toast(challengeDisabledText.value || '人机校验未启用，暂不接受游客提交', 'err')
    return
  }
  if (challengeFailed.value) {
    toast('人机验证未就绪，请点击「重新加载验证」', 'err')
    return
  }
  if (!turnstileToken.value) {
    toast('请先完成人机验证', 'err')
    return
  }
  const qq = guestQQ.value.trim()
  if (qq && !/^[1-9]\d{4,10}$/.test(qq)) {
    toast('QQ 号格式不正确（5-11 位数字）', 'err')
    return
  }

  guestSubmitting.value = true
  try {
    const res = await $fetch<{ review: IGuestReview; message?: string }>(
      `/api/token-deals/${props.dealId}/guest-reviews`,
      {
        method: 'POST',
        credentials: 'include',
        body: {
          nickname,
          qq,
          rating: guestRating.value,
          content: guestContent.value.trim(),
          turnstile_token: turnstileToken.value,
        },
      },
    )
    myGuestReview.value = res.review
    guestFormOpen.value = false
    guestContent.value = ''
    toast(res.message || '评测已提交，等待审核')
    // 若该访客此前已有通过的评测，本次是覆盖提交 → 列表内容会变
    await loadReviews(true)
  } catch (err: any) {
    const errMsg = String(err?.data?.error || '')
    toast(err?.data?.error || '提交失败', 'err')
    // 令牌一次性：失败也必须换新，否则用户点重试必然又报过期
    resetTurnstile()
    if (errMsg.includes('人机验证')) challengeNote.value = errMsg
  } finally {
    guestSubmitting.value = false
  }
}

async function withdrawGuestReview() {
  if (!myGuestReview.value || guestSubmitting.value) return
  guestSubmitting.value = true
  try {
    await $fetch(`/api/token-deals/${props.dealId}/guest-reviews/${myGuestReview.value.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    myGuestReview.value = null
    toast('已撤回评测')
  } catch (err: any) {
    toast(err?.data?.error || '撤回失败', 'err')
  } finally {
    guestSubmitting.value = false
  }
}

/** 打开建议修改面板：未登录先提示 */
function openProposal() {
  if (!authStore.isLoggedIn) {
    toast('请先登录后再提交修改建议', 'err')
    return
  }
  proposalOpen.value = true
}

function onProposalSaved(text: string) {
  proposalOpen.value = false
  toast(text || '修改建议已提交，等待审核')
  loadDeal()
  emit('changed')
}

/** 撤回自己提交的建议 */
async function withdrawMyEdit() {
  if (!myEdit.value || editBusy.value) return
  editBusy.value = true
  try {
    await $fetch(`/api/token-deal-edits/${myEdit.value.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    myEdit.value = null
    toast('已撤回修改建议')
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '撤回失败', 'err')
  } finally {
    editBusy.value = false
  }
}

/** 审核提案：通过 */
async function reviewEdit(target: IDealEdit, action: 'approve' | 'reject', reason = '') {
  if (editBusy.value) return
  editBusy.value = true
  try {
    const res = await $fetch<{ message?: string; deal_status?: string }>(
      `/api/token-deal-edits/${target.id}/review`,
      { method: 'POST', body: { action, reason }, credentials: 'include' },
    )
    toast(res?.message || (action === 'approve' ? '已通过' : '已驳回'))
    await loadDeal()
    await loadReviews(true)
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '操作失败', 'err')
  } finally {
    editBusy.value = false
  }
}

async function confirmReject() {
  if (!rejectTarget.value) return
  const target = rejectTarget.value
  const reason = rejectReason.value.trim()
  rejectTarget.value = null
  rejectReason.value = ''
  await reviewEdit(target, 'reject', reason)
}

async function loadReviews(reset = false) {
  if (reviewsLoading.value) return
  reviewsLoading.value = true
  try {
    const targetPage = reset ? 1 : reviewPage.value
    const data = await $fetch<IReviewsPayload>(`/api/token-deals/${props.dealId}/reviews`, {
      query: { page: targetPage, limit: 20 },
      credentials: 'include',
    })
    reviews.value = reset ? data.reviews : [...reviews.value, ...data.reviews]
    distribution.value = { ...distribution.value, ...data.distribution }
    reviewPagination.value = data.pagination
    reviewTotal.value = data.pagination.total
    reviewPage.value = targetPage
  } catch {
    /* 评测列表加载失败不阻断主流程 */
  } finally {
    reviewsLoading.value = false
  }
}

function loadMoreReviews() {
  reviewPage.value += 1
  loadReviews(false)
}

/** SSR 预取的第一页评测：落库方式与 loadReviews(true) 保持一致（页码恒为第 1 页） */
function applyInitialReviews(data: IReviewsPayload) {
  reviews.value = data.reviews
  distribution.value = { ...distribution.value, ...data.distribution }
  reviewPagination.value = data.pagination
  reviewTotal.value = data.pagination.total
  reviewPage.value = 1
}

/**
 * 给评测打「有用」标 —— 无需登录，点一次标上、再点一次取消。
 *
 * 服务端返回权威计数后就地更新该条，**不重拉整个列表**（避免分页位置丢失）。
 * 失败时回滚乐观更新，保持界面与服务端一致。
 */
async function toggleMark(review: IReview) {
  const key = String(review.id)
  if (markingIds.value.has(key)) return
  markingIds.value.add(key)

  const prevMarked = !!review.my_marked
  const prevCount = review.mark_count || 0

  // 乐观更新：先给出即时反馈，失败再回滚
  review.my_marked = !prevMarked
  review.mark_count = Math.max(0, prevCount + (prevMarked ? -1 : 1))

  try {
    const data = await $fetch<{ marked: boolean; mark_count: number }>(
      `/api/token-deals/${props.dealId}/review-marks`,
      {
        method: 'POST',
        body: { review_id: key },
        credentials: 'include',
      },
    )
    // 以服务端结果为准（同 IP 超限时服务端会返回 marked:false 且计数不变）
    review.my_marked = data.marked
    review.mark_count = data.mark_count
    if (!data.marked && !prevMarked && data.mark_count === prevCount) {
      toast('该网络下标记数已达上限', 'err')
    }
  } catch (err: any) {
    review.my_marked = prevMarked
    review.mark_count = prevCount
    toast(err?.data?.error || err?.message || '操作失败，请稍后再试', 'err')
  } finally {
    markingIds.value.delete(key)
  }
}

async function vote(direction: 'up' | 'down') {
  if (!deal.value || voting.value) return
  voting.value = true
  try {
    const res = await $fetch<{ my_vote: string | null; vote_up: number; vote_down: number }>(
      `/api/token-deals/${props.dealId}/vote`,
      { method: 'POST', body: { vote: direction }, credentials: 'include' },
    )
    myVote.value = res.my_vote
    deal.value.vote_up = res.vote_up
    deal.value.vote_down = res.vote_down
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '投票失败', 'err')
  } finally {
    voting.value = false
  }
}

async function submitReview() {
  if (!formContent.value.trim()) {
    toast('请填写评测内容', 'err')
    return
  }
  submitting.value = true
  try {
    const res = await $fetch<{ rating_sum: number; rating_count: number; average: number | null }>(
      `/api/token-deals/${props.dealId}/reviews`,
      {
        method: 'POST',
        body: { rating: formRating.value, content: formContent.value.trim() },
        credentials: 'include',
      },
    )
    if (deal.value) {
      deal.value.rating_sum = res.rating_sum
      deal.value.rating_count = res.rating_count
    }
    myReview.value = { rating: formRating.value, content: formContent.value.trim() }
    toast('评测已提交')
    await loadReviews(true)
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '提交失败', 'err')
  } finally {
    submitting.value = false
  }
}

async function importDeal() {
  if (!authStore.isLoggedIn) {
    toast('请先登录后再导入', 'err')
    return
  }
  importing.value = true
  try {
    const res = await $fetch<{ skipped: boolean; message: string }>(
      `/api/token-deals/${props.dealId}/import`,
      { method: 'POST', credentials: 'include' },
    )
    toast(res.message || '已导入')
  } catch (err: any) {
    toast(err?.data?.error || '导入失败', 'err')
  } finally {
    importing.value = false
  }
}

async function removeDeal() {
  if (!import.meta.client) return
  if (!confirm(`确定删除通告「${deal.value?.title}」？该操作不可撤销。`)) return
  deleting.value = true
  try {
    await $fetch(`/api/token-deals/${props.dealId}`, { method: 'DELETE', credentials: 'include' })
    emit('changed')
    close()
  } catch (err: any) {
    toast(err?.data?.error || '删除失败', 'err')
  } finally {
    deleting.value = false
  }
}

/**
 * 抽一个邀请码（2026-10-30）
 *
 * 通告可配多个码，各自带「展现比例」与「被复制次数」阈值；**抽选在服务端完成**，
 * 前端只拿到被选中的那一个 —— 所以「按比例只显示一个」不是前端障眼法。
 * 拿不到 / 全部用满时静默隐藏区块，不影响详情阅读。
 */
async function loadInviteCode() {
  inviteCode.value = null
  inviteCopied.value = false
  // 有码要抽，或领取地址里写了 {邀请码} 占位符（抽码后才会有替换好的成品地址）时才请求
  if (!deal.value?.has_invite_code && !deal.value?.claim_url_has_placeholder) return
  try {
    const res = await $fetch<{
      data: {
        id: number | null
        code: string | null
        label: string
        t: string
        claim_url?: string
        claim_url_source?: 'call_url' | 'url'
      }
    }>(
      `/api/token-deals/${props.dealId}/invite-code`,
      { credentials: 'include' },
    )
    const d = res?.data
    inviteCode.value = d?.code
      ? {
          id: Number(d.id),
          code: String(d.code),
          label: String(d.label || ''),
          t: String(d.t || ''),
          // 未抽中 / 模板无占位符时服务端给空串 —— 前端据此回退到原文展示
          claim_url: String(d.claim_url || ''),
          claim_url_source: d.claim_url_source === 'call_url' ? 'call_url' : 'url',
        }
      : null
  } catch {
    inviteCode.value = null
  }
}

/** 复制邀请码，并上报一次「被复制」—— 达到阈值后该码不再出现给任何人 */
async function copyInviteCode() {
  const current = inviteCode.value
  if (!current || !import.meta.client) return
  try {
    // 共用工具：http 下 navigator.clipboard 不存在
    if (!(await copyText(current.code))) throw new Error('copy failed')
  } catch {
    toast('复制失败，请手动选择', 'err')
    return
  }
  toast('已复制邀请码')
  if (inviteCopied.value) return
  inviteCopied.value = true
  try {
    await $fetch(`/api/token-deals/${props.dealId}/invite-code/${current.id}/copy`, {
      method: 'POST',
      // 带上抽中凭证：服务端据此确认该码确实刚发给过本次访问者
      body: { t: current.t },
      credentials: 'include',
    })
  } catch {
    // 计数失败不影响用户已经完成的复制动作，静默忽略
  }
}

async function copy(text?: string) {
  if (!text || !import.meta.client) return
  // 共用工具：http 下 navigator.clipboard 不存在，原写法必然失败
  if (await copyText(text)) toast('已复制到剪贴板')
  else toast('复制失败，请手动选择', 'err')
}


function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

let prevOverflow = ''

// SSR 预取载荷：在 setup 阶段同步应用一次，保证服务端渲染出的首帧 HTML 就带详情正文
// （爬虫据此拿到内容；客户端 hydration 时复用同一份数据，两边渲染结果一致）
if (props.initial) applyDealPayload(props.initial)
if (props.initialReviews) applyInitialReviews(props.initialReviews)

// 落地页 refresh()（编辑保存/投票后重取）会下发新的载荷 → 就地更新
watch(() => props.initial, (v) => { if (v) applyDealPayload(v) })
watch(() => props.initialReviews, (v) => { if (v) applyInitialReviews(v) })

// 相关推荐（2026-11-04）：详情可能是**异步到达**的（弹窗形态先 fetch 再渲染），
// 所以除了 onMounted 里主动拉一次，deal.id 一到也补拉一次。
// 只在客户端触发：SSR 里发起的请求不会被 await，拿不到首屏 HTML 收益，反而多一次服务端查询。
// `relatedLoadedFor` 保证同一个 deal 只成功加载一次（弹窗反复开关不重复请求）。
watch(() => deal.value?.id, () => {
  if (import.meta.client) void loadRelated()
})

onMounted(() => {
  // 滚动锁定与 Esc 关闭只属于弹窗形态；落地页形态让页面正常滚动
  if (!isPage.value) {
    prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeydown)
  }

  if (props.initial) {
    // SSR 已给正文：客户端只补「按需/不可预取」的部分 ——
    // 邀请码（每次展现随机抽一个，带一次性凭证）与审核人的提案明细
    void loadInviteCode()
    void syncPendingEdits(props.initial)
  } else {
    loadDeal()
  }
  if (!props.initialReviews) loadReviews(true)
  // 相关推荐（2026-11-04）：落地页形态的 deal 在 setup 阶段就已由 initial 填入，
  // 此时 watch(deal.id) 不会触发（值没有「变化」）→ 这里主动拉一次。
  // `relatedLoadedFor` / `relatedLoading` 保证与 watcher 的触发不会并发重复请求。
  void loadRelated()
})

onUnmounted(() => {
  if (!isPage.value) {
    document.body.style.overflow = prevOverflow
    document.removeEventListener('keydown', onKeydown)
  }
  if (messageTimer) clearTimeout(messageTimer)
})
</script>

<style scoped>
.tdd-backdrop {
  position: fixed;
  inset: 0;
  /* 必须高于移动端底部导航（.mobile-bottom-nav = 9998）：
     移动端本弹窗是贴底 sheet，层级低于底栏时底部按钮会被底栏压住，
     且底栏会浮在遮罩之上仍可点击。同层另见 ShareSheet 10070 / Editor 10060。 */
  z-index: 10050;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
  animation: modal-fade 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tdd-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 680px;
  max-height: 88vh;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: modal-in 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* ── 落地页形态（伪静态 /tokens/<id>.html）──
   同一个组件两用：列表页当弹窗（遮罩 + 锁滚动），详情页当正文。
   这里只把「弹窗」的外壳约束去掉，内部结构、交互与弹窗形态完全一致。 */
.tdd-backdrop.is-page {
  position: static;
  inset: auto;
  z-index: auto;
  display: block;
  padding: 0;
  background: none;
  backdrop-filter: none;
  animation: none;
}
.tdd-backdrop.is-page .tdd-modal {
  max-width: 780px;
  margin: 20px auto;
  max-height: none;
  animation: none;
}
/* 弹窗里主体是独立滚动区（max-height + overflow-y）；落地页交给页面本身滚动 */
.tdd-backdrop.is-page .tdd-body {
  overflow: visible;
}

/* ── 头部 ── */
.tdd-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 0.5px solid var(--divider);
}
.tdd-head-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.tdd-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  object-fit: contain;
  flex-shrink: 0;
  background: var(--surface-sunken);
}
.tdd-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-secondary);
}
.tdd-head-copy { min-width: 0; }
.tdd-provider {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tdd-pin {
  font-size: 12px;
  color: var(--primary);
  margin-left: 2px;
}
.tdd-meta {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tdd-meta .is-warn { color: var(--warning); }
.tdd-dot { margin: 0 5px; }
.tdd-head-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.tdd-quality {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}
.q-top, .q-high { background: var(--primary-light); color: var(--primary); }
.q-mid { background: var(--surface-sunken); color: var(--text-secondary); }
.q-low, .q-bottom { background: color-mix(in srgb, var(--warning) 12%, transparent); color: var(--warning); }
.tdd-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-tertiary);
  font-size: 17px;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tdd-close:hover { background: var(--surface-hover); color: var(--text-primary); }
.tdd-close:active { background: var(--surface-active); }
.tdd-close:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* ── 主体 ── */
.tdd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
/* ── 水印徽标的定位基准（2026-10-30 改版）──
   为什么需要这一层 `.tdd-body-inner`：
   `.tdd-body` 在弹窗形态下是**滚动容器**（`overflow-y:auto`）。若徽标以 `.tdd-body`
   为基准做 `top:50%`，它锚定的是**首屏（可见区）中部**而不是「详情内容中部」，
   而且会随内容一起滚出视野 —— 那既不是用户要的「页面中部」，也不是「背景图」。
   所以新增一层与内容等高的内层容器，让水印跟随**内容**（而不是视口）定位：
     - `position: relative`：作为水印的定位基准（相对内容高度）；
     - `isolation: isolate`：**自建层叠上下文**。没有它，`z-index:-1` 的水印会跑到更外层
       祖先（.tdd-modal / .tdd-backdrop）的背景后面而整层看不见；
       有了它，水印落在正文内容之下、正文仍正常显示（这是「不影响正式内容」的机制保证）；
     - `min-height: 100%`：内容不足一屏时也让水印有完整的定位空间。 */
.tdd-body-inner {
  position: relative;
  isolation: isolate;
  min-height: 100%;
}
/* ── 水印层（2026-10-30 五轮）：容器查询的锚点 ──
   为什么不把 `container-type: size` 直接放在 `.tdd-body-inner` 上：
   size containment 会让元素「按没有子内容来计算自身尺寸」，而 inner 的高度**恰恰
   来自内容**。落地页形态下 `.tdd-modal { max-height: none }`、`.tdd-body` 的高度
   是内容驱动的 auto，此时 `min-height: 100%` 无法解析（父高 auto）会退化成 0，
   整块塌陷、水印消失。弹窗形态因为有确定高度才「碰巧」没事 —— 这种只在一种形态下
   成立的写法不能留。
   改成本层：`position:absolute; inset:0` → 高度由包含块解析，**不依赖自身内容**，
   因此 `container-type:size` 在这里完全安全；层高恒等于内容区高度，
   内部 `cqh` 也就精确等于「内容区高度的 1%」。弹窗与落地页两种形态同时成立。
   层自身 `z-index:-1` 让整层压在正文之下（原来的层叠关系不变），
   `pointer-events:none` 保证不挡任何交互。 */
.tdd-seal-layer {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  container-type: size;
  /* 层内水印自身不再需要负 z-index（层已经整体在下面），保持 0 以免在层内再沉一层 */
}
/* 水印必须压在内容之下：给内容区块一个非负层叠位置。
   （正常流元素本来在负 z-index 之上，这层显式声明让意图可读，
   并防御后续有人给区块加 position 却没定义 z-index 时水印意外盖上去。） */
.tdd-body-inner > .tdd-section,
.tdd-body-inner > .tdd-facts,
.tdd-body-inner > .tdd-title,
.tdd-body-inner > .tdd-summary,
.tdd-body-inner > .tdd-nav,
.tdd-body-inner > .tdd-status {
  position: relative;
  z-index: 0;
}
.tdd-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 56px 20px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.tdd-state.small { padding: 16px; }
.tdd-state i { font-size: 22px; }
.tdd-state p { margin: 0; }
.spin { animation: modal-spin 1s linear infinite; }

.tdd-status {
  display: flex;
  gap: 8px;
  padding: 12px;
  margin-bottom: 16px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.55;
}
.tdd-status i { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.tdd-status strong { display: block; margin-bottom: 2px; font-size: 13px; }
.tdd-status p { margin: 0; }
.tdd-status.is-pending { background: color-mix(in srgb, var(--warning) 10%, transparent); color: var(--warning); }
.tdd-status.is-rejected { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
.tdd-status.is-invalid { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }

.tdd-title {
  margin: 0 0 16px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text-primary);
}

/* ── 方案 A：内容色块半透明，让水印完整透出（2026-10-30 六轮）──
   问题（用户原话「额度、邀请码之类的背景色把水印遮挡了」）：
   水印层是 `z-index:-1`，任何**不透明背景**的内容块都会盖住它，
   于是水印被切成一堆碎片，只在色块缝隙里露出来。
   浏览器实测（生产样本，容器高 708）命中 6 个不透明块：
     div.tdd-fact [42,106] / span.model-chip ×2 [233,257]
     button.vote-btn ×2 [400,502] / div.health-rating [400,502]
     button.tdd-btn [574,612]
   选方案 A 而不是 B（水印提到内容之上）的理由：
     B 会让 20% 不透明度的水印文字压到正文上，正文可读性受损；
     A 保住「水印在内容之下、永不干扰阅读」这个原始设计前提，
     只把色块从「完全不透明」调成 62% —— 色块仍能分辨出层次，
     水印在色块区域也能透出轮廓，不再碎成几块。
   为什么是 50%：这是「水印能透出」与「色块仍可辨识」的临界点。
     实测 62% 时水印在色块内仍偏淡（色块边缘盖住圆弧），
     低于 50% 色块几乎看不出边界、卡片层次丢失。
     50% 同时满足：alpha = 0.5，不构成「不透明遮挡」（遮挡判定的阈值就是 >0.5）。
   范围只覆盖「可能落到水印矩形内」的内容块（表单/卡片/代码块/按钮），
   不动 `.tdd-modal` 与 `.tdd-foot` 这类外层容器（它们不在水印层内）。 */
.tdd-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.tdd-fact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
}
.fact-label { font-size: 11px; color: var(--text-tertiary); }
.fact-value { font-size: 13px; color: var(--text-primary); }

/* ── 一句话摘要（2026-11-04 改版）──
   紧跟标题，负 margin 抵消 `.tdd-title` 的 16px 下边距，让「标题 + 摘要」读成一个整体。 */
.tdd-summary {
  margin: -8px 0 16px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-secondary);
}

/* ── 结构化信息面板：额度 / 领取条件 / 限制 / 有效期（2026-11-04 改版）──
   `.tdd-facts` 是**既有容器**（grid + auto-fit），这里只做增量：
     1. 单元格下限 140px → 200px：「领取条件 / 限制」是成句内容，
        140px 会把它们压成窄柱（一行三五个字），200px 才能在桌面两列排布下正常成行；
     2. 空值格子根本不会被渲染（见 specCells 的空值不入列策略）→ 无需 :empty 兜底；
     3. 富文本格（.tdd-rich）与纯文字格（.fact-value）视觉保持一致。
   配色全部走既有变量，未引入新色板。 */
.tdd-spec {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  align-items: start;
}
/* 图标与标签同排（`<i>` 由模板注入，见 fact-label 内） */
.tdd-fact .fact-label {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tdd-fact .fact-label i { font-size: 13px; }
/* 合并态格子跨满整行（「限制与领取条件」，见 specCells 的三态规则）：
   两列布局下若只占一列，右侧会留一块空白，看着像「这里缺了点东西」。 */
.tdd-fact.is-wide { grid-column: 1 / -1; }
/* 富文本格容器。元素级排版（p / ul / table / code…）与备注共用同一套规则，
   见上方「备注富文本」段里并列 `.tdd-rich` 的各条 :deep() 选择器 —— 刻意不复制规则体，
   否则两处排版会随时间漂移。这里只补容器自身属性。 */
.tdd-rich {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-secondary);
}

.tdd-section { margin-bottom: 16px; }
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.section-title i { font-size: 15px; color: var(--text-tertiary); }

.tdd-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 12px;
  border-bottom: 0.5px solid var(--divider);
}
.tdd-row:last-child { border-bottom: none; }
.row-label { flex-shrink: 0; width: 64px; color: var(--text-tertiary); }
.row-link {
  flex: 1;
  min-width: 0;
  color: var(--primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 6px;
}
.row-link:hover { text-decoration: underline; }
.row-link:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.row-code {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tdd-models { display: flex; flex-wrap: wrap; gap: 6px; }
.model-chip {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  color: var(--text-secondary);
}
.tdd-note {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

/* ── 备注富文本（2026-10-30）─────────────────────────────────
   v-html 注入的节点不带 scoped 属性，必须用 :deep() 才命中。
   另外富文本要关掉 pre-wrap：marked 生成的是块级标签，
   保留 pre-wrap 会把源码里的换行渲染成多余空行。
   2026-11-04：下面每一条规则的选择器都**并列了 `.tdd-rich`** ——
   结构化面板里的「领取条件 / 限制」两格同样消费服务端消毒后的 HTML
   （requirements_html / limits_html），排版需求与备注完全一致。
   用逗号并列而不是复制一份规则体，避免两处排版随时间漂移。 */
.tdd-note.markdown-body,
.tdd-rich {
  white-space: normal;
  word-break: break-word;
}
.tdd-note.markdown-body :deep(p),
.tdd-rich :deep(p) { margin: 0 0 8px; }
.tdd-note.markdown-body :deep(p:first-child),
.tdd-rich :deep(p:first-child),
.tdd-note.markdown-body :deep(ul:first-child),
.tdd-rich :deep(ul:first-child),
.tdd-note.markdown-body :deep(ol:first-child),
.tdd-rich :deep(ol:first-child) { margin-top: 0; }
.tdd-note.markdown-body :deep(p:last-child),
.tdd-rich :deep(p:last-child),
.tdd-note.markdown-body :deep(ul:last-child),
.tdd-rich :deep(ul:last-child),
.tdd-note.markdown-body :deep(ol:last-child),
.tdd-rich :deep(ol:last-child) { margin-bottom: 0; }
.tdd-note.markdown-body :deep(h1),
.tdd-rich :deep(h1),
.tdd-note.markdown-body :deep(h2),
.tdd-rich :deep(h2),
.tdd-note.markdown-body :deep(h3),
.tdd-rich :deep(h3),
.tdd-note.markdown-body :deep(h4),
.tdd-rich :deep(h4),
.tdd-note.markdown-body :deep(h5),
.tdd-rich :deep(h5),
.tdd-note.markdown-body :deep(h6),
.tdd-rich :deep(h6) {
  margin: 12px 0 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}
.tdd-note.markdown-body :deep(ul),
.tdd-rich :deep(ul),
.tdd-note.markdown-body :deep(ol),
.tdd-rich :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.tdd-note.markdown-body :deep(li),
.tdd-rich :deep(li) { margin: 2px 0; }
.tdd-note.markdown-body :deep(a),
.tdd-rich :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.tdd-note.markdown-body :deep(code),
.tdd-rich :deep(code) {
  font-family: var(--font-mono);
  font-size: 12px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
}
.tdd-note.markdown-body :deep(pre),
.tdd-rich :deep(pre) {
  margin: 0 0 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  border-radius: var(--radius-sm);
  overflow-x: auto;
}
.tdd-note.markdown-body :deep(pre code),
.tdd-rich :deep(pre code) {
  background: none;
  padding: 0;
}
.tdd-note.markdown-body :deep(blockquote),
.tdd-rich :deep(blockquote) {
  margin: 0 0 8px;
  padding: 4px 0 4px 12px;
  border-left: 3px solid var(--border);
  color: var(--text-tertiary);
}
.tdd-note.markdown-body :deep(img),
.tdd-rich :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 6px 0;
  border-radius: var(--radius-sm);
}
.tdd-note.markdown-body :deep(table),
.tdd-rich :deep(table) {
  width: 100%;
  margin: 0 0 8px;
  border-collapse: collapse;
  font-size: 12px;
}
.tdd-note.markdown-body :deep(th),
.tdd-rich :deep(th),
.tdd-note.markdown-body :deep(td),
.tdd-rich :deep(td) {
  padding: 4px 8px;
  border: 1px solid var(--border);
  text-align: left;
}
.tdd-note.markdown-body :deep(hr),
.tdd-rich :deep(hr) {
  margin: 10px 0;
  border: none;
  border-top: 1px solid var(--border);
}

/* ── 邀请码（2026-10-30）── */
.invite-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.invite-code {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.invite-label {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ── 健康度 ── */
.tdd-health {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr;
  gap: 10px;
  align-items: stretch;
}
.vote-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 8px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  background: color-mix(in srgb, var(--surface-raised) 50%, transparent);
  cursor: pointer;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.vote-btn i { font-size: 18px; }
.vote-label { font-size: 12px; color: var(--text-tertiary); }
.vote-count { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.vote-btn.is-up i { color: var(--success); }
.vote-btn.is-down i { color: var(--danger); }
.vote-btn.is-up.active { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); }
.vote-btn.is-down.active { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.vote-btn:hover:not(:disabled) { background: var(--surface-hover); }
.vote-btn:active:not(:disabled) { background: var(--surface-active); }
.vote-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.vote-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.health-rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 12px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
}
.rating-score { display: flex; align-items: baseline; gap: 2px; }
.score-num { font-size: 20px; font-weight: 700; color: var(--text-primary); }
.score-max { font-size: 11px; color: var(--text-tertiary); }
.rating-stars { display: flex; gap: 1px; font-size: 11px; color: var(--warning); }
.rating-count { font-size: 11px; color: var(--text-tertiary); }

.tdd-distribution {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.dist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.dist-label { width: 32px; flex-shrink: 0; }
.dist-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  overflow: hidden;
}
.dist-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--warning);
  transition: width 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.dist-count { width: 24px; text-align: right; font-variant-numeric: tabular-nums; }
.tdd-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ── 评测表单 ── */
.review-form { display: flex; flex-direction: column; gap: 8px; }
.star-input { display: flex; align-items: center; gap: 3px; }
.star-btn {
  border: none;
  background: none;
  padding: 2px;
  border-radius: 6px;
  font-size: 18px;
  line-height: 1;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.12s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
}
.star-btn:hover { transform: scale(1.1); }
.star-btn:active { transform: scale(0.98); }
.star-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.star-btn.active { color: var(--warning); }
.star-text { margin-left: 6px; font-size: 12px; color: var(--text-tertiary); }
.review-input {
  width: 100%;
  resize: vertical;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.6;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--surface-raised) 50%, transparent);
  border: 0.5px solid var(--border);
  border-radius: 10px;
  outline: none;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.review-input:focus { border-color: var(--border-focus); }
.review-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.char-count { font-size: 11px; color: var(--text-tertiary); }

/* ── 评测列表 ── */
.review-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.review-item {
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
}
.review-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
/* 头像：有图走 <img>，无图/加载失败回退昵称首字母色块 */
.review-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  color: var(--text-inverse);
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
}
.review-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.review-author { font-size: 12px; font-weight: 500; color: var(--text-primary); }
/* 游客标识：与登录用户评测区分 */
.review-tag {
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 6px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-tertiary);
}
.review-stars { display: flex; gap: 1px; font-size: 11px; color: var(--warning); }
.review-time { margin-left: auto; font-size: 11px; color: var(--text-tertiary); }

/* ── 游客评测 ── */
.guest-open-btn { width: 100%; justify-content: center; }
.guest-form { gap: 10px; }
.guest-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.guest-field {
  flex: 1 1 160px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.guest-label {
  font-size: 11px;
  color: var(--text-secondary);
}
.guest-label em {
  font-style: normal;
  color: var(--danger);
}
.guest-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.guest-input:focus {
  outline: none;
  border-color: var(--border-focus);
}
.guest-privacy-tip {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-tertiary);
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.guest-privacy-tip i { margin-top: 1px; }
.guest-avatar-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.guest-avatar-preview img {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border);
}
.challenge-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.guest-challenge {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
}
.challenge-q {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}
.challenge-input {
  width: 72px;
  flex: 0 0 auto;
  text-align: center;
}
.challenge-refresh {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  border-radius: 6px;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.challenge-refresh:hover { color: var(--primary); background: var(--surface-hover); }
.challenge-refresh:active { background: var(--surface-active); }
.challenge-refresh:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
/* 挂件加载失败时的重试入口（fail-closed：失败即挡住提交，不降级） */
.challenge-retry {
  border: none;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.challenge-retry:hover { background: var(--surface-hover); }
.challenge-retry:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* 已有待审评测的状态回显 */
.guest-status {
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.guest-status-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.guest-badge {
  font-size: 10px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.guest-badge.rejected {
  color: var(--danger);
  border-color: var(--danger);
}
.guest-status-nick { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.guest-stars { display: flex; gap: 1px; font-size: 11px; color: var(--warning); }
.guest-status-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.guest-status-tip {
  margin: 0;
  font-size: 11px;
  color: var(--text-tertiary);
}
.guest-status-tip.err { color: var(--danger); }
.guest-status-actions { display: flex; gap: 8px; }

.review-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

/* ── 评测打标（社区健康度第三维）── */
.review-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.mark-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 0.5px solid var(--border);
  background: transparent;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.mark-btn i { font-size: 12px; }
.mark-btn:hover:not(:disabled) {
  border-color: var(--text-tertiary);
  color: var(--text-secondary);
  background: var(--surface-hover);
}
.mark-btn:active:not(:disabled) { background: var(--surface-active); }
.mark-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
/* 已标：高亮为成功色，与「还能用」投票同一语义色系 */
.mark-btn.active {
  border-color: var(--success);
  color: var(--success);
  background: color-mix(in srgb, var(--success) 8%, transparent);
}
.mark-btn.active .mark-text { font-weight: 600; }
.mark-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mark-count { font-weight: 600; }
.mark-hint { font-size: 11px; color: var(--text-tertiary); opacity: 0.75; }
.tdd-empty {
  margin: 0;
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
.more-btn { margin-top: 12px; width: 100%; justify-content: center; }

/* ── 底部 ── */
.tdd-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 0.5px solid var(--divider);
  background: var(--surface-raised);
  flex-wrap: wrap;
}
.tdd-foot-left,
.tdd-foot-right { display: flex; align-items: center; gap: 8px; }

.tdd-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  background: color-mix(in srgb, var(--surface-raised) 50%, transparent);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tdd-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.tdd-btn:active:not(:disabled) { background: var(--surface-active); }
.tdd-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tdd-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.tdd-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--text-inverse);
}
.tdd-btn.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.tdd-btn.primary:active:not(:disabled) { background: var(--primary-dark); border-color: var(--primary-dark); }
.tdd-btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
.tdd-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); }
.tdd-btn.tiny { padding: 4px 8px; font-size: 11px; }

/* ── 修改建议 ── */
.tdd-edit-mine {
  padding: 12px;
  border-radius: 10px;
  background: var(--primary-light);
  border: 0.5px solid var(--border);
}
.edit-mine-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.edit-mine-comment {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.edit-mine-comment i { color: var(--primary); flex-shrink: 0; margin-top: 1px; }
.edit-mine-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.edit-diff-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.edit-diff-item {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 12px;
  line-height: 1.5;
}
.diff-label {
  flex-shrink: 0;
  min-width: 62px;
  color: var(--text-tertiary);
}
.diff-from {
  color: var(--text-tertiary);
  text-decoration: line-through;
  word-break: break-all;
}
.diff-arrow { color: var(--text-tertiary); font-size: 13px; flex-shrink: 0; }
.diff-to {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}

.tdd-edit-review .section-title { display: flex; align-items: center; gap: 6px; }
.review-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-inverse);
  background: var(--danger);
}
.review-list-edit {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.review-edit-item {
  padding: 12px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
}
.review-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.review-edit-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}
.review-edit-author i { color: var(--primary); font-size: 13px; }
.review-edit-time { font-size: 11px; color: var(--text-tertiary); }
.review-edit-comment {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.review-edit-noop {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
.review-edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

/* ── 驳回修改建议弹窗（须高于详情弹窗 10050）── */
.tdd-reject-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10080;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
}
.tdd-reject-modal {
  width: 100%;
  max-width: 420px;
  padding: 16px;
  border-radius: 14px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  box-shadow: var(--shadow-lg);
}
.reject-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.reject-sub {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.tdd-reject-modal textarea {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 10px;
  outline: none;
  resize: vertical;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tdd-reject-modal textarea:focus { border-color: var(--border-focus); }
.tdd-reject-modal textarea::placeholder { color: var(--text-tertiary); }
.reject-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.reject-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

/* ── 轻提示 ── */
.tdd-toast {
  position: absolute;
  left: 50%;
  bottom: 70px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--text-inverse);
  background: var(--text-primary);
  box-shadow: var(--shadow-lg);
  white-space: nowrap;
}
.tdd-toast.err { background: var(--danger); }
.toast-enter-active,
.toast-leave-active { transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
.toast-enter-from,
.toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(6px); }

/* ══════════════════════════════════════════════════════════════════════════
   ── 核实情况 / FAQ / 相关推荐 / 底部导航 / 收藏（2026-11-04 改版）─────────
   配色一律复用站点既有变量（--success / --warning / --divider / --surface-sunken…），
   不引入新色板；移动端覆盖写在下方本组件自己的 @media 里。
   ══════════════════════════════════════════════════════════════════════════ */

/* 核实情况：状态 chip + 核实日期同排；核实范围单独成块（左侧竖线，视觉上像「引用/出处」） */
.verify-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.verify-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.verify-state i { font-size: 13px; }
.verify-state.is-ok {
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: color-mix(in srgb, var(--success) 82%, var(--text-primary));
}
.verify-state.is-pending {
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: color-mix(in srgb, var(--warning) 80%, var(--text-primary));
}
.verify-date { font-size: 12px; color: var(--text-tertiary); }
.verify-scope {
  padding: 10px 12px;
  border-radius: 10px;
  border-left: 3px solid var(--border);
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
}
.verify-scope-label {
  display: block;
  margin-bottom: 2px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.verify-scope-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.verify-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--warning);
}
.verify-note {
  display: flex;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
.verify-note i { flex-shrink: 0; margin-top: 2px; }

/* FAQ：原生 <details>，零 JS 状态、SSR 直出、键盘与读屏默认可达。
   自绘三角替代各浏览器默认 marker（Chrome/Safari 走 ::-webkit-details-marker，
   Firefox 走 marker，所以两处都要关）。 */
.tdd-faq { display: flex; flex-direction: column; gap: 6px; }
.faq-item {
  border: 1px solid var(--divider);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  overflow: hidden;
}
.faq-q {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  list-style: none;
}
.faq-q::-webkit-details-marker { display: none; }
.faq-q::marker { content: ''; }
.faq-q::before {
  content: '';
  flex-shrink: 0;
  width: 0;
  height: 0;
  margin-top: 5px;
  border-left: 5px solid var(--text-tertiary);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.15s ease;
}
.faq-item[open] > .faq-q::before { transform: rotate(90deg); }
.faq-a {
  margin: 0;
  padding: 0 12px 10px 23px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

/* 相关推荐：桌面为自适应网格（4~6 张），移动端改横向滚动条（见 @media） */
.related-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
}
.related-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--divider);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  text-decoration: none;
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.related-card:hover {
  border-color: var(--border-focus);
  transform: translateY(-1px);
}
.related-provider {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.related-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text-primary);
}
.related-desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

/* 底部导航：通往分类落地页与精选对比表 */
.tdd-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 8px;
  padding-top: 12px;
  border-top: 0.5px solid var(--divider);
}
.tdd-nav-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  text-decoration: none;
  transition: color 0.15s ease;
}
.tdd-nav-link:hover { color: var(--primary); }

/* 收藏按钮激活态：复用 --primary，不新增变量 */
.tdd-btn.is-fav { color: var(--primary); }

/* ── 移动端 ── */
@media (max-width: 640px) {
  .tdd-backdrop { padding: 0; align-items: flex-end; }
  .tdd-modal {
    max-width: none;
    max-height: 92vh;
    border-radius: 14px 14px 0 0;
  }
  .tdd-health { grid-template-columns: 1fr 1fr; }
  .health-rating { grid-column: 1 / -1; }
  .tdd-foot { flex-direction: column; align-items: stretch; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
  .tdd-foot-left, .tdd-foot-right { width: 100%; }
  .tdd-foot-left .tdd-btn, .tdd-foot-right .tdd-btn { flex: 1; justify-content: center; }
  /* ── 2026-11-04 新增块的移动端覆盖 ──
     项目约定（CLAUDE.md「移动端覆盖必须写进组件内」）：外部 CSS 与组件 scoped 规则
     同特异度、靠加载顺序决胜，所以这些覆盖只能放在本组件自己的 @media 里。 */
  /* 四格面板：手机上单列，避免 200px 下限在 360px 屏上退化成横向挤压 */
  .tdd-spec { grid-template-columns: 1fr; }
  /* 相关推荐：网格 → 横向滚动条，一屏能扫到下一张卡（scroll-snap 停在卡边界） */
  .related-strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }
  .related-card { flex: 0 0 78%; scroll-snap-align: start; }
  /* 底部导航：两列均分，图标与文字居中 */
  .tdd-nav-link { flex: 1 1 calc(50% - 4px); justify-content: center; }
  /* FAQ 问题行更紧凑，但保留可点区域高度 */
  .faq-q { padding: 9px 10px; }
  .faq-a { padding: 0 10px 9px 21px; }
}

/* ── 窄屏 header：让右侧徽标组整体换行（2026-10-30）──
   按盒模型测算：`.tdd-head-side` 里「分类徽标（最长『免费云服务器』6 字 ≈ 88px）+ 品质徽标 40px
   + 关闭按钮 28px + 两个 gap 16px = 172px」，且 `flex-shrink: 0`（不可压缩）。
   于是标题可用宽度 = 内容宽 − 172 − 图标 46：
     360 → 109px、375 → 124px、390 → 139px、414 → 163px、430 → 179px
   而标题下面那行「国内直连 · 官方直营 · 永久有效」约需 170px —— 414px 下会被折成两行。
   不溢出，但很难看。所以断点取 480px（覆盖 360–430 全系手机竖屏）：
   标题独占第一行、徽标组整体落到第二行右对齐。
   不隐藏任何内容（分类/品质/关闭都还在），只改排布。
   `flex: 1 1 100%` 让 `.tdd-head-main` 占据整行，`.tdd-head-side` 靠 `margin-left:auto` 右对齐。 */
@media (max-width: 480px) {
  .tdd-head { flex-wrap: wrap; row-gap: 10px; }
  .tdd-head-main { flex: 1 1 100%; }
  .tdd-head-side { margin-left: auto; }
}
/* ── 分类彩色徽标（2026-10-30）：从正文事实区移到 header ──
   与 .tdd-quality 同一尺寸语言（12px / 6px 圆角），只是每种分类一个色。
   配色全部走站点既有变量，亮暗主题自动跟随；透视度与 .tdd-quality 的既有做法一致。 */
.tdd-category {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
  white-space: nowrap;
}
.tdd-category.is-blue {
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
  color: color-mix(in srgb, var(--accent-blue) 82%, var(--text-primary));
}
.tdd-category.is-purple {
  background: color-mix(in srgb, var(--accent-purple) 14%, transparent);
  color: color-mix(in srgb, var(--accent-purple) 82%, var(--text-primary));
}
.tdd-category.is-primary {
  background: var(--primary-light);
  color: var(--primary);
}
/* teal（免费域名，2026-11-04）：站点没有 teal 语义变量，用既有 --primary（绿）
   与 --accent-blue（蓝）混出青色 —— 属于「复用既有变量」，不是新增色板条目。
   调色机制与上面三档完全一致（14% 打底 + 82% 上色，亮暗主题自动跟随）。 */
.tdd-category.is-teal {
  --tdd-teal: color-mix(in srgb, var(--primary) 55%, var(--accent-blue));
  background: color-mix(in srgb, var(--tdd-teal) 14%, transparent);
  color: color-mix(in srgb, var(--tdd-teal) 82%, var(--text-primary));
}

/* ── 是否实名徽标（2026-10-30 九轮：右上水印 → header 徽章）──
   用户原话「是否实名不要水印了，改为徽章放置到 header/div[2]」。
   视觉参数与 `.tdd-category` **逐项对齐**（12px / padding 2px 8px / 圆角 6px /
   600 字重 / nowrap / flex-shrink:0），让「分类 · 品质 · 实名」三个徽标在同一套语言里。
   调色板也复用同一套机制：color-mix(色 14%, transparent) 打底 +
   color-mix(色 82%, 文字色) 上色，亮暗主题自动跟随。
   `cursor: help` 是因为「其他」态的 40 字手填说明只出现在 title 里，
   给个可悬停提示的视觉暗示（不影响点击，本元素无交互）。
   四态配色：无需实名=绿(success) / 需身份证=蓝(accent-blue) /
             需人脸=紫(accent-purple) / 需实名=黄(warning)。 */
.tdd-realname {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
  white-space: nowrap;
  cursor: help;
}
.tdd-realname.is-ok {
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: color-mix(in srgb, var(--success) 82%, var(--text-primary));
}
.tdd-realname.is-blue {
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
  color: color-mix(in srgb, var(--accent-blue) 82%, var(--text-primary));
}
.tdd-realname.is-purple {
  background: color-mix(in srgb, var(--accent-purple) 14%, transparent);
  color: color-mix(in srgb, var(--accent-purple) 82%, var(--text-primary));
}
.tdd-realname.is-pending {
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: color-mix(in srgb, var(--warning) 80%, var(--text-primary));
}

/* 读屏专用：视觉隐藏但辅助技术可读（1px + clip，不能用 display:none）。
   为什么详情页需要自己一份：scoped 样式不跨组件生效，而实名徽标的 sr-only
   文本渲染在**本组件**的 header 里。写法与本仓 TokenFilterBar / keys.vue 一致。 */
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

/* 底部「前往领取」在地址含未替换占位符时的降级态：不可点，但仍占位不跳版 */
.tdd-btn.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
</style>
