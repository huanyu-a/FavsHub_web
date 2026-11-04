<template>
  <Teleport to="body">
    <div class="tde-backdrop" @click.self="onBackdrop">
      <div class="tde-modal" role="dialog" aria-modal="true" :aria-label="ariaLabel">
        <header class="tde-head">
          <div class="tde-head-copy">
            <h2 class="tde-title">
              <i :class="headIcon"></i>
              {{ headTitle }}
            </h2>
            <p class="tde-sub">{{ headSub }}</p>
          </div>
          <button type="button" class="tde-close" title="关闭" @click="close">
            <i class="ri-close-line"></i>
          </button>
        </header>

        <div class="tde-body">
          <!-- 游客身份（未登录发布时）：署名 + 人机校验 -->
          <fieldset v-if="isGuest" class="tde-group">
            <legend class="tde-legend">游客身份</legend>

            <label class="tde-field">
              <span class="field-label">昵称 <em>*</em></span>
              <input
                v-model="guestNickname"
                type="text"
                :maxlength="24"
                placeholder="展示用的名字，最长 24 字"
              >
            </label>

            <div class="tde-field">
              <span class="field-label">人机校验 <em>*</em></span>
              <div class="guest-challenge">
                <!-- fail-closed：挂件失败即拒绝提交，不提供算术题降级通道 -->
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
              <span class="field-hint">游客提交无需登录，同一 IP 每天限 1 条；提交后同样由管理员审核，通过后公开展示。</span>
            </div>
          </fieldset>

          <!-- 基本信息 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">基本信息</legend>

            <label class="tde-field">
              <span class="field-label">服务商 <em>*</em></span>
              <input
                v-model="form.provider"
                type="text"
                :maxlength="LIMITS.provider"
                placeholder="如：智谱 AI、ModelScope、OpenRouter"
              >
              <span class="field-hint">{{ form.provider.length }} / {{ LIMITS.provider }}</span>
            </label>

            <label class="tde-field">
              <span class="field-label">通告标题 <em>*</em></span>
              <input
                v-model="form.title"
                type="text"
                :maxlength="LIMITS.title"
                placeholder="如：新用户注册送 2000 万 Tokens"
              >
              <span class="field-hint">{{ form.title.length }} / {{ LIMITS.title }}</span>
            </label>

            <label class="tde-field">
              <span class="field-label">领取地址 <em>*</em></span>
              <input
                v-model="form.url"
                type="url"
                :maxlength="LIMITS.url"
                placeholder="https://..."
              >
              <span class="field-hint">必须为 http(s) 链接，用于一键导入书签</span>
              <!-- 邀请码占位符（2026-10-30）：服务端只在该访客「已抽中码」的那次响应里替换 -->
              <span class="field-hint">
                可写邀请码占位符 <code class="tde-code">{邀请码}</code>
                （也认 <code class="tde-code">{code}</code> / <code class="tde-code">{invite_code}</code>，全角花括号同样有效）：
                访客抽中邀请码后，服务端会把它替换成那次抽中的码并做 URL 编码，给出完整领取地址。
              </span>
            </label>

            <label class="tde-field">
              <span class="field-label">API 调用地址</span>
              <input
                v-model="form.call_url"
                type="url"
                :maxlength="LIMITS.callUrl"
                placeholder="https://api.example.com/v1（可选）"
              >
              <span class="field-hint">
                这里也可以写 <code class="tde-code">{邀请码}</code> 占位符；
                两个地址都写了占位符时，以 API 调用地址为准。
              </span>
            </label>

            <label class="tde-field">
              <span class="field-label">免费额度</span>
              <input
                v-model="form.quota"
                type="text"
                :maxlength="LIMITS.quota"
                placeholder="如：2000 万 Tokens / 每日 100 次调用 / 永久免费"
              >
            </label>
          </fieldset>

          <!-- ── 状态（2026-11-04，仅管理员 + 编辑已有条目）──
               放在最前：改状态是这个面板最常做的操作，不该藏在表单底部。
               「已审核」与「已发布」是两档：审过不等于上线，发布才上线。 -->
          <fieldset v-if="isAdmin && isEdit" class="tde-group">
            <legend class="tde-legend">通告状态</legend>
            <div class="tde-field">
              <span class="field-label">当前状态</span>
              <div class="chip-row">
                <button
                  v-for="st in SETTABLE_STATES"
                  :key="st"
                  type="button"
                  class="chip"
                  :class="{ active: stateDraft === st }"
                  @click="stateDraft = st"
                >{{ DEAL_STATE_LABELS[st] }}</button>
              </div>
              <p class="tde-hint">
                「已发布」才会在前端展示；「已审核」只是通过审核的可信标记，不会出现在列表页。
                下架 / 失效 / 驳回 / 删除均不在前端展示。
              </p>
              <p v-if="stateChanged" class="tde-hint tde-hint-warn">
                状态将变为「{{ DEAL_STATE_LABELS[stateDraft] }}」，保存后立即生效。
              </p>
            </div>
          </fieldset>

          <!-- 分类与分级 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">分类与分级</legend>

            <div class="tde-field">
              <span class="field-label">通告分类</span>
              <div class="chip-row">
                <button
                  v-for="c in CATEGORY_OPTIONS"
                  :key="c.value"
                  type="button"
                  class="chip"
                  :class="{ active: form.category === c.value }"
                  @click="form.category = c.value"
                >{{ c.label }}</button>
              </div>
              <p class="tde-hint">云服务器 / PaaS / Serverless 免费档选「免费云服务器」；API 额度选「API 额度」</p>
            </div>

            <div class="tde-field">
              <span class="field-label">品质分级</span>
              <div class="chip-row">
                <button
                  v-for="q in QUALITY_LEVELS"
                  :key="q"
                  type="button"
                  class="chip"
                  :class="{ active: form.quality === q }"
                  @click="form.quality = q"
                >{{ q }}</button>
              </div>
            </div>

            <div class="tde-field">
              <span class="field-label">访问区域</span>
              <div class="chip-row">
                <button
                  v-for="r in REGION_OPTIONS"
                  :key="r.value"
                  type="button"
                  class="chip"
                  :class="{ active: form.region === r.value }"
                  @click="form.region = r.value"
                >{{ r.label }}</button>
              </div>
            </div>

            <div class="tde-field">
              <span class="field-label">来源标签</span>
              <div class="chip-row">
                <button
                  v-for="s in SOURCE_OPTIONS"
                  :key="s.value"
                  type="button"
                  class="chip"
                  :class="{ active: form.source_tag === s.value }"
                  @click="form.source_tag = s.value"
                >{{ s.label }}</button>
              </div>
            </div>

            <!-- 是否实名（2026-10-30）—— 领取门槛属性。
                 「未标注」是默认可选项：存量通告都是未填，编辑时必须能原样存回未填，
                 否则一打开编辑器就被迫替作者瞎标一个。选「其他」才出现手填文案。 -->
            <div class="tde-field">
              <span class="field-label">是否实名</span>
              <div class="chip-row">
                <button
                  v-for="r in REAL_NAME_OPTIONS"
                  :key="r.value"
                  type="button"
                  class="chip"
                  :class="{ active: form.real_name === r.value }"
                  @click="form.real_name = r.value"
                >{{ r.label }}</button>
              </div>
              <input
                v-if="form.real_name === 'other'"
                v-model="form.real_name_other"
                type="text"
                :maxlength="LIMITS.realNameOther"
                placeholder="如：需上传护照 / 需银行卡四要素验证"
              >
              <span v-if="form.real_name === 'other'" class="field-hint">
                {{ form.real_name_other.length }} / {{ LIMITS.realNameOther }}
                · 仅选「其他」时保留，改成别的选项会自动清空
              </span>
              <p v-else class="tde-hint">
                选「其他」可手填具体方式；选「未标注」时详情页不显示实名徽标。
              </p>
            </div>

            <!-- 精选对比（2026-11-04）：**仅管理员**渲染 —— 与 pinned 同口径。
                 普通用户连控件都看不到，提交时也不会带上这个字段。 -->
            <div v-if="isAdmin" class="tde-field">
              <span class="field-label">精选对比</span>
              <div class="chip-row">
                <button
                  type="button"
                  class="chip"
                  :class="{ active: form.featured }"
                  :aria-pressed="form.featured"
                  @click="form.featured = !form.featured"
                >
                  <i :class="form.featured ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'"></i>
                  进「精选对比」表
                </button>
              </div>
              <p class="tde-hint">
                勾选后这条会进入「精选对比」表 —— 现在该表内嵌在 <code class="tde-code">/tokens</code>
                页底部（<code class="tde-code">/tokens/compare</code> 仍可单独访问）。
                仅管理员可设置。
              </p>
            </div>
          </fieldset>

          <!-- 模型与有效期 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">模型与有效期</legend>

            <div class="tde-field">
              <span class="field-label">支持模型（{{ form.models.length }} / {{ LIMITS.models }}）</span>

              <!-- 2026-10-30：内置 /v1/models 拉取。部分平台需鉴权，
                   故 key 输入框与按钮同排；填了 key 才会带 Authorization 出去。
                   key 只用于本次请求，不落库、不回显。 -->
              <div class="model-fetch">
                <input
                  v-model="modelApiKey"
                  type="password"
                  class="model-fetch-key"
                  autocomplete="off"
                  placeholder="API Key（仅需鉴权的平台填写，不会保存）"
                >
                <button
                  type="button"
                  class="tde-btn"
                  :disabled="modelFetching || !form.call_url.trim()"
                  :title="form.call_url.trim() ? '从 API 地址拉取模型清单' : '请先填写 API 地址'"
                  @click="fetchModels"
                >
                  <i :class="modelFetching ? 'ri-loader-4-line spin' : 'ri-download-cloud-2-line'"></i>
                  {{ modelFetching ? '获取中...' : '获取模型' }}
                </button>
              </div>
              <span v-if="modelFetchError" class="field-hint is-err">{{ modelFetchError }}</span>
              <span v-else-if="modelFetchNote" class="field-hint">{{ modelFetchNote }}</span>

              <div v-if="fetchedModels.length" class="model-picker">
                <div class="model-picker-head">
                  <span>拉到 {{ fetchedModels.length }} 个，点击勾选</span>
                  <button type="button" class="model-picker-close" @click="fetchedModels = []">收起</button>
                </div>
                <div class="model-picker-list">
                  <button
                    v-for="m in fetchedModels"
                    :key="m"
                    type="button"
                    class="model-pick"
                    :class="{ selected: form.models.includes(m) }"
                    @click="toggleFetchedModel(m)"
                  >
                    <i :class="form.models.includes(m) ? 'ri-checkbox-circle-fill' : 'ri-add-circle-line'"></i>
                    {{ m }}
                  </button>
                </div>
              </div>

              <div class="tag-input">
                <span v-for="(m, i) in form.models" :key="m" class="tag">
                  {{ m }}
                  <button type="button" class="tag-remove" title="移除" @click="removeModel(i)">
                    <i class="ri-close-line"></i>
                  </button>
                </span>
                <input
                  v-model="modelDraft"
                  type="text"
                  class="tag-field"
                  :maxlength="LIMITS.modelName"
                  :placeholder="form.models.length ? '继续添加...' : '如 glm-4-flash，回车添加'"
                  @keydown.enter.prevent="addModel"
                  @keydown.,.prevent="addModel"
                  @blur="addModel"
                >
              </div>
            </div>

            <label class="tde-field">
              <span class="field-label">有效期</span>
              <input v-model="expiresDate" type="date">
              <span class="field-hint">留空表示永久有效</span>
            </label>
          </fieldset>

          <!-- 结构化信息（2026-11-04）──
               列表卡片的「一句话摘要」、详情页的「额度 / 领取条件 / 限制」与底部 FAQ
               都读这几列。requirements / limits 是普通用户可写字段，展示时由**服务端**
               渲染成 *_html 并消毒，前端不自行 marked。 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">结构化信息</legend>

            <label class="tde-field">
              <span class="field-label">一句话摘要</span>
              <input
                v-model="form.summary"
                type="text"
                :maxlength="LIMITS.summary"
                placeholder="如：注册即送 100 万 Token，无需实名，额度长期有效"
              >
              <span class="field-hint">
                {{ form.summary.length }} / {{ LIMITS.summary }} · 列表卡片上最多显示两行
              </span>
            </label>

            <label class="tde-field">
              <span class="field-label">领取条件</span>
              <textarea
                v-model="form.requirements"
                rows="4"
                :maxlength="LIMITS.requirements"
                placeholder="如：手机号注册 + 实名认证；或 GitHub 账号注册满 30 天"
              ></textarea>
              <span class="field-hint">
                {{ form.requirements.length }} / {{ LIMITS.requirements }} ·
                支持 Markdown / HTML，展示时由服务端渲染并消毒
              </span>
            </label>

            <label class="tde-field">
              <span class="field-label">限制条款</span>
              <textarea
                v-model="form.limits"
                rows="4"
                :maxlength="LIMITS.limits"
                placeholder="如：每分钟 60 次调用；不支持并发；禁止商用转售"
              ></textarea>
              <span class="field-hint">
                {{ form.limits.length }} / {{ LIMITS.limits }} ·
                支持 Markdown / HTML，展示时由服务端渲染并消毒
              </span>
            </label>

            <label class="tde-field">
              <span class="field-label">核实范围</span>
              <textarea
                v-model="form.verify_scope"
                rows="3"
                :maxlength="LIMITS.verifyScope"
                placeholder="如：本站核实了「注册成功 + 额度到账 + 完成一次调用」，未验证长期稳定性"
              ></textarea>
              <span class="field-hint">
                {{ form.verify_scope.length }} / {{ LIMITS.verifyScope }} ·
                写清站点到底核了什么，别让「能注册」被读成「能长期用」
              </span>
            </label>

            <div class="tde-field">
              <span class="field-label">常见问题（{{ form.faq.length }} / {{ LIMITS.faq }}）</span>
              <div v-for="(item, i) in form.faq" :key="i" class="faq-row">
                <div class="faq-row-main">
                  <input
                    v-model="item.q"
                    type="text"
                    :maxlength="LIMITS.faqQ"
                    placeholder="问题（不超过 100 字）"
                  >
                  <textarea
                    v-model="item.a"
                    rows="2"
                    :maxlength="LIMITS.faqA"
                    placeholder="答案（不超过 600 字）"
                  ></textarea>
                </div>
                <button type="button" class="faq-remove" title="删除这条问答" @click="removeFaq(i)">
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
              <button
                v-if="form.faq.length < LIMITS.faq"
                type="button"
                class="faq-add"
                @click="addFaq"
              >
                <i class="ri-add-line"></i> 添加一条问答
              </button>
              <p class="tde-hint">
                展示在详情页底部，可被搜索引擎收录。每条必须同时填写问题与答案。
              </p>
            </div>
          </fieldset>

          <!-- 备注 -->
          <fieldset class="tde-group">
            <legend class="tde-legend">备注</legend>
            <label class="tde-field">
              <span class="field-label">补充说明</span>
              <textarea
                v-model="form.note"
                rows="6"
                :maxlength="LIMITS.note"
                placeholder="领取门槛、是否需要实名、常见坑点等。支持 Markdown / HTML / 图片，如：&#10;**需实名**，额度 500 万&#10;![截图](https://example.com/a.png)"
              ></textarea>
              <span class="field-hint">
                {{ form.note.length }} / {{ LIMITS.note }} ·
                支持 Markdown、HTML 与图片；展示时由服务端统一渲染并消毒
              </span>
            </label>
          </fieldset>

          <!-- 邀请码（2026-10-30）──
              码池挂在通告 ID 上，因此只在「编辑既有通告」时出现：
              新建时还没有 ID，提案模式则由作者/管理员在直接编辑里配置。 -->
          <fieldset v-if="canEditInviteCodes" class="tde-group">
            <legend class="tde-legend">
              邀请码（{{ form.inviteCodes.length }} / {{ LIMITS.inviteCodes }}）
            </legend>

            <!-- 码池读失败时必须显式告知并**锁住编辑**：
                 PUT 是全量替换，「没读到」被当成「空池」提交会把整池连同 copy_count 一起删掉。
                 所以这里不给编辑入口，submit 也会跳过这次 PUT（通告其余字段照常保存）。 -->
            <p v-if="inviteCodesError" class="field-hint is-err">
              {{ inviteCodesError }}
            </p>

            <template v-else>
              <p class="tde-hint">
                可配置多个邀请码：<strong>展现比例</strong>决定访客打开详情页时抽中它的概率（越大越容易）；
                <strong>复制上限</strong>用满后该码不再出现给任何人（留 0 = 不限）。
                访客一次只会看到其中一个，抽选在服务端完成。
              </p>

              <p v-if="!inviteCodesLoaded" class="tde-hint">正在读取现有邀请码…</p>

              <template v-if="inviteCodesLoaded">
                <div v-for="(c, i) in form.inviteCodes" :key="i" class="invite-edit-row">
                  <input
                    v-model="c.code"
                    type="text"
                    class="invite-input"
                    :maxlength="LIMITS.inviteCode"
                    placeholder="邀请码或邀请链接"
                  >
                  <input
                    v-model="c.label"
                    type="text"
                    class="invite-input is-small"
                    :maxlength="LIMITS.inviteLabel"
                    placeholder="备注（选填）"
                  >
                  <label class="invite-num" title="展现比例：越大越容易被抽中">
                    <span>比例</span>
                    <input v-model.number="c.weight" type="number" min="1" max="1000" step="1">
                  </label>
                  <label class="invite-num" title="被复制次数上限：用满后该码不再出现">
                    <span>复制上限</span>
                    <input v-model.number="c.copyLimit" type="number" min="0" max="1000000" step="1">
                  </label>
                  <button
                    type="button"
                    class="invite-remove"
                    title="移除该邀请码"
                    @click="removeInviteCode(i)"
                  >
                    <i class="ri-delete-bin-line"></i>
                  </button>
                  <span v-if="c.copy_count" class="invite-used">
                    已复制 {{ c.copy_count }} 次{{ c.exhausted ? '（已用满，访客不再见到）' : '' }}
                  </span>
                </div>

                <button
                  type="button"
                  class="tde-btn"
                  :disabled="form.inviteCodes.length >= LIMITS.inviteCodes"
                  @click="addInviteCode"
                >
                  <i class="ri-add-line"></i> 添加邀请码
                </button>
              </template>
            </template>
          </fieldset>

          <!-- 建议修改：提交说明 + 改动清单 -->
          <fieldset v-if="isProposal" class="tde-group">
            <legend class="tde-legend">提交给审核人</legend>

            <label class="tde-field">
              <span class="field-label">修改理由</span>
              <textarea
                v-model="comment"
                rows="2"
                :maxlength="LIMITS.comment"
                placeholder="如：领取地址已变更、额度从 500 万调整为 1000 万"
              ></textarea>
              <span class="field-hint">{{ comment.length }} / {{ LIMITS.comment }}</span>
            </label>

            <div class="tde-diff">
              <div class="tde-diff-head">
                <i class="ri-git-commit-line"></i>
                本次改动 <strong>{{ changedFields.length }}</strong> 项
              </div>
              <p v-if="changedFields.length === 0" class="tde-diff-empty">
                还没有任何改动 —— 修改上面的字段后再提交。
              </p>
              <ul v-else class="tde-diff-list">
                <li v-for="c in changedFields" :key="c.field" class="tde-diff-item">
                  <span class="diff-label">{{ c.label }}</span>
                  <span class="diff-from">{{ displayValue(c.field, c.from) }}</span>
                  <i class="ri-arrow-right-line diff-arrow"></i>
                  <span class="diff-to">{{ displayValue(c.field, c.to) }}</span>
                </li>
              </ul>
            </div>
          </fieldset>

          <p v-if="errorText" class="tde-error">
            <i class="ri-error-warning-line"></i> {{ errorText }}
          </p>
        </div>

        <footer class="tde-foot">
          <button type="button" class="tde-btn ghost" :disabled="saving" @click="close">取消</button>
          <button
            type="button"
            class="tde-btn primary"
            :disabled="saving || guestSubmitBlocked || (isProposal && changedFields.length === 0)"
            @click="submit"
          >
            <i :class="saving ? 'ri-loader-4-line spin' : 'ri-check-line'"></i>
            {{ saving ? '提交中...' : submitLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { SETTABLE_STATES, DEAL_STATE_LABELS } from '~/utils/deal-state'
import type { DealState } from '~/utils/deal-state'
// 分类下拉直接引用真源（原先此处与 TokenFilterBar 各抄一份逐字相同的数组）
import { DEAL_CATEGORY_OPTIONS as CATEGORY_OPTIONS } from '~/utils/deal-categories'

interface ITokenDeal {
  id: string
  provider: string
  title: string
  url: string
  /** 统一状态（2026-11-04）：pending|verified|published|offline|invalid|rejected|deleted */
  state?: string
  /** @deprecated 旧列，仅兼容旧数据；可见性请读 state */
  status?: string
  call_url?: string
  quota?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  category?: string
  expires_at?: number | null
  note?: string
  /** 一句话摘要（2026-11-04） */
  summary?: string
  /** 限制条款（2026-11-04，支持富文本，服务端渲染 *_html） */
  limits?: string
  /** 领取条件（2026-11-04，支持富文本） */
  requirements?: string
  /** 核实范围说明（2026-11-04） */
  verify_scope?: string
  /** FAQ（2026-11-04）：数组形态回填 */
  faq?: Array<{ q: string; a: string }>
  /** 1 = 精选对比（仅管理员可写） */
  featured?: number
  /** 是否实名（2026-10-30）：'' = 未填 | no | id_card | face | other */
  real_name?: string
  /** 「其他」的手填文案，仅 real_name === 'other' 时有意义 */
  real_name_other?: string
}

const props = defineProps<{
  deal?: ITokenDeal | null
  /** 建议修改模式：预填现值、只提交改动字段、提交到建议通道而非直接编辑 */
  proposal?: boolean
}>()
const emit = defineEmits<{
  close: []
  saved: [message: string]
}>()

const authStore = useAuthStore()

const LIMITS = {
  provider: 60,
  title: 120,
  url: 500,
  callUrl: 500,
  quota: 200,
  /** 2026-10-30：备注上限 500 → 2000，并支持 Markdown / HTML / 图片富文本（服务端渲染消毒） */
  note: 2000,
  models: 20,
  modelName: 60,
  comment: 200,
  /** 是否实名 →「其他」手填文案上限，与 server/utils/token-deals.ts 的 LIMITS.realNameOther 一致 */
  realNameOther: 40,
  /** 邀请码：与 server/utils/invite-codes.ts 的 INVITE_CODE_LIMITS 保持一致 */
  inviteCodes: 20,
  inviteCode: 300,
  inviteLabel: 40,
  // ── 结构化字段（2026-11-04）：与 server/utils/token-deals.ts 的 LIMITS 一一对应 ──
  summary: 200,
  limits: 2000,
  requirements: 2000,
  verifyScope: 500,
  /** FAQ 条数上限（单条 q ≤ faqQ、a ≤ faqA） */
  faq: 10,
  faqQ: 100,
  faqA: 600,
}

const QUALITY_LEVELS = ['上上品', '上品', '中品', '下品', '下下品']
const REGION_OPTIONS = [
  { value: 'cn', label: '国内直连' },
  { value: 'global', label: '海外（需代理）' },
]
const SOURCE_OPTIONS = [
  { value: 'official', label: '官方直营' },
  { value: 'relay', label: '中转站' },
  { value: 'community', label: '社区转发' },
]
// 分类下拉见顶部 import（真源 `~/utils/deal-categories`，与 TokenFilterBar 同源）

/**
 * 是否实名（2026-10-30）—— 与 server/utils/token-deals.ts 的 REAL_NAME_VALUES 一致。
 *
 * 额外给一个「未填」选项：存量通告都是未填，编辑时必须能原样保存回未填，
 * 否则一打开编辑器就被迫选一个，等于替作者瞎标。
 */
const REAL_NAME_OPTIONS = [
  { value: '', label: '未标注' },
  { value: 'no', label: '否' },
  { value: 'id_card', label: '身份证' },
  { value: 'face', label: '人脸' },
  { value: 'other', label: '其他' },
]
const REAL_NAME_LABELS: Record<string, string> = {
  '': '未标注',
  no: '否',
  id_card: '身份证',
  face: '人脸',
  other: '其他',
}

const REGION_LABELS: Record<string, string> = { cn: '国内直连', global: '海外（需代理）' }
const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}

const isEdit = computed(() => !!props.deal?.id)
const isProposal = computed(() => !!props.proposal)
const isAdmin = computed(() => authStore.isAdmin)
/** 游客发布模式：未登录 + 新建（编辑/提案永远需要登录身份） */
const isGuest = computed(() => !authStore.isLoggedIn && !isEdit.value && !isProposal.value)

/**
 * 是否开放邀请码配置（2026-10-30）
 *
 * 码池挂在通告 ID 上，所以：新建时还没有 ID → 不显示（保存后可再编辑）；
 * 提案模式不碰码池（属于作者/管理员的直接操作）；游客无法通过服务端权限校验。
 */
const canEditInviteCodes = computed(() =>
  isEdit.value && !isGuest.value && !isProposal.value,
)

const headTitle = computed(() => {
  if (isProposal.value) return '建议修改'
  return isEdit.value ? '编辑通告' : '发布白嫖通告'
})
const headIcon = computed(() => {
  if (isProposal.value) return 'ri-lightbulb-line'
  return isEdit.value ? 'ri-edit-line' : 'ri-add-circle-line'
})
const ariaLabel = computed(() => headTitle.value)
const headSub = computed(() => {
  if (isProposal.value) {
    return '只提交你改动的字段，由通告作者或管理员审核通过后生效。'
  }
  if (isGuest.value) return '游客提交无需登录（同一 IP 每天限 1 条），通过人机校验即可提交；通过管理员审核后公开展示。'
  if (isAdmin.value) return '管理员发布将直接上线，无需审核。'
  if (isEdit.value) return '作者编辑即刻生效；通告曾被驳回时会重新进入待审队列。'
  return '提交后由管理员审核，通过后公开展示。'
})
const submitLabel = computed(() => {
  if (isProposal.value) return '提交修改建议'
  return isEdit.value ? '保存修改' : '提交通告'
})

/** 与 server/utils/token-deals.ts 的 DEAL_PATCHABLE 对应（顺序也一致，决定 diff 的展示顺序） */
const PATCHABLE = [
  'provider', 'title', 'url', 'call_url', 'quota', 'models',
  'region', 'quality', 'source_tag', 'category', 'expires_at', 'note',
  'real_name', 'real_name_other',
  // 结构化字段（2026-11-04）：普通用户可写，同样可走建议通道。
  // `featured` 刻意不在其中（仅管理员、且不走建议通道，与 pinned 同口径）。
  'summary', 'limits', 'requirements', 'verify_scope', 'faq',
] as const

const FIELD_LABELS: Record<string, string> = {
  provider: '服务商',
  title: '通告标题',
  url: '领取地址',
  call_url: 'API 调用地址',
  quota: '免费额度',
  models: '支持模型',
  region: '访问区域',
  quality: '品质分级',
  source_tag: '来源标签',
  category: '分类',
  expires_at: '有效期',
  note: '备注',
  real_name: '是否实名',
  real_name_other: '实名方式说明',
  summary: '一句话摘要',
  limits: '限制条款',
  requirements: '领取条件',
  verify_scope: '核实范围',
  faq: '常见问题',
}

/** 编辑器里的邀请码草稿；`copy_count` / `exhausted` 来自服务端，只读回显 */
interface InviteCodeDraft {
  id?: number
  code: string
  label: string
  weight: number
  copyLimit: number
  enabled?: boolean
  copy_count?: number
  exhausted?: boolean
}

/**
 * 状态草稿（2026-11-04）：与 form 分开管理，因为状态不走同一套 PUT
 * （那条是全量替换字段，状态有独立的 /state 端点，语义不同）。
 */
const stateDraft = ref<DealState>('pending')
const stateOriginal = ref<DealState>('pending')
const stateChanged = computed(() => stateDraft.value !== stateOriginal.value)

const form = ref({
  provider: '',
  title: '',
  url: '',
  call_url: '',
  quota: '',
  models: [] as string[],
  region: 'cn',
  quality: '中品',
  source_tag: 'official',
  category: 'token',
  note: '',
  /** 是否实名（2026-10-30）：'' = 未标注 */
  real_name: '',
  /** 「其他」的手填文案：real_name !== 'other' 时提交前会被清空（与服务端同一规则） */
  real_name_other: '',
  // ── 结构化字段（2026-11-04，均对应服务端新增列）──
  /** 一句话摘要（≤200） */
  summary: '',
  /** 限制条款（≤2000，富文本由服务端渲染） */
  limits: '',
  /** 领取条件（≤2000，富文本由服务端渲染） */
  requirements: '',
  /** 核实范围说明（≤500） */
  verify_scope: '',
  /** FAQ 草稿（≤10 条，单条 q ≤100 / a ≤600） */
  faq: [] as Array<{ q: string; a: string }>,
  /** 精选对比：仅管理员可见可写（与 pinned 同口径），普通用户不渲染该开关 */
  featured: false,
  /** 邀请码池（2026-10-30）：全量提交，服务端做全量替换 */
  inviteCodes: [] as InviteCodeDraft[],
})

const modelDraft = ref('')
const expiresDate = ref('')
const saving = ref(false)
const errorText = ref('')
const comment = ref('')

// ── 模型清单拉取（2026-10-30）──
// API Key 只随本次请求出站，不落库；部分平台不填 key 即可拉到模型
const modelApiKey = ref('')
const modelFetching = ref(false)
const modelFetchError = ref('')
const modelFetchNote = ref('')
const fetchedModels = ref<string[]>([])

// ── 邀请码（2026-10-30）──
/**
 * 码池是否成功读回。
 *
 * `PUT /:id/invite-codes` 是**全量替换**语义，所以「读失败」与「真的是空池」
 * 必须能区分开：2026-10-30 审查指出，原先 `loadInviteCodes` 在 catch 里把列表置空，
 * 用户只改个标题点保存就会 `PUT {codes: []}`，**整池连同 copy_count 被静默删除**。
 */
const inviteCodesLoaded = ref(false)
const inviteCodesError = ref('')

// ── 游客身份（isGuest 时生效）──
const guestNickname = ref('')
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
  isGuest.value && (challengeProvider.value !== 'turnstile' || challengeFailed.value || !turnstileToken.value),
)

