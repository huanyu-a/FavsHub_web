/**
 * 预设官方精选集数据 + seed 函数
 * 在数据库为空时自动填充
 */
import type Database from 'better-sqlite3'
import { upsertPoolBookmark } from './collection-bookmarks'

export interface SeedCollectionBookmark {
  title: string
  url: string
  icon?: string
  description?: string
  category_name: string
  sort_order?: number
}

export interface SeedCollection {
  name: string
  description: string
  icon: string
  bookmarks: SeedCollectionBookmark[]
}

export const DEFAULT_COLLECTIONS: SeedCollection[] = [
  {
    name: 'AI 开发者工具',
    description: 'AI 编程助手、模型平台、开发框架一站式收藏',
    icon: 'ri-robot-2-line',
    bookmarks: [
      { title: 'ChatGPT', url: 'https://chat.openai.com', description: 'OpenAI 对话式 AI', category_name: '对话 AI', sort_order: 1 },
      { title: 'Claude', url: 'https://claude.ai', description: 'Anthropic 安全 AI 助手', category_name: '对话 AI', sort_order: 2 },
      { title: 'DeepSeek', url: 'https://chat.deepseek.com', description: '深度求索 AI 对话', category_name: '对话 AI', sort_order: 3 },
      { title: 'Kimi', url: 'https://kimi.moonshot.cn', description: '月之暗面长文本 AI', category_name: '对话 AI', sort_order: 4 },
      { title: 'Cursor', url: 'https://www.cursor.com', description: 'AI 代码编辑器', category_name: '编程工具/AI 编辑器', sort_order: 1 },
      { title: 'GitHub Copilot', url: 'https://github.com/features/copilot', description: 'GitHub AI 编程助手', category_name: '编程工具/AI 编辑器', sort_order: 2 },
      { title: 'Bolt.new', url: 'https://bolt.new', description: 'AI 全栈 Web 开发', category_name: '编程工具/开发部署', sort_order: 3 },
      { title: 'v0.dev', url: 'https://v0.dev', description: 'Vercel AI UI 生成器', category_name: '编程工具/开发部署', sort_order: 4 },
      { title: 'Replit', url: 'https://replit.com', description: '在线 AI 编程环境', category_name: '编程工具/开发部署', sort_order: 5 },
      { title: 'Hugging Face', url: 'https://huggingface.co', description: 'AI 模型和数据集平台', category_name: '模型平台', sort_order: 1 },
      { title: 'Replicate', url: 'https://replicate.com', description: 'API 调用 AI 模型', category_name: '模型平台', sort_order: 2 },
      { title: 'Poe', url: 'https://poe.com', description: '多模型 AI 聚合平台', category_name: '模型平台', sort_order: 3 },
      { title: 'Coze', url: 'https://www.coze.cn', description: '字节跳动 AI Bot 平台', category_name: '模型平台', sort_order: 4 },
    ],
  },
  {
    name: '设计师资源',
    description: 'UI 设计、配色、图标、字体、灵感必备',
    icon: 'ri-palette-line',
    bookmarks: [
      { title: 'Dribbble', url: 'https://dribbble.com', description: '全球设计师作品展示', category_name: '灵感社区', sort_order: 1 },
      { title: 'Behance', url: 'https://www.behance.net', description: 'Adobe 设计师社区', category_name: '灵感社区', sort_order: 2 },
      { title: 'Mobbin', url: 'https://mobbin.com', description: 'App 设计模式参考库', category_name: '灵感社区', sort_order: 3 },
      { title: 'Coolors', url: 'https://coolors.co', description: '一键生成配色方案', category_name: '配色工具', sort_order: 1 },
      { title: 'Adobe Color', url: 'https://color.adobe.com', description: 'Adobe 配色轮', category_name: '配色工具', sort_order: 2 },
      { title: 'MyColor.space', url: 'https://mycolor.space', description: '渐变色生成器', category_name: '配色工具', sort_order: 3 },
      { title: 'Iconify', url: 'https://iconify.design', description: '开源图标库聚合', category_name: '图标资源', sort_order: 1 },
      { title: 'Iconfont', url: 'https://www.iconfont.cn', description: '阿里图标库', category_name: '图标资源', sort_order: 2 },
      { title: 'Phosphor Icons', url: 'https://phosphoricons.com', description: '简洁线性图标集', category_name: '图标资源', sort_order: 3 },
      { title: 'Google Fonts', url: 'https://fonts.google.com', description: '免费 Web 字体库', category_name: '字体资源', sort_order: 1 },
      { title: '猫啃网', url: 'https://www.maoken.com', description: '免费商用字体下载', category_name: '字体资源', sort_order: 2 },
      { title: 'Figma', url: 'https://www.figma.com', description: '在线协同设计工具', category_name: '设计工具/界面设计', sort_order: 1 },
      { title: 'Framer', url: 'https://www.framer.com', description: '动效+设计+建站', category_name: '设计工具/界面设计', sort_order: 2 },
      { title: 'Canva', url: 'https://www.canva.cn', description: '在线平面设计平台', category_name: '设计工具/平面设计', sort_order: 3 },
    ],
  },
  {
    name: '产品经理工具箱',
    description: 'PRD 撰写、原型设计、数据分析、竞品研究',
    icon: 'ri-bar-chart-grouped-line',
    bookmarks: [
      { title: 'Notion', url: 'https://www.notion.so', description: '全能笔记+文档协作', category_name: '文档协作', sort_order: 1 },
      { title: '飞书文档', url: 'https://docs.feishu.cn', description: '字节跳动协作平台', category_name: '文档协作', sort_order: 2 },
      { title: '石墨文档', url: 'https://shimo.im', description: '在线协作文档', category_name: '文档协作', sort_order: 3 },
      { title: 'Axure', url: 'https://www.axure.com', description: '专业原型设计', category_name: '原型工具', sort_order: 1 },
      { title: '墨刀', url: 'https://modao.cc', description: '国产原型设计工具', category_name: '原型工具', sort_order: 2 },
      { title: 'MasterGo', url: 'https://mastergo.com', description: '云端产品设计工具', category_name: '原型工具', sort_order: 3 },
      { title: '艾瑞咨询', url: 'https://www.iresearch.com.cn', description: '互联网数据报告', category_name: '数据研究', sort_order: 1 },
      { title: 'QuestMobile', url: 'https://www.questmobile.com.cn', description: '移动端大数据', category_name: '数据研究', sort_order: 2 },
      { title: 'SimilarWeb', url: 'https://www.similarweb.com', description: '网站流量分析', category_name: '数据研究', sort_order: 3 },
      { title: 'Product Hunt', url: 'https://www.producthunt.com', description: '每日新产品发现', category_name: '竞品发现', sort_order: 1 },
      { title: '少数派', url: 'https://sspai.com', description: '高品质数字生活', category_name: '竞品发现', sort_order: 2 },
      { title: '即刻', url: 'https://web.okjike.com', description: '兴趣社区+产品讨论', category_name: '竞品发现', sort_order: 3 },
    ],
  },
]

