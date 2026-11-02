<template>
  <div class="admin-page">
    <div class="page-header">
      <div>
        <h2>🤖 机器人配置</h2>
        <p class="subtitle">配置 QQ 官方机器人直连、多群广播与 Webhook 回调，自动推送白嫖通告、审核提醒与群交互。</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline" :disabled="testing || !qqBot.qq_bot_enabled" @click="sendTestMessage">
          <i :class="testing ? 'ri-loader-4-line ri-spin' : 'ri-send-plane-line'"></i>
          {{ testing ? '发送中...' : '发送测试群消息' }}
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

    <div class="config-grid">
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

      <!-- 卡片 5：游客模式与外部生态订阅指南 -->
      <div class="card">
        <div class="card-header">
          <h3>游客与外部群主接入（零代码直连）</h3>
          <span class="badge-pill">公开生态</span>
        </div>
        <div class="card-body">
          <p class="hint">其他站长、交流群主或外部访客若想把本站的白嫖通告同步推送到他们自己的 QQ 群，<strong>无需安装配置复杂的 Hermes CLI</strong>，只需使用官方 <code>favshub-poll.py</code> 轮询脚本即可原生直推：</p>

          <div class="code-block-box">
            <pre><code>python3 favshub-poll.py --init \
  --site {{ siteUrl }} \
  --qq-appid 外部群主的AppID \
  --qq-secret 外部群主的AppSecret \
  --qq-group 外部群主的群OpenID \
  --label "我的QQ群"</code></pre>
          </div>

          <p class="hint" style="margin-top: 10px;">
            该脚本已发布在公开技能包中（<code>{{ siteUrl }}/skills/favshub-data-ops.json</code>，版本 <code>v1.11.0</code>），纯 Python 原生 <code>urllib</code> 实现，内置 7200s Token 换取/缓存与未报备域名自动剥离降级。
          </p>
        </div>
      </div>
    </div>

    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '机器人配置' })

const authStore = useAuthStore()
const runtimeConfig = useRuntimeConfig()

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}

const siteUrl = ref('https://hao.bx9y.com.cn')
const webhookUrl = computed(() => `${siteUrl.value}/api/bot/qq`)

const showMultiBotHelp = ref(false)
const copiedWebhook = ref(false)
const testing = ref(false)
const testResult = ref<{ success: boolean; message?: string; error?: string; message_id?: string } | null>(null)

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

onMounted(async () => {
  if (process.client) {
    siteUrl.value = window.location.origin
  }
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
  color: var(--n-text-color-3, #777);
  font-size: 13px;
  margin: 0;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}
.btn-outline {
  border: 1px solid var(--primary, #18a058);
  color: var(--primary, #18a058);
  background: transparent;
}
.btn-outline:hover:not(:disabled) {
  background: var(--primary, #18a058);
  color: #fff;
}
.btn-outline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  border-color: #ccc;
  color: #999;
}

.alert-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 13px;
}
.alert-banner.is-success {
  background: rgba(24, 160, 88, 0.1);
  border: 1px solid rgba(24, 160, 88, 0.3);
  color: #18a058;
}
.alert-banner.is-error {
  background: rgba(208, 48, 80, 0.1);
  border: 1px solid rgba(208, 48, 80, 0.3);
  color: #d03050;
}
.alert-content {
  flex: 1;
}
.code-tag {
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  margin-left: 8px;
}
.alert-close {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
}

.config-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.status-badge {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  font-weight: 500;
}
.status-badge.is-active {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
}
.status-badge.is-disabled {
  background: rgba(120, 120, 120, 0.12);
  color: #888;
}

.channel-tag {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  background: #e8f4ff;
  color: #1677ff;
  font-weight: 500;
}
.badge-pill {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
  color: #666;
}

.notice-box {
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 18px;
  font-size: 13px;
  line-height: 1.6;
}
.notice-box.is-info {
  background: rgba(22, 119, 255, 0.06);
  border-left: 4px solid #1677ff;
}
.notice-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #1677ff;
  display: flex;
  align-items: center;
  gap: 6px;
}
.notice-list {
  margin: 0;
  padding-left: 18px;
}
.notice-list li {
  margin-bottom: 4px;
}

.webhook-panel {
  margin-top: 18px;
  padding: 14px 16px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px dashed rgba(0, 0, 0, 0.15);
  border-radius: 8px;
}
.webhook-title {
  font-size: 13px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.copy-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.copy-bar code {
  flex: 1;
  background: rgba(0, 0, 0, 0.05);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  user-select: all;
  overflow-x: auto;
}
.btn-copy {
  padding: 8px 14px;
  border: 1px solid var(--border, #ddd);
  background: var(--bg-card, #fff);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.btn-copy:hover {
  background: rgba(0, 0, 0, 0.05);
}

.toggle-details {
  margin-top: 16px;
  border-top: 1px solid var(--border, #eee);
  padding-top: 12px;
}
.details-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--primary, #18a058);
}
.details-body {
  margin-top: 10px;
  font-size: 13px;
  color: var(--n-text-color-2, #555);
}
.details-body pre {
  background: #1e1e1e;
  color: #dcdcdc;
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
  margin: 8px 0;
}

.code-block-box pre {
  background: #1e1e1e;
  color: #569cd6;
  padding: 14px;
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.code-block-box code {
  color: #9cdcfe;
}

.required {
  color: #d03050;
  margin-left: 2px;
}
</style>
