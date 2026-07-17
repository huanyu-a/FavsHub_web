/**
 * POST /api/admin/dev/seed-prompts — 填充测试提示词数据
 * 仅管理员可用，生成多样化的示例数据用于演示和调试
 */
import { randomUUID } from 'node:crypto'
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

interface SeedPrompt {
  title: string
  description: string
  content: string
  tags: string[]
  versions: number
  usage: number
}

// 预置多样化提示词模板
const SEED_TEMPLATES: SeedPrompt[] = [
  {
    title: '代码审查专家',
    description: '对代码进行全面审查，从正确性、安全性、性能等维度分析',
    content: `你是一名资深代码审查专家，请对以下代码进行全面审查：

## 审查维度
1. 正确性 — 逻辑正确性、边界条件
2. 安全性 — 注入攻击、敏感信息泄露
3. 性能 — 不必要的循环、内存泄漏
4. 可读性 — 命名、结构、注释
5. 最佳实践 — 惯用写法

## 输出格式
对每个问题标注严重程度（🔴严重 / 🟡建议 / 🟢优化），给出具体行号和修改方案。`,
    tags: ['编程', '代码审查', '开发工具'],
    versions: 3,
    usage: 128,
  },
  {
    title: '中英翻译专家',
    description: '高质量中英文互译，保持专业术语准确和语境自然',
    content: `你是一名专业的中英双语翻译专家。

## 翻译原则
- 忠实原文，核心信息不增不减
- 专业术语使用行业标准译法
- 不出现"翻译腔"

## 输出格式
1. 翻译结果
2. 关键术语对照表（如有）
3. 翻译选择说明（如有）

请翻译：{{待翻译内容}}`,
    tags: ['翻译', '语言工具', '写作'],
    versions: 2,
    usage: 95,
  },
  {
    title: 'SEO 文章优化',
    description: '分析文章 SEO 表现并给出具体优化建议',
    content: `你是一名 SEO 专家，请分析以下文章：

## 分析项目
1. 关键词密度与分布
2. 标题和 meta 优化
3. 内容结构与可读性
4. 内外链策略
5. 图片 alt 与加载性能

给出具体的优化建议和执行优先级。`,
    tags: ['写作', '营销', 'SEO'],
    versions: 2,
    usage: 67,
  },
  {
    title: 'SQL 查询优化',
    description: '分析 SQL 查询性能瓶颈，给出优化方案和索引建议',
    content: `你是一名数据库优化专家。

## 分析内容
1. 查询执行计划解读
2. 索引使用分析
3. 全表扫描识别
4. JOIN 优化建议
5. 分页优化方案

数据库：{{数据库类型}}
查询：{{SQL语句}}`,
    tags: ['编程', '数据库', '性能优化'],
    versions: 2,
    usage: 83,
  },
  {
    title: '产品需求文档(PRD)生成器',
    description: '根据产品想法快速生成结构化 PRD 文档',
    content: `你是一名资深产品经理。

请为以下产品想法生成 PRD：

## 文档结构
1. 产品概述（目标用户、核心价值）
2. 功能需求（用户故事 + 验收标准）
3. 非功能需求（性能、安全、可用性）
4. 信息架构与页面流程
5. 数据模型概要
6. 迭代计划与优先级
7. 风险与依赖`,
    tags: ['产品管理', '文档', '写作'],
    versions: 1,
    usage: 42,
  },
  {
    title: '营销文案撰写',
    description: '根据产品信息撰写多平台的营销文案',
    content: `你是一名资深营销文案撰写人。

产品信息：{{产品信息}}
目标平台：{{平台}}
目标人群：{{目标人群}}

请生成：
1. 吸引眼球的标题（3 个备选）
2. 正文（不同长度版本：50字/200字/500字）
3. Call-to-Action 文案
4. Hashtag 建议（适用于社交媒体）`,
    tags: ['营销', '写作', '创意'],
    versions: 2,
    usage: 156,
  },
  {
    title: '面试问题生成器',
    description: '根据岗位生成结构化面试问题和评分标准',
    content: `你是一名资深 HR 和技术面试官。

岗位：{{岗位名称}}
级别：{{级别}}
技术栈：{{技术栈}}

请生成：
1. 5 道技术题（含参考答案和评分点）
2. 3 道行为面试题（STAR 追问方向）
3. 2 道系统设计题（оценивание标准）
4. 整体评估矩阵`,
    tags: ['招聘', '人力资源', '面试'],
    versions: 1,
    usage: 31,
  },
  {
    title: '数据可视化建议',
    description: '根据数据类型和分析目的推荐最佳可视化方案',
    content: `你是一名数据可视化专家。

数据类型：{{数据类型}}
分析目的：{{分析目的}}
受众：{{目标受众}}

请推荐：
1. 最适合的图表类型（附理由）
2. 配色方案建议
3. 标注和图例要点
4. 常见反模式提醒
5. 推荐的实现工具（D3/Tableau/ECharts 等）`,
    tags: ['数据可视化', '数据分析', '设计'],
    versions: 1,
    usage: 24,
  },
  {
    title: '会议纪要整理',
    description: '将会议录音/文字转化为结构化纪要',
    content: `你是一名高效的行政助理。

请将以下会议内容整理为结构化纪要：

## 结构要求
1. 会议基本信息（时间、参会人、议题）
2. 关键讨论点摘要
3. 决议事项（含负责人和截止日期）
4. 待跟进事项
5. 下次会议安排（如有）`,
    tags: ['办公效率', '文档', '写作'],
    versions: 2,
    usage: 88,
  },
  {
    title: '单元测试生成',
    description: '根据函数/组件自动生成完整的单元测试',
    content: `你是一名测试工程师。

请为以下代码生成单元测试：

## 测试要求
1. 正常路径测试
2. 边界条件测试
3. 异常输入测试
4. Mock 外部依赖
5. 测试可读性与命名规范

语言：{{编程语言}}
框架：{{测试框架}}`,
    tags: ['编程', '测试', '开发工具'],
    versions: 3,
    usage: 71,
  },
  {
    title: '技术方案评审',
    description: '对技术方案进行深度评审，识别风险和改进点',
    content: `你是一名架构师，请评审以下技术方案：

## 评审维度
1. 架构合理性 — 分层、模块边界、扩展性
2. 技术选型 — 是否匹配需求、社区活跃度
3. 性能预估 — 瓶颈识别、容量规划
4. 安全性 — 数据保护、权限设计
5. 运维友好 — 监控、部署、回滚
6. 成本估算 — 云服务、人力、时间

给出风险等级（高/中/低）和具体改进建议。`,
    tags: ['架构', '技术评审', '开发工具'],
    versions: 2,
    usage: 55,
  },
  {
    title: '用户故事细化',
    description: '将模糊的需求描述为结构化的用户故事',
    content: `你是一名敏捷教练。

请将以下需求转化为标准用户故事：

## 输出格式
**作为** [角色]
**我希望** [功能/行为]
**以便** [业务价值]

## 还需输出
- 验收标准（Given/When/Then）
- 技术约束
- 优先级建议（MoSCoW）
- 估算故事点（Fibonacci）
- 依赖事项`,
    tags: ['产品管理', '敏捷', '文档'],
    versions: 1,
    usage: 38,
  },
]

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const db = getRawDb()
  const now = Date.now()

  // 检查是否已有数据（防止重复填充）
  const existing = (db.prepare('SELECT COUNT(*) as c FROM prompts WHERE user_id = ?').get(user.id) as any)?.c || 0
  if (existing > 5) {
    return { success: false, message: '已有较多提示词数据，请先清空再填充（不允许重复填充）' }
  }

  const folderTree = [
    { id: `${now}_cat_dev`, name: '开发工具', children: ['编程', '测试', '开发工具'] },
    { id: `${now}_cat_writing`, name: '写作内容', children: ['写作', '翻译', '文档'] },
    { id: `${now}_cat_biz`, name: '商业分析', children: ['营销', '产品管理', '数据分析'] },
  ]

  const allTagNames = new Set<string>()
  for (const t of SEED_TEMPLATES) for (const tag of t.tags) allTagNames.add(tag)

  const createFolder = db.prepare('INSERT OR IGNORE INTO prompt_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  const createPrompt = db.prepare('INSERT OR IGNORE INTO prompts (id, user_id, title, description, content, folder_id, version_count, current_version, usage_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const createVersion = db.prepare('INSERT OR IGNORE INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const createTag = db.prepare('INSERT OR IGNORE INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
  const createRelation = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)')

  const seedAll = db.transaction(() => {
    // 创建文件夹
    for (const f of folderTree) {
      createFolder.run(f.id, user.id, f.name, now, now)
    }

    // 创建所有标签
    for (const tagName of allTagNames) {
      createTag.run(`${now}_tag_${tagName}`, user.id, tagName, now)
    }

    // 建立标签名→ID 映射
    const tagIdMap = new Map<string, string>()
    for (const tagName of allTagNames) {
      const row = db.prepare('SELECT id FROM tags WHERE name = ? AND user_id = ?').get(tagName, user.id) as any
      if (row) tagIdMap.set(tagName, row.id)
    }

    // 创建提示词 + 版本 + 标签关联
    let idx = 0
    for (const tpl of SEED_TEMPLATES) {
      const promptId = `${now}_${String(idx).padStart(3, '0')}_${randomUUID().slice(0, 6)}`
      // 归入某个文件夹
      const parentFolder = folderTree[idx % folderTree.length]
      const verNums = Math.max(1, tpl.versions)

      createPrompt.run(promptId, user.id, tpl.title, tpl.description, tpl.content, parentFolder.id, verNums, `${verNums}.0`, tpl.usage, now, now)

      // 创建版本历史
      for (let v = verNums; v >= 1; v--) {
        createVersion.run(`${promptId}_v${v}`, promptId, tpl.content, `${v}.0`, '', now - (verNums - v) * 86400000)
      }

      // 标签关联
      for (const tagName of tpl.tags) {
        const tagId = tagIdMap.get(tagName)
        if (tagId) createRelation.run(promptId, tagId, now)
      }

      idx++
    }
  })

  seedAll()

  return {
    success: true,
    data: {
      prompts: SEED_TEMPLATES.length,
      folders: folderTree.length,
      tags: allTagNames.size,
      userId: user.id,
    },
  }
})
