// 获取用户首选语言
function getUserLanguage() {
  try {
    if (chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
      return chrome.i18n.getUILanguage();
    }
  } catch (e) {}
  return navigator.language || 'zh-CN';
}

window.getLocalizedMessage = function(messageName) {
  const userLang = getUserLanguage();
  let message = '';
  try {
    if (chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
      message = chrome.i18n.getMessage(messageName);
    }
  } catch (e) {}

  // 如果没有找到消息，直接返回消息名称
  if (!message) {
    return messageName;
  }

  return message;
};

window.updateUILanguage = function() {
  const userLang = getUserLanguage();
  // console.log('Current UI language:', userLang); // 日志已移除

  // 处理常规的 data-i18n 属性
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const messageName = element.getAttribute('data-i18n');
    const localizedMessage = window.getLocalizedMessage(messageName);
    element.textContent = localizedMessage;
  });

  // 处理 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const messageName = element.getAttribute('data-i18n-placeholder');
    element.placeholder = window.getLocalizedMessage(messageName);
  });

  // 处理 title
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    const messageName = element.getAttribute('data-i18n-title');
    element.title = window.getLocalizedMessage(messageName);
  });
};

// 在文档加载完成后自动更新 UI 语言
document.addEventListener('DOMContentLoaded', window.updateUILanguage);