/**
 * 获取人机校验方式（fail-closed）。
 * Turnstile 已配置 → 渲染挂件；未配置/已关闭 → 游客通道关闭，直接提示不可提交。
 * 没有算术题降级：挂件失败就挡住提交，不给刷量脚本留旁路。
 */
async function loadChallenge() {
  turnstileToken.value = ''
  challengeFailed.value = false
  challengeNote.value = ''
  challengeRetryable.value = false
  try {
    const res = await $fetch<any>('/api/token-deals/guest-challenge')
    if (res?.provider === 'turnstile') {
      challengeProvider.value = 'turnstile'
      turnstileSiteKey.value = String(res.site_key || '')
    } else {
      challengeProvider.value = 'disabled'
      challengeDisabledText.value = res?.message || '人机校验未启用，暂不接受游客提交'
    }
  } catch {
    challengeProvider.value = 'disabled'
    challengeDisabledText.value = '人机校验配置获取失败，请刷新页面重试'
    challengeRetryable.value = true
  }
}

function onTurnstileSuccess(token: string) {
  turnstileToken.value = token
  challengeNote.value = ''
  challengeFailed.value = false
}

/** 令牌 300s 过期：提示重新验证（挂件会自动重置） */
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

/** 令牌一次性：提交后必须重置换新，否则重试必然报「已过期」 */
function resetTurnstile() {
  turnstileToken.value = ''
  turnstileRef.value?.reset?.()
}

