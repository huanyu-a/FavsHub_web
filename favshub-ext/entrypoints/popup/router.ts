import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'bookmarks',
      component: () => import('@/components/Home.vue'),
    },
    {
      path: '/add',
      name: 'add',
      component: () => import('@/components/Add.vue'),
    },
    {
      path: '/sync',
      name: 'sync',
      component: () => import('@/components/Sync.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/components/Settings.vue'),
    },
  ],
});

export default router;
