<script setup lang="ts">
import { darkTheme } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import type { Component } from 'vue';
import { Checkmark, ColorPaletteOutline, DesktopOutline, GlobeOutline, SunnyOutline } from '@vicons/ionicons5';
import { useRoute } from 'vue-router';
import { locale } from '@/i18n';
import {
    applyThemeToDocument,
    getSystemTheme,
    getThemeTokens,
    isActiveWebsiteTab,
    normalizeThemeMode,
    parseWebsiteThemeMessage,
    readActiveWebsiteTheme,
    themeModeStorage,
} from '@/utils/theme';
import type { ResolvedTheme, ThemeMode } from '@/utils/theme';

const route = useRoute();
const mode = ref<ThemeMode>('warm');
const systemTheme = ref<ResolvedTheme>(getSystemTheme());
const websiteTheme = ref<ResolvedTheme | null>(null);
let websiteRequest = 0;

const effectiveTheme = computed<ResolvedTheme>(() => {
    if (mode.value === 'warm') return 'light';
    if (mode.value === 'website') return websiteTheme.value || systemTheme.value;
    return systemTheme.value;
});

const naiveTheme = computed(() => effectiveTheme.value === 'dark' ? darkTheme : null);
const themeOverrides = computed<GlobalThemeOverrides>(() => {
    const colors = getThemeTokens(effectiveTheme.value);
    return {
        common: {
            primaryColor: colors.primary,
            primaryColorHover: colors.primaryHover,
            primaryColorPressed: colors.primaryPressed,
            primaryColorSuppl: effectiveTheme.value === 'light' ? '#10B981' : colors.primary,
            infoColor: colors.primary,
            infoColorHover: colors.primaryHover,
            infoColorPressed: colors.primaryPressed,
            successColor: colors.primary,
            textColorBase: colors.text,
            textColor1: colors.text,
            textColor2: effectiveTheme.value === 'light' ? '#4B5563' : colors.text,
            textColor3: colors.textSecondary,
            bodyColor: colors.bg,
            cardColor: colors.surface,
            borderColor: colors.border,
            borderRadius: '10px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        Button: {
            heightMedium: '36px',
        },
        Input: {
            heightMedium: '36px',
        },
    };
});

const appearanceLabel = computed(() => locale.value === 'zh' ? '外观' : 'Appearance');
const themeOptions = computed<Array<{ value: ThemeMode; label: string; icon: Component }>>(() => [
    { value: 'warm', label: locale.value === 'zh' ? '固定暖白' : 'Warm white', icon: SunnyOutline },
    { value: 'system', label: locale.value === 'zh' ? '跟随系统' : 'Follow system', icon: DesktopOutline },
    { value: 'website', label: locale.value === 'zh' ? '跟随网站' : 'Follow website', icon: GlobeOutline },
]);
const currentThemeOption = computed(() => themeOptions.value.find(option => option.value === mode.value) || themeOptions.value[0]);

async function refreshWebsiteTheme() {
    const request = ++websiteRequest;
    const theme = await readActiveWebsiteTheme();
    if (request === websiteRequest && mode.value === 'website') websiteTheme.value = theme;
}

function selectThemeMode(value: ThemeMode) {
    mode.value = value;
    void themeModeStorage.setValue(value).catch(() => {});
}

watch(effectiveTheme, (theme) => applyThemeToDocument(theme), { immediate: true });
watch(mode, (value) => {
    if (value === 'website') {
        void refreshWebsiteTheme();
    } else {
        websiteRequest += 1;
        websiteTheme.value = null;
    }
});

let systemMedia: MediaQueryList | null = null;
const handleSystemChange = (event: MediaQueryListEvent) => {
    systemTheme.value = event.matches ? 'dark' : 'light';
    if (mode.value === 'website') void refreshWebsiteTheme();
};
const handleTabChange = () => {
    if (mode.value === 'website') void refreshWebsiteTheme();
};
const handleTabUpdated = (_tabId: number, changeInfo: { status?: string; url?: string }) => {
    if ((changeInfo.status === 'complete' || changeInfo.url) && mode.value === 'website') {
        void refreshWebsiteTheme();
    }
};
const handleWebsiteThemeMessage = (message: unknown, sender: { tab?: { id?: number; url?: string } }) => {
    if (mode.value !== 'website' || !parseWebsiteThemeMessage(message)) return;
    const tabId = sender.tab?.id;
    const senderUrl = sender.tab?.url;
    if (tabId == null || !senderUrl) return;
    void isActiveWebsiteTab(tabId, senderUrl).then((isActive) => {
        if (isActive && mode.value === 'website') void refreshWebsiteTheme();
    });
};
let stopThemeWatch: (() => void) | null = null;

onMounted(async () => {
    if (typeof window.matchMedia === 'function') {
        systemMedia = window.matchMedia('(prefers-color-scheme: dark)');
        systemTheme.value = systemMedia.matches ? 'dark' : 'light';
        systemMedia.addEventListener('change', handleSystemChange);
    }
    browser.tabs.onActivated.addListener(handleTabChange);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.runtime.onMessage.addListener(handleWebsiteThemeMessage);
    stopThemeWatch = themeModeStorage.watch((value) => {
        mode.value = normalizeThemeMode(value);
    });
    mode.value = normalizeThemeMode(await themeModeStorage.getValue());
});