/** 打开时的原始值 —— 提案模式据此算 diff，只提交被改动的字段 */
const original = ref<Record<string, any>>({})

function toDateInput(ts?: number | null) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 日期 → 当日 23:59:59 的本地时间戳，避免「当天就显示已过期」 */
function toExpiresAt(value: string): number | null {
  if (!value) return null
  const ts = new Date(`${value}T23:59:59`).getTime()
  return Number.isFinite(ts) ? ts : null
}

/** 表单当前值摊平成与 patch 同形（snake_case） */
function currentPatch(): Record<string, any> {
  const f = form.value
  return {
    provider: f.provider.trim(),
    title: f.title.trim(),
    url: f.url.trim(),
    call_url: f.call_url.trim(),
    quota: f.quota.trim(),
    models: [...f.models],
    region: f.region,
    quality: f.quality,
    source_tag: f.source_tag,
  category: f.category || 'token',
    expires_at: toExpiresAt(expiresDate.value),
    note: f.note.trim(),
    real_name: f.real_name,
    // 与服务端 `normalizeRealName` 同一规则：非「其他」时文案一律为空
    // （这里先清空，提案模式的 diff 才不会把一句残留文案当成改动提交上去）
    real_name_other: f.real_name === 'other' ? f.real_name_other.trim() : '',
    // 结构化字段（2026-11-04）
    summary: f.summary.trim(),
    limits: f.limits.trim(),
    requirements: f.requirements.trim(),
    verify_scope: f.verify_scope.trim(),
    faq: faqForSubmit(f.faq),
    // ⚠️ 刻意**不含** `featured`：仅管理员可写，且与 pinned 同口径不走建议通道。
    // 直接编辑路径在 submit() 里按 isAdmin 补上，避免普通用户提交时被服务端拒。
  }
}

