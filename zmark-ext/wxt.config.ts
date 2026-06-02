import { defineConfig } from 'wxt';
// import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import tailwindcss from '@tailwindcss/vite'

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    permissions: ['clipboardRead', 'storage', 'tabs', 'contextMenus', 'notifications', 'bookmarks', 'sidePanel', 'commands', 'favicon', 'history', 'downloads', 'management', 'scripting'],
    host_permissions: ['http://*/*', 'https://*/*'],
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
