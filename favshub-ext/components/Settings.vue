<script lang="ts" setup>
import BottomNav from '@/components/BottomNav.vue';
import PopupLayout from '@/components/PopupLayout.vue';
import PageTitle from '@/components/title.vue';
import { baseUrlStorage, tokenStorage, userInfoStorage, enableFloatingBallStorage, languageStorage, type AppLanguage } from '@/utils/storage';
import { request } from '@/utils/request';
import { currentLanguage } from '@/utils/server-errors';
import { t, setLocale } from '@/i18n';

const message = useMessage();
const baseUrl = ref('');
const username = ref('');
const password = ref('');
const isLoggedIn = ref(false);
const currentUser = ref<{ id: number; username: string; email?: string; is_admin?: boolean } | null>(null);
const isLoggingIn = ref(false);
const isRegistering = ref(false);
const isTesting = ref(false);
const floatingBallEnabled = ref(false);
const language = ref<AppLanguage>('zh');

async function handleLanguageChange(val: AppLanguage) {
  language.value = val;
  setLocale(val);
  await languageStorage.setValue(val);
  message.success(val === 'zh' ? t('ui.settings.lang_switched_zh') : t('ui.settings.lang_switched_en'));
}

interface LoginResponse {
  token: string;
  user: { id: number; username: string; email?: string; is_admin?: boolean };
}

async function loadSavedConfig() {
  try {
    const [savedBaseUrl, savedToken, savedUser] = await Promise.all([
      baseUrlStorage.getValue(),
      tokenStorage.getValue(),
      userInfoStorage.getValue(),
    ]);

    baseUrl.value = savedBaseUrl;
    currentUser.value = savedUser;
    isLoggedIn.value = !!savedToken && !!savedUser;
    floatingBallEnabled.value = await enableFloatingBallStorage.getValue();
    language.value = await currentLanguage();
  } catch {
    message.error(t('ui.settings.load_config_failed'));
  }
}

async function handleTestConnection() {
  const serverUrl = validateBaseUrl(baseUrl.value);
  if (!serverUrl) {
    message.error(t('ui.settings.invalid_server_url'));
    return;
  }

  isTesting.value = true;

  try {
    const response = await fetch(`${serverUrl}/api/auth/me`, {
      method: 'GET',
      // 测试连接不应挂着默认 90s 超时等死
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401) {
      message.success(t('ui.settings.test_ok_need_login'));
    } else if (response.ok) {
      message.success(t('ui.settings.test_ok'));
    } else {
      message.error(t('ui.settings.test_failed'));
    }
  } catch {
    message.error(t('ui.settings.request_failed'));
  } finally {
    isTesting.value = false;
  }
}

/**
 * 校验并规范化服务器地址。
 * 返回 null 表示地址非法（阻断保存/登录）；合法时返回去除尾部斜杠的地址。
 * 非 localhost 的明文 http 会给出警告（自建局域网 http 部署属常见场景，只警告不阻断）。
 */
function validateBaseUrl(input: string): string | null {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname;
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (!isLocal) {
      message.warning(t('ui.settings.insecure_http_warning'));
    }
  }
  return value;
}

async function handleLogin() {
  const serverUrl = validateBaseUrl(baseUrl.value);
  if (!serverUrl) {
    message.error(t('ui.settings.invalid_server_url'));
    return;
  }

  if (!username.value.trim()) {
    message.error(t('ui.settings.username_required'));
    return;
  }

  if (!password.value.trim()) {
    message.error(t('ui.settings.password_required'));
    return;
  }

  isLoggingIn.value = true;

  try {
    const result = await request<LoginResponse>(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value.trim() }),
      auth: false,
    });

    await Promise.all([
      baseUrlStorage.setValue(serverUrl),
      tokenStorage.setValue(result.token),
      userInfoStorage.setValue(result.user),
    ]);

    currentUser.value = result.user;
    isLoggedIn.value = true;
    password.value = '';
    message.success(t('ui.settings.welcome', { name: result.user.username }));
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('ui.settings.login_failed'));
  } finally {
    isLoggingIn.value = false;
  }
}

