<script setup lang="ts">
import type { GlobalThemeOverrides } from 'naive-ui';

const themeOverrides: GlobalThemeOverrides = {
    common: {
        primaryColor: '#047857',
        primaryColorHover: '#065F46',
        primaryColorPressed: '#064E3B',
        primaryColorSuppl: '#10B981',
        infoColor: '#047857',
        infoColorHover: '#065F46',
        infoColorPressed: '#064E3B',
        successColor: '#047857',
        textColorBase: '#1F2937',
        textColor1: '#1F2937',
        textColor2: '#4B5563',
        textColor3: '#6B7280',
        bodyColor: '#F8F7F4',
        cardColor: '#FFFFFF',
        borderColor: '#E7E5E4',
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
</script>

<template>
<n-config-provider :theme-overrides="themeOverrides">
    <n-dialog-provider>
        <n-message-provider>
            <router-view />
        </n-message-provider>
    </n-dialog-provider>
</n-config-provider>
</template>
