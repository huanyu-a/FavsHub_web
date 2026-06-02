document.addEventListener('DOMContentLoaded', () => {
    // 检查 WelcomeManager 是否已经加载
    if (!window.WelcomeManager) {
        console.error('WelcomeManager not found. Make sure welcome.js is loaded before wallpaper.js');
    }
    const wallpaperManager = new WallpaperManager();
});

// WallpaperManager 类用于处理所有壁纸相关的操作
class WallpaperManager {
    constructor() {
        // 首先初始化所有必要的属性
        this.wallpaperOptions = document.querySelectorAll('.wallpaper-option');
        this.uploadInput = document.getElementById('upload-wallpaper');
        this.mainElement = document.querySelector('main');
        
        // 初始化预设壁纸列表
        this.initializePresetWallpapers();
        
        // 初始化预加载队列
        this.preloadQueue = new Set();
        this.preloadedImages = new Map();
        
        // 初始化用户壁纸数组
        this.userWallpapers = [];
        
        // 初始化其他属性
        this.activeOption = null;
        
        // 加载用户壁纸
        this.loadUserWallpapers();
        
        // 初始化事件监听和其他设置
        this.initializeEventListeners();
        this.initialize();
        
        // 初始化必应壁纸
        this.bingWallpapers = [];
        this.initBingWallpapers();
    }

    // 新增方法：初始化预设壁纸列表
    initializePresetWallpapers() {
        this.presetWallpapers = [
            {
                url: '/images/wallpapers/wallpaper-1.png',
                title: 'Foggy Forest'
            },
            {
                url: '/images/wallpapers/wallpaper-2.png',
                title: 'Mountain Lake'
            },
            {
                url: '/images/wallpapers/wallpaper-3.png',
                title: 'Sunset Beach'
            },
            {
                url: '/images/wallpapers/wallpaper-4.png',
                title: 'City Night'
            },
            {
                url: '/images/wallpapers/wallpaper-5.png',
                title: 'Aurora'
            },
            {
                url: '/images/wallpapers/wallpaper-6.png',
                title: 'Desert Dunes'
            },
            {
                url: '/images/wallpapers/wallpaper-7.png',
                title: 'Mountain View'
            },
            {
                url: '/images/wallpapers/wallpaper-8.png',
                title: 'Forest Lake'
            },
            {
                url: '/images/wallpapers/wallpaper-9.png',
                title: 'Sunset Hills'
            },
            {
                url: '/images/wallpapers/wallpaper-10.png',
                title: 'Ocean View'
            },
            {
                url: '/images/wallpapers/wallpaper-11.jpg',
                title: 'Ocean View1'
            },
            {
                url: '/images/wallpapers/wallpaper-12.jpg',
                title: 'Ocean View2'
            }
        ];
    }

    // 修改 loadPresetWallpapers 方法，添加错误处理
    async loadPresetWallpapers() {
        const wallpaperContainer = document.querySelector('.wallpaper-options');
        if (!wallpaperContainer) {
            // 设置面板已移至后台，静默跳过
            return;
        }
        
        wallpaperContainer.innerHTML = '';

        // 添加预设壁纸
        if (Array.isArray(this.presetWallpapers)) {
            this.presetWallpapers.forEach(preset => {
                const option = this.createWallpaperOption(preset.url, preset.title);
                wallpaperContainer.appendChild(option);
            });
        }

        // 添加用户上传的壁纸
        if (Array.isArray(this.userWallpapers)) {
            this.userWallpapers.forEach(wallpaper => {
                const option = this.createWallpaperOption(
                    wallpaper.url,
                    chrome.i18n.getMessage('uploadedWallpaperBadge'),
                    true
                );
                wallpaperContainer.appendChild(option);
            });
        }
    }

    initialize() {
        this.preloadWallpapers();
        this.loadPresetWallpapers();
        this.initializeWallpaper().then(() => {
            document.documentElement.classList.remove('loading-wallpaper');
        });
    }

