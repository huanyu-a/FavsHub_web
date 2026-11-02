<template>
  <div class="admin-page">
    <div class="page-header">
      <div>
        <h2>{{ isAdmin ? '🤖 机器人与 API' : '🔑 API 令牌与集成' }}</h2>
        <p class="subtitle">
          {{ isAdmin ? '管理 QQ 官方机器人出站、多群广播、外部订阅生命周期与 AI 助手 API 访问令牌。' : '创建与管理您的个人访问令牌（PAT），供 AI 助手或脚本安全读写数据。' }}
        </p>
      </div>
      <div class="header-actions">
        <button
          v-if="isAdmin && currentTab === 'config'"
          class="btn btn-outline"
          :disabled="testing || !qqBot.qq_bot_enabled"
          @click="sendTestMessage"
        >
          <i :class="testing ? 'ri-loader-4-line ri-spin' : 'ri-send-plane-line'"></i>
          {{ testing ? '发送中...' : '发送测试群消息' }}
        </button>
        <button
          v-else-if="currentTab === 'tokens'"
          class="btn btn-primary btn-sm"
          @click="openCreateToken"
        >
          <i class="ri-add-line"></i> 创建令牌
        </button>
      </div>
    </div>

    <!-- 顶部测试反馈提示条 -->
    <div v-if="testResult" :class="['alert-banner', testResult.success ? 'is-success' : 'is-error']">
      <i :class="testResult.success ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'"></i>
      <div class="alert-content">
        <strong>{{ testResult.success ? '测试成功' : '测试失败' }}：</strong>
        {{ testResult.message || testResult.error }}
        <span v-if="testResult.message_id" class="code-tag">ID: {{ testResult.message_id }}</span>
      </div>
      <button class="alert-close" @click="testResult = null">&times;</button>
    </div>

    <!-- 全局操作消息 -->
    <div v-if="pageMessage" :class="['alert-banner', pageMessageType === 'error' ? 'is-error' : 'is-success']">
      <i :class="pageMessageType === 'error' ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'"></i>
      <div class="alert-content">{{ pageMessage }}</div>
      <button class="alert-close" @click="pageMessage = ''">&times;</button>
    </div>

    <!-- 顶部 Tab 导航 -->
    <div class="tab-nav">
      <button v-if="isAdmin" :class="{ active: currentTab === 'config' }" @click="switchTab('config')">
        <i class="ri-settings-4-line"></i> 机器人通道配置
      </button>
      <button v-if="isAdmin" :class="{ active: currentTab === 'subs' }" @click="switchTab('subs')">
        <i class="ri-rss-line"></i> 外部订阅管理<span v-if="subCounts.active" class="tab-badge">{{ subCounts.active }}</span>
      </button>
      <button :class="{ active: currentTab === 'tokens' }" @click="switchTab('tokens')">
        <i class="ri-key-2-line"></i> API 令牌 (PAT)<span v-if="tokens.length" class="tab-badge">{{ tokens.length }}</span>
      </button>
      <button :class="{ active: currentTab === 'guide' }" @click="switchTab('guide')">
        <i class="ri-book-open-line"></i> 接入说明
      </button>
    </div>

    <!-- ══════════════════════════════════════════════════════
         TAB 1: 机器人通道配置
         ══════════════════════════════════════════════════════ -->
    <div v-if="currentTab === 'config'" class="config-grid">
      <!-- 卡片 1：基础开关与出站方式 -->
      <div class="card">
        <div class="card-header">
          <h3>出站通道与总开关</h3>
          <span class="status-badge" :class="qqBot.qq_bot_enabled ? 'is-active' : 'is-disabled'">
            {{ qqBot.qq_bot_enabled ? '已启用' : '已暂停' }}
          </span>
        </div>
        <div class="card-body">
          <div class="toggle-row">
            <div>
              <label>启用机器人通知</label>
              <small>开启后，新发布的通告、审核通过、到期续期与下架事件将自动广播到配置的目标群。</small>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="qqBot.qq_bot_enabled" @change="saveConfig">
              <span class="slider"></span>
            </label>
          </div>

          <div class="fg" style="margin-top: 16px;">
            <label>出站传输通道</label>
            <select v-model="qqBot.qq_bot_transport" @change="saveConfig">
              <option value="official">QQ 官方 OpenAPI（推荐 · 无状态直连 · 零封号风险）</option>
              <option value="outbox">Hermes outbox（服务器队列 · 需本地安装 Hermes CLI）</option>
              <option value="onebot">OneBot 11 HTTP API（NapCat 第三方协议）</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 卡片 2：QQ 官方机器人直连配置（当 transport === 'official' 时主显示） -->
      <div class="card" v-if="qqBot.qq_bot_transport === 'official'">
        <div class="card-header">
          <h3>QQ 官方机器人直连参数（API v2）</h3>
          <span class="channel-tag">腾讯官方通道</span>
        </div>
        <div class="card-body">
          <div class="notice-box is-info">
            <div class="notice-title"><i class="ri-information-line"></i> 腾讯开放平台接入要点</div>
            <ul class="notice-list">
              <li><strong>主动发言权限（核心）</strong>：将机器人加入 QQ 群后，<strong>群主必须在手机 QQ 进群设置 → 机器人 → 打开【机器人主动在群聊内发言】</strong>，否则接口会返回 <code>40034105</code> 权限拒绝。</li>
              <li><strong>配额与频控</strong>：单群每日最多接收 <strong>1000 条</strong>主动消息，单群频控 <strong>20 次/分钟</strong>，Bot 维度 30~60 次/分钟。</li>
              <li><strong>网址安全规范</strong>：若消息内包含域名链接，平台风控可能会拦截（<code>304003</code> / <code>40054010</code>），系统已内置自动剥离 URL 降级纯文本兜底重发机制，确保通知必达。</li>
            </ul>
          </div>

          <div class="fg">
            <label>机器人 AppID <span class="required">*</span></label>
            <input v-model="qqBot.qq_bot_appid" placeholder="如 1900000000 或多机器人 JSON 配置" @input="saveConfig">
            <small>QQ 开放平台后台的 AppID。支持填写单个 AppID，或填写多机器人配置 JSON 数组。</small>
          </div>

          <div class="fg">
            <label>机器人 AppSecret <span class="required">*</span></label>
            <input v-model="qqBot.qq_bot_app_secret" type="password" placeholder="留空表示保持当前已保存的 Secret" @focus="onQqSecretFocus" @input="saveConfig">
            <small>用于向腾讯服务器换取 7200 秒 access_token，以及入站 Webhook 的 Ed25519 签名验证。仅服务端存储，前台脱敏回显。</small>
          </div>

          <div class="fg">
            <label>通知目标群（群 OpenID）<span class="required">*</span></label>
            <input v-model="qqBot.qq_bot_group_id" placeholder="如 37BC1D07...,44BC2E07...（支持逗号分隔多个群 OpenID，兼容 qqbot: 前缀）" @input="saveConfig">
            <small>与该 AppID 绑定的群 OpenID。支持<strong>逗号、分号分隔多个群同时广播</strong>；自动识别并剥离 <code>qqbot:</code> 前缀，自动过滤非 QQ 协议。</small>
          </div>

          <div class="fg">
            <label>管理员提醒目标（用户 OpenID）</label>
            <input v-model="qqBot.qq_admin_qq" placeholder="如 C3DB769D...,USER_OPENID_2（支持逗号分隔多个用户 OpenID）" @input="saveConfig">
            <small>有普通用户或游客提交新通告时，机器人会通过官方私聊接口主动向这批管理员 OpenID 发送待审提醒。留空则仅在群内提醒。</small>
          </div>

          <!-- Webhook 回调地址说明 -->
          <div class="webhook-panel">
            <div class="webhook-title">
              <i class="ri-links-line"></i> <strong>官方 Webhook 回调地址（用于群内 @ 指令与被动回复）</strong>
            </div>
            <div class="copy-bar">
              <code>{{ webhookUrl }}</code>
              <button class="btn-copy" @click="copyText(webhookUrl)">{{ copiedWebhook ? '已复制' : '复制地址' }}</button>
            </div>
            <small style="color: var(--n-text-color-3, #777); display: block; margin-top: 6px;">
              前往 QQ 开放平台 → 开发设置 → 填入此回调地址。配置后，群成员在群内 <code>@机器人</code>（例如输入 <code>/帮助</code>、<code>/通告</code>）系统可自动被动回复，同时能快速在日志中捕获该群的 <code>group_openid</code>。
            </small>
          </div>

          <!-- 多机器人配置折叠说明 -->
          <div class="toggle-details">
            <div class="details-summary" @click="showMultiBotHelp = !showMultiBotHelp">
              <i :class="showMultiBotHelp ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"></i>
              <span>多 QQ 机器人实例配置说明（进阶高级用法）</span>
            </div>
            <div v-if="showMultiBotHelp" class="details-body">
              <p>如果您的业务需要挂载多个不同的 QQ 机器人（例如：Bot A 负责主群，Bot B 负责测试群/VIP 群），您只需在上方 <strong>机器人 AppID</strong> 输入框中直接粘贴 JSON 数组：</p>
              <pre><code>[
  {
    "appId": "1900000001",
    "appSecret": "你的Secret1",
    "groups": ["群OpenID_A", "群OpenID_B"]
  },
  {
    "appId": "1900000002",
    "appSecret": "你的Secret2",
    "groups": ["群OpenID_C"]
  }
]</code></pre>
              <small>系统会自动对每个机器人账号进行独立的 Token 换取与并发隔离，并根据入站请求的 <code>X-Bot-Appid</code> 自动匹配密钥验签。</small>
            </div>
          </div>
        </div>
      </div>

      <!-- 卡片 3：Hermes outbox 配置（当 transport === 'outbox' 时展示） -->
      <div class="card" v-if="qqBot.qq_bot_transport === 'outbox'">
        <div class="card-header"><h3>Hermes outbox 文件队列配置</h3></div>
        <div class="card-body">
          <p class="hint">经服务器本地 Hermes CLI 异步投递：应用程序把消息写入本地队列目录，宿主机定时任务（crontab）调用 <code>hermes send</code> 完成多协议投递。</p>
          <div class="fg">
            <label>队列目录（spool）</label>
            <input v-model="qqBot.qq_outbox_path" placeholder="如 /opt/favshub/data/qq-outbox" @input="saveConfig">
            <small>必须为容器内与宿主机共享的挂载目录。留空时回落到环境变量 <code>NUXT_QQ_OUTBOX_DIR/qq-outbox</code>。</small>
          </div>
          <div class="fg">
            <label>通知目标群（群 / 频道）</label>
            <input v-model="qqBot.qq_bot_group_id" placeholder="如 qqbot:37BC…,dingtalk:cid…（逗号分隔多通道）" @input="saveConfig">
            <small>Hermes 目标串；裸 ID 默认按 qqbot 处理。</small>
          </div>
          <div class="fg">
            <label>主人提醒目标（私聊）</label>
            <input v-model="qqBot.qq_admin_qq" placeholder="如 qqbot:C3DB… 或 10001" @input="saveConfig">
            <small>待审通告时单独私聊主人 Hermes 目标。</small>
          </div>
        </div>
      </div>

      <!-- 卡片 4：OneBot 11 配置（当 transport === 'onebot' 时展示） -->
      <div class="card" v-if="qqBot.qq_bot_transport === 'onebot'">
        <div class="card-header"><h3>OneBot 11（NapCat HTTP API）</h3></div>
        <div class="card-body">
          <p class="hint">通过 NapCat / OneBot 11 协议机器人发送群通知。需在服务端环境变量配置 <code>NUXT_QQ_BOT_HTTP_URL</code> 指向机器人 HTTP 接口地址。</p>
          <div class="fg">
            <label>通知目标 QQ 群号</label>
            <input v-model="qqBot.qq_bot_group_id" placeholder="如 123456789" @input="saveConfig">
          </div>
          <div class="fg">
            <label>管理员 QQ 号</label>
            <input v-model="qqBot.qq_admin_qq" placeholder="如 10001" @input="saveConfig">
            <small>待审通知中在群内 @ 此 QQ 号。</small>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════
         TAB 2: 外部订阅管理
         ══════════════════════════════════════════════════════ -->
    <div v-else-if="currentTab === 'subs'" class="card">
      <div class="card-header">
        <h3>外部机器人订阅凭证与拉取状态</h3>
        <div style="display: flex; align-items: center; gap: 8px;">
          <select v-model="subStatus" class="search-input" style="width: 120px;" @change="subPage = 1; loadSubs()">
            <option value="all">全部状态</option>
            <option value="active">生效中</option>
            <option value="paused">已暂停</option>
            <option value="revoked">已退订</option>
          </select>
          <button class="btn btn-ghost btn-sm" :disabled="subsLoading" @click="loadSubs">刷新</button>
          <button class="btn btn-ghost btn-sm" :disabled="eventsLoading" @click="toggleEvents">
            {{ showEvents ? '收起事件' : '最近事件' }}
          </button>
        </div>
      </div>

      <p class="card-hint">
        站点<b>不主动外呼投递</b>：由访客或合作群主的本地 Hermes 定时轮询拉取 <code>/api/token-deals/changes</code>（或原生订阅
        <code>/api/token-deals/feed.atom</code>），再由其本机 <code>hermes send</code> 到对应 QQ 群。
        这里监控凭证状态与最近来拉时间 —— 超过 3 天未请求将标记为「静默」。
      </p>

      <div class="sub-stats">
        <span class="sub-stat"><b>{{ subCounts.active }}</b> 生效中</span>
        <span class="sub-stat"><b>{{ subCounts.paused }}</b> 已暂停</span>
        <span class="sub-stat"><b>{{ subCounts.revoked }}</b> 已退订</span>
      </div>

      <div v-if="subsLoading" class="empty-state">加载中...</div>
      <div v-else-if="subs.length === 0" class="empty-state">暂无外部机器人订阅</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 130px;">备注</th>
              <th style="width: 130px;">凭证</th>
              <th>关注内容</th>
              <th style="width: 110px;">状态</th>
              <th style="width: 130px;">拉取记录</th>
              <th style="width: 150px;">最近来拉</th>
              <th style="width: 190px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in subs" :key="s.id">
              <td>{{ s.label || '（未命名）' }}</td>
              <td><code class="sub-token">{{ s.token_masked }}</code></td>
              <td>{{ s.filters_summary }}</td>
              <td>
                <span class="badge" :class="s.status === 'active' ? 'badge-public' : (s.status === 'paused' ? 'badge-pending' : 'badge-private')">
                  {{ SUB_STATUS_LABELS[s.status] || s.status }}
                </span>
                <span v-if="s.stale" class="sub-stale">静默</span>
              </td>
              <td>{{ s.pull_count }} 次 · 游标 {{ s.cursor }}</td>
              <td>{{ formatTime(s.last_pull_at) }}</td>
              <td>
                <button v-if="s.status === 'active'" class="btn btn-ghost btn-sm" :disabled="subBusy" @click="subAction(s, 'pause')">暂停</button>
                <button v-else-if="s.status === 'paused'" class="btn btn-ghost btn-sm" :disabled="subBusy" @click="subAction(s, 'resume')">恢复</button>
                <button v-if="s.status !== 'revoked'" class="btn btn-danger btn-sm" :disabled="subBusy" @click="subAction(s, 'revoke')">撤销</button>
                <button class="btn btn-danger btn-sm" :disabled="subBusy" @click="subAction(s, 'delete')">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="subTotalPages > 1" class="pagination">
        <button :disabled="subPage <= 1" @click="subPage--; loadSubs()">上一页</button>
        <span>第 {{ subPage }} / {{ subTotalPages }} 页（共 {{ subTotal }} 条）</span>
        <button :disabled="subPage >= subTotalPages" @click="subPage++; loadSubs()">下一页</button>
      </div>

      <!-- 最近事件抽屉面板 -->
      <div v-if="showEvents" class="sub-events">
        <h4>最近公开事件（供订阅者消费的数据源）</h4>
        <p class="card-hint">
          排查「某条变化为什么外部没收到」先看这里：没有事件 = 那次变化不满足公开安全边界（未审核 / 已下架 / 无实质差异），非接口故障。
        </p>
        <div v-if="eventsLoading" class="empty-state">加载中...</div>
        <div v-else-if="events.length === 0" class="empty-state">暂无事件</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 70px;">序号</th>
                <th style="width: 90px;">类型</th>
                <th>文案（推送给机器人的纯文本渲染）</th>
                <th style="width: 150px;">时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in events" :key="e.seq">
                <td>{{ e.seq }}</td>
                <td><span class="badge badge-public">{{ e.kind_label }}</span></td>
                <td>{{ e.text }}</td>
                <td>{{ formatTime(e.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════
         TAB 3: API 令牌 (PAT)
         ══════════════════════════════════════════════════════ -->
    <div v-else-if="currentTab === 'tokens'">
      <div class="card">
        <div class="card-header">
          <h3>我的个人访问令牌（PAT）</h3>
          <div>
            <button class="btn btn-primary btn-sm" @click="openCreateToken">创建令牌</button>
            <button class="btn btn-ghost btn-sm" :disabled="tokensLoading" @click="loadTokens">刷新</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>名称</th><th>前缀</th><th>权限范围</th><th>状态</th><th>创建时间</th><th>最后使用</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-if="tokensLoading"><td colspan="7" class="empty-state">加载中...</td></tr>
              <tr v-else-if="tokens.length === 0"><td colspan="7" class="empty-state">还没有令牌，点击右上角「创建令牌」开始</td></tr>
              <tr v-for="t in tokens" :key="t.id">
                <td>{{ t.name }}</td>
                <td><code class="mono">{{ t.prefix }}</code></td>
                <td>
                  <span v-for="s in t.scopes" :key="s" class="badge" :class="scopeBadge(s)">{{ s }}</span>
                </td>
                <td>
                  <span v-if="t.status === 'active'" class="badge badge-public">有效</span>
                  <span v-else-if="t.status === 'expired'" class="badge badge-pending">已过期</span>
                  <span v-else class="badge badge-private">已吊销</span>
                </td>
                <td>{{ formatTime(t.created_at) }}</td>
                <td>{{ t.last_used_at ? formatTime(t.last_used_at) : '从未使用' }}</td>
                <td class="actions">
                  <button v-if="t.status !== 'revoked'" class="btn btn-danger btn-sm" @click="revokeToken(t)">吊销</button>
                  <span v-else style="color:var(--text-tertiary);font-size:12px;">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card card-tips" style="margin-top: 16px;">
        <div class="card-header"><h3>安全与调用说明</h3></div>
        <ul class="tips">
          <li><strong>明文只显示一次</strong>：令牌创建后立即复制保存，站点只存哈希，遗失后无法找回，只能重新创建。</li>
          <li><strong>权限分级</strong>：<code class="mono">read</code> 查询 → <code class="mono">write</code> 创建与更新 → <code class="mono">delete</code> 删除（高等级包含低等级）。</li>
          <li><strong>删除权限仅管理员</strong>：含 <code class="mono">delete</code> 的令牌仅管理员可创建；且删除接口必须携带确认标志。</li>
          <li><strong>数据隔离</strong>：令牌只能操作你本人的数据，无法访问其他账号，也无法访问登录、用户管理等普通接口。</li>
          <li><strong>随时可撤销</strong>：吊销后立即生效；建议为不同用途创建独立令牌，便于单独回收。</li>
        </ul>
        <div class="usage">
          <div class="usage-title">AI 助手 / 脚本调用示例</div>
          <pre class="mono usage-code">curl -H "Authorization: Bearer &lt;你的令牌&gt;" \
  {{ siteUrl }}/api/ai/describe</pre>
          <p class="usage-note">
            首个调用建议访问 <code class="mono">/api/ai/describe</code>，它会返回完整的能力清单与字段字典。
            本站同时原生支持 MCP 协议端点：<code class="mono">{{ siteUrl }}/api/mcp</code>。
          </p>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════
         TAB 4: 接入说明（独立 Tab）
         ══════════════════════════════════════════════════════ -->
    <div v-else-if="currentTab === 'guide'" class="config-grid">
      <!-- 推荐 Hermes 方案 -->
      <div class="card">
        <div class="card-header">
          <h3>🌟 外部群主与游客接入（优先推荐 Hermes 方案）</h3>
          <span class="badge-pill">官方推荐 · 零封号</span>
        </div>
        <div class="card-body">
          <p class="hint">
            其他站长、交流群主或外部访客若想把 FavsHub 的白嫖通告同步推送到他们自己的 QQ 群，<strong>优先推荐使用 Hermes 统一消息中枢方案</strong>。由本机 Hermes 集中管理凭证与多通道投递，具备无可比拟的安全性与便利性：
          </p>

          <div class="channel-compare-grid">
            <div class="compare-item">
              <div class="ci-title"><i class="ri-shield-check-line" style="color: #52c41a;"></i> 零封号风险</div>
              <p>对接腾讯官方开放平台（OpenAPI API v2）或企业通道，全流程合法合规，无第三方协议冻结封号风险。</p>
            </div>
            <div class="compare-item">
              <div class="ci-title"><i class="ri-key-line" style="color: #1890ff;"></i> 本地凭证隔离</div>
              <p>机器人的 AppSecret 仅保存在本机 Hermes 配置中，不向 FavsHub 站点泄漏；FavsHub 仅作为只读数据源。</p>
            </div>
            <div class="compare-item">
              <div class="ci-title"><i class="ri-broadcast-line" style="color: #722ed1;"></i> 多通道一键广播</div>
              <p>支持 QQ 官方机器人、钉钉、飞书等，同一份通告可通过一条 CLI 命令同时推送到多个平台。</p>
            </div>
          </div>

          <div style="margin: 20px 0 12px;">
            <h4 style="margin: 0 0 6px; font-size: 15px;">方式一：Hermes 原生 Feed 订阅（最简单 · 零代码）</h4>
            <p class="hint" style="margin: 0 0 8px;">直接在 Hermes 的订阅管理中添加本站公开 Atom 订阅源，自动定时轮询并广播：</p>
            <div class="code-block-box">
              <pre><code>Feed 地址: {{ siteUrl }}/api/token-deals/feed.atom
投递目标:  qqbot:你的群OpenID（或 dingtalk:Token）
轮询间隔:  推荐 5m 或 10m</code></pre>
            </div>
          </div>

          <div style="margin: 20px 0 12px;">
            <h4 style="margin: 0 0 6px; font-size: 15px;">方式二：Hermes 技能驱动与 CLI 投递（全事件覆盖）</h4>
            <p class="hint" style="margin: 0 0 8px;">
              通过本站公开技能包 <code>favshub-data-ops</code>（<code>{{ siteUrl }}/skills/favshub-data-ops.json</code>），由 Hermes 定时拉取 <code>/api/token-deals/changes</code> 增量事件流，可完整捕获【上新】、【变更】、【续期】与【下架脱敏】等全生命周期事件：
            </p>
            <div class="code-block-box">
              <pre><code># 1. 创建订阅并取得基线游标（免登录，仅需一次）
curl -sS -X POST {{ siteUrl }}/api/deal-subscriptions \
  -H 'content-type: application/json' \
  -d '{"label": "我的QQ群", "filters": {"kinds": ["online", "offline", "updated", "renewed", "pinned"]}}'

# 2. 定时根据游标拉取增量（events[].text 已做好 200 字排版与安全脱敏）
curl -sS "{{ siteUrl }}/api/token-deals/changes?token=你的Token&since=上次游标"

# 3. 通过 Hermes CLI 广播到 QQ 群
hermes send -t qqbot:你的群OpenID "【上新】服务商名称｜某免费额度通告标题..."</code></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- QQ 官方机器人群设置避坑指引 -->
      <div class="card">
        <div class="card-header">
          <h3>QQ 官方机器人群设置避坑指南</h3>
          <span class="channel-tag">关键权限说明</span>
        </div>
        <div class="card-body">
          <div class="notice-box is-error" style="margin-bottom: 16px;">
            <div class="notice-title"><i class="ri-alert-line"></i> 常见错误 40034105：未开启主动发言权限</div>
            <p style="margin: 6px 0 0; line-height: 1.6; font-size: 13px;">
              将机器人拉入 QQ 群后，<strong>群主必须打开手机 QQ 进群设置 → 点击「群机器人」→ 点击你的机器人 → 开启【机器人主动在群聊内发言】</strong>开关。若未开启，腾讯平台会直接拦截主动消息推送并返回此错误。
            </p>
          </div>

          <div class="notice-box is-info">
            <div class="notice-title"><i class="ri-shield-user-line"></i> 频控与安全规范</div>
            <ul class="notice-list" style="margin-top: 6px;">
              <li><strong>频控上限</strong>：单群每日最多接收 <strong>1000 条</strong>主动消息，单群频控 <strong>20 次/分钟</strong>，Bot 维度 30~60 次/分钟。</li>
              <li><strong>网址安全</strong>：如果消息中含有外部链接且未报备（<code>304003</code> / <code>40054010</code>），系统会自动剥离 URL 降级纯文本兜底重发，确保核心通知必达。</li>
              <li><strong>消息防重</strong>：系统自动维护自增 <code>msg_seq</code>，杜绝 <code>40054005</code> 消息去重拦截。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建令牌 Modal 弹窗 -->
    <div v-if="createTokenVisible" :class="['modal-overlay', { active: createTokenVisible }]" @click.self="createTokenVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>创建 API 访问令牌 (PAT)</h3>
          <button class="modal-close" @click="createTokenVisible = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="fg">
            <label>令牌名称</label>
            <input v-model="tokenForm.name" maxlength="64" placeholder="例如：Hermes 机器人 / 数据备份脚本">
          </div>
          <div class="fg">
            <label>权限范围</label>
            <div class="scope-list">
              <label class="scope-item">
                <input type="checkbox" value="read" v-model="tokenForm.scopes">
                <span><strong>read</strong> 查询数据</span>
              </label>
              <label class="scope-item">
                <input type="checkbox" value="write" v-model="tokenForm.scopes">
                <span><strong>write</strong> 创建与更新（含 read）</span>
              </label>
              <label class="scope-item" :class="{ disabled: !isAdmin }">
                <input type="checkbox" value="delete" v-model="tokenForm.scopes" :disabled="!isAdmin">
                <span>
                  <strong>delete</strong> 删除数据（含 read/write）
                  <em v-if="!isAdmin" class="scope-lock">仅管理员可授予</em>
                </span>
              </label>
            </div>
          </div>
          <div class="fg">
            <label>有效期（天，留空表示永久）</label>
            <input v-model="tokenForm.expires_in_days" type="number" min="1" max="3650" placeholder="留空 = 永久有效">
          </div>
          <p v-if="tokenErrorMsg" class="err-msg">{{ tokenErrorMsg }}</p>
          <div class="form-btns">
            <button class="btn btn-ghost" @click="createTokenVisible = false">取消</button>
            <button class="btn btn-primary" :disabled="tokenCreating" @click="submitCreateToken">
              {{ tokenCreating ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 明文令牌展示 Modal 弹窗（仅此一次） -->
    <div v-if="plainTokenVisible" :class="['modal-overlay', { active: plainTokenVisible }]" @click.self="closePlainToken">
      <div class="modal">
        <div class="modal-header">
          <h3>令牌已创建成功</h3>
          <button class="modal-close" @click="closePlainToken">&times;</button>
        </div>
        <div class="modal-body">
          <p class="warn-msg">请立即复制保存。关闭本窗口后，出于安全考虑系统将无法再次查看明文！</p>
          <div class="token-box">
            <code class="mono token-plain">{{ plainToken }}</code>
            <button class="btn btn-primary btn-sm" @click="copyPlainToken">{{ copiedToken ? '已复制' : '复制令牌' }}</button>
          </div>
          <div class="form-btns">
            <button class="btn btn-ghost" @click="closePlainToken">我已妥善保存</button>
          </div>
        </div>
      </div>
    </div>

    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '机器人与 API' })

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}

const siteUrl = ref('https://hao.bx9y.com.cn')
const webhookUrl = computed(() => `${siteUrl.value}/api/bot/qq`)

// ── Tab 切换与路由联动 ──────────────────────────────────────
type BotTab = 'config' | 'subs' | 'tokens' | 'guide'
const currentTab = ref<BotTab>(isAdmin.value ? 'config' : 'tokens')

function switchTab(t: BotTab) {
  if (!isAdmin.value && (t === 'config' || t === 'subs')) {
    t = 'tokens'
  }
  currentTab.value = t
  router.replace({ query: { ...route.query, tab: t } })
  if (t === 'subs' && subs.value.length === 0 && isAdmin.value) loadSubs()
  if (t === 'tokens' && tokens.value.length === 0) loadTokens()
}

// 监听路由 query 变化（支持浏览器前进/后退与同页跳转）
watch(
  () => route.query.tab,
  (newTab) => {
    if (newTab && ['config', 'subs', 'tokens', 'guide'].includes(String(newTab))) {
      let t = newTab as BotTab
      if (!isAdmin.value && (t === 'config' || t === 'subs')) {
        t = 'tokens'
        router.replace({ query: { ...route.query, tab: 'tokens' } })
      }
      currentTab.value = t
      if (t === 'subs' && subs.value.length === 0 && isAdmin.value) loadSubs()
      if (t === 'tokens' && tokens.value.length === 0) loadTokens()
    }
  }
)

// ── 全局与测试消息提示 ──────────────────────────────────────
const pageMessage = ref('')
const pageMessageType = ref<'success' | 'error'>('success')
function showPageMessage(msg: string, type: 'success' | 'error' = 'success') {
  pageMessage.value = msg
  pageMessageType.value = type
  setTimeout(() => { if (pageMessage.value === msg) pageMessage.value = '' }, 4000)
}

const testing = ref(false)
const testResult = ref<{ success: boolean; message?: string; error?: string; message_id?: string } | null>(null)
const copiedWebhook = ref(false)
const showMultiBotHelp = ref(false)

// ── TAB 1：机器人通道配置 ──────────────────────────────────
const qqBot = reactive({
  qq_bot_enabled: false,
  qq_bot_group_id: '',
  qq_admin_qq: '',
  qq_bot_appid: '',
  qq_bot_app_secret: '',
  qq_bot_transport: 'official',
  qq_outbox_path: '',
})

let saveTimer: any = null
function saveConfig() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: {
          data: {
            qq_bot_enabled: String(qqBot.qq_bot_enabled),
            qq_bot_group_id: qqBot.qq_bot_group_id,
            qq_admin_qq: qqBot.qq_admin_qq,
            qq_bot_appid: qqBot.qq_bot_appid,
            qq_bot_app_secret: qqBot.qq_bot_app_secret,
            qq_bot_transport: qqBot.qq_bot_transport,
            qq_outbox_path: qqBot.qq_outbox_path,
          },
        },
      })
      if (qqBot.qq_bot_app_secret) qqBot.qq_bot_app_secret = '已设置'
    } catch (e) {
      console.error('保存 QQ 机器人设置失败', e)
    }
  }, 400)
}

