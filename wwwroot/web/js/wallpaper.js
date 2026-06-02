document.addEventListener('DOMContentLoaded', () => {
    BackgroundManager.initialize();
});

const BackgroundManager = {
    initialize() {
        this.initializeEventListeners();
        this.initializeBackground();
    },

    initializeEventListeners() {
        document.querySelectorAll('.settings-bg-option').forEach(option => {
            option.addEventListener('click', () => {
                this.handleBackgroundOptionClick(option);
            });
        });
    },

    handleBackgroundOptionClick(option) {
        this.clearAllActiveStates();

        option.classList.add('active');

        const bgClass = option.getAttribute('data-bg');
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDarkMode) {
            document.documentElement.className = bgClass;
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.className = bgClass;
        }

        FavsHubSettings.set('useDefaultBackground', 'true');

        const welcomeElement = document.getElementById('welcome-message');
        if (welcomeElement && window.WelcomeManager) {
            window.WelcomeManager.adjustTextColor(welcomeElement);
        }
    },

    clearAllActiveStates() {
        document.querySelectorAll('.settings-bg-option').forEach(option => {
            option.classList.remove('active');
        });
    },

    async initializeBackground() {
        await FavsHubSettings.load();

        const useDefaultBackground = FavsHubSettings.get('useDefaultBackground');
        const savedBg = FavsHubSettings.get('selectedBackground');
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

        this.clearAllActiveStates();

        if (String(useDefaultBackground) === 'true' && savedBg) {
            const bgOption = document.querySelector(`.settings-bg-option[data-bg="${savedBg}"]`);
            if (bgOption) {
                bgOption.classList.add('active');
                if (isDarkMode) {
                    document.documentElement.className = savedBg;
                    document.documentElement.setAttribute('data-theme', 'dark');
                } else {
                    document.documentElement.className = savedBg;
                }
            }
            return;
        }

        if (savedBg) {
            const bgOption = document.querySelector(`.settings-bg-option[data-bg="${savedBg}"]`);
            if (bgOption) {
                bgOption.classList.add('active');
                if (isDarkMode) {
                    document.documentElement.className = savedBg;
                    document.documentElement.setAttribute('data-theme', 'dark');
                } else {
                    document.documentElement.className = savedBg;
                }
            }
            return;
        }

        const defaultBgOption = document.querySelector('.settings-bg-option[data-bg="gradient-background-7"]');
        if (defaultBgOption) {
            defaultBgOption.classList.add('active');
            document.documentElement.className = 'gradient-background-7';
        }
    },

    resetBackground() {
        this.clearAllActiveStates();

        const defaultBgOption = document.querySelector('.settings-bg-option[data-bg="gradient-background-7"]');
        if (defaultBgOption) {
            defaultBgOption.classList.add('active');
            document.documentElement.className = 'gradient-background-7';
            FavsHubSettings.set('useDefaultBackground', 'true');
            FavsHubSettings.set('selectedBackground', 'gradient-background-7');
        }
    },

};

// ===== Year Progress Bar =====

document.addEventListener('DOMContentLoaded', function () {
    const yearProgressContainer = document.getElementById('year-progress');
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);
    const now = new Date();
    const yearProgress = ((now - startOfYear) / (endOfYear - startOfYear)) * 100;

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';

    for (let i = 0; i < 12; i++) {
        const progressSegment = document.createElement('div');
        if (i < Math.floor(yearProgress / 8.33)) {
            progressSegment.classList.add('active');
        }
        progressBar.appendChild(progressSegment);
    }

    const yearProgressElement = document.createElement('div');
    yearProgressElement.className = 'year-progress';
    const yearProgressText = chrome.i18n.getMessage('yearProgress');
    yearProgressElement.innerHTML = `<span>${currentYear} ${yearProgressText}</span>`;
    yearProgressElement.appendChild(progressBar);

    const progressPercentage = document.createElement('div');
    progressPercentage.className = 'progress-percentage';
    progressPercentage.textContent = `${yearProgress.toFixed(2)}%`;

    yearProgressContainer.appendChild(yearProgressElement);
    yearProgressContainer.appendChild(progressPercentage);
});