/**
 * FAQ 草稿 → 提交形态。
 *
 * 只丢掉「问题与答案都为空」的整行（用户点了「添加一条」又没填是常态）；
 * 只填了一半的行原样提交，让服务端返回「FAQ 每项必须同时填写…」的明确中文错误，
 * 而不是在这里静默吞掉用户输入。
 */
function faqForSubmit(list: Array<{ q: string; a: string }>): Array<{ q: string; a: string }> {
  return (Array.isArray(list) ? list : [])
    .map(it => ({ q: String(it?.q ?? '').trim(), a: String(it?.a ?? '').trim() }))
    .filter(it => it.q || it.a)
}

/** 值语义比较（models 按数组比，expires_at 把 undefined 归一成 null） */
function sameValue(a: any, b: any) {
  const na = a === undefined ? null : a
  const nb = b === undefined ? null : b
  return JSON.stringify(na) === JSON.stringify(nb)
}

/** 改动清单 —— 提案模式据此展示与提交 */
const changedFields = computed(() => {
  if (!isProposal.value) return []
  const cur = currentPatch()
  const out: Array<{ field: string; label: string; from: any; to: any }> = []
  for (const key of PATCHABLE) {
    const prev = original.value[key] ?? null
    const next = cur[key] ?? null
    if (!sameValue(prev, next)) {
      out.push({ field: key, label: FIELD_LABELS[key] || key, from: prev, to: next })
    }
  }
  return out
})

