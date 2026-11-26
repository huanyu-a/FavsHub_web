import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import BottomNav from '@/components/BottomNav.vue';

vi.mock('@/i18n', () => ({ t: (key: string) => key }));

const Page = { template: '<div />' };

async function setup(initialPath = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'bookmarks', component: Page },
      { path: '/add', name: 'add', component: Page },
      { path: '/sync', name: 'sync', component: Page },
      { path: '/settings', name: 'settings', component: Page },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(BottomNav, {
    global: {
      plugins: [router],
      stubs: { NIcon: true },
    },
  });
  return { router, wrapper };
}

describe('BottomNav', () => {
  it('用 aria-current 标记当前路由，当前项点击不重复导航', async () => {
    const { router, wrapper } = await setup('/sync');
    const buttons = wrapper.findAll('button');

    expect(buttons).toHaveLength(4);
    expect(buttons[2].attributes('aria-current')).toBe('page');
    expect(buttons[0].attributes('aria-current')).toBeUndefined();

    const pushSpy = vi.spyOn(router, 'push');
    await buttons[2].trigger('click');
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('点击其他导航项跳转并更新当前态', async () => {
    const { router, wrapper } = await setup('/');
    const buttons = wrapper.findAll('button');

    await buttons[1].trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/add');
    expect(router.currentRoute.value.name).toBe('add');
    expect(buttons[1].attributes('aria-current')).toBe('page');
    expect(buttons[0].attributes('aria-current')).toBeUndefined();
  });
});