function onQqSecretFocus() {
  if (qqBot.qq_bot_app_secret === '已设置') qqBot.qq_bot_app_secret = ''
}

function copyText(txt: string) {
  if (process.client) {
    navigator.clipboard?.writeText(txt)
    copiedWebhook.value = true
    setTimeout(() => { copiedWebhook.value = false }, 2000)
  }
}

async function sendTestMessage() {
  testing.value = true
  testResult.value = null
  try {
    const res = await $fetch<any>('/api/admin/bot/test', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: {
        text: `🤖 FavsHub 机器人连通性自检测试\n发送时间：${new Date().toLocaleTimeString('zh-CN')}\n当前通道：QQ 官方 OpenAPI 直连\n状态：正常通信中！`,
      },
    })
    testResult.value = res
  } catch (err: any) {
    testResult.value = {
      success: false,
      error: err?.data?.error || err?.message || '请求失败',
    }
  } finally {
    testing.value = false
  }
}

// ── TAB 2：外部订阅管理 ────────────────────────────────────
const SUB_STATUS_LABELS: Record<string, string> = { active: '生效中', paused: '已暂停', revoked: '已退订' }
const subs = ref<any[]>([])
const subCounts = reactive({ active: 0, paused: 0, revoked: 0 })
const subsLoading = ref(false)
const subBusy = ref(false)
const subStatus = ref<'all' | 'active' | 'paused' | 'revoked'>('all')
const subPage = ref(1)
const subTotal = ref(0)
const subPageSize = 20
const subTotalPages = computed(() => Math.max(1, Math.ceil(subTotal.value / subPageSize)))
const showEvents = ref(false)
const events = ref<any[]>([])
const eventsLoading = ref(false)