/** diff 展示用：把枚举值与时间戳渲染成人话 */
function displayValue(field: string, value: any): string {
  // 是否实名的空串是「未标注」，不是「空」，先于下面那条空值兜底处理
  if (field === 'real_name') return REAL_NAME_LABELS[String(value ?? '')] ?? String(value ?? '')
  if (value === null || value === undefined || value === '') return '（空）'
  if (field === 'models') return Array.isArray(value) && value.length ? value.join('、') : '（空）'
  // FAQ 是 {q,a}[]：diff 里只列问题，答案太长会把面板撑爆
  if (field === 'faq') {
    if (!Array.isArray(value) || value.length === 0) return '（空）'
    return value.map((it: any) => String(it?.q ?? '')).filter(Boolean).join('；') || '（空）'
  }
  if (field === 'region') return REGION_LABELS[value] || String(value)
  if (field === 'source_tag') return SOURCE_LABELS[value] || String(value)
  if (field === 'expires_at') {
    const ts = Number(value)
    if (!Number.isFinite(ts)) return String(value)
    return new Date(ts).toLocaleDateString('zh-CN')
  }
  return String(value)
}

function addModel() {
  const name = modelDraft.value.trim().replace(/,$/, '')
  modelDraft.value = ''
  if (!name) return
  if (form.value.models.length >= LIMITS.models) return
  if (form.value.models.includes(name)) return
  form.value.models.push(name.slice(0, LIMITS.modelName))
}