    initializeEventListeners() {
        // 初始化上传事件监听（元素可能不存在）
        if (this.uploadInput) {
            this.uploadInput.addEventListener('change', (event) => this.handleFileUpload(event));
        }

        // 初始化重置按钮事件监听
        const resetButton = document.getElementById('reset-wallpaper');
        if (resetButton) {
            resetButton.addEventListener('click', () => this.resetWallpaper());
        }

        // 添加图片加载错误处理
        window.addEventListener('error', (e) => this.handleImageError(e), true);

        // 添加检查缓存按钮事件监听
        const checkCacheButton = document.getElementById('check-wallpaper-cache');
        if (checkCacheButton) {
            checkCacheButton.addEventListener('click', () => this.checkWallpaperCache());
        }

        // 纯色背景选项的点击事件
        document.querySelectorAll('.settings-bg-option').forEach(option => {
            option.addEventListener('click', () => {
                this.handleBackgroundOptionClick(option);
            });
        });

        // 壁纸选项的点击事件
        document.querySelectorAll('.wallpaper-option').forEach(option => {
            option.addEventListener('click', () => {
                this.handleWallpaperOptionClick(option);
            });
        });
    }

    handleBackgroundOptionClick(option) {
        // 移除所有选项的 active 状态
        this.clearAllActiveStates();
        
        // 设置当前选项为 active
        option.classList.add('active');
        this.activeOption = option;
        
        // 应用纯色背景
        const bgClass = option.getAttribute('data-bg');
        // 检查是否为暗黑模式
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDarkMode) {
            // 在暗黑模式下保持暗色背景
            document.documentElement.className = bgClass;
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.className = bgClass;
        }
        
        // 清除壁纸
        this.clearWallpaper();
        FavsHubSettings.set('useDefaultBackground', 'true');
        