async function handleRegister() {
  const serverUrl = validateBaseUrl(baseUrl.value);
  if (!serverUrl) {
    message.error(t('ui.settings.invalid_server_url'));
    return;
  }

  if (!username.value.trim()) {
    message.error(t('ui.settings.username_required'));
    return;
  }

  if (!password.value.trim()) {
    message.error(t('ui.settings.password_required'));
    return;
  }

  isRegistering.value = true;

  try {
    const result = await request<LoginResponse>(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value.trim() }),
      auth: false,
    });

    await Promise.all([
      baseUrlStorage.setValue(serverUrl),
      tokenStorage.setValue(result.token),
      userInfoStorage.setValue(result.user),
    ]);

    currentUser.value = result.user;
    isLoggedIn.value = true;
    password.value = '';
    message.success(t('ui.settings.register_success_welcome', { name: result.user.username }));
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('ui.settings.register_failed'));
  } finally {
    isRegistering.value = false;
  }
}

async function handleToggleFloatingBall(val: boolean) {
  floatingBallEnabled.value = val;
  await enableFloatingBallStorage.setValue(val);
  message.success(val ? t('ui.settings.floating_ball_on') : t('ui.settings.floating_ball_off'));
}

async function handleLogout() {
  await Promise.all([
    tokenStorage.removeValue(),
    userInfoStorage.removeValue(),
  ]);

  currentUser.value = null;
  isLoggedIn.value = false;
  username.value = '';
  password.value = '';
  message.success(t('ui.settings.logged_out'));
}

onMounted(() => {
  void loadSavedConfig();
});
</script>

<template>
  <PopupLayout>
    <PageTitle :title="t('ui.settings.title')" />

    <main class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div class="space-y-3">
        <!-- 服务器地址 -->
        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">{{ t('ui.settings.server_section') }}</h2>
            <p class="mt-1 text-xs text-slate-500">{{ t('ui.settings.server_desc') }}</p>
          </div>

          <div class="space-y-3">
            <n-input v-model:value="baseUrl" placeholder="http://localhost:3000" :disabled="isLoggedIn" />
            <n-button :loading="isTesting" block secondary type="primary" @click="handleTestConnection">
              {{ t('ui.settings.test_connection') }}
            </n-button>
          </div>
        </section>

        <!-- 登录/注册 -->
        <section v-if="!isLoggedIn" class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">{{ t('ui.settings.account_section') }}</h2>
          </div>

          <div class="space-y-3">
            <n-input v-model:value="username" :placeholder="t('ui.settings.username')" @keyup.enter="handleLogin" />
            <n-input v-model:value="password" type="password" show-password-on="click" :placeholder="t('ui.settings.password')" @keyup.enter="handleLogin" />
            <div class="grid grid-cols-2 gap-2">
              <n-button :loading="isLoggingIn" type="primary" block @click="handleLogin">
                {{ t('ui.settings.login') }}
              </n-button>
              <n-button :loading="isRegistering" block @click="handleRegister">
                {{ t('ui.settings.register') }}
              </n-button>
            </div>
          </div>
        </section>

        <!-- 已登录状态 -->
        <section v-else class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold text-slate-900">{{ currentUser?.username }}</div>
              <div class="text-xs text-slate-500">{{ t('ui.settings.logged_in') }}</div>
            </div>
            <n-button secondary type="error" @click="handleLogout">
              {{ t('ui.settings.logout') }}
            </n-button>
          </div>
        </section>

        <!-- 悬浮球设置 -->
        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">{{ t('ui.settings.floating_ball') }}</h2>
              <p class="mt-1 text-xs text-slate-500">{{ t('ui.settings.floating_ball_desc') }}</p>
            </div>
            <n-switch :value="floatingBallEnabled" @update:value="handleToggleFloatingBall" />
          </div>
        </section>

        <!-- 语言设置 -->
        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">{{ t('ui.settings.language') }}</h2>
              <p class="mt-1 text-xs text-slate-500">{{ t('ui.settings.language_desc') }}</p>
            </div>
            <n-radio-group :value="language" size="small" @update:value="handleLanguageChange">
              <n-radio-button value="zh">{{ t('ui.settings.lang_zh') }}</n-radio-button>
              <n-radio-button value="en">English</n-radio-button>
            </n-radio-group>
          </div>
        </section>
      </div>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