function removeModel(index: number) {
  form.value.models.splice(index, 1)
}

// ── FAQ 草稿增删（2026-11-04）──
function addFaq() {
  if (form.value.faq.length >= LIMITS.faq) return
  form.value.faq.push({ q: '', a: '' })
}

function removeFaq(index: number) {
  form.value.faq.splice(index, 1)
}

function close() {
  emit('close')
}

function onBackdrop() {
  close()
}

async function submit() {
  errorText.value = ''
  addModel()

  const f = form.value
  if (!f.provider.trim()) { errorText.value = '服务商名称不能为空'; return }
  if (!f.title.trim()) { errorText.value = '通告标题不能为空'; return }
  if (!f.url.trim()) { errorText.value = '领取地址不能为空'; return }

  const cur = currentPatch()

  // ── 建议修改：只提交被改动的字段 ──
  if (isProposal.value) {
    const changed = changedFields.value
    if (changed.length === 0) {
      errorText.value = '还没有任何改动，请先修改要建议的字段'
      return
    }
    const patch: Record<string, any> = {}
    for (const c of changed) patch[c.field] = cur[c.field]

    saving.value = true
    try {
      const res = await $fetch<{ success: boolean; created: boolean; message?: string }>(
        `/api/token-deals/${props.deal!.id}/edits`,
        {
          method: 'POST',
          body: { ...patch, comment: comment.value.trim() },
          credentials: 'include',
        },
      )
      emit('saved', res?.message || '修改建议已提交，等待审核')
    } catch (err: any) {
      errorText.value = err?.data?.error || err?.message || '提交失败，请稍后重试'
    } finally {
      saving.value = false
    }
    return
  }

  // ── 发布 / 编辑自己的通告（游客走同一端点的游客通道）──
  if (isGuest.value) {
    if (!guestNickname.value.trim()) { errorText.value = '请填写昵称'; return }
    if (challengeProvider.value === 'disabled') {
      errorText.value = challengeDisabledText.value || '人机校验未启用，暂不接受游客提交'
      return
    }
    if (challengeFailed.value) { errorText.value = '人机验证未就绪，请点击「重新加载验证」'; return }
    if (!turnstileToken.value) { errorText.value = '请先完成人机验证'; return }
  }

  saving.value = true
  try {
    const body: Record<string, any> = { ...cur }
    if (isGuest.value) {
      body.nickname = guestNickname.value.trim()
      body.turnstile_token = turnstileToken.value
    }
    // 精选对比：仅管理员可写（与 pinned 同口径）。普通用户**不传**这个字段 ——
    // 传了要么被忽略要么被 403，白白把一次正常保存变成报错。
    if (isAdmin.value) body.featured = form.value.featured ? 1 : 0

    const res = await $fetch<{ success: boolean; message?: string }>(
      isEdit.value ? `/api/token-deals/${props.deal!.id}` : '/api/token-deals',
      {
        method: isEdit.value ? 'PUT' : 'POST',
        body,
        credentials: 'include',
      },
    )

    // 邀请码（2026-10-30）：独立资源，主表保存成功后再**全量提交**码池。
    // 失败时不发 saved 事件 —— 通告内容已入库但这块没存上，
    // 静默关窗会让用户以为全部成功。
    // inviteCodesLoaded 为假 ⇒ 码池没读回来，**跳过这一笔**：
    // PUT 是全量替换，提交空数组会把现有码池连同 copy_count 一起删掉
    if (canEditInviteCodes.value && props.deal?.id && inviteCodesLoaded.value) {
      const codes = form.value.inviteCodes
        .map(c => ({
          code: c.code.trim(),
          label: c.label.trim(),
          weight: Number(c.weight) || 1,
          copyLimit: Number(c.copyLimit) || 0,
          // 沿用读回来的启用状态，不要硬编码 true ——
          // 否则被停用的码会在下一次保存时被静默复活
          enabled: c.enabled !== false,
        }))
        .filter(c => c.code)

      try {
        await $fetch(`/api/token-deals/${props.deal.id}/invite-codes`, {
          method: 'PUT',
          body: { codes },
          credentials: 'include',
        })
      } catch (err: any) {
        errorText.value = err?.data?.error || '通告已保存，但邀请码保存失败，请重试'
        return
      }
    }

    // ── 状态变更（2026-11-04）──
    // 走独立端点：主表 PUT 是全量替换字段，状态有自己的流转规则与权限
    // （作者只能提交审核/下架，管理员才能发布）。两者语义不同，不能并进一次请求。
    if (isAdmin.value && isEdit.value && stateChanged.value && props.deal?.id) {
      try {
        await $fetch(`/api/admin/token-deals/${props.deal.id}/state`, {
          method: 'PUT',
          body: { state: stateDraft.value },
          credentials: 'include',
        })
      } catch (err: any) {
        // 内容已存但状态没改 —— 必须说清楚，否则用户以为状态也变了
        errorText.value = `内容已保存，但状态修改失败：${err?.data?.error || err?.message || '未知错误'}`
        return
      }
    }

    emit('saved', res?.message || '')
  } catch (err: any) {
    const errMsg = String(err?.data?.error || '')
    errorText.value = errMsg || err?.message || '提交失败，请稍后重试'
    // 令牌一次性：失败也必须换新，否则用户点重试必然又报过期
    resetTurnstile()
    if (errMsg.includes('人机验证')) challengeNote.value = errMsg
  } finally {
    saving.value = false
  }
}

