/**
 * PromptPro 提示词搜索集成
 * 在主项目搜索框中增加对提示词的搜索功能
 */

// PromptPro 提示词搜索
class PromptProSearch {
  constructor() {
    this.prompts = [];
    this.initialized = false;
  }

  // 从 IndexedDB 加载提示词
  async init() {
    if (this.initialized) {
      return;
    }

    try {
      // 检查 IndexedDB 是否存在 PromptPro 数据库
      const dbExists = await this.checkDatabaseExists();

      if (!dbExists) {
        return;
      }

      this.prompts = await this.loadPrompts();
      this.initialized = true;
    } catch (error) {
      console.error('[PromptPro Search] 初始化失败:', error);
    }
  }

  // 检查数据库是否存在
  async checkDatabaseExists() {
    return new Promise((resolve) => {
      const request = indexedDB.open('PromptProDB');
      request.onerror = () => resolve(false);
      request.onsuccess = (event) => {
        event.target.result.close();
        resolve(true);
      };
    });
  }

  // 加载所有提示词
  async loadPrompts() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PromptProDB');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const db = event.target.result;
        try {
          const transaction = db.transaction('prompts', 'readonly');
          const store = transaction.objectStore('prompts');
          const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
          const prompts = getAllRequest.result || [];
          // 同时加载文件夹和标签信息
          this.loadRelatedData(db).then(related => {
            this.folders = related.folders;
            this.tags = related.tags;
            this.tagRelations = related.tagRelations;
            
            // 关联文件夹和标签
            this.prompts = prompts.map(prompt => {
              const folder = this.folders.find(f => f.folder_id === prompt.folder_id);
              const relations = this.tagRelations.filter(r => r.prompt_id === prompt.prompt_id);
              const promptTags = relations.map(r => this.tags.find(t => t.tag_id === r.tag_id)).filter(Boolean);
              
              return {
                ...prompt,
                folder_name: folder ? folder.folder_name : '',
                tags: promptTags
              };
            });
            
            resolve(this.prompts);
          });
        };

