<script lang="ts" setup>
import BottomNav from '@/components/BottomNav.vue';
import PopupLayout from '@/components/PopupLayout.vue';
import PageTitle from '@/components/title.vue';
import { baseUrlStorage, tokenStorage, userInfoStorage, enableFloatingBallStorage } from '@/utils/storage';
import { request } from '@/utils/request';

const message = useMessage();
const baseUrl = ref('');
const username = ref('');
const password = ref('');
const isLoggedIn = ref(false);
const currentUser = ref<{ id: number; username: string; email?: string } | null>(null);
const isLoggingIn = ref(false);
const isRegistering = ref(false);
const isTesting = ref(false);
const floatingBallEnabled = ref(false);

interface LoginResponse {
  token: string;
  user: { id: number; username: string; email?: string };
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
  } catch {
    message.error('读取配置失败');
  }
}

async function handleTestConnection() {
  if (!baseUrl.value.trim()) {
    message.error('请输入服务器地址');
    return;
  }

  isTesting.value = true;

  try {
    const response = await fetch(`${baseUrl.value.replace(/\/+$/, '')}/api/auth/me`, {
      method: 'GET',
    });

    if (response.status === 401) {
      message.success('连接成功，请登录');
    } else if (response.ok) {
      message.success('连接成功');
    } else {
      message.error('连接失败');
    }
  } catch {
    message.error('请求失败，请检查地址或网络');
  } finally {
    isTesting.value = false;
  }
}

async function handleLogin() {
  if (!baseUrl.value.trim()) {
    message.error('请输入服务器地址');
    return;
  }

  if (!username.value.trim()) {
    message.error('请输入用户名');
    return;
  }

  if (!password.value.trim()) {
    message.error('请输入密码');
    return;
  }

  isLoggingIn.value = true;

  try {
    const result = await request<LoginResponse>(`${baseUrl.value.replace(/\/+$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value.trim() }),
      auth: false,
    });

    await Promise.all([
      baseUrlStorage.setValue(baseUrl.value.trim()),
      tokenStorage.setValue(result.token),
      userInfoStorage.setValue(result.user),
    ]);

    currentUser.value = result.user;
    isLoggedIn.value = true;
    password.value = '';
    message.success(`欢迎，${result.user.username}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '登录失败');
  } finally {
    isLoggingIn.value = false;
  }
}

async function handleRegister() {
  if (!baseUrl.value.trim()) {
    message.error('请输入服务器地址');
    return;
  }

  if (!username.value.trim()) {
    message.error('请输入用户名');
    return;
  }

  if (!password.value.trim()) {
    message.error('请输入密码');
    return;
  }

  isRegistering.value = true;

  try {
    const result = await request<LoginResponse>(`${baseUrl.value.replace(/\/+$/, '')}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value.trim() }),
      auth: false,
    });

    await Promise.all([
      baseUrlStorage.setValue(baseUrl.value.trim()),
      tokenStorage.setValue(result.token),
      userInfoStorage.setValue(result.user),
    ]);

    currentUser.value = result.user;
    isLoggedIn.value = true;
    password.value = '';
    message.success(`注册成功，欢迎 ${result.user.username}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '注册失败');
  } finally {
    isRegistering.value = false;
  }
}

async function handleToggleFloatingBall(val: boolean) {
  floatingBallEnabled.value = val;
  await enableFloatingBallStorage.setValue(val);
  message.success(val ? '悬浮球已开启' : '悬浮球已关闭');
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
  message.success('已退出登录');
}

onMounted(() => {
  void loadSavedConfig();
});
</script>

<template>
  <PopupLayout>
    <PageTitle title="设置" />

    <main class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div class="space-y-3">
        <!-- 服务器地址 -->
        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">服务器连接</h2>
            <p class="mt-1 text-xs text-slate-500">输入 FavsHub 服务器地址</p>
          </div>

          <div class="space-y-3">
            <n-input v-model:value="baseUrl" placeholder="http://localhost:3000" :disabled="isLoggedIn" />
            <n-button :loading="isTesting" block secondary type="primary" @click="handleTestConnection">
              测试连接
            </n-button>
          </div>
        </section>

        <!-- 登录/注册 -->
        <section v-if="!isLoggedIn" class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">账号登录</h2>
          </div>

          <div class="space-y-3">
            <n-input v-model:value="username" placeholder="用户名" />
            <n-input v-model:value="password" type="password" show-password-on="click" placeholder="密码" />
            <div class="grid grid-cols-2 gap-2">
              <n-button :loading="isLoggingIn" type="primary" block @click="handleLogin">
                登录
              </n-button>
              <n-button :loading="isRegistering" block @click="handleRegister">
                注册
              </n-button>
            </div>
          </div>
        </section>

        <!-- 已登录状态 -->
        <section v-else class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold text-slate-900">{{ currentUser?.username }}</div>
              <div class="text-xs text-slate-500">已登录</div>
            </div>
            <n-button secondary type="error" @click="handleLogout">
              退出
            </n-button>
          </div>
        </section>

        <!-- 悬浮球设置 -->
        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">悬浮球</h2>
              <p class="mt-1 text-xs text-slate-500">在所有网页显示快捷操作悬浮球</p>
            </div>
            <n-switch :value="floatingBallEnabled" @update:value="handleToggleFloatingBall" />
          </div>
        </section>
      </div>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