        // 更新欢迎消息颜色
        const welcomeElement = document.getElementById('welcome-message');
        if (welcomeElement && window.WelcomeManager) {
            window.WelcomeManager.adjustTextColor(welcomeElement);
        }
    }

    handleWallpaperOptionClick(option) {
        // 移除所有选项的 active 状态
        this.clearAllActiveStates();
        
        // 设置当前选项为 active
        option.classList.add('active');
        this.activeOption = option;
        
        // 应用壁纸
        const wallpaperUrl = option.getAttribute('data-wallpaper-url');
        this.setWallpaper(wallpaperUrl);
        
        // 清除纯色背景
        document.documentElement.className = '';
        localStorage.removeItem('useDefaultBackground');
    }

    clearAllActiveStates() {
        // 清除所有纯色背景选项的 active 状态
        document.querySelectorAll('.settings-bg-option').forEach(option => {
            option.classList.remove('active');
        });
        
        // 清除所有壁纸选项的 active 状态
        document.querySelectorAll('.wallpaper-option').forEach(option => {
            option.classList.remove('active');
        });
        // 清除所有必应壁纸选项的 active 状态
        document.querySelectorAll('.bing-wallpaper-item').forEach(option => {
            option.classList.remove('active');
        });
    }

    // 优化预加载方法
    preloadWallpapers() {
        this.presetWallpapers.forEach(preset => {
            if (!this.preloadedImages.has(preset.url)) {
                const img = new Image();
                img.src = preset.url;
                this.preloadQueue.add(preset.url);
                
                img.onload = () => {
                    this.preloadedImages.set(preset.url, img);
                    this.preloadQueue.delete(preset.url);
                };
            }
        });
    }

    // 初始化壁纸状态
    // 优先级：用户壁纸 > 用户纯色背景 > 管理员壁纸 URL > 管理员纯色背景 > 硬编码默认
    async initializeWallpaper() {
        // 等待设置从后端加载完成，确保能读取到管理员系统默认
        await FavsHubSettings.load();

        const savedWallpaper = localStorage.getItem('originalWallpaper');
        const useDefaultBackground = FavsHubSettings.get('useDefaultBackground');
        const savedBg = FavsHubSettings.get('selectedBackground');
        const adminWallpaper = FavsHubSettings.get('wallpaperUrl');
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

        // 清除所有选中状态
        this.clearAllActiveStates();

        // 1. 用户明确设置的壁纸（本地存储）
        if (savedWallpaper) {
            let wallpaperOption = document.querySelector(`.wallpaper-option[data-wallpaper-url="${savedWallpaper}"]`);
            if (!wallpaperOption) {
                await this.loadPresetWallpapers();
                wallpaperOption = document.querySelector(`.wallpaper-option[data-wallpaper-url="${savedWallpaper}"]`);
            }
            if (wallpaperOption) {
                wallpaperOption.classList.add('active');
                this.activeOption = wallpaperOption;
            }
            await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => { this.applyWallpaper(savedWallpaper); resolve(); };
                img.onerror = resolve;
                img.src = savedWallpaper;
            });
            return;
        }

        // 2. 用户明确选择的纯色背景（通过设置侧边栏选择，兼容 boolean true 和字符串 'true'）
        if (String(useDefaultBackground) === 'true' && savedBg) {
            const bgOption = document.querySelector(`.settings-bg-option[data-bg="${savedBg}"]`);
            if (bgOption) {
                bgOption.classList.add('active');
                this.activeOption = bgOption;
                if (isDarkMode) {
                    document.documentElement.className = savedBg;
                    document.documentElement.setAttribute('data-theme', 'dark');
                } else {
                    document.documentElement.className = savedBg;
                }
            }
            return;
        }

        // 3. 管理员设置的壁纸 URL（系统默认，不持久化到 localStorage，允许管理员后续修改生效）
        if (adminWallpaper) {
            await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => { this.applyWallpaper(adminWallpaper); resolve(); };
                img.onerror = resolve;
                img.src = adminWallpaper;
            });
            return;
        }

        // 4. 管理员设置的纯色背景（系统默认，用户无偏好时生效）
        if (savedBg) {
            const bgOption = document.querySelector(`.settings-bg-option[data-bg="${savedBg}"]`);
            if (bgOption) {
                bgOption.classList.add('active');
                this.activeOption = bgOption;
                if (isDarkMode) {
                    document.documentElement.className = savedBg;
                    document.documentElement.setAttribute('data-theme', 'dark');
                } else {
                    document.documentElement.className = savedBg;
                }
            }
            return;
        }

        // 5. 最终兜底：硬编码默认背景（不写入用户设置，避免覆盖管理员后续配置）
        const defaultBgOption = document.querySelector('.settings-bg-option[data-bg="gradient-background-7"]');
        if (defaultBgOption) {
            defaultBgOption.classList.add('active');
            this.activeOption = defaultBgOption;
            document.documentElement.className = 'gradient-background-7';
        }
    }

    // 重置壁纸
    resetWallpaper() {
        // 清除所有选中状态
        this.clearAllActiveStates();
        this.clearWallpaper();
        
        // 设置默认背景
        const defaultBgOption = document.querySelector('.settings-bg-option[data-bg="gradient-background-7"]');
        if (defaultBgOption) {
            defaultBgOption.classList.add('active');
            this.activeOption = defaultBgOption;
            document.documentElement.className = 'gradient-background-7';
            // 保存默认背景设置
            FavsHubSettings.set('useDefaultBackground', 'true');
            FavsHubSettings.set('selectedBackground', 'gradient-background-7');
        }
        
        // 使用本地化的成功提示
        alert(chrome.i18n.getMessage('wallpaperResetSuccess'));
    }

    // 清除壁纸样式
    clearWallpaper() {
        document.body.classList.remove('has-wallpaper');
        document.body.style.removeProperty('--wallpaper-image');
        document.body.style.backgroundImage = 'none';
        this.mainElement.style.backgroundImage = 'none';
    }

    // 修改应用壁纸方法
    applyWallpaper(url) {
        const backgroundStyle = {
            backgroundImage: `url("${url}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundAttachment: 'fixed'
        };

        // 使用 requestAnimationFrame 确保样式更新在下一帧执行
        requestAnimationFrame(() => {
            document.body.classList.add('has-wallpaper');
            document.body.style.setProperty('--wallpaper-image', `url("${url}")`);
            Object.assign(this.mainElement.style, backgroundStyle);
            Object.assign(document.body.style, backgroundStyle);
            
            // 更新欢迎消息颜色
            const welcomeElement = document.getElementById('welcome-message');
            if (welcomeElement && window.WelcomeManager) {
                window.WelcomeManager.adjustTextColor(welcomeElement);
            }
        });
    }

    // 设置新壁纸
    async setWallpaper(url) {
        if (!url) return;

        try {
            // 如果是 Unsplash 图片，添加优化参数
            if (url.includes('images.unsplash.com')) {
                url = `${url}?q=80&w=1920&auto=format&fit=crop`;
            }

            localStorage.removeItem('useDefaultBackground');
            document.querySelectorAll('.settings-bg-option').forEach(option => {
                option.classList.remove('active');
            });
            document.documentElement.className = '';
            await this.applyAndSaveWallpaper(url);
        } catch (error) {
            console.error('设置壁纸失败:', error);
            alert('设置壁纸失败，请重试');
        }
    }

    // 修改 applyAndSaveWallpaper 方法
    async applyAndSaveWallpaper(dataUrl) {
        try {
            // 在保存新壁纸前，先清除所有相关的存储
            this.clearWallpaperCache();
            
            // 压缩图片数据以减少存储大小
            const compressedDataUrl = await this.compressImageForStorage(dataUrl);
            
            try {
                // 尝试保存压缩后的数据
                localStorage.setItem('originalWallpaper', compressedDataUrl);
            } catch (storageError) {
                console.warn('无法保存壁纸到本地存储，将只保存在内存中');
            }
            
            // 更新内存缓存
            if (this.wallpaperCache) {
                URL.revokeObjectURL(this.wallpaperCache.src);
                this.wallpaperCache.src = '';
            }
            this.wallpaperCache = new Image();
            this.wallpaperCache.src = dataUrl;

            // 应用壁纸
            await this.applyWallpaper(dataUrl);
        } catch (error) {
            console.error('Failed to save wallpaper:', error);
            alert('设置壁纸失败，请重试');
        }
    }

    // 添加新方法：压缩图片数据
    async compressImageForStorage(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // 计算压缩后的尺寸，最大宽度1920px
                const maxWidth = 1920;
                const scale = Math.min(1, maxWidth / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // 使用较低的质量来减少数据大小
                const compressedDataUrl = canvas.toDataURL('image/jpeg', 1);
                
                // 清理内存
                URL.revokeObjectURL(img.src);
                resolve(compressedDataUrl);
            };
            img.src = dataUrl;
        });
    }

    // 创建缩略图
    createThumbnail(dataUrl, callback) {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const thumbnailSize = { width: 200, height: 200 };

            canvas.width = thumbnailSize.width;
            canvas.height = thumbnailSize.height;
            ctx.drawImage(img, 0, 0, thumbnailSize.width, thumbnailSize.height);

            const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.7);
            callback(thumbnailDataUrl);
        };
        img.src = dataUrl;
    }

    // 处理文件上传
    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!this.validateFile(file)) return;

        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const compressedDataUrl = await this.compressImageForStorage(e.target.result);
                
                // 保存到用户壁纸列表
                this.userWallpapers.unshift({
                    url: compressedDataUrl,
                    title: '自定义壁纸',
                    timestamp: Date.now()
                });

                // 修改限制数量，比如改为10张
                const MAX_WALLPAPERS = 1;
                if (this.userWallpapers.length > MAX_WALLPAPERS) {
                    // 删除最旧的壁纸
                    const removedWallpapers = this.userWallpapers.splice(MAX_WALLPAPERS);
                    // 清理被删除壁纸的资源
                    removedWallpapers.forEach(wallpaper => {
                        if (wallpaper.url) {
                            URL.revokeObjectURL(wallpaper.url);
                        }
                    });
                }

                // 保存到localStorage
                try {
                    localStorage.setItem('userWallpapers', JSON.stringify(this.userWallpapers));
                } catch (storageError) {
                    console.warn('Storage quota exceeded, removing oldest wallpapers');
                    // 如果存储失败，继续删除旧壁纸直到能够存储为止
                    while (this.userWallpapers.length > 1) {
                        this.userWallpapers.pop();
                        try {
                            localStorage.setItem('userWallpapers', JSON.stringify(this.userWallpapers));
                            break;
                        } catch (e) {
                            continue;
                        }
                    }
                }

                await this.loadPresetWallpapers();
                await this.setWallpaper(compressedDataUrl);
                
            } catch (error) {
                console.error('处理壁纸时出错:', error);
                alert('设置壁纸失败，请重试');
            }
        };
        reader.onerror = () => alert(chrome.i18n.getMessage('fileReadError'));
        reader.readAsDataURL(file);
        
        event.target.value = '';
    }

    // 验证上传的文件
    validateFile(file) {
        if (!file) return false;
        if (!file.type.startsWith('image/')) {
            alert(chrome.i18n.getMessage('pleaseUploadImage'));
            return false;
        }
        if (file.size > 10 * 1024 * 1024) {
            alert(chrome.i18n.getMessage('imageSizeExceeded'));
            return false;
        }
        return true;
    }

    // 获取最大屏幕分辨率
    getMaxScreenResolution() {
        const pixelRatio = window.devicePixelRatio || 1;
        let maxWidth = window.screen.width;
        let maxHeight = window.screen.height;

        // 设置基准分辨率为1920x1080
        const baseWidth = 1920;
        const baseHeight = 1080;

        // 如果是高分屏，适当提高分辨率，但不超过2K
        if (pixelRatio > 1) {
            maxWidth = Math.min(maxWidth * pixelRatio, 2560);
            maxHeight = Math.min(maxHeight * pixelRatio, 1440);
        }

        // 返回较小的值：实际分辨率或基准分辨率
        return {
            width: Math.min(maxWidth, baseWidth),
            height: Math.min(maxHeight, baseHeight)
        };
    }

    // 计算最大文件大小
    calculateMaxFileSize() {
        const maxResolution = this.getMaxScreenResolution();
        const pixelCount = maxResolution.width * maxResolution.height;
        const baseSize = pixelCount * 4; // 4 bytes per pixel (RGBA)

        // 简化压缩比率
        let compressionRatio = 0.7; // 默认70%质量
        if (pixelCount > 1920 * 1080) {
            compressionRatio = 0.5; // 更高分辨率使用50%质量
        }

        // 限制最终文件大小在2MB到5MB之间
        const maxSize = Math.round(baseSize * compressionRatio);
        return Math.min(Math.max(maxSize, 2 * 1024 * 1024), 5 * 1024 * 1024);
    }

    // 压缩并设置壁纸
    compressAndSetWallpaper(img, maxResolution) {
        // 先生成并显示低质量预览
        const previewCanvas = document.createElement('canvas');
        const previewCtx = previewCanvas.getContext('2d');
        const previewWidth = Math.round(img.width * 0.1);
        const previewHeight = Math.round(img.height * 0.1);
        
        previewCanvas.width = previewWidth;
        previewCanvas.height = previewHeight;
        previewCtx.drawImage(img, 0, 0, previewWidth, previewHeight);
        
        // 显示模糊预览
        const previewUrl = previewCanvas.toDataURL('image/jpeg', 0.5);
        this.setWallpaper(previewUrl);

        // 然后异步处理高质量版本
        requestAnimationFrame(() => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // 保持图片比例
            const ratio = Math.min(
                maxResolution.width / img.width,
                maxResolution.height / img.height
            );
            
            const width = Math.round(img.width * ratio);
            const height = Math.round(img.height * ratio);

            canvas.width = width;
            canvas.height = height;

            // 使用更好的图像平滑算法
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            ctx.drawImage(img, 0, 0, width, height);

            // 使用较高的压缩质量
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            this.setWallpaper(compressedDataUrl);
        });
    }

    // 处理图片加载错误
    handleImageError(e) {
        if (e.target.tagName === 'IMG' || e.target.tagName === 'IMAGE') {
            console.error('图片加载失败:', e.target.src);
            if (e.target.src !== this.defaultWallpaper) {
                this.setWallpaper(this.defaultWallpaper);
            }
        }
    }

    // 添加新方法：创建壁纸选项元素
    createWallpaperOption(url, title, isUploaded = false) {
        const option = document.createElement('div');
        option.className = 'wallpaper-option';
        option.dataset.wallpaperUrl = url;
        option.title = title;
        option.style.backgroundImage = `url('${url}')`;

        // 如果是上传的壁纸，添加标识
        if (isUploaded) {
            const badge = document.createElement('span');
            badge.className = 'uploaded-wallpaper-badge';
            badge.textContent = chrome.i18n.getMessage('uploadedWallpaperBadge');
            option.appendChild(badge);
        }

        option.addEventListener('click', () => {
            document.querySelectorAll('.settings-bg-option').forEach(opt => {
                opt.classList.remove('active');
            });
            document.querySelectorAll('.wallpaper-option').forEach(opt => {
                opt.classList.remove('active');
            });
            option.classList.add('active');
            document.documentElement.className = '';
            this.setWallpaper(url);
        });

        return option;
    }

    // 新增：生成缩略图方法
    generateThumbnail(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // 计算合适的缩略图尺寸
                const maxSize = 150; // 更小的缩略图尺寸
                const ratio = Math.min(maxSize / img.width, maxSize / img.height);
                const width = Math.round(img.width * ratio);
                const height = Math.round(img.height * ratio);

                canvas.width = width;
                canvas.height = height;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // 使用webp格式（如果浏览器支持）
                if (this.supportsWebP()) {
                    resolve(canvas.toDataURL('image/webp', 0.8));
                } else {
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                }
            };

            img.onerror = reject;
            img.src = imageUrl;
        });
    }

    // 检查WebP支持
    supportsWebP() {
        const canvas = document.createElement('canvas');
        return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    }

    // 添加清理缓存的方法
    clearWallpaperCache() {
        if (this.wallpaperCache) {
            URL.revokeObjectURL(this.wallpaperCache.src);
            this.wallpaperCache.src = '';
            this.wallpaperCache = null;
        }
        
        localStorage.removeItem('originalWallpaper');
        localStorage.removeItem('selectedWallpaper');
        localStorage.removeItem('wallpaperThumbnail');
        // 不要清除用户壁纸列表
        // localStorage.removeItem('userWallpapers');
    }

    // 添加加载在线壁纸的方法
    loadOnlineWallpapers() {
        const container = document.querySelector('.wallpaper-options-container');
        if (!container) return;

        this.onlineWallpapers.forEach(wallpaper => {
            const option = document.createElement('div');
            option.className = 'wallpaper-option';
            option.setAttribute('data-wallpaper-url', wallpaper.url);
            
            // 创建缩略图
            const img = document.createElement('img');
            img.src = wallpaper.thumbnail;
            img.alt = 'Online Wallpaper';
            img.className = 'wallpaper-thumbnail';
            
            option.appendChild(img);
            container.appendChild(option);

            // 添加点击事件
            option.addEventListener('click', () => {
                this.setWallpaper(wallpaper.url);
            });
        });
    }

    // 添加新方法：加载用户壁纸
    loadUserWallpapers() {
        try {
            const savedWallpapers = localStorage.getItem('userWallpapers');
            if (savedWallpapers) {
                this.userWallpapers = JSON.parse(savedWallpapers);
                // 验证每个壁纸的有效性
                this.userWallpapers = this.userWallpapers.filter(wallpaper => {
                    return wallpaper && wallpaper.url && typeof wallpaper.url === 'string';
                });
                // 更新localStorage
                localStorage.setItem('userWallpapers', JSON.stringify(this.userWallpapers));
            }
        } catch (error) {
            console.error('Failed to load user wallpapers:', error);
            this.userWallpapers = [];
        }
    }

    // 修改 getLocalizedMessage 方法以支持参数
    getLocalizedMessage(key, fallback, substitutions = []) {
        try {
            const message = chrome.i18n.getMessage(key, substitutions);
            return message || fallback;
        } catch (error) {
            console.warn(`Failed to get localized message for key: ${key}`, error);
            if (substitutions.length > 0) {
                // 如果有替换参数，手动替换fallback中的占位符
                return fallback.replace(/\$1/g, substitutions[0])
                             .replace(/\$2/g, substitutions[1]);
            }
            return fallback;
        }
    }

    // 修改显示分辨率警告的代码
    handleFileRead(e, file, maxSize) {
        const img = new Image();
        img.onload = () => {
            const maxResolution = this.getMaxScreenResolution();
            
            if (img.width < maxResolution.width || img.height < maxResolution.height) {
                // 传递分辨率参数
                const warning = this.getLocalizedMessage(
                    'lowResolutionWarning',
                    `图片分辨率过低，建议使用至少 ${maxResolution.width}x${maxResolution.height} 的图片以获得最佳效果`,
                    [maxResolution.width.toString(), maxResolution.height.toString()]
                );
                alert(warning);
            }

            try {
                if (file.size <= maxSize) {
                    this.setWallpaper(e.target.result);
                } else {
                    this.compressAndSetWallpaper(img, maxResolution);
                }
            } catch (error) {
                console.error('处理壁纸时出错:', error);
                alert(this.getLocalizedMessage('wallpaperSetError', '设置壁纸失败，请重试'));
            } finally {
                URL.revokeObjectURL(img.src);
            }
        };
        img.onerror = () => {
            alert(this.getLocalizedMessage('imageLoadError', '图片加载失败，请尝试其他图片'));
            URL.revokeObjectURL(img.src);
        };
        img.src = e.target.result;
    }

    // 初始化必应壁纸
    async initBingWallpapers() {
        try {
            // 获取8天的必应壁纸
            const wallpapers = await this.fetchBingWallpapers(4);
            this.bingWallpapers = wallpapers;
            
            // 渲染壁纸
            this.renderBingWallpapers();
        } catch (error) {
            console.error('Failed to initialize Bing wallpapers:', error);
        }
    }

    // 获取必应壁纸
    async fetchBingWallpapers(count = 4) {
        try {
            // 通过服务端代理获取 Bing 壁纸（避免浏览器 CORS 限制）
            const response = await fetch('/api/bing-wallpaper');
            const data = await response.json();
            
            if (!data?.images) {
                console.error('No images data in response');
                return [];
            }

            // 使用解构赋值和箭头函数简化代码
            return data.images.map(({ url, title, copyright, startdate }) => ({
                // 使用中国的必应域名
                url: `https://cn.bing.com${url}`,
                title: title || copyright?.split('(')[0]?.trim() || 'Bing Wallpaper',
                copyright,
                date: startdate
            }));
        } catch (error) {
            console.error('Failed to fetch Bing wallpapers:', error);
            return [];
        }
    }

    // 渲染必应壁纸
    renderBingWallpapers() {
        const container = document.querySelector('.bing-wallpapers-grid');
        if (!container) return;
        
        container.innerHTML = '';
        const fragment = document.createDocumentFragment();
        this.bingWallpapers.forEach(wallpaper => 
            fragment.appendChild(this.createBingWallpaperElement(wallpaper))
        );
        container.appendChild(fragment);
    }

    // 创建必应壁纸元素
    createBingWallpaperElement(wallpaper) {
        const { url, title, date } = wallpaper;
        const element = document.createElement('div');
        element.className = 'bing-wallpaper-item';
        element.setAttribute('data-wallpaper-url', url);
        element.title = title;
        element.innerHTML = `
            <div class="bing-wallpaper-thumbnail" style="background-image: url(${url})"></div>
            <div class="bing-wallpaper-info">
                <div class="bing-wallpaper-title">${title}</div>
                <div class="bing-wallpaper-date">${this.formatDate(date)}</div>
            </div>
        `;

        // 修改点击事件，使用 handleWallpaperOptionClick
        element.addEventListener('click', () => {
            this.handleWallpaperOptionClick(element);
        });

        return element;
    }

    // 格式化日期
    formatDate(dateStr) {
        try {
            const year = dateStr.slice(0, 4);
            const month = parseInt(dateStr.slice(4, 6));
            const day = parseInt(dateStr.slice(6, 8));
            const date = new Date(year, month - 1, day);
            return `${month}月${day}日`;
        } catch (error) {
            console.error('Error formatting date:', error);
            return dateStr;
        }
    }
}

