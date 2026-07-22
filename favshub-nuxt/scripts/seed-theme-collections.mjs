/**
 * 从公共池书签按主题规则批量创建精选集
 * - is_public=1, is_official=0
 * - 优先管理员个人文件夹分类思路 + DH_NavHub 主题
 * - 每个精选集：name / description / icon / SEO / 内部分类 / 引用 bookmark_id
 *
 * 用法: node scripts/seed-theme-collections.mjs
 * 可选: --dry  只预览匹配数量不写入
 *       --force  即使同名已存在也再创建（默认跳过同名）
 */
import Database from 'better-sqlite3'
import { join } from 'node:path'

const DRY = process.argv.includes('--dry')
const FORCE = process.argv.includes('--force')
const DB_PATH = join(process.cwd(), 'data', 'favshub.db')
const USER_ID = 1
// --min=N  最少匹配数，默认 5；传 --min=0 可创建空精选集供后续补书签
const minArg = process.argv.find(a => a.startsWith('--min='))
const MIN_BOOKMARKS = minArg ? Math.max(0, parseInt(minArg.split('=')[1], 10) || 0) : 5
const MAX_BOOKMARKS = 120

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── 匹配工具 ──────────────────────────────────────────────
function likeAny(fields, patterns) {
  // patterns: string[]  → title/url/desc LIKE %p%
  const clauses = []
  const params = []
  for (const p of patterns) {
    const like = `%${p}%`
    for (const f of fields) {
      clauses.push(`${f} LIKE ?`)
      params.push(like)
    }
  }
  return { sql: `(${clauses.join(' OR ')})`, params }
}

function hostAny(hosts) {
  // host match via url LIKE
  const clauses = []
  const params = []
  for (const h of hosts) {
    clauses.push(`url LIKE ?`)
    params.push(`%://${h}%`)
    clauses.push(`url LIKE ?`)
    params.push(`%://www.${h}%`)
  }
  return { sql: `(${clauses.join(' OR ')})`, params }
}

function excludeAny(patterns) {
  if (!patterns?.length) return { sql: '1=1', params: [] }
  const parts = []
  const params = []
  for (const p of patterns) {
    parts.push(`title NOT LIKE ? AND url NOT LIKE ? AND COALESCE(description,'') NOT LIKE ?`)
    params.push(`%${p}%`, `%${p}%`, `%${p}%`)
  }
  return { sql: `(${parts.join(' AND ')})`, params }
}

/**
 * 规则: { keywords?, hosts?, exclude?, requireAll? }
 * requireAll: keywords 全部命中（AND），默认 OR
 */
function matchBookmarks(rule) {
  const fields = ['title', 'url', "COALESCE(description,'')"]
  const parts = [`COALESCE(label,'') = ''`]
  const params = []

  if (rule.hosts?.length) {
    const h = hostAny(rule.hosts)
    parts.push(h.sql)
    params.push(...h.params)
  }

  if (rule.keywords?.length) {
    if (rule.requireAll) {
      for (const k of rule.keywords) {
        const l = likeAny(fields, [k])
        parts.push(l.sql)
        params.push(...l.params)
      }
    } else {
      const l = likeAny(fields, rule.keywords)
      parts.push(l.sql)
      params.push(...l.params)
    }
  }

  if (rule.exclude?.length) {
    const e = excludeAny(rule.exclude)
    parts.push(e.sql)
    params.push(...e.params)
  }

  if (rule.extraSql) {
    parts.push(`(${rule.extraSql})`)
    if (rule.extraParams) params.push(...rule.extraParams)
  }

  const sql = `
    SELECT id, title, url, description, icon
    FROM bookmarks
    WHERE ${parts.join(' AND ')}
    ORDER BY id
    LIMIT ${MAX_BOOKMARKS * 2}
  `
  return db.prepare(sql).all(...params)
}

// ── 精选集定义 ────────────────────────────────────────────
// categories: 可选，书签会尽量分到第一个匹配的子类；无子类则不分
// catRules: { name, keywords?, hosts? }[]

/** @type {Array<{
 *  name: string
 *  description: string
 *  icon: string
 *  meta_title: string
 *  meta_description: string
 *  meta_keywords: string
 *  rule: object
 *  categories?: Array<{name: string, keywords?: string[], hosts?: string[]}>
 * }>} */
