import { defineConfig } from 'wxt';
// import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import tailwindcss from '@tailwindcss/vite'

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'FavsHub-Ext',
    permissions: ['storage', 'tabs', 'contextMenus', 'notifications', 'bookmarks', 'sidePanel', 'commands', 'favicon', 'history', 'scripting'],
    // 收窄 host 权限：https 全站（书签站点均为 https）+ 本地开发 http
    // 明文 http://*/* 无必要，且会放大 <all_urls> 注入面的审查风险
    host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    // sidePanel API 需要 Chromium 114+，旧浏览器不声明会出现功能残缺
    minimum_chrome_version: '114',
    side_panel: {
      default_path: 'popup.html',
    },
    commands: {
      open_side_panel: {
        suggested_key: { default: 'Alt+B', mac: 'Command+B' },
        description: '打开侧边栏',
      },
    },
  },
  vite: () => ({
    plugins: [
      //vue(),
      tailwindcss(),
      AutoImport({
        imports: [
          'vue',
          {
            'naive-ui': [
              'useDialog',
              'useMessage',
              'useNotification',
              'useLoadingBar'
            ]
          }
        ]
      }),
      Components({
        resolvers: [NaiveUiResolver()]
      })
    ],
  }),
  modules: ['@wxt-dev/module-vue'],
});
