/**
 * 欢迎消息管理器
 * 由后端设置驱动：showWelcomeMessage 控制是否显示，用户名从 FavsHubSettings 获取。
 * 颜色适配已移至 CSS（data-theme + CSS 自定义属性）。
 */
const WelcomeManager = {
    _timer: null,

    // 初始化
    initialize() {
        const showWelcome = FavsHubSettings.get('showWelcomeMessage');
        const welcomeElement = document.getElementById('welcome-message');
        if (!welcomeElement) return;

        if (showWelcome === false) {
            welcomeElement.style.display = 'none';
            welcomeElement.style.visibility = 'hidden';
            return;
        }

        welcomeElement.style.display = '';
        welcomeElement.style.visibility = 'visible';
        this.updateWelcomeMessage();
        this.scheduleNextUpdate();
    },

    // 更新欢迎消息
    updateWelcomeMessage() {
        const welcomeElement = document.getElementById('welcome-message');
        if (!welcomeElement) return;

        const hours = new Date().getHours();
        let greeting;
        if (hours < 12) {
            greeting = window.getLocalizedMessage('morningGreeting');
        } else if (hours < 18) {
            greeting = window.getLocalizedMessage('afternoonGreeting');
        } else {
            greeting = window.getLocalizedMessage('eveningGreeting');
        }

        // 优先从已登录用户的 nickname 获取，最后 FavsHubSettings
        let userName = '';
        try {
          const userInfo = JSON.parse(localStorage.getItem('favshub_user') || '{}');
          userName = userInfo.nickname || '';
        } catch {}
        if (!userName) {
          userName = FavsHubSettings.get('userName') || '';
        }
        welcomeElement.textContent = userName ? `${greeting}, ${userName}` : greeting;
    },

    // 计算距离下一个整点的毫秒数，用 setTimeout 精准更新
    scheduleNextUpdate() {
        if (this._timer) clearTimeout(this._timer);
        const now = new Date();
        const msUntilNextHour = (60 - now.getMinutes()) * 60 * 1000
            - now.getSeconds() * 1000
            - now.getMilliseconds();
        this._timer = setTimeout(() => {
            this.updateWelcomeMessage();
            this.scheduleNextUpdate();
        }, msUntilNextHour);
    },

    // 颜色适配已移至 CSS，保留空方法避免外部调用报错
    adjustTextColor() {}
};

// 导出给其他模块使用
window.WelcomeManager = WelcomeManager;

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    WelcomeManager.initialize();
});