async function loadSubs() {
  subsLoading.value = true
  try {
    const params = new URLSearchParams({
      status: subStatus.value,
      page: String(subPage.value),
      limit: String(subPageSize),
    })
    const r = await $fetch<any>(`/api/admin/token-deals/subscriptions?${params}`, { headers: getAuthHeaders() })
    subs.value = r.items || []
    subTotal.value = r.total || 0
    Object.assign(subCounts, r.counts || {})
  } catch (e: any) {
    showPageMessage('加载订阅失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
    subs.value = []
    subTotal.value = 0
  } finally {
    subsLoading.value = false
  }
}

async function loadEvents() {
  eventsLoading.value = true
  try {
    const r = await $fetch<any>('/api/admin/token-deals/events?limit=50', { headers: getAuthHeaders() })
    events.value = r.items || []
  } catch (e: any) {
    showPageMessage('加载事件失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    eventsLoading.value = false
  }
}

function toggleEvents() {
  showEvents.value = !showEvents.value
  if (showEvents.value && events.value.length === 0) loadEvents()
}

async function subAction(s: any, action: 'pause' | 'resume' | 'revoke' | 'delete') {
  if (!process.client || subBusy.value) return
  const name = s.label || s.id
  const tips: Record<string, string> = {
    pause: `暂停订阅「${name}」？对方轮询将返回空结果（paused: true）。`,
    resume: `恢复订阅「${name}」？`,
    revoke: `撤销订阅「${name}」？该凭证立即失效且不可逆。`,
    delete: `彻底删除订阅「${name}」的记录？不可恢复。`,
  }
  if (!confirm(tips[action])) return
  subBusy.value = true
  try {
    const r = await $fetch<any>(`/api/admin/token-deals/subscriptions/${s.id}`, {
      method: 'POST',
      body: { action },
      headers: getAuthHeaders(),
    })
    showPageMessage(r?.message || '已处理')
    await loadSubs()
    if (showEvents.value) await loadEvents()
  } catch (e: any) {
    showPageMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    subBusy.value = false
  }
}

// ── TAB 3：API 令牌 (PAT) ──────────────────────────────────
const tokens = ref<any[]>([])
const tokensLoading = ref(false)
const createTokenVisible = ref(false)
const tokenCreating = ref(false)
const tokenErrorMsg = ref('')
const tokenForm = reactive({ name: '', scopes: ['read', 'write'] as string[], expires_in_days: '' })

const plainToken = ref('')
const plainTokenVisible = ref(false)
const copiedToken = ref(false)

function scopeBadge(scope: string) {
  if (scope === 'delete') return 'badge-danger'
  if (scope === 'write') return 'badge-pending'
  return 'badge-public'
}

async function loadTokens() {
  tokensLoading.value = true
  try {
    const d = await $fetch<{ tokens: any[] }>('/api/user/api-tokens', { headers: getAuthHeaders(), credentials: 'include' })
    tokens.value = d.tokens || []
  } catch (err: any) {
    showPageMessage(err?.data?.error || err?.message || '加载令牌失败', 'error')
  } finally {
    tokensLoading.value = false
  }
}

function openCreateToken() {
  tokenForm.name = ''
  tokenForm.scopes = ['read', 'write']
  tokenForm.expires_in_days = ''
  tokenErrorMsg.value = ''
  createTokenVisible.value = true
}

async function submitCreateToken() {
  tokenErrorMsg.value = ''
  if (!tokenForm.name.trim()) { tokenErrorMsg.value = '请填写令牌名称'; return }
  if (tokenForm.scopes.length === 0) { tokenErrorMsg.value = '至少选择一个权限'; return }

  tokenCreating.value = true
  try {
    const body: any = { name: tokenForm.name.trim(), scopes: tokenForm.scopes }
    if (tokenForm.expires_in_days !== '' && tokenForm.expires_in_days != null) {
      body.expires_in_days = Number(tokenForm.expires_in_days)
    }
    const d = await $fetch<{ token: string }>('/api/user/api-tokens', {
      method: 'POST',
      body,
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    plainToken.value = d.token
    copiedToken.value = false
    createTokenVisible.value = false
    plainTokenVisible.value = true
    await loadTokens()
  } catch (err: any) {
    tokenErrorMsg.value = err?.data?.error || err?.message || '创建失败'
  } finally {
    tokenCreating.value = false
  }
}

function closePlainToken() {
  plainTokenVisible.value = false
  plainToken.value = ''
  copiedToken.value = false
}

async function copyPlainToken() {
  try {
    await navigator.clipboard.writeText(plainToken.value)
    copiedToken.value = true
    setTimeout(() => { copiedToken.value = false }, 2000)
  } catch {
    tokenErrorMsg.value = '复制失败，请手动选中复制'
  }
}

async function revokeToken(t: any) {
  if (!confirm(`确定吊销令牌「${t.name}」吗？使用该令牌的 AI 或脚本将立即失去访问权限。`)) return
  try {
    await $fetch(`/api/user/api-tokens/${t.id}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' })
    showPageMessage(`令牌「${t.name}」已吊销`)
    await loadTokens()
  } catch (err: any) {
    alert('吊销失败: ' + (err?.data?.error || err?.message || '未知错误'))
  }
}

// ── 格式化工具 ──────────────────────────────────────────────
function formatTime(ts?: number | string | null): string {
  if (!ts) return '—'
  const d = new Date(typeof ts === 'string' && /^\d+$/.test(ts) ? Number(ts) : ts)
  if (isNaN(d.getTime())) return String(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

onMounted(async () => {
  if (process.client) {
    siteUrl.value = window.location.origin
    const queryTab = route.query.tab as BotTab
    if (queryTab && ['config', 'subs', 'tokens', 'guide'].includes(queryTab)) {
      if (!isAdmin.value && (queryTab === 'config' || queryTab === 'subs')) {
        currentTab.value = 'tokens'
      } else {
        currentTab.value = queryTab
      }
    } else if (!isAdmin.value) {
      currentTab.value = 'tokens'
    }
  }

  // 仅管理员请求系统机器人设置，避免普通用户触发 403
  if (isAdmin.value) {
    try {
      const d = await $fetch<any>('/api/admin/config', { headers: getAuthHeaders() })
      if (d?.systemData) {
        const s = d.systemData
        qqBot.qq_bot_enabled = s.qq_bot_enabled === 'true'
        qqBot.qq_bot_group_id = s.qq_bot_group_id || ''
        qqBot.qq_admin_qq = s.qq_admin_qq || ''
        qqBot.qq_bot_appid = s.qq_bot_appid || ''
        qqBot.qq_bot_app_secret = s.qq_bot_app_secret || ''
        qqBot.qq_bot_transport = s.qq_bot_transport || 'official'
        qqBot.qq_outbox_path = s.qq_outbox_path || ''
      }
    } catch (e) {
      console.error('加载机器人配置失败', e)
    }
  }

  // 根据当前激活的 tab 懒加载对应数据
  if (currentTab.value === 'subs' && isAdmin.value) loadSubs()
  else if (currentTab.value === 'tokens') loadTokens()
})
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}
.page-header h2 {
  font-size: 20px;
  margin: 0 0 4px;
}
.subtitle {
  color: var(--n-text-color-3, #888);
  font-size: 13px;
  margin: 0;
}

/* 顶部 Tab 样式 */
.tab-nav {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  margin-bottom: 20px;
  padding-bottom: 1px;
  overflow-x: auto;
}
.tab-nav button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.2s;
  white-space: nowrap;
}
.tab-nav button:hover {
  color: var(--primary, #1890ff);
}
.tab-nav button.active {
  color: var(--primary, #1890ff);
  border-bottom-color: var(--primary, #1890ff);
  font-weight: 600;
}
.tab-badge {
  display: inline-block;
  padding: 1px 6px;
  font-size: 11px;
  border-radius: 10px;
  background: var(--bg-hover, #eee);
  color: var(--text-secondary, #666);
}
.tab-nav button.active .tab-badge {
  background: rgba(24, 144, 255, 0.15);
  color: var(--primary, #1890ff);
}

/* 提示条 */
.alert-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 13px;
  line-height: 1.5;
}
.alert-banner.is-success {
  background: rgba(82, 196, 26, 0.12);
  color: #389e0d;
  border: 1px solid rgba(82, 196, 26, 0.3);
}
.alert-banner.is-error {
  background: rgba(255, 77, 79, 0.12);
  color: #cf1322;
  border: 1px solid rgba(255, 77, 79, 0.3);
}
.alert-content {
  flex: 1;
}
.alert-close {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: inherit;
  padding: 0 4px;
}
.code-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  margin-left: 6px;
}

/* 配置卡片 */
.config-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.card {
  background: var(--surface, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  padding: 20px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}
.card-header h3 {
  font-size: 16px;
  margin: 0;
}
.card-hint {
  font-size: 13px;
  color: var(--text-secondary, #666);
  line-height: 1.6;
  margin: 0 0 14px;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-badge {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
}
.status-badge.is-active {
  background: rgba(82, 196, 26, 0.15);
  color: #52c41a;
}
.status-badge.is-disabled {
  background: rgba(0, 0, 0, 0.06);
  color: var(--n-text-color-3, #999);
}
.channel-tag {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(24, 144, 255, 0.12);
  color: #1890ff;
}
.badge-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(82, 196, 26, 0.15);
  color: #389e0d;
  font-weight: 500;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toggle-row label {
  font-weight: 500;
  display: block;
}
.toggle-row small {
  color: var(--n-text-color-3, #888);
  font-size: 12px;
}

/* 开关组件 */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #ccc;
  transition: .3s;
  border-radius: 24px;
}
.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
  border-radius: 50%;
}
input:checked + .slider {
  background-color: #1890ff;
}
input:checked + .slider:before {
  transform: translateX(20px);
}

.fg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fg label {
  font-size: 13px;
  font-weight: 500;
}
.fg input, .fg select, .search-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #d9d9d9);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-input, #fff);
  color: inherit;
  transition: border-color 0.2s;
}
.fg input:focus, .fg select:focus, .search-input:focus {
  border-color: #1890ff;
  outline: none;
}
.fg small {
  color: var(--n-text-color-3, #888);
  font-size: 12px;
  line-height: 1.5;
}
.required {
  color: #ff4d4f;
}

.notice-box {
  padding: 12px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.notice-box.is-info {
  background: rgba(24, 144, 255, 0.08);
  border-left: 3px solid #1890ff;
}
.notice-box.is-error {
  background: rgba(255, 77, 79, 0.08);
  border-left: 3px solid #ff4d4f;
}
.notice-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.notice-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.6;
}
.notice-list li {
  margin-bottom: 4px;
}

.webhook-panel {
  background: var(--surface-sunken, #f8f9fa);
  border: 1px dashed var(--border-color, #d9d9d9);
  border-radius: 8px;
  padding: 12px 14px;
}
.copy-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.copy-bar code {
  flex: 1;
  padding: 6px 10px;
  background: var(--surface, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  word-break: break-all;
}
.btn-copy {
  padding: 6px 12px;
  border: 1px solid #1890ff;
  background: #1890ff;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}
.btn-copy:hover {
  background: #40a9ff;
}

.toggle-details {
  border: 1px solid var(--border-color, #f0f0f0);
  border-radius: 6px;
  overflow: hidden;
}
.details-summary {
  padding: 10px 12px;
  background: var(--surface-sunken, #fcfcfc);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}
.details-body {
  padding: 12px 14px;
  border-top: 1px solid var(--border-color, #f0f0f0);
  font-size: 13px;
}
.details-body pre {
  margin: 8px 0;
  padding: 10px;
  background: #2d3748;
  color: #e2e8f0;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  overflow-x: auto;
}

/* 按钮通用 */
.btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.btn-primary {
  background: #1890ff;
  color: #fff;
}
.btn-primary:hover {
  background: #40a9ff;
}
.btn-outline {
  border-color: #1890ff;
  color: #1890ff;
  background: transparent;
}
.btn-outline:hover:not(:disabled) {
  background: rgba(24, 144, 255, 0.08);
}
.btn-outline:disabled {
  border-color: #d9d9d9;
  color: #bfbfbf;
  cursor: not-allowed;
}
.btn-ghost {
  border: 1px solid var(--border-color, #d9d9d9);
  background: transparent;
  color: inherit;
}
.btn-ghost:hover {
  background: var(--bg-hover, #f5f5f5);
}
.btn-danger {
  border-color: rgba(255, 77, 79, 0.4);
  background: rgba(255, 77, 79, 0.08);
  color: #ff4d4f;
}
.btn-danger:hover {
  background: #ff4d4f;
  color: #fff;
}
.btn-sm {
  padding: 3px 8px;
  font-size: 12px;
}

/* 表格通用 */
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th, td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}
th {
  font-weight: 600;
  color: var(--text-secondary, #666);
  background: var(--surface-sunken, #fafafa);
}
.empty-state {
  text-align: center;
  padding: 36px 0;
  color: var(--text-tertiary, #999);
  font-size: 13px;
}

/* 订阅管理特定样式 */
.sub-stats {
  display: flex;
  gap: 20px;
  margin: 0 0 14px;
  color: var(--text-secondary, #666);
  font-size: 13px;
}
.sub-stat b {
  color: var(--text-primary, #111);
  font-size: 16px;
  margin-right: 4px;
}
.sub-token {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
}
.sub-stale {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(250, 173, 20, .15);
  color: #d48806;
}
.sub-events {
  margin-top: 22px;
  border-top: 1px solid var(--border-color, #f0f0f0);
  padding-top: 16px;
}
.sub-events h4 {
  margin: 0 0 6px;
  font-size: 14px;
}
.pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  font-size: 13px;
}
.pagination button {
  padding: 4px 10px;
  border: 1px solid var(--border-color, #d9d9d9);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 徽章 */
.badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.badge-public {
  background: rgba(82, 196, 26, 0.12);
  color: #52c41a;
}
.badge-pending {
  background: rgba(250, 173, 20, 0.12);
  color: #faad14;
}
.badge-private, .badge-danger {
  background: rgba(255, 77, 79, 0.12);
  color: #ff4d4f;
}

/* API 令牌 Tab 样式 */
.card-tips {
  margin-top: 16px;
}
.tips {
  margin: 0;
  padding: 0 0 0 18px;
  color: var(--text-secondary, #666);
  font-size: 13px;
  line-height: 1.8;
}
.tips li {
  margin-bottom: 2px;
}
.usage {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--divider, #f0f0f0);
}
.usage-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.usage-code {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  background: var(--surface-sunken, #282c34);
  color: #abb2bf;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
}
.usage-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-tertiary, #888);
  line-height: 1.6;
}
.mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
}
.scope-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.scope-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}
.scope-item.disabled {
  opacity: .55;
  cursor: not-allowed;
}
.scope-item strong {
  color: var(--text-primary, #111);
  font-family: var(--font-mono, monospace);
}
.scope-lock {
  display: block;
  font-style: normal;
  font-size: 12px;
  color: var(--text-tertiary, #999);
}
.err-msg {
  margin: 8px 0 0;
  color: #ff4d4f;
  font-size: 13px;
}
.warn-msg {
  margin: 0 0 12px;
  color: #faad14;
  font-size: 13px;
  line-height: 1.7;
}
.token-box {
  display: flex;
  gap: 8px;
  align-items: center;
}
.token-plain {
  flex: 1;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--surface-sunken, #f5f5f5);
  color: var(--text-primary, #111);
  word-break: break-all;
  user-select: all;
}

/* Modal 弹窗 */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}
.modal {
  background: var(--surface, #fff);
  border-radius: 10px;
  width: 100%;
  max-width: 480px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}
.modal-header h3 {
  margin: 0;
  font-size: 16px;
}
.modal-close {
  background: transparent;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #888;
}
.modal-body {
  padding: 20px;
}
.form-btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

/* 接入指南对比网格 */
.channel-compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.compare-item {
  padding: 12px;
  background: var(--surface-sunken, #f8f9fa);
  border: 1px solid var(--border-color, #e9ecef);
  border-radius: 8px;
}
.ci-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.compare-item p {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #666);
  line-height: 1.5;
}
.code-block-box pre {
  margin: 0;
  padding: 12px 14px;
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
}
</style>
