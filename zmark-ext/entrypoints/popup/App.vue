<script setup lang="ts">
import type { GlobalThemeOverrides } from 'naive-ui';

const themeOverrides: GlobalThemeOverrides = {
    common: {
        primaryColor: '#2D8CF0',
        primaryColorHover: '#4A9CF3',
        primaryColorPressed: '#1F73D8',
        primaryColorSuppl: '#6AAEF7',
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
