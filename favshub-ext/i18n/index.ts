import { ref } from 'vue'
import zh from './locales/zh'
import en from './locales/en'
import { currentLanguage } from '@/utils/server-errors'

/**
 * 轻量 i18n：不依赖 vue-i18n（避免其消息编译器撑大 bundle）。
 * locale 为 reactive ref，切换语言后所有 t() 调用自动更新。
 */
const dictionaries: Record<'zh' | 'en', Record<string, string>> = {
  zh: zh as Record<string, string>,
  en: en as Record<string, string>,
}

/** 当前语言（响应式） */
export const locale = ref<'zh' | 'en'>('zh')

void currentLanguage().then((l) => {
  locale.value = l
})

export function setLocale(l: 'zh' | 'en') {
  locale.value = l
}

/** 翻译：当前语言缺失时回落英文，再回落 key 本身；支持 {name} 插值 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[locale.value]
  let text = dict?.[key] ?? dictionaries.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}