const COLLECTIONS = [
  // ══════ 管理员个人分类延伸 ══════
  {
    name: 'AI 对话助手',
    description: 'ChatGPT、Claude、DeepSeek、Kimi、通义千问等主流 AI 对话平台与国产大模型入口',
    icon: '💬',
    meta_title: 'AI 对话助手精选集 - ChatGPT / Claude / DeepSeek',
    meta_description: '汇集国内外主流 AI 对话助手与大模型入口，一站式访问 ChatGPT、Claude、DeepSeek、Kimi、文心一言等。',
    meta_keywords: 'AI对话,ChatGPT,Claude,DeepSeek,Kimi,大模型,人工智能',
    rule: {
      keywords: ['ChatGPT', 'Claude', 'DeepSeek', 'Kimi', '通义', '文心', '豆包', 'Gemini', 'Copilot', 'Poe', '元宝', '智谱', 'GLM', '讯飞星火', '月之暗面', 'AI对话', '对话AI', 'chat.openai', 'chat.deepseek', 'claude.ai', 'kimi.moonshot'],
      exclude: ['API', 'Midjourney', 'Stable Diffusion', '生图', '绘图', '绘画', 'Agent', '编程', '代码'],
    },
    categories: [
      { name: '国际大模型', keywords: ['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Poe', 'openai'] },
      { name: '国产大模型', keywords: ['DeepSeek', 'Kimi', '通义', '文心', '豆包', '智谱', 'GLM', '讯飞', '元宝'] },
    ],
  },
  {
    name: 'AI 绘画与视觉',
    description: 'Midjourney、Stable Diffusion、即梦、可灵等 AI 图像/视频生成与视觉创作工具',
    icon: '🎨',
    meta_title: 'AI 绘画与视觉生成工具精选集',
    meta_description: 'AI 绘图、视频生成、视觉创意工具合集：Midjourney、SD、即梦、可灵、DALL·E 等。',
    meta_keywords: 'AI绘画,Midjourney,Stable Diffusion,即梦,AI生图,AI视频',
    rule: {
      keywords: ['Midjourney', 'Stable Diffusion', 'DALL', '即梦', '可灵', 'AI绘画', 'AI绘图', '生图', '文生图', 'AI视频', 'Runway', 'Pika', 'Sora', '画一画', '通义万相', 'Liblib', 'Civitai', '视觉AI', 'AI设计'],
    },
  },
  {
    name: 'AI 编程与 Agent',
    description: 'Cursor、Copilot、Claude Code、各类 AI Agent 与 AI 编程助手',
    icon: '🤖',
    meta_title: 'AI 编程助手与 Agent 精选集',
    meta_description: 'AI 代码编辑器、编程助手与智能 Agent 工具箱，提升开发效率。',
    meta_keywords: 'AI编程,Cursor,Copilot,Claude Code,AI Agent,编程助手',
    rule: {
      keywords: ['Cursor', 'Copilot', 'Claude Code', 'AI编程', 'AI代码', 'AI Agent', 'Agent', 'Bolt.new', 'v0.dev', 'Replit', 'Windsurf', 'Devin', 'Continue', 'Aider', 'Codeium', 'Tabnine', 'Qoder', 'TRAE', 'WorkBuddy', 'Cherry Studio', 'PromptBox'],
    },
  },
  {
    name: 'AI API 与模型平台',
    description: 'AI 中转 API、模型广场、MaaS 平台与开放接口聚合',
    icon: '🔌',
    meta_title: 'AI API 与模型平台精选集',
    meta_description: 'AI API 中转、模型调用平台、MaaS 服务与开放接口资源合集。',
    meta_keywords: 'AI API,模型平台,MaaS,API中转,OpenAI API',
    rule: {
      keywords: ['AI API', 'API中转', 'MaaS', '模型平台', 'OpenRouter', '1API', 'API2D', 'CloseAI', 'SiliconFlow', '硅基流动', 'Together AI', 'Fireworks', 'Groq', 'Hugging Face', 'huggingface', 'Replicate', 'ModelScope', '魔搭', '讯飞星辰', 'V3 API', 'KULAAI', 'one-api', 'New API', 'ChatAPI', 'API 中转', '令牌', '中转站', '接口站'],
    },
  },
  {
    name: '设计师灵感与作品',
    description: 'Dribbble、Behance、站酷等设计灵感社区与作品集平台',
    icon: '✨',
    meta_title: '设计师灵感社区精选集',
    meta_description: '全球设计灵感与作品展示平台，UI/UX、平面、插画灵感一站收藏。',
    meta_keywords: '设计灵感,Dribbble,Behance,站酷,UI设计,作品集',
    rule: {
      keywords: ['Dribbble', 'Behance', '站酷', 'zcool.com', '设计灵感', 'UI设计', 'UI/UX', 'Mobbin', 'Land-book', 'Awwwards', '花瓣网', 'Pinterest', '设计社区', '作品集', 'uisdc', '优设'],
      exclude: ['字体', '图标', '配色', '壁纸'],
    },
  },
  {
    name: '图标字体与配色',
    description: 'Iconfont、Iconify、免费字体、中国色、配色生成器等设计基础资源',
    icon: '🔤',
    meta_title: '图标·字体·配色资源精选集',
    meta_description: '图标库、免费商用字体、配色方案与中国色资源，设计师必备基础素材。',
    meta_keywords: '图标,字体,配色,Iconfont,Iconify,中国色,免费字体',
    rule: {
      keywords: ['iconfont', 'Iconify', '图标', '字体', '配色', '中国色', 'Coolors', '色板', '色卡', '渐变', 'emoji', 'Phosphor', 'Remix Icon', 'Font Awesome', '猫啃', '字由', 'fonts.google', 'Adobe Color', 'MyColor'],
    },
  },
  {
    name: '设计素材与图库',
    description: '壁纸、图库、插画、音效、模板等免费/商用设计素材',
    icon: '🖼️',
    meta_title: '设计素材与免费图库精选集',
    meta_description: '壁纸、免费图库、插画、音效与设计模板素材导航。',
    meta_keywords: '设计素材,壁纸,图库,Unsplash,插画,音效,模板',
    rule: {
      keywords: ['壁纸', '图库', '素材', 'Unsplash', 'Pexels', 'Pixabay', '插画', '音效', '模板', 'CGWallpapers', '天空之城', 'Skypixel', 'Libre Stock', '稿定', '创客贴', '包图', '昵图', '千图'],
      exclude: ['PPT模板', '简历模板'],
    },
  },
  {
    name: '站长工具箱',
    description: '站长之家、爱站、SEO、统计、收录、IP 查询等建站运维工具',
    icon: '🌐',
    meta_title: '站长工具箱 - SEO·统计·运维',
    meta_description: '站长必备：SEO 优化、网站统计、收录查询、IP/域名工具与建站平台。',
    meta_keywords: '站长工具,SEO,爱站,站长之家,网站统计,收录',
    rule: {
      keywords: ['站长', 'SEO', '爱站', '收录', '百度统计', '友盟', '关键词规划', 'IP地址', '本机IP', '域名', 'CDN', 'SSL', '备案', 'Whois', 'Ping', '测速', '死链', '友链', 'ICP'],
    },
  },
  {
    name: '开发者工具与社区',
    description: 'GitHub、编程导航、技术社区、API 调试与开发文档',
    icon: '💻',
    meta_title: '开发者工具与技术社区精选集',
    meta_description: 'GitHub、开源项目、技术社区、API 工具与开发文档导航。',
    meta_keywords: '开发者,GitHub,编程,开源,API,技术社区',
    rule: {
      keywords: ['GitHub', 'HelloGitHub', 'Gitee', '码云', '编程导航', 'code-nav', '掘金', 'V2EX', 'CSDN', 'Stack Overflow', 'MDN', 'DevDocs', 'Apifox', 'Postman', 'API文档', '开源项目', '开发者'],
      exclude: ['AI编程', 'Cursor', 'Copilot'],
    },
  },
  {
    name: '文本与 JSON 工具',
    description: 'JSON 格式化、Markdown、正则、代码格式化、在线编辑器',
    icon: '📝',
    meta_title: 'JSON·Markdown·文本处理在线工具',
    meta_description: 'JSON 格式化对比、Markdown 编辑、正则测试、代码美化等文本处理工具。',
    meta_keywords: 'JSON,Markdown,正则,格式化,文本处理,在线编辑器',
    rule: {
      keywords: ['JSON', 'Markdown', '正则', '格式化', 'YAML', 'YML', '代码格式化', '在线编辑器', '文字转拼音', '对比', 'Diff', 'Base64', 'URL编码', 'Hash', '加密解密'],
    },
  },
  {
    name: '排版与公众号工具',
    description: '公众号排版、Markdown 排版、在线排版器与内容发布辅助',
    icon: '📰',
    meta_title: '公众号排版与内容工具精选集',
    meta_description: '微信公众号排版、Markdown 一键排版、内容创作与发布辅助工具。',
    meta_keywords: '公众号排版,Markdown排版,微信排版,内容工具',
    rule: {
      keywords: ['排版', '公众号', 'Markdown Editor', 'R-Markdown', '微信编辑', '秀米', '135编辑器', '新榜', '内容创作'],
    },
  },
  {
    name: '科学上网与代理',
    description: '代理 IP、机场相关、网络加速与跨境访问工具（仅收录工具站）',
    icon: '🛡️',
    meta_title: '代理与网络加速工具精选集',
    meta_description: 'HTTP 代理、IP 池、网络加速与跨境访问相关工具站点。',
    meta_keywords: '代理,HTTP代理,IP池,网络加速,科学上网',
    rule: {
      keywords: ['代理', 'Clash', 'V2Ray', 'SSR', '科学上网', '机场', '翻墙', 'VPN', 'HTTP代理', 'IP池', '青果云', '阿布云', '四叶天', 'Greenhub', 'Shadowsocks'],
    },
  },

  // ══════ DH_NavHub 主题延伸 ══════
  {
    name: '网盘与文件传输',
    description: '阿里云盘、百度网盘、蓝奏云、奶牛快传等云存储与文件中转',
    icon: '☁️',
    meta_title: '网盘与文件传输服务精选集',
    meta_description: '主流网盘、临时传文件、大文件中转服务导航。',
    meta_keywords: '网盘,阿里云盘,百度网盘,蓝奏云,文件传输',
    rule: {
      keywords: ['网盘', '云盘', '文件传输', '奶牛快传', '文叔叔', 'Wenshushu', 'CowTransfer', '蓝奏', '阿里云盘', '百度网盘', '天翼云', '微云', '城通', '夸克网盘', '迅雷云盘'],
      hosts: ['aliyundrive.com', 'pan.baidu.com', 'lanzou', 'cowtransfer.com', 'wenshushu.cn', 'cloud.189.cn', 'url67.ctfile.com'],
      exclude: ['搜索', '盘搜', '资源'],
    },
    categories: [
      { name: '主流网盘', keywords: ['阿里', '百度', '夸克', '天翼', '微云'] },
      { name: '蓝奏与分享', keywords: ['蓝奏', 'lanzou'] },
      { name: '临时传输', keywords: ['奶牛', '文叔叔', 'CowTransfer', '临时'] },
    ],
  },
  {
    name: '网盘与资源搜索',
    description: '盘搜、超能搜、磁力/BT 搜索与全网资源发现引擎',
    icon: '🔍',
    meta_title: '网盘搜索与资源发现引擎精选集',
    meta_description: '网盘资源搜索、磁力/BT 搜索引擎与全网资源发现工具。',
    meta_keywords: '网盘搜索,盘搜,磁力搜索,BT搜索,资源搜索',
    rule: {
      keywords: ['网盘搜索', '盘搜', '超能搜', '磁力搜索', 'BT搜索', '种子搜索', '资源搜索', '茶杯狐', '飞鱼盘搜', '磁力链搜索', '云盘搜索', '搜盘'],
      exclude: ['在线观看', '播放器'],
    },
  },
  {
    name: 'PDF 与文档处理',
    description: 'PDF 转换、合并、OCR 扫描、在线文档编辑与格式互转',
    icon: '📄',
    meta_title: 'PDF 转换与文档处理工具精选集',
    meta_description: 'PDF 转 Word/图片、合并拆分、OCR 识别与在线文档处理工具。',
    meta_keywords: 'PDF,PDF转换,OCR,文档处理,格式转换',
    rule: {
      keywords: ['PDF', 'OCR', '扫描王', '文档处理', '格式转换', '转Word', '转PDF', '合并PDF', '拆分PDF', 'CAJ', 'djvu', 'PDF转换'],
    },
  },
  {
    name: '图片编辑与处理',
    description: '在线 PS、抠图、压缩、GIF、修图与图片格式工具',
    icon: '🖌️',
    meta_title: '在线图片编辑与处理工具精选集',
    meta_description: '在线 Photoshop、智能抠图、图片压缩、GIF 制作与图片处理工具。',
    meta_keywords: '在线PS,抠图,图片压缩,GIF,图片编辑',
    rule: {
      keywords: ['在线PS', '抠图', '图片压缩', 'GIF', '修图', '图片编辑', '图片处理', '加水印', '去水印', '图片转换', 'WebP', 'Facetune', 'P图', '大神P图', '稿定设计', 'Photopea'],
      exclude: ['壁纸', '图库', '素材下载'],
    },
  },
  {
    name: '视频剪辑与影音工具',
    description: '剪映、Premiere、在线剪辑、字幕、转码与影音处理软件',
    icon: '🎬',
    meta_title: '视频剪辑与影音处理工具精选集',
    meta_description: '视频剪辑软件、在线剪辑、字幕工具、转码与影音处理资源。',
    meta_keywords: '视频剪辑,剪映,Premiere,字幕,转码,影音工具',
    rule: {
      keywords: ['剪辑', '剪映', 'Premiere', 'After Effects', 'Final Cut', '达芬奇', '字幕工具', '视频转码', '视频编辑', '爱剪辑', '乐视频', '视频压缩', '格式工厂', 'HandBrake', 'PotPlayer', '视频播放器', 'CapCut', '剪影'],
    },
  },
  {
    name: '在线影视观看',
    description: '免费在线电影、电视剧、综艺与纪录片观看站点',
    icon: '🍿',
    meta_title: '在线影视观看站点精选集',
    meta_description: '在线看电影、追剧、综艺与纪录片资源站点导航。',
    meta_keywords: '在线电影,免费影视,追剧,电视剧,纪录片',
    rule: {
      keywords: ['在线观看', '在线电影', '免费电影', '追剧', '蓝光影院', 'Gimy', '电视剧在线', '综艺', '纪录片', '影视站', '影视导航', '想看', '视频解析', '电影网站'],
      exclude: ['下载', '字幕组', '磁力', 'BT', '软件', '播放器', '剪辑'],
    },
  },
  {
    name: '动漫与二次元',
    description: '番剧追番、动漫下载、二次元社区与相关资源',
    icon: '🌸',
    meta_title: '动漫番剧与二次元资源精选集',
    meta_description: '追番、动漫在线、字幕组、二次元社区与同人资源导航。',
    meta_keywords: '动漫,追番,二次元,番剧,字幕组,B站',
    rule: {
      keywords: ['动漫', '追番', '二次元', '番剧', '漫画', 'ACG', 'Bilibili番', '哔哩哔哩', '字幕组', 'Comicat', '米画师', 'moetu', '萌图', '动漫下载', '在线漫画', '条漫'],
    },
  },
  {
    name: '音乐与有声',
    description: '在线音乐、无损下载、播客、听书与有声内容',
    icon: '🎵',
    meta_title: '音乐·播客·有声内容精选集',
    meta_description: '在线听歌、音乐下载、播客电台与有声书资源导航。',
    meta_keywords: '音乐,播客,有声书,听书,无损音乐,电台',
    rule: {
      keywords: ['音乐', 'MP3', '无损', '播客', '有声', '听书', '电台', '网易云', 'QQ音乐', 'Spotify', 'MyFreeMP3', '铃声', '音效', '喜马拉雅'],
      exclude: ['剪辑', '视频'],
    },
  },
  {
    name: '体育赛事直播',
    description: '足球、NBA、综合体育直播与赛事资讯',
    icon: '⚽',
    meta_title: '体育赛事直播精选集',
    meta_description: '足球、篮球、综合体育直播与赛事数据资讯站点。',
    meta_keywords: '体育直播,足球,NBA,赛事,直播吧',
    rule: {
      keywords: ['体育', '足球', 'NBA', '赛事', '直播吧', '体育直播', '比赛', '英超', '西甲', 'CBA', '网球', 'F1'],
    },
  },
  {
    name: '游戏平台与资源',
    description: 'Steam、Epic、Switch、模拟器、怀旧游戏与游戏资讯',
    icon: '🎮',
    meta_title: '游戏平台·模拟器·怀旧游戏精选集',
    meta_description: 'Steam/Epic 游戏平台、Switch/模拟器、怀旧 ROM 与游戏资源导航。',
    meta_keywords: '游戏,Steam,Epic,模拟器,Switch,怀旧游戏',
    rule: {
      keywords: ['Steam', 'Epic', '游戏', '模拟器', 'Switch', 'ROM', '小霸王', '怀旧', '单机', '独立游戏', 'TapTap', 'PS4', 'PS5', 'Xbox', '任天堂', '塞尔达', 'GBA', 'FC', 'NDS'],
    },
  },
  {
    name: '软件下载站',
    description: 'PC 软件、绿色破解、软件合集与下载站导航',
    icon: '💾',
    meta_title: 'PC 软件下载与绿色软件精选集',
    meta_description: 'Windows 软件下载、绿色版、破解软件资源站与软件合集。',
    meta_keywords: '软件下载,绿色软件,破解软件,PC软件,吾爱破解',
    rule: {
      keywords: ['软件下载', '绿色软件', '破解', '吾爱', '52pojie', '软件站', '装机', '软件合集', '绿色版', '便携版', 'Portable', 'Appinn', '小众软件', 'MSDN', 'Itellhow', '中关村'],
      exclude: ['Mac', '安卓', 'iOS', 'APK', '游戏'],
    },
  },
  {
    name: 'Mac 软件精选',
    description: 'macOS 应用分享、正版替代与 Mac 工具',
    icon: '🍎',
    meta_title: 'Mac 软件与应用分享精选集',
    meta_description: 'macOS 精品应用、Mac 软件下载与效率工具推荐。',
    meta_keywords: 'Mac软件,macOS,Mac应用,苹果软件',
    rule: {
      keywords: ['Mac', 'macOS', 'Mac软件', 'Mac应用', '苹果电脑', 'Homebrew'],
      exclude: ['iOS', 'iPhone', 'iPad'],
    },
  },
  {
    name: '安卓应用精选',
    description: 'Android APK、安卓工具、学习办公与系统应用',
    icon: '📱',
    meta_title: '安卓应用与 APK 资源精选集',
    meta_description: 'Android 应用下载、APK 资源、安卓学习办公与系统工具。',
    meta_keywords: '安卓,Android,APK,安卓应用,手机软件',
    rule: {
      keywords: ['安卓', 'Android', 'APK', '手机软件', '安卓应用', 'Google Play', '应用商店'],
      exclude: ['iOS', 'iPhone'],
    },
  },
  {
    name: 'iOS 应用与技巧',
    description: 'iPhone/iPad 应用推荐、TestFlight、iOS 技巧教程',
    icon: '📲',
    meta_title: 'iOS 应用与 iPhone 技巧精选集',
    meta_description: 'iOS 精品 App、TestFlight、越狱与 iPhone/iPad 使用技巧。',
    meta_keywords: 'iOS,iPhone,iPad,App Store,TestFlight',
    rule: {
      keywords: ['iOS', 'iPhone', 'iPad', 'App Store', 'TestFlight', '苹果手机', '越狱', '快捷指令'],
    },
  },
  {
    name: '系统工具与维护',
    description: '系统优化、清理卸载、PE、驱动、重装与维护工具',
    icon: '🛠️',
    meta_title: '系统优化与维护工具精选集',
    meta_description: 'Windows 系统优化、垃圾清理、驱动、PE 工具与重装维护资源。',
    meta_keywords: '系统优化,PE,驱动,清理,卸载,系统维护',
    rule: {
      keywords: ['系统优化', 'PE工具', 'WePE', '微PE', '优启通', '驱动精灵', '驱动下载', 'Geek Uninstaller', '系统重装', '磁盘分区', '系统激活', 'Office激活', 'Win激活', '引导修复', '系统备份'],
    },
  },
  {
    name: '下载工具与管理',
    description: 'IDM、迅雷、Aria2、网盘客户端与下载加速器',
    icon: '⬇️',
    meta_title: '下载工具与下载管理器精选集',
    meta_description: '多线程下载器、BT 客户端、网盘下载工具与加速器。',
    meta_keywords: '下载工具,IDM,Aria2,迅雷,BT下载',
    rule: {
      keywords: ['下载器', '下载工具', 'IDM', 'Aria2', '迅雷', 'Motrix', 'qBittorrent', 'Transmission', 'Free Download', '下载管理', '离线下载', 'NDM'],
    },
  },
  {
    name: '浏览器与扩展',
    description: 'Chrome/Edge 扩展、油猴脚本、浏览器推荐',
    icon: '🧩',
    meta_title: '浏览器扩展与油猴脚本精选集',
    meta_description: 'Chrome 插件、油猴脚本、浏览器推荐与扩展资源站。',
    meta_keywords: '浏览器扩展,Chrome插件,油猴,GreasyFork,脚本',
    rule: {
      keywords: ['浏览器扩展', '浏览器插件', '油猴', 'GreasyFork', 'Tampermonkey', 'Violentmonkey', 'Chrome扩展', 'Edge插件', '脚本猫', '用户脚本', 'Chrome插件'],
    },
  },
  {
    name: '隐私安全与密码',
    description: '密码管理、安全检测、临时邮箱/号码与隐私保护',
    icon: '🔐',
    meta_title: '隐私安全·密码·临时邮箱精选集',
    meta_description: '密码管理器、安全检测、临时邮箱/手机号与隐私保护工具。',
    meta_keywords: '密码管理,临时邮箱,隐私安全,安全检测,2FA',
    rule: {
      keywords: ['密码管理', '临时邮箱', '临时号码', '隐私保护', '安全检测', '2FA', 'OTP', 'Bitwarden', '1Password', 'LastPass', 'Have I Been', '病毒扫描', '沙箱', '指纹浏览器', '密码生成', '安全工具'],
    },
  },
  {
    name: '办公效率工具',
    description: 'Office、WPS、在线文档、思维导图、效率套件',
    icon: '💼',
    meta_title: '办公效率与在线文档工具精选集',
    meta_description: 'Office/WPS、飞书/Notion 文档、思维导图与办公效率工具。',
    meta_keywords: '办公,Office,WPS,Notion,飞书,思维导图,效率',
    rule: {
      keywords: ['Office', 'WPS', 'Excel', 'PowerPoint', 'Word文档', 'Notion', '飞书文档', '石墨文档', '思维导图', '流程图', 'XMind', 'ProcessOn', '办公软件', '效率工具', '待办', '番茄钟', '笔记软件', '印象笔记', 'Evernote', 'Obsidian', 'Logseq'],
      exclude: ['激活', '破解', '模板下载'],
    },
  },
  {
    name: 'PPT 与简历模板',
    description: 'PPT 模板、简历模板、Word/Excel 模板资源',
    icon: '📊',
    meta_title: 'PPT·简历·办公模板精选集',
    meta_description: '免费/精品 PPT 模板、简历模板与办公文档模板下载。',
    meta_keywords: 'PPT模板,简历模板,Word模板,办公模板',
    rule: {
      keywords: ['PPT模板', '简历模板', 'Word模板', 'Excel模板', '模板下载', 'iSlide', '第一PPT', '优品PPT', '简历', '求职简历', '幻灯片'],
    },
  },
  {
    name: '原型与产品设计',
    description: 'Figma、Axure、墨刀、MasterGo 等产品与交互设计工具',
    icon: '📐',
    meta_title: '原型设计与产品设计工具精选集',
    meta_description: 'Figma、Axure、墨刀、MasterGo 等原型与产品设计协作工具。',
    meta_keywords: 'Figma,Axure,墨刀,原型设计,产品设计,MasterGo',
    rule: {
      keywords: ['Figma', 'Axure', '墨刀', 'MasterGo', 'Framer', '原型', '交互设计', '产品设计', '蓝湖', '即时设计', 'Pixso', 'Sketch'],
    },
  },
  {
    name: '英语与语言学习',
    description: '英语课程、背单词、口语听力、词典翻译与多语言学习',
    icon: '🗣️',
    meta_title: '英语学习与语言工具精选集',
    meta_description: '英语学习资源、背单词 App、口语听力训练、词典与翻译工具。',
    meta_keywords: '英语学习,背单词,口语,四级,六级,翻译,词典',
    rule: {
      keywords: ['英语', '背单词', '口语', '听力', '四级', '六级', '雅思', '托福', '翻译', '词典', '有道', 'DeepL', 'Duolingo', '墨墨', '不背单词', '多邻国', 'Grammarly', '语言学习', '日语', '韩语'],
    },
  },
  {
    name: 'K12 与中小学教育',
    description: '小学初中高中课本、同步课程、竞赛与教辅资源',
    icon: '🎒',
    meta_title: '中小学教育与 K12 资源精选集',
    meta_description: '中小学电子课本、同步课程、竞赛资料与教辅学习资源。',
    meta_keywords: '中小学,K12,课本,教辅,竞赛,同步课程',
    rule: {
      keywords: ['小学', '初中', '高中', '课本', '教辅', '同步', '小灯塔', '竞赛', '奥数', '中考', '高考', 'K12', '幼升小', '学而思', '作业帮'],
    },
  },
  {
    name: '考研与职业考试',
    description: '考研、公务员、教资、驾考等职业与升学考试资源',
    icon: '🎓',
    meta_title: '考研·公务员·职业考试资源精选集',
    meta_description: '考研资料、公务员考试、教师资格、驾考等职业升学考试资源。',
    meta_keywords: '考研,公务员,教资,驾考,职业考试,升学',
    rule: {
      keywords: ['考研', '公务员', '教资', '教师资格', '驾考', '司法考试', '注册会计师', 'CPA', '建造师', '职业考试', '升学', '专升本', '成考', '自考'],
    },
  },
  {
    name: '在线课程与慕课',
    description: 'MOOC、B 站课程、网易云课堂、Coursera 等在线学习平台',
    icon: '📚',
    meta_title: '在线课程与慕课平台精选集',
    meta_description: '国内外慕课、B 站课程、技能学习与在线教育平台导航。',
    meta_keywords: '慕课,MOOC,在线课程,B站课程,网易云课堂,Coursera',
    rule: {
      keywords: ['慕课', 'MOOC', '在线课程', '网易云课堂', '中国大学MOOC', 'Coursera', 'Udemy', 'B站课程', '付费课程', '技能学习', '学堂在线', '腾讯课堂', '中文慕课'],
    },
  },
  {
    name: '编程学习与教程',
    description: '编程入门、前端后端、算法刷题与 IT 技术教程',
    icon: '🧑‍💻',
    meta_title: '编程学习与 IT 技术教程精选集',
    meta_description: '编程入门教程、前后端技术、算法 LeetCode 与 IT 学习资源。',
    meta_keywords: '编程学习,前端,后端,Python,算法,LeetCode,教程',
    rule: {
      keywords: ['编程', '前端', '后端', 'Python', 'Java', 'JavaScript', 'Vue', 'React', 'Node', '算法', 'LeetCode', '数据结构', '教程', '从入门', 'Docker', 'Linux', 'Go语言', 'Rust', 'TypeScript', '面试题'],
      exclude: ['AI编程', 'Cursor', '游戏'],
    },
  },
  {
    name: '电子书与阅读',
    description: '电子书下载、小说、Z-Library、阅读器与书单',
    icon: '📖',
    meta_title: '电子书·小说·阅读资源精选集',
    meta_description: '电子书下载、网络小说、Z-Library 镜像与阅读工具导航。',
    meta_keywords: '电子书,小说,Z-Library,阅读,书单,Kindle',
    rule: {
      keywords: ['电子书', '小说', 'Z-Library', 'zlib', 'Anna', '阅读', '书单', 'Kindle', '推书', '精校', 'txt', 'epub', 'mobi', 'pdf书', '图书馆', '古籍'],
      exclude: ['有声', '听书'],
    },
  },
  {
    name: '学术论文与文献',
    description: '论文查重、文献下载、学术搜索与科研工具',
    icon: '🔬',
    meta_title: '学术论文与文献工具精选集',
    meta_description: '论文查重、文献下载、学术搜索引擎与科研辅助工具。',
    meta_keywords: '论文,文献,学术,查重,知网,科研',
    rule: {
      keywords: ['论文', '文献', '学术', '查重', '知网', 'CNKI', 'Google Scholar', 'Sci-Hub', 'ResearchGate', '万方', '维普', '科研', '期刊', 'SCI', '核心期刊'],
    },
  },
  {
    name: '行业数据与报告',
    description: '互联网数据、行业报告、数据分析与可视化平台',
    icon: '📈',
    meta_title: '行业数据报告与数据分析精选集',
    meta_description: '艾瑞、QuestMobile、199IT 等行业数据报告与数据分析可视化工具。',
    meta_keywords: '行业报告,数据分析,艾瑞,QuestMobile,数据可视化',
    rule: {
      keywords: ['数据报告', '行业报告', '艾瑞', 'QuestMobile', '199IT', '数据分析', '数据可视化', 'SimilarWeb', 'PowerBI', 'Power BI', 'Tableau', '数据中心', '排行榜', '新榜', '权威数据'],
    },
  },
  {
    name: '科技资讯与社区',
    description: '少数派、V2EX、即刻、数码与互联网资讯社区',
    icon: '📡',
    meta_title: '科技资讯与互联网社区精选集',
    meta_description: '科技数码资讯、互联网社区与产品讨论平台导航。',
    meta_keywords: '科技资讯,少数派,V2EX,即刻,数码,互联网',
    rule: {
      keywords: ['少数派', 'sspai', 'V2EX', '即刻', '科技资讯', '数码', 'Product Hunt', '虎嗅', '36氪', '爱范儿', 'IT之家', '异次元', 'Appinn', '小众软件'],
    },
  },
  {
    name: '自媒体与新媒体',
    description: '公众号运营、短视频、直播带货与新媒体工具',
    icon: '📣',
    meta_title: '自媒体与新媒体运营工具精选集',
    meta_description: '公众号、短视频、直播带货与新媒体运营数据分析工具。',
    meta_keywords: '自媒体,新媒体,公众号,短视频,直播带货',
    rule: {
      keywords: ['自媒体', '新媒体', '公众号运营', '短视频', '带货', '主播', '新榜', '西瓜数据', '飞瓜', '卡思数据', '抖音运营', '视频号', '小红书运营'],
    },
  },
  {
    name: '影视下载与字幕',
    description: '影视下载站、字幕组、PT 与高清资源',
    icon: '🎞️',
    meta_title: '影视下载与字幕组资源精选集',
    meta_description: '电影电视剧下载、字幕组、PT 站点与高清影视资源导航。',
    meta_keywords: '影视下载,字幕组,PT,高清电影,人人影视',
    rule: {
      keywords: ['字幕组', '人人影视', '影视下载', 'PT站', '高清下载', 'FIX字幕', '字幕侠', '飘花电影', 'Hao4K', '4K下载', '蓝光下载', 'YYeTs', '字幕库', '电影下载'],
    },
  },
  {
    name: 'BT 与磁力资源',
    description: 'BT 种子、磁力链接索引与相关工具站',
    icon: '🧲',
    meta_title: 'BT 种子与磁力资源精选集',
    meta_description: 'BT 种子搜索、磁力链接索引与 P2P 资源工具。',
    meta_keywords: 'BT,磁力,种子,Magnet,Torrent,P2P',
    rule: {
      keywords: ['磁力搜索', 'BT搜索', '种子搜索', 'Magnet', 'Torrent', 'P2P资源', 'Loadbt', 'Nyaa', '磁力链', 'BT站'],
      exclude: ['下载器', 'qBittorrent'],
    },
  },
  {
    name: '地图出行与生活',
    description: '地图导航、出行、外卖、购物优惠与生活实用工具',
    icon: '🗺️',
    meta_title: '地图出行与生活实用工具精选集',
    meta_description: '地图导航、出行票务、外卖购物与日常生活实用工具。',
    meta_keywords: '地图,出行,外卖,购物,生活工具,优惠',
    rule: {
      keywords: ['地图', '导航', '出行', '外卖', '购物', '优惠', '票务', '高铁', '机票', '天气', '日历', '快递', '生活服务', '支付宝', '优惠券'],
    },
  },
  {
    name: '趣味生成与探索',
    description: '有趣的在线生成器、冷知识、互动小工具与探索站点',
    icon: '🎲',
    meta_title: '趣味在线工具与探索站点精选集',
    meta_description: '有趣生成器、冷门站点、互动实验与互联网探索导航。',
    meta_keywords: '趣味工具,生成器,冷知识,互动,探索',
    rule: {
      keywords: ['生成器', '趣味', '好玩', '随机', '测试', '占卜', '起名', '表情包', '梗', '冷知识', '今天', '历史上的今天', '小游戏', '解压'],
    },
  },
  {
    name: 'GitHub 开源精选',
    description: 'HelloGitHub、优质开源项目、开发者工具仓库',
    icon: '🐙',
    meta_title: 'GitHub 开源项目精选集',
    meta_description: '优质 GitHub 开源项目、HelloGitHub 推荐与开发者仓库导航。',
    meta_keywords: 'GitHub,开源,HelloGitHub,开源项目',
    rule: {
      keywords: ['GitHub', 'HelloGitHub', '开源', 'Gitee', 'awesome', '开源项目'],
      hosts: ['github.com', 'gitee.com', 'hellogithub.com'],
    },
  },
  {
    name: '微信生态工具',
    description: '微信文件传输、公众号、小程序与微信相关工具',
    icon: '💚',
    meta_title: '微信生态与公众号工具精选集',
    meta_description: '微信文件传输助手、公众号工具、小程序开发与微信相关服务。',
    meta_keywords: '微信,公众号,小程序,文件传输助手',
    rule: {
      keywords: ['微信文件', '文件传输助手', '公众号工具', '小程序开发', 'weixin.qq', '视频号', '微信生态', '微信助手'],
    },
  },
  {
    name: '语雀与知识库资源',
    description: '语雀分享的软件清单、教程合集与知识库资源',
    icon: '📒',
    meta_title: '语雀知识库与资源清单精选集',
    meta_description: '语雀公开文档中的软件清单、教程合集与效率资源。',
    meta_keywords: '语雀,知识库,软件清单,教程合集',
    rule: {
      hosts: ['yuque.com', 'www.yuque.com'],
    },
  },
  {
    name: '阿里云盘资源库',
    description: '阿里云盘分享的课程、软件、影视与学习资源合集',
    icon: '📦',
    meta_title: '阿里云盘分享资源精选集',
    meta_description: '阿里云盘公开分享：课程、软件、学习资料与影视资源合集。',
    meta_keywords: '阿里云盘,云盘资源,课程分享,学习资料',
    rule: {
      hosts: ['aliyundrive.com', 'www.aliyundrive.com', 'alipan.com', 'www.alipan.com'],
    },
    categories: [
      { name: '学习课程', keywords: ['课程', '学习', '教育', '英语', '考研', '课本', '教程'] },
      { name: '软件工具', keywords: ['软件', '工具', 'Office', '安装', '系统'] },
      { name: '影音娱乐', keywords: ['电影', '音乐', '影视', '视频', '游戏'] },
    ],
  },
  {
    name: '百度网盘资源库',
    description: '百度网盘分享的课程、游戏、软件与综合资源',
    icon: '🫐',
    meta_title: '百度网盘分享资源精选集',
    meta_description: '百度网盘公开分享链接：课程、游戏、软件与综合资源。',
    meta_keywords: '百度网盘,网盘分享,资源合集',
    rule: {
      hosts: ['pan.baidu.com'],
    },
  },
  {
    name: '蓝奏云软件库',
    description: '蓝奏云分享的 PC/安卓软件、工具与应用安装包',
    icon: '📂',
    meta_title: '蓝奏云软件与应用分享精选集',
    meta_description: '蓝奏云公开分享：Windows/Android 软件、工具箱与应用资源。',
    meta_keywords: '蓝奏云,软件分享,APK,绿色软件',
    rule: {
      hosts: ['lanzou', 'lanzoux.com', 'lanzoui.com', 'lanzoul.com', 'lanzouw.com', 'woozooo.com'],
    },
    categories: [
      { name: 'PC 软件', keywords: ['Windows', 'Win', 'PC', '绿色', '便携', '安装'] },
      { name: '安卓应用', keywords: ['安卓', 'Android', 'APK', '手机'] },
    ],
  },
  {
    name: 'FlowUs 资源合集',
    description: 'FlowUs 息流分享的教程、清单与知识资源',
    icon: '🌊',
    meta_title: 'FlowUs 息流资源精选集',
    meta_description: 'FlowUs 公开分享页：教程、资源清单与知识文档。',
    meta_keywords: 'FlowUs,息流,资源分享,知识库',
    rule: {
      hosts: ['flowus.cn'],
    },
  },
  {
    name: '摄影与航拍',
    description: '航拍、摄影作品、图库与摄影学习资源',
    icon: '📷',
    meta_title: '摄影·航拍·视觉作品精选集',
    meta_description: '航拍社区、摄影作品、视觉灵感与摄影学习资源。',
    meta_keywords: '摄影,航拍,Skypixel,视觉,作品',
    rule: {
      keywords: ['摄影', '航拍', 'Skypixel', '天空之城', '人像摄影', '风光摄影', '相机评测'],
    },
  },
  {
    name: '财经与股票',
    description: '股票行情、财经资讯、投资理财相关站点',
    icon: '💰',
    meta_title: '财经资讯与股票工具精选集',
    meta_description: '股票行情、财经新闻、投资理财与数据分析工具。',
    meta_keywords: '股票,财经,投资,理财,行情',
    rule: {
      keywords: ['股票', '财经', '投资理财', '基金', '证券', '行情', '雪球', '同花顺', '东方财富', '华尔街'],
    },
  },
  {
    name: '求职与招聘',
    description: '招聘平台、简历工具、面试题与求职资讯',
    icon: '🧳',
    meta_title: '求职招聘与面试资源精选集',
    meta_description: '招聘网站、简历制作、面试题库与求职经验资源。',
    meta_keywords: '求职,招聘,简历,面试,Boss直聘',
    rule: {
      keywords: ['求职', '招聘', '简历', '面试题', 'Boss直聘', '智联', '拉勾', '前程无忧', '猎聘', '校招', '社招'],
    },
  },
  {
    name: 'Docker 与运维',
    description: 'Docker、Linux、服务器运维、VPS 与部署相关',
    icon: '🐳',
    meta_title: 'Docker·Linux·运维部署精选集',
    meta_description: 'Docker 教程、Linux 运维、VPS 与自动化部署资源。',
    meta_keywords: 'Docker,Linux,运维,VPS,部署,服务器',
    rule: {
      keywords: ['Docker', 'Linux', '运维', 'VPS', 'Nginx', 'Kubernetes', 'K8s', '宝塔', '1Panel', 'Portainer', '服务器部署'],
    },
  },
  {
    name: '二维码与短链工具',
    description: '二维码生成、短链接、通用小工具集合',
    icon: '🔗',
    meta_title: '二维码·短链·通用小工具精选集',
    meta_description: '二维码生成识别、短链接服务与日常小工具。',
    meta_keywords: '二维码,短链,小工具,生成器',
    rule: {
      keywords: ['二维码', '短链', '短链接', 'QR码', 'qrcode', 'MikuTools', '在线工具箱', 'ToolTT'],
    },
  },
  {
    name: 'AI 提示词与 Prompt',
    description: 'Prompt 工程、提示词库、AI 指令与模板',
    icon: '💡',
    meta_title: 'AI 提示词与 Prompt 工程精选集',
    meta_description: 'Prompt 提示词库、指令模板与 Prompt 工程学习资源。',
    meta_keywords: 'Prompt,提示词,AI指令,Prompt工程',
    rule: {
      keywords: ['Prompt', '提示词', 'AI指令', '提示词库', 'Prompt工程', '指令集', '提示词模板', 'promptbase'],
    },
  },
  {
    name: 'Windows 系统资源',
    description: 'Windows 镜像、激活、美化与系统相关工具',
    icon: '🪟',
    meta_title: 'Windows 系统镜像与工具精选集',
    meta_description: 'Windows 镜像下载、系统激活、美化与优化工具。',
    meta_keywords: 'Windows,系统镜像,激活,MSDN,系统优化',
    rule: {
      keywords: ['Windows', 'Win10', 'Win11', 'Win7', 'MSDN', '系统镜像', '原版系统', 'ITellhow', '纯净版系统'],
    },
  },
  {
    name: '数据可视化与 BI',
    description: 'Power BI、图表库、可视化设计与 BI 工具',
    icon: '📉',
    meta_title: '数据可视化与 BI 工具精选集',
    meta_description: 'Power BI、数据可视化图表库与商业智能工具导航。',
    meta_keywords: '数据可视化,PowerBI,BI,图表,Tableau',
    rule: {
      keywords: ['数据可视化', 'PowerBI', 'Power BI', 'Tableau', 'ECharts', 'AntV', 'D3.js', '商业智能', '数据看板', 'Dashboard'],
    },
  },
  {
    name: '导航站与资源汇总',
    description: '综合导航站、资源库入口与工具导航合集',
    icon: '🧭',
    meta_title: '导航站与资源汇总精选集',
    meta_description: '优质导航站、资源库入口与工具集合站推荐。',
    meta_keywords: '导航站,资源汇总,工具导航,起始页',
    rule: {
      keywords: ['导航站', '起始页', '资源汇总', '工具导航', '阿虚的储物间', '设计师导航', '开发者导航', '网址导航', '收藏导航'],
    },
  },
  {
    name: 'B站与视频平台',
    description: 'Bilibili、视频下载、弹幕与视频平台相关',
    icon: '📺',
    meta_title: 'B站与视频平台工具精选集',
    meta_description: 'Bilibili 相关工具、视频下载与主流视频平台入口。',
    meta_keywords: 'B站,Bilibili,视频下载,YouTube,视频平台',
    rule: {
      keywords: ['B站', 'Bilibili', '哔哩哔哩', 'YouTube', '油管', '视频下载', '弹幕', 'B站下载'],
    },
  },
  {
    name: '产品经理工具箱 Pro',
    description: '文档协作、原型、数据分析、竞品与产品社区（扩展版）',
    icon: '📋',
    meta_title: '产品经理工具与资源精选集',
    meta_description: '产品经理文档、原型、数据、竞品分析与产品社区资源。',
    meta_keywords: '产品经理,PRD,原型,竞品分析,数据分析',
    rule: {
      keywords: ['产品经理', 'PRD', '竞品分析', '用户研究', 'Product Hunt', '产品社区', '需求分析', '用户画像'],
    },
  },
  {
    name: '前端开发精选',
    description: '前端框架、CSS 工具、组件库与前端学习资源',
    icon: '🖥️',
    meta_title: '前端开发工具与资源精选集',
    meta_description: 'Vue/React 生态、CSS 工具、组件库与前端开发学习导航。',
    meta_keywords: '前端,Vue,React,CSS,组件库,Web开发',
    rule: {
      keywords: ['前端开发', 'Vue', 'React', 'CSS框架', 'JavaScript', 'TypeScript', 'Webpack', 'Vite', '组件库', 'Tailwind', 'Bootstrap', 'Element Plus', 'Ant Design', 'Nuxt', 'Next.js'],
    },
  },
  {
    name: '后端与 API 开发',
    description: '后端框架、API 设计、数据库与服务端工具',
    icon: '⚙️',
    meta_title: '后端开发与 API 工具精选集',
    meta_description: '后端框架、API 调试、数据库工具与服务端开发资源。',
    meta_keywords: '后端,API,数据库,Node,Java,Go',
    rule: {
      keywords: ['后端开发', '数据库', 'MySQL', 'Redis', 'MongoDB', 'PostgreSQL', 'Node.js', 'Spring Boot', 'Django', 'Flask', 'FastAPI', 'GraphQL', 'Swagger', 'Apifox', 'Postman'],
      exclude: ['AI API', 'API中转'],
    },
  },
  {
    name: '字体设计与下载',
    description: '免费商用字体、中文字体、字体识别与设计',
    icon: '𝕋',
    meta_title: '免费字体下载与字体设计精选集',
    meta_description: '免费商用中英文字体下载、字体识别与字体设计资源。',
    meta_keywords: '字体下载,免费字体,商用字体,中文字体',
    rule: {
      keywords: ['字体下载', 'Fonts', '商用字体', '免费字体', '猫啃网', '字由', '字体天下', 'Google Fonts', '思源字体', '得意黑', '字体识别'],
    },
  },
  {
    name: '压缩与解压工具',
    description: '文件压缩、解压、分卷与压缩格式工具',
    icon: '📦',
    meta_title: '压缩解压工具精选集',
    meta_description: 'ZIP/RAR/7z 压缩解压软件与在线压缩工具。',
    meta_keywords: '压缩,解压,7z,WinRAR,ZIP',
    rule: {
      keywords: ['压缩软件', '解压', '7-Zip', 'WinRAR', 'Bandizip', 'ZIP压缩', 'RAR', '分卷压缩', '文件压缩'],
    },
  },
  {
    name: '翻译与词典',
    description: '在线翻译、专业词典、双语对照与语言工具',
    icon: '🌍',
    meta_title: '在线翻译与词典工具精选集',
    meta_description: 'DeepL、谷歌翻译、有道等在线翻译与专业词典工具。',
    meta_keywords: '翻译,词典,DeepL,有道,Google翻译',
    rule: {
      keywords: ['在线翻译', '词典', 'DeepL', '有道翻译', 'Google翻译', '百度翻译', '双语词典', 'dictionary', 'Translate'],
    },
  },
  {
    name: '邮件与临时通讯',
    description: '临时邮箱、文件传书、隐私通讯相关',
    icon: '✉️',
    meta_title: '临时邮箱与通讯工具精选集',
    meta_description: '临时邮箱、隐私邮件与轻量通讯工具导航。',
    meta_keywords: '临时邮箱,邮箱,隐私邮件,通讯',
    rule: {
      keywords: ['临时邮箱', '临时邮件', 'Gmail', 'Outlook', 'ProtonMail', '隐私邮箱', 'Email临时'],
    },
  },
  {
    name: '热榜与资讯聚合',
    description: '今日热榜、全网热点、资讯聚合与排行',
    icon: '🔥',
    meta_title: '热榜资讯与热点聚合精选集',
    meta_description: '全网热榜、热点聚合、资讯排行与实时热点工具。',
    meta_keywords: '热榜,热点,资讯聚合,排行榜,今日热榜',
    rule: {
      keywords: ['热榜', '今日热榜', '全网热搜', '资讯聚合', '热点聚合', '热搜榜'],
    },
  },
  {
    name: '独立开发者资源',
    description: '独立开发、出海、变现与 Indie Hacker 资源',
    icon: '🚀',
    meta_title: '独立开发者与出海资源精选集',
    meta_description: '独立开发、产品出海、变现与 Indie Hacker 工具资源。',
    meta_keywords: '独立开发,出海,Indie Hacker,产品变现',
    rule: {
      keywords: ['独立开发', '出海', 'Indie Hacker', 'Hacker News', 'Product Hunt', 'Side Project', '独立产品', 'Vercel', 'Stripe', '产品变现', '独立开发者'],
    },
  },
  {
    name: '图标库大全',
    description: '各类图标库、Icon 生成与图标设计资源',
    icon: '⭐',
    meta_title: '图标库与 Icon 资源精选集',
    meta_description: 'Iconfont、Iconify、Remix、Lucide 等图标库资源导航。',
    meta_keywords: '图标库,Iconfont,Iconify,Icon,SVG图标',
    rule: {
      keywords: ['图标库', 'iconfont', 'Iconify', 'Remix Icon', 'Lucide', 'Heroicons', 'Feather Icon', 'SVG图标', 'iconpark', 'IconPark'],
    },
  },
  {
    name: '配色与中国色',
    description: '配色生成、中国传统色、渐变与色彩工具',
    icon: '🌈',
    meta_title: '配色方案与中国色精选集',
    meta_description: '在线配色、中国传统色、渐变生成与色彩设计工具。',
    meta_keywords: '配色,中国色,渐变,色板,色彩工具',
    rule: {
      keywords: ['配色', '中国色', '渐变色', '色板', '色卡', 'Coolors', 'Adobe Color', 'ColorHunt', 'zhongguose', '色彩搭配'],
    },
  },
  // ══════ 补充主题（保证 ≥50 且覆盖更多方向） ══════
  {
    name: '云服务与对象存储',
    description: '阿里云、腾讯云、OSS、CDN 与云厂商控制台',
    icon: '⛅',
    meta_title: '云服务与对象存储精选集',
    meta_description: '主流云厂商、对象存储、CDN 与云服务控制台入口。',
    meta_keywords: '云服务,阿里云,腾讯云,OSS,CDN',
    rule: {
      keywords: ['阿里云', '腾讯云', '华为云', 'AWS', 'OSS', '对象存储', 'CDN', '云服务器', 'ECS', 'S3'],
    },
  },
  {
    name: '写作与内容创作',
    description: '写作工具、灵感、文案与内容创作辅助',
    icon: '✍️',
    meta_title: '写作与内容创作工具精选集',
    meta_description: '写作软件、文案灵感、内容创作与校对工具导航。',
    meta_keywords: '写作,文案,内容创作,校对,灵感',
    rule: {
      keywords: ['写作', '文案', '内容创作', '校对', '润色', '灵感写作', '小说写作', 'Scrivener', 'Typora'],
    },
  },
  {
    name: '健康与运动',
    description: '健身、运动、冥想与健康管理相关应用',
    icon: '🏃',
    meta_title: '健康运动与健身工具精选集',
    meta_description: '健身计划、运动记录、冥想与健康管理应用资源。',
    meta_keywords: '健身,运动,健康,冥想,锻炼',
    rule: {
      keywords: ['健身', '运动', '锻炼', '瑜伽', '冥想', '健康管理', '跑步', 'Keep', 'Daily Workout'],
    },
  },
  {
    name: '育儿与亲子',
    description: '育儿知识、儿童教育、亲子音频与家庭资源',
    icon: '👶',
    meta_title: '育儿亲子与儿童教育精选集',
    meta_description: '育儿知识、儿童课程、亲子音频与家庭教育资源。',
    meta_keywords: '育儿,亲子,儿童教育,早教',
    rule: {
      keywords: ['育儿', '亲子', '儿童', '早教', '绘本', '米小圈', '儿童教育', '性教育', '幼儿园'],
    },
  },
  {
    name: '法律与政务',
    description: '法律法规查询、政务服务与公共信息',
    icon: '⚖️',
    meta_title: '法律查询与政务服务精选集',
    meta_description: '法律法规、政务服务、公共信息查询入口。',
    meta_keywords: '法律,政务,法规,公共服务',
    rule: {
      keywords: ['法律', '法规', '政务', '裁判文书', '合同模板', '法律援助', '政府', '公共服务'],
    },
  },
]