/**
 * 从通告的 API 地址拉取模型清单（2026-10-30）
 *
 * 走**服务端代理**而非浏览器直连，原因有二：
 *   1. 中转站基本不带 CORS 头，浏览器直连必然被拦；
 *   2. SSRF 校验（内网地址 / DNS rebinding / 重定向重校验）只能在服务端做。
 * 拉回来的模型**不自动选中** —— 需求是「手动点击选择」。
 */
async function fetchModels() {
  modelFetchError.value = ''
  modelFetchNote.value = ''
  fetchedModels.value = []

  const callUrl = form.value.call_url.trim()
  if (!callUrl) {
    modelFetchError.value = '请先填写 API 地址'
    return
  }

  modelFetching.value = true
  try {
    const res = await $fetch<{
      data: { models: string[]; count: number; truncated: boolean }
    }>('/api/token-deals/fetch-models', {
      method: 'POST',
      body: { call_url: callUrl, api_key: modelApiKey.value.trim() || undefined },
      credentials: 'include',
    })

    fetchedModels.value = res?.data?.models || []
    modelFetchNote.value = fetchedModels.value.length
      ? `获取到 ${fetchedModels.value.length} 个模型${res?.data?.truncated ? '（已达上限，仅显示前 500 个）' : ''}，点击下方勾选`
      : '该地址没有返回模型'
  } catch (err: any) {
    modelFetchError.value = err?.data?.error || err?.message || '获取模型失败'
  } finally {
    modelFetching.value = false
  }
}

/** 点击勾选 / 取消勾选拉取到的模型 */
function toggleFetchedModel(name: string) {
  const idx = form.value.models.indexOf(name)
  if (idx >= 0) {
    form.value.models.splice(idx, 1)
    return
  }
  if (form.value.models.length >= LIMITS.models) {
    modelFetchError.value = `最多选择 ${LIMITS.models} 个模型`
    return
  }
  form.value.models.push(name)
}

// ── 邀请码编辑 ──

function addInviteCode() {
  if (form.value.inviteCodes.length >= LIMITS.inviteCodes) return
  form.value.inviteCodes.push({ code: '', label: '', weight: 1, copyLimit: 0 })
}

function removeInviteCode(index: number) {
  form.value.inviteCodes.splice(index, 1)
}