export function seedDefaultCollections(db: Database.Database) {
  const now = Date.now()
  const userId = 1

  const insCollection = db.prepare(`
    INSERT OR IGNORE INTO collections (id, user_id, name, description, icon, is_public, is_official, bookmark_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
  `)
  const insCategory = db.prepare(`
    INSERT INTO collection_categories (collection_id, name, parent_id, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insCb = db.prepare(`
    INSERT OR IGNORE INTO collection_bookmarks (collection_id, bookmark_id, category_id, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction(() => {
    let idx = 0
    for (const col of DEFAULT_COLLECTIONS) {
      const collectionId = `${now}_col_${idx}`
      insCollection.run(collectionId, userId, col.name, col.description, col.icon, col.bookmarks.length, now, now)

      // 解析层级分类：category_name 中 "/" 分隔父子
      const categoryMap = new Map<string, number>()
      const parentSort = new Map<string, number>()
      const rawNames = [...new Set(col.bookmarks.map(b => b.category_name))]
      const topNames = new Set<string>()
      for (const raw of rawNames) {
        const parentName = raw.split('/')[0].trim()
        if (!topNames.has(parentName)) { topNames.add(parentName); parentSort.set(parentName, parentSort.size) }
      }
      for (const parentName of topNames) {
        const r = insCategory.run(collectionId, parentName, null, parentSort.get(parentName) ?? 0, now)
        categoryMap.set(parentName, Number(r.lastInsertRowid))
      }
      let childSortOrder = 0
      for (const raw of rawNames) {
        if (!raw.includes('/')) continue
        const parts = raw.split('/')
        const childName = parts[1].trim()
        const parentId = categoryMap.get(parts[0].trim())
        const r = insCategory.run(collectionId, childName, parentId, childSortOrder++, now)
        categoryMap.set(raw, Number(r.lastInsertRowid))
      }

      // 写入公共池（URL 去重 upsert），再写 collection_bookmarks 引用
      for (let i = 0; i < col.bookmarks.length; i++) {
        const b = col.bookmarks[i]
        const bookmarkId = upsertPoolBookmark(db, userId, {
          title: b.title,
          url: b.url,
          icon: b.icon || '',
        }, now)
        const categoryId = categoryMap.get(b.category_name) || null
        insCb.run(collectionId, bookmarkId, categoryId, b.sort_order ?? i, now)
      }
      idx++
    }
  })

  insertMany()
  console.log(`[DB] 已插入 ${DEFAULT_COLLECTIONS.length} 个官方精选集`)
}