// ── 分类分配 ──────────────────────────────────────────────
function assignCategory(bm, categories) {
  if (!categories?.length) return null
  const text = `${bm.title} ${bm.url} ${bm.description || ''}`.toLowerCase()
  for (const cat of categories) {
    if (cat.hosts?.some(h => bm.url.includes(h))) return cat.name
    if (cat.keywords?.some(k => text.includes(k.toLowerCase()))) return cat.name
  }
  return categories[0]?.name || null
}

// ── 写入 ──────────────────────────────────────────────────
function createCollection(def, bookmarks) {
  const now = Date.now()
  const collectionId = `col_${now}_${Math.random().toString(36).slice(2, 8)}`

  const insCol = db.prepare(`
    INSERT INTO collections (
      id, user_id, name, description, icon,
      meta_title, meta_description, meta_keywords,
      is_public, is_official, bookmark_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
  `)
  const insCat = db.prepare(`
    INSERT INTO collection_categories (collection_id, name, parent_id, sort_order, created_at)
    VALUES (?, ?, NULL, ?, ?)
  `)
  const insCb = db.prepare(`
    INSERT OR IGNORE INTO collection_bookmarks (collection_id, bookmark_id, category_id, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  const run = db.transaction(() => {
    // 去重 + 截断
    const seen = new Set()
    const unique = []
    for (const b of bookmarks) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      unique.push(b)
      if (unique.length >= MAX_BOOKMARKS) break
    }

    insCol.run(
      collectionId, USER_ID, def.name, def.description, def.icon,
      def.meta_title, def.meta_description, def.meta_keywords,
      unique.length, now, now,
    )

    const catMap = new Map()
    const catNames = def.categories?.map(c => c.name) || []
    // 确保所有会用到的分类存在；若无子类定义，不建分类
    if (catNames.length) {
      catNames.forEach((name, i) => {
        const r = insCat.run(collectionId, name, i, now)
        catMap.set(name, Number(r.lastInsertRowid))
      })
      // 其他
      if (!catMap.has('其他')) {
        const r = insCat.run(collectionId, '其他', catNames.length, now)
        catMap.set('其他', Number(r.lastInsertRowid))
      }
    }

    let i = 0
    for (const b of unique) {
      let catId = null
      if (catMap.size) {
        const cname = assignCategory(b, def.categories) || '其他'
        catId = catMap.get(cname) ?? catMap.get('其他') ?? null
      }
      insCb.run(collectionId, b.id, catId, i++, now)
    }
    return unique.length
  })

  return { id: collectionId, count: run() }
}

// ── 主流程 ────────────────────────────────────────────────
console.log(`定义精选集: ${COLLECTIONS.length} 个`)
console.log(`模式: ${DRY ? 'DRY-RUN' : 'WRITE'}  MIN=${MIN_BOOKMARKS} MAX=${MAX_BOOKMARKS}`)

const existingNames = new Set(
  db.prepare('SELECT name FROM collections').all().map(r => r.name),
)

const results = []
let skipped = 0
let tooFew = 0

for (const def of COLLECTIONS) {
  if (!FORCE && existingNames.has(def.name)) {
    console.log(`  [SKIP] 已存在: ${def.name}`)
    skipped++
    continue
  }

  const matched = matchBookmarks(def.rule)
  if (matched.length < MIN_BOOKMARKS) {
    console.log(`  [FEW] ${def.name}: 仅 ${matched.length} 条，跳过`)
    tooFew++
    continue
  }

  if (DRY) {
    console.log(`  [DRY] ${def.name}: ${matched.length} 条`)
    results.push({ name: def.name, count: matched.length })
    continue
  }

  const { id, count } = createCollection(def, matched)
  console.log(`  [OK] ${def.name}: ${count} 条 → ${id}`)
  results.push({ name: def.name, count, id })
  existingNames.add(def.name)
}

// 汇总
const total = db.prepare('SELECT COUNT(*) as c FROM collections').get().c
const pub = db.prepare('SELECT COUNT(*) as c FROM collections WHERE is_public=1').get().c
const official = db.prepare('SELECT COUNT(*) as c FROM collections WHERE is_official=1').get().c
const nonOff = db.prepare('SELECT COUNT(*) as c FROM collections WHERE is_official=0').get().c
const withMeta = db.prepare(`SELECT COUNT(*) as c FROM collections WHERE COALESCE(meta_title,'')!=''`).get().c
const avgBm = db.prepare('SELECT AVG(bookmark_count) as a FROM collections').get().a

console.log('\n========== 完成 ==========')
console.log(`本次创建: ${results.length}  跳过同名: ${skipped}  匹配不足: ${tooFew}`)
console.log(`库中精选集: 共 ${total} | 公开 ${pub} | 官方 ${official} | 非官方 ${nonOff}`)
console.log(`有 SEO: ${withMeta} | 平均书签: ${avgBm?.toFixed?.(1) ?? avgBm}`)

if (results.length) {
  console.log('\n本次明细:')
  results
    .sort((a, b) => b.count - a.count)
    .forEach(r => console.log(`  ${String(r.count).padStart(4)}  ${r.name}`))
}

// 覆盖率：至少出现在 1 个精选集中的公共池书签
const covered = db.prepare(`
  SELECT COUNT(DISTINCT b.id) as c
  FROM bookmarks b
  JOIN collection_bookmarks cb ON cb.bookmark_id = b.id
  WHERE COALESCE(b.label,'') = ''
`).get().c
const pool = db.prepare(`SELECT COUNT(*) as c FROM bookmarks WHERE COALESCE(label,'')=''`).get().c
console.log(`\n公共池覆盖: ${covered}/${pool} (${((covered / pool) * 100).toFixed(1)}%)`)

db.close()