/** 读回既有码池（仅编辑既有通告时有意义；失败时**锁住编辑**，见 inviteCodesLoaded 的说明） */
async function loadInviteCodes() {
  inviteCodesLoaded.value = false
  inviteCodesError.value = ''
  if (!canEditInviteCodes.value || !props.deal?.id) return
  try {
    const res = await $fetch<{
      data: {
        codes: Array<{
          id: number
          code: string
          label: string
          weight: number
          copy_limit: number
          copy_count: number
          enabled: boolean
          exhausted: boolean
        }>
      }
    }>(`/api/token-deals/${props.deal.id}/invite-codes`, { credentials: 'include' })

    form.value.inviteCodes = (res?.data?.codes || []).map(c => ({
      id: c.id,
      code: c.code,
      label: c.label || '',
      weight: Number(c.weight) > 0 ? Number(c.weight) : 1,
      copyLimit: Number(c.copy_limit) || 0,
      enabled: c.enabled !== false,
      copy_count: Number(c.copy_count) || 0,
      exhausted: !!c.exhausted,
    }))
    inviteCodesLoaded.value = true
  } catch (err: any) {
    // 只读失败不改数据：保持清空但**标记未加载**，submit 会跳过码池那一笔 PUT
    inviteCodesError.value = err?.data?.error
      || '邀请码列表加载失败。为避免误删现有邀请码，本次保存不会改动邀请码，请关闭后重试。'
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

let prevOverflow = ''

onMounted(() => {
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)

  const d = props.deal
  if (d) {
    // 状态回填（2026-11-04）：从 deal 读当前 state 作为草稿起点。
    // 兼容老数据：若后端还没给 state（旧快照/缓存），按 status + 标记推断，
    // 免得下拉默认停在「待审核」而在保存时把一条线上条目误降级。
    const raw = (d as any).state
      || ((d as any).deleted_at ? 'deleted'
        : (d as any).invalid_at ? 'invalid'
        : (d as any).status === 'rejected' ? 'rejected'
        : (d as any).status === 'pending' ? 'pending'
        : 'published')
    stateOriginal.value = raw as DealState
    stateDraft.value = raw as DealState

    form.value = {
      provider: d.provider || '',
      title: d.title || '',
      url: d.url || '',
      call_url: d.call_url || '',
      quota: d.quota || '',
      models: [...(d.models || [])],
      region: d.region || 'cn',
      quality: d.quality || '中品',
      source_tag: d.source_tag || 'official',
      // 2026-10-30 修：此前漏了 category 回填，表单默认值 'token' 会被原样提交，
      // 导致编辑一条「免费云服务器 / 客户端额度」通告时分类被静默改回 API 额度
      category: d.category || 'token',
      note: d.note || '',
      real_name: d.real_name || '',
      real_name_other: d.real_name_other || '',
      // 结构化字段（2026-11-04）：旧数据没有这些列 → 一律回落到空值，编辑器照常可用
      summary: d.summary || '',
      limits: d.limits || '',
      requirements: d.requirements || '',
      verify_scope: d.verify_scope || '',
      faq: Array.isArray(d.faq)
        ? d.faq.map(it => ({ q: String(it?.q ?? ''), a: String(it?.a ?? '') }))
        : [],
      featured: Number(d.featured || 0) === 1,
      inviteCodes: [],
    }
    expiresDate.value = toDateInput(d.expires_at)
  }

  // 快照原始值 —— 提案模式据此算 diff（必须放在表单填充之后）
  original.value = currentPatch()

  // 邀请码：独立资源（详情接口不下发码池），单独拉取
  void loadInviteCodes()

  // 游客模式：预取人机校验方式（Turnstile 挂件 / 通道关闭），省去一次手动点击
  if (isGuest.value) loadChallenge()
})

onUnmounted(() => {
  document.body.style.overflow = prevOverflow
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.tde-backdrop {
  position: fixed;
  inset: 0;
  /* 高于移动端底部导航（9998）：移动端是贴底 sheet，避免底部按钮被底栏压住 */
  z-index: 10060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
  animation: modal-fade 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tde-modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  max-height: 88vh;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: modal-in 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tde-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 0.5px solid var(--divider);
}
.tde-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.tde-title i { font-size: 17px; color: var(--primary); }
.tde-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tde-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-tertiary);
  font-size: 17px;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tde-close:hover { background: var(--surface-hover); color: var(--text-primary); }
.tde-close:active { background: var(--surface-active); }
.tde-close:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.tde-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.tde-group {
  border: none;
  margin: 0 0 16px;
  padding: 0;
}
.tde-group:last-of-type { margin-bottom: 0; }
.tde-legend {
  padding: 0;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.tde-field {
  display: block;
  position: relative;
  margin-bottom: 12px;
}
.tde-field:last-child { margin-bottom: 0; }
.field-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.field-label em {
  color: var(--danger);
  font-style: normal;
}
.tde-field input[type="text"],
.tde-field input[type="url"],
.tde-field input[type="date"],
.tde-field textarea {
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
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tde-field textarea { resize: vertical; }
.tde-field input:focus,
.tde-field textarea:focus { border-color: var(--border-focus); }
.tde-field input::placeholder,
.tde-field textarea::placeholder { color: var(--text-tertiary); }
.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}
/* 字段提示里内嵌的占位符示例（如 {邀请码}），与正文区分开但不抢眼 */
.tde-code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--surface-hover);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

/* ── FAQ 草稿行（2026-11-04）── */
.faq-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
}
.faq-row-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
/* 行首留 8px 上边距是为了和输入框视觉对齐 —— 删除按钮本身不参与输入区 */
.faq-remove {
  flex-shrink: 0;
  margin-top: 6px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.faq-remove:hover {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}
.faq-remove:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.faq-add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 0.5px dashed var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.faq-add:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-light);
}
.faq-add:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  padding: 4px 12px;
  font-size: 13px;
  border-radius: 999px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.chip:hover { background: var(--surface-hover); color: var(--text-primary); }
.chip:active { background: var(--surface-active); }
.chip:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.chip.active {
  background: var(--primary-light);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 500;
}

.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
  min-height: 40px;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tag-input:focus-within { border-color: var(--border-focus); }
.tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px 3px 9px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
}
.tag-remove {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 0;
  font-size: 13px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tag-remove:hover { color: var(--danger); }
.tag-remove:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tag-field {
  flex: 1;
  min-width: 130px;
  border: none;
  outline: none;
  background: none;
  font-size: 12px;
  color: var(--text-primary);
}
.tag-field::placeholder { color: var(--text-tertiary); }

.tde-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 12px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

/* 建议修改：改动清单 */
.tde-diff {
  margin-top: 4px;
  padding: 10px 12px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
}
.tde-diff-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.tde-diff-head i { color: var(--primary); font-size: 14px; }
.tde-diff-head strong { color: var(--primary); font-weight: 600; }
.tde-diff-empty {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tde-diff-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tde-diff-item {
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

.tde-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 0.5px solid var(--divider);
  background: var(--surface-raised);
}
.tde-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 18px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tde-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.tde-btn:active:not(:disabled) { background: var(--surface-active); }
.tde-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tde-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.tde-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--text-inverse);
}
.tde-btn.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.tde-btn.primary:active:not(:disabled) { background: var(--primary-dark); border-color: var(--primary-dark); }
.spin { animation: modal-spin 1s linear infinite; }

/* ── 模型拉取（2026-10-30）─────────────────────────────────── */
.model-fetch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.model-fetch-key {
  flex: 1;
  min-width: 0;
}
.model-picker {
  margin: 6px 0 10px;
  padding: 8px 10px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
}
.model-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.model-picker-close {
  border: none;
  background: none;
  padding: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.model-picker-close:hover { color: var(--text-primary); }
.model-picker-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 168px;
  overflow-y: auto;
}
.model-pick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 0.5px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.16s, color 0.16s, border-color 0.16s;
}
.model-pick:hover { border-color: var(--border-focus); color: var(--text-primary); }
.model-pick.selected {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
}
/* 拉取失败提示：与普通 hint 区分（红色） */
.field-hint.is-err { color: var(--danger, #ef4444); }

/* ── 邀请码（2026-10-30）───────────────────────────────────── */
.tde-hint {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
.invite-edit-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.invite-input {
  flex: 1 1 220px;
  min-width: 0;
}
.invite-input.is-small { flex: 0 1 140px; }
.invite-num {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.invite-num input {
  width: 78px;
  padding: 6px 8px;
  border: 0.5px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
}
.invite-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0.5px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.16s, color 0.16s, border-color 0.16s;
}
.invite-remove:hover {
  border-color: var(--danger, #ef4444);
  color: var(--danger, #ef4444);
}
.invite-used {
  flex-basis: 100%;
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ── 模型拉取结束 ── */

/* 游客身份：人机校验行（Turnstile 挂件 / 未启用提示 / 失败重试） */
.challenge-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.guest-challenge {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
/* 挂件加载失败时的重试入口（fail-closed：失败即挡住提交，不降级） */
.challenge-retry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 0.5px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.challenge-retry:hover { background: var(--surface-hover); color: var(--primary); }
.challenge-retry:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .tde-backdrop { padding: 0; align-items: flex-end; }
  .tde-modal {
    max-width: none;
    max-height: 92vh;
    border-radius: 14px 14px 0 0;
  }
  .tde-foot .tde-btn { flex: 1; justify-content: center; }
  .tde-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
}
</style>
