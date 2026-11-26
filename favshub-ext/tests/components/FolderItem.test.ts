import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import FolderItem from '@/components/FolderItem.vue';

vi.mock('@/i18n', () => ({ t: (key: string) => key }));

const folder = { id: 1, name: '工作', parent_id: null, children: [] };
const bookmarks = [
  { id: 1, title: 'Alpha', url: 'https://example.com/a', folder_id: 1 },
  { id: 2, title: 'Beta', url: 'https://example.com/b', folder_id: 1 },
  { id: 3, title: 'Outside', url: 'https://example.com/c', folder_id: 2 },
];

function mountFolder(expandedIds: Set<number>) {
  return mount(FolderItem, {
    props: { folder, bookmarks, expandedIds, depth: 0 },
    global: { stubs: { NIcon: true } },
  });
}

describe('FolderItem', () => {
  it('折叠时隐藏书签，点击文件夹上抛 toggle', async () => {
    const wrapper = mountFolder(new Set());

    expect(wrapper.text()).toContain('工作');
    expect(wrapper.text()).toContain('2');
    expect(wrapper.text()).not.toContain('Alpha');

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('toggle')).toEqual([[1]]);
  });

  it('展开后仅展示当前文件夹书签，点击书签上抛 open', async () => {
    const wrapper = mountFolder(new Set());
    await wrapper.setProps({ expandedIds: new Set([1]) });

    expect(wrapper.text()).toContain('Alpha');
    expect(wrapper.text()).toContain('Beta');
    expect(wrapper.text()).not.toContain('Outside');

    await wrapper.get('img[alt="Alpha"]').trigger('click');
    expect(wrapper.emitted('open')).toEqual([['https://example.com/a']]);

    await wrapper.setProps({ expandedIds: new Set() });
    expect(wrapper.text()).not.toContain('Alpha');
  });
});