        getAllRequest.onerror = () => reject(getAllRequest.error);
        } catch (e) {
          // IndexedDB 存储不存在（数据已迁移到服务端），返回空数组
          resolve([]);
        }
      };
    });
  }

  // 加载关联数据
  async loadRelatedData(db) {
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(['folders', 'tags', 'tag_relations'], 'readonly');

        const foldersStore = transaction.objectStore('folders');
        const tagsStore = transaction.objectStore('tags');
        const relationsStore = transaction.objectStore('tag_relations');

      const foldersRequest = foldersStore.getAll();
      const tagsRequest = tagsStore.getAll();
      const relationsRequest = relationsStore.getAll();

      let folders = [], tags = [], tagRelations = [];
      let completed = 0;

      const checkComplete = () => {
        completed++;
        if (completed === 3) {
          resolve({ folders, tags, tagRelations });
        }
      };

      foldersRequest.onsuccess = () => {
        folders = foldersRequest.result || [];
        checkComplete();
      };

      tagsRequest.onsuccess = () => {
        tags = tagsRequest.result || [];
        checkComplete();
      };

      relationsRequest.onsuccess = () => {
        tagRelations = relationsRequest.result || [];
        checkComplete();
      };
      } catch (e) {
        // IndexedDB 存储不存在（数据已迁移到服务端）
        resolve({ folders: [], tags: [], tagRelations: [] });
      }
    });
  }

  // 搜索提示词（支持多关键词模糊匹配）
  search(query) {
    if (!query || !this.initialized) {
      return [];
    }

    // 分词：按空格、中文标点、英文标点分隔
    const keywords = query
      .trim()
      .split(/[\s\u3000\u2000-\u206f\u3000-\u303f\uff00-\uffef,.!?;:，。！？；：、]+/)
      .filter(k => k.length > 0);

    if (keywords.length === 0) return [];

    const results = this.prompts
      .map(prompt => {
        const score = this.calculateScore(prompt, keywords);
        return score > 0 ? { ...prompt, _score: score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b._score - a._score);

    return results;
  }

  // 计算匹配分数（与 promptpro-storage.js 保持一致）
  calculateScore(prompt, keywords) {
    const title = (prompt.title || '').toLowerCase();
    const desc = (prompt.description || '').toLowerCase();
    const content = (prompt.content || '').toLowerCase();
    const folder = (prompt.folder_name || '').toLowerCase();
    const tagNames = (prompt.tags || []).map(t => (t.tag_name || '').toLowerCase());

    let totalScore = 0;
    let titleMatchedCount = 0;
    let tagMatchedCount = 0;
    let descMatchedCount = 0;
    let folderMatchedCount = 0;
    let contentMatchedCount = 0;

    for (const keyword of keywords) {
      // 标题匹配（权重最高）
      if (title.includes(keyword)) {
        if (title === keyword) totalScore += 10000;
        else if (title.startsWith(keyword)) totalScore += 8000;
        else totalScore += 5000;
        titleMatchedCount++;
      }

      // 标签匹配
      if (tagNames.some(tag => tag.includes(keyword))) {
        totalScore += 2000;
        tagMatchedCount++;
      }

      // 描述匹配
      if (desc.includes(keyword)) {
        if (desc.startsWith(keyword)) totalScore += 1500;
        else totalScore += 1000;
        descMatchedCount++;
      }

      // 文件夹匹配
      if (folder.includes(keyword)) {
        totalScore += 800;
        folderMatchedCount++;
      }

      // 内容匹配（权重最低）
      if (content.includes(keyword)) {
        totalScore += 300;
        contentMatchedCount++;
      }
    }

    // 标题中包含所有关键词时，给予极高奖励（精确匹配）
    if (titleMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 5000;
    }

    // 标签中包含所有关键词时，给予高奖励
    if (tagMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 3000;
    }

    // 描述中包含所有关键词时，给予中等奖励
    if (descMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 1500;
    }

    // 跨字段匹配奖励（标题+标签、标题+描述等）
    const fieldsMatched = [
      titleMatchedCount > 0,
      tagMatchedCount > 0,
      descMatchedCount > 0,
      folderMatchedCount > 0
    ].filter(Boolean).length;
    
    if (fieldsMatched >= 2 && keywords.length > 1) {
      totalScore += fieldsMatched * 1000;
    }

    return totalScore;
  }

  // 渲染搜索结果
  renderResults(results) {
    if (!results || results.length === 0) return '';

    return results.map(prompt => {
      const tagsHtml = (prompt.tags || []).slice(0, 2).map(tag => 
        `<span class="prompt-search-tag">${this.escapeHtml(tag.tag_name)}</span>`
      ).join('');

      return `
        <div class="prompt-search-result" data-prompt-id="${prompt.prompt_id}">
          <div class="prompt-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <div class="prompt-search-content">
            <div class="prompt-search-title">${this.escapeHtml(prompt.title)}</div>
            ${prompt.description ? `<div class="prompt-search-desc">${this.escapeHtml(prompt.description)}</div>` : ''}
            <div class="prompt-search-meta">
              ${prompt.folder_name ? `<span class="prompt-search-folder">${this.escapeHtml(prompt.folder_name)}</span>` : ''}
              ${tagsHtml}
            </div>
          </div>
          <div class="prompt-search-action">
            <button class="prompt-search-open-btn" title="打开编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 转义 HTML
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 获取最近使用的提示词
  getRecentPrompts(limit = 10) {
    if (!this.prompts || this.prompts.length === 0) {
      return [];
    }

    // 按更新时间排序，返回最近的提示词
    return [...this.prompts]
      .sort((a, b) => {
        const timeA = a.updated_at || a.created_at || 0;
        const timeB = b.updated_at || b.created_at || 0;
        return timeB - timeA;
      })
      .slice(0, limit);
  }

  // 打开提示词编辑
  openPromptEdit(promptId) {
    // 获取提示词数据
    const prompt = this.prompts.find(p => p.prompt_id === promptId);
    if (!prompt) return;

    // 通过 window.postMessage 通知 PromptPro 页面打开编辑
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      // 查找是否已打开 PromptPro 页面
      chrome.tabs.query({ url: '*://*/src/promptpro.html*' }, (tabs) => {
        if (tabs.length > 0) {
          // 如果已打开，发送消息
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'openPromptEdit',
            promptId: promptId
          }, (response) => {
            if (chrome.runtime.lastError) {
              // 如果消息发送失败，打开新标签页
              this.openPromptProInNewTab(promptId);
            }
          });
        } else {
          // 如果未打开，打开新标签页
          this.openPromptProInNewTab(promptId);
        }
      });
    }
  }

  // 在新标签页打开 PromptPro 并编辑提示词
  openPromptProInNewTab(promptId) {
    const url = chrome.runtime.getURL(`src/promptpro.html?edit=${promptId}`);
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url });
    } else {
      window.open(`promptpro.html?edit=${promptId}`, '_blank');
    }
  }
}

// 全局实例
window.promptProSearch = new PromptProSearch();

// 初始化 - 使用多种方式确保可靠执行
function initPromptProSearch() {
  if (window.promptProSearch.initialized) return;
  window.promptProSearch.init().catch(err => {
    console.error('[PromptPro Search] 初始化失败:', err);
  });
}

// 如果 DOMContentLoaded 已经触发，立即初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPromptProSearch);
} else {
  // DOM 已经加载完成
  initPromptProSearch();
}

// 也支持在 window load 时初始化（双重保险）
if (!window.promptProSearch.initialized) {
  window.addEventListener('load', () => {
    if (!window.promptProSearch.initialized) {
      initPromptProSearch();
    }
  });
}