onBeforeUnmount(() => {
    websiteRequest += 1;
    systemMedia?.removeEventListener('change', handleSystemChange);
    browser.tabs.onActivated.removeListener(handleTabChange);
    browser.tabs.onUpdated.removeListener(handleTabUpdated);
    browser.runtime.onMessage.removeListener(handleWebsiteThemeMessage);
    stopThemeWatch?.();
});
</script>

<template>
<n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-dialog-provider>
        <n-message-provider>
            <router-view />
            <n-popover v-if="route.name === 'settings'" trigger="click" placement="bottom-end" :show-arrow="false">
                <template #trigger>
                    <button class="fh-theme-trigger" type="button" :aria-label="appearanceLabel" :title="appearanceLabel">
                        <n-icon :component="currentThemeOption.icon" size="17" />
                    </button>
                </template>
                <div class="fh-theme-menu" role="group" :aria-label="appearanceLabel">
                    <div class="fh-theme-menu__title">
                        <n-icon :component="ColorPaletteOutline" size="14" />
                        <span>{{ appearanceLabel }}</span>
                    </div>
                    <button
                        v-for="option in themeOptions"
                        :key="option.value"
                        type="button"
                        class="fh-theme-option"
                        :class="{ 'is-active': mode === option.value }"
                        :aria-pressed="mode === option.value"
                        @click="selectThemeMode(option.value)"
                    >
                        <n-icon :component="option.icon" size="16" />
                        <span>{{ option.label }}</span>
                        <n-icon v-if="mode === option.value" class="fh-theme-option__check" :component="Checkmark" size="15" />
                    </button>
                </div>
            </n-popover>
        </n-message-provider>
    </n-dialog-provider>
</n-config-provider>
</template>

<style>
.fh-theme-trigger {
    position: fixed;
    top: 14px;
    right: 12px;
    z-index: 30;
    display: inline-flex;
    width: 30px;
    height: 30px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--fh-border);
    border-radius: 9px;
    background: var(--fh-surface);
    color: var(--fh-primary);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(41, 37, 36, 0.06);
}

.fh-theme-trigger:hover {
    border-color: var(--fh-primary);
    background: var(--fh-surface-soft);
}

.fh-theme-trigger:focus-visible,
.fh-theme-option:focus-visible {
    outline: 2px solid var(--fh-primary);
    outline-offset: 2px;
}

.fh-theme-menu {
    min-width: 180px;
    padding: 5px;
    color: var(--fh-text);
}

.fh-theme-menu__title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px 8px;
    color: var(--fh-text-secondary);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
}

.fh-theme-option {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--fh-text);
    cursor: pointer;
    font-size: 13px;
    padding: 9px;
    text-align: left;
}

.fh-theme-option:hover,
.fh-theme-option.is-active {
    background: var(--fh-surface-soft);
    color: var(--fh-primary);
}

.fh-theme-option.is-active {
    font-weight: 600;
}

.fh-theme-option__check {
    margin-left: auto;
}

/* Existing components use Tailwind's stone/emerald literals. Keep light mode untouched
   and map those literals to the shared variables only for the opt-in dark appearance. */
:root[data-favshub-theme='dark'] .popup-shell.text-stone-800,
:root[data-favshub-theme='dark'] .popup-shell .text-stone-900,
:root[data-favshub-theme='dark'] .popup-shell .text-stone-800,
:root[data-favshub-theme='dark'] .popup-shell .text-stone-700,
:root[data-favshub-theme='dark'] .popup-shell .hover\:text-stone-800:hover {
    color: var(--fh-text);
}

:root[data-favshub-theme='dark'] .popup-shell .text-stone-600,
:root[data-favshub-theme='dark'] .popup-shell .text-stone-500,
:root[data-favshub-theme='dark'] .popup-shell .text-stone-400 {
    color: var(--fh-text-secondary);
}

:root[data-favshub-theme='dark'] .popup-shell .bg-white,
:root[data-favshub-theme='dark'] .popup-shell .bg-white\/90,
:root[data-favshub-theme='dark'] .popup-shell .bg-white\/95 {
    background-color: var(--fh-surface);
}

:root[data-favshub-theme='dark'] .popup-shell .bg-stone-50,
:root[data-favshub-theme='dark'] .popup-shell .hover\:bg-stone-100:hover {
    background-color: var(--fh-surface-soft);
}

:root[data-favshub-theme='dark'] .popup-shell .border-stone-200,
:root[data-favshub-theme='dark'] .popup-shell .border-stone-200\/90 {
    border-color: var(--fh-border);
}

:root[data-favshub-theme='dark'] .popup-shell .bg-emerald-50,
:root[data-favshub-theme='dark'] .popup-shell .bg-emerald-100,
:root[data-favshub-theme='dark'] .popup-shell .hover\:bg-emerald-50\/70:hover {
    background-color: var(--fh-surface-soft);
}

:root[data-favshub-theme='dark'] .popup-shell .text-emerald-600,
:root[data-favshub-theme='dark'] .popup-shell .text-emerald-700,
:root[data-favshub-theme='dark'] .popup-shell .hover\:text-emerald-600:hover {
    color: var(--fh-primary);
}
</style>