function optimizeMemoryUsage(img) {
    // 在压缩完成后释放原始图片内存
    const url = img.src;
    img.onload = null;
    img.src = '';
    URL.revokeObjectURL(url);
}
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

    function updateColors() {
        if (typeof window.adjustTextColor === 'function') {
            const yearTextSpan = yearProgressElement.querySelector('span');
            const activeSegments = progressBar.querySelectorAll('.active');
            const inactiveSegments = progressBar.querySelectorAll('div:not(.active)');
            
            const backgroundImage = document.body.style.backgroundImage;
            if (!backgroundImage) return;

            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = backgroundImage.slice(5, -2);

            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const sampleSize = 50;
                canvas.width = sampleSize;
                canvas.height = sampleSize;
                ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

                try {
                    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
                    const data = imageData.data;
                    let r = 0, g = 0, b = 0;
                    let count = 0;

                    for (let x = 0, len = data.length; x < len; x += 4) {
                        r += data[x];
                        g += data[x + 1];
                        b += data[x + 2];
                        count++;
                    }

                    r = Math.floor(r / count);
                    g = Math.floor(g / count);
                    b = Math.floor(b / count);

                    const brightness = (r * 0.299 + g * 0.587 + b * 0.114);

                    yearTextSpan.style.color = brightness > 128 ? 
                        `rgba(${Math.max(0, r - 160)}, ${Math.max(0, g - 160)}, ${Math.max(0, b - 160)}, 0.75)` : 
                        `rgba(${Math.min(255, (255 - r) + 80)}, ${Math.min(255, (255 - g) + 80)}, ${Math.min(255, (255 - b) + 80)}, 0.75)`;
                    yearTextSpan.style.textShadow = 'none';
                    yearTextSpan.style.transition = 'color 0.3s ease';

                    progressPercentage.style.color = yearTextSpan.style.color;
                    progressPercentage.style.textShadow = 'none';
                    progressPercentage.style.transition = 'color 0.3s ease';

                    activeSegments.forEach(segment => {
                        if (brightness > 128) {
                            const darkR = Math.max(0, r - 160);
                            const darkG = Math.max(0, g - 160);
                            const darkB = Math.max(0, b - 160);
                            segment.style.backgroundColor = `rgba(${darkR}, ${darkG}, ${darkB}, 0.3)`;
                        } else {
                            const lightR = Math.min(255, (255 - r) + 80);
                            const lightG = Math.min(255, (255 - g) + 80);
                            const lightB = Math.min(255, (255 - b) + 80);
                            segment.style.backgroundColor = `rgba(${lightR}, ${lightG}, ${lightB}, 0.3)`;
                        }
                        segment.style.boxShadow = 'none';
                        segment.style.transition = 'background-color 0.3s ease';
                    });

                    inactiveSegments.forEach(segment => {
                        if (brightness > 128) {
                            segment.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.1)`;
                        } else {
                            segment.style.backgroundColor = `rgba(255, 255, 255, 0.1)`;
                        }
                        segment.style.boxShadow = 'none';
                        segment.style.transition = 'background-color 0.3s ease';
                    });

                } catch (error) {
                    console.error('分析背景颜色失败:', error);
                }
            };
        }
    }

    updateColors();

    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'attributes' && 
                mutation.attributeName === 'style' && 
                mutation.target === document.body) {
                updateColors();
            }
        });
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['style']
    });
});