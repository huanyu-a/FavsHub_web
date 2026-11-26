import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import Search from '@/components/Search.vue';

vi.mock('@/i18n', () => ({ t: (key: string) => key }));

const NInputStub = defineComponent({
  name: 'NInput',
  props: { value: { type: String, default: '' } },
  emits: ['update:value'],
  template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});

describe('Search', () => {
  it('v-model 同时支持输入上抛和父级值下传', async () => {
    const Host = defineComponent({
      components: { Search },
      data: () => ({ query: 'initial' }),
      template: '<Search v-model="query" /><output>{{ query }}</output>',
    });
    const wrapper = mount(Host, {
      global: {
        stubs: { NInput: NInputStub, NIcon: true },
      },
    });

    const input = wrapper.get('input');
    expect((input.element as HTMLInputElement).value).toBe('initial');

    await input.setValue('bookmark keyword');
    expect(wrapper.vm.query).toBe('bookmark keyword');
    expect(wrapper.get('output').text()).toBe('bookmark keyword');

    wrapper.vm.query = 'from parent';
    await nextTick();
    expect((input.element as HTMLInputElement).value).toBe('from parent');
  });
});
