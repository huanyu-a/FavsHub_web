import { createI18n } from 'vue-i18n'
import { languageStorage, type AppLanguage } from '@/utils/storage'

// 同步加载语言包（默认中文）
import zh from './locales/zh'
import en from './locales/en'

function isSupportedLanguage(value: string): value is AppLanguage {
  return value === 'zh' || value === 'en'
}

function getDefaultLanguage(): AppLanguage {
  if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) {
    return 'zh'
  }

  return 'en'
}

const i18n = createI18n({
  legacy: false,
  locale: getDefaultLanguage(),
  fallbackLocale: 'en',   // 备选语言
  messages: {
    zh,
    en
  },
  missingWarn: false,
  fallbackWarn: false
})

void languageStorage.getValue().then((savedLanguage) => {
  if (isSupportedLanguage(savedLanguage)) {
    i18n.global.locale.value = savedLanguage
  }
})

export const t = i18n.global.t
export default i18n
