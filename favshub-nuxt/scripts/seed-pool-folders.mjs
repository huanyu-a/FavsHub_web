/**
 * 为公共池书签（label=''）创建/补齐分类文件夹并自动归类
 * - 优先对齐管理员个人文件夹命名
 * - 不足部分参考 DH_NavHub 主题
 * - 不改动个人书签（label != ''）的 folder_id
 *
 * 用法:
 *   node scripts/seed-pool-folders.mjs --dry
 *   node scripts/seed-pool-folders.mjs
 *   node scripts/seed-pool-folders.mjs --reset   # 先清空公共池 folder_id 再重分
 */
import Database from 'better-sqlite3'
import { join } from 'node:path'

const DRY = process.argv.includes('--dry')
const RESET = process.argv.includes('--reset')
const DB_PATH = join(process.cwd(), 'data', 'favshub.db')
const USER_ID = 1

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── 分类树：name + icon + 可选 parent 名 + 匹配规则 ──────────────
// 规则优先级：数组越靠前越先匹配；子类优先于父类（先注册叶子）
/** @type {Array<{
 *  name: string
 *  parent?: string | null
 *  icon?: string
 *  sort?: number
 *  keywords?: string[]
 *  hosts?: string[]
 *  exclude?: string[]
 * }>} */
const FOLDER_TREE = [
  // 一级
  { name: 'AI专区', icon: '🤖', sort: 10 },
  { name: '站长资源', icon: '🌐', sort: 20 },
  { name: '技术工具', icon: '🛠️', sort: 30 },
  { name: '设计专区', icon: '🎨', sort: 40 },
  { name: '开发编程', icon: '💻', sort: 50 },
  { name: '学习教育', icon: '📚', sort: 60 },
  { name: '效率办公', icon: '💼', sort: 70 },
  { name: '网盘资源', icon: '☁️', sort: 80 },
  { name: '影音娱乐', icon: '🎬', sort: 90 },
  { name: '软件应用', icon: '💾', sort: 100 },
  { name: '游戏娱乐', icon: '🎮', sort: 110 },
  { name: '资讯数据', icon: '📊', sort: 120 },
  { name: '生活常用', icon: '🏠', sort: 130 },
  { name: '自媒体', icon: '📣', sort: 140 },
  { name: '安全网络', icon: '🛡️', sort: 150 },
  { name: '其他', icon: '📁', sort: 999 },

  // AI专区
  {
    name: 'AI对话', parent: 'AI专区', icon: '💬', sort: 1,
    keywords: ['ChatGPT', 'Claude', 'DeepSeek', 'Kimi', '通义', '文心', '豆包', 'Gemini', 'Copilot', 'Poe', '元宝', '智谱', 'GLM', '讯飞星火', '月之暗面', 'AI对话', 'chat.openai', 'claude.ai'],
  },
  {
    name: '视觉AI', parent: 'AI专区', icon: '🖼️', sort: 2,
    keywords: ['Midjourney', 'Stable Diffusion', 'DALL', '即梦', '可灵', 'AI绘画', 'AI绘图', '生图', '文生图', 'AI视频', 'Runway', 'Pika', 'Sora', '画一画', '通义万相', 'Liblib', 'Civitai'],
  },
  {
    name: 'AI Tool', parent: 'AI专区', icon: '🧰', sort: 3,
    keywords: ['AI工具', 'AI Tool', 'Prompt', '提示词', 'Cherry Studio', 'PromptBox', 'AI写作', 'AI助手'],
  },
  {
    name: 'AI_API', parent: 'AI专区', icon: '🔌', sort: 4,
    keywords: ['AI API', 'API中转', 'MaaS', '模型平台', 'OpenRouter', '1API', 'SiliconFlow', '硅基流动', 'Hugging Face', 'huggingface', 'Replicate', 'ModelScope', '魔搭', '讯飞星辰'],
  },
  {
    name: 'Agent', parent: 'AI专区', icon: '🦾', sort: 5,
    keywords: ['Agent', 'Cursor', 'Copilot', 'AI编程', 'AI代码', 'Bolt.new', 'v0.dev', 'Replit', 'Windsurf', 'Devin', 'Qoder', 'TRAE', 'WorkBuddy', 'Claude Code'],
  },
  {
    name: 'AI专区', parent: null, // 兜底到一级（匹配时用 keywords 挂到本级）
    keywords: ['人工智能', '大模型', 'LLM', 'AIGC', 'ChatBot'],
  },

  // 站长资源
  {
    name: '站长平台', parent: '站长资源', icon: '📡', sort: 1,
    keywords: ['站长', 'SEO', '爱站', '站长之家', '收录', '百度统计', '友盟', '关键词规划', '备案', 'Whois', 'ICP', '友链', '死链'],
  },
  {
    name: '软件下载', parent: '站长资源', icon: '⬇️', sort: 2,
    keywords: ['软件下载', '绿色软件', '破解', '吾爱', '52pojie', '装机', 'Portable', 'Appinn', '小众软件', 'MSDN'],
    exclude: ['Mac', '安卓', 'iOS', 'APK', '游戏'],
  },
  {
    name: '项目推荐', parent: '站长资源', icon: '⭐', sort: 3,
    keywords: ['开源项目', 'HelloGitHub', '项目推荐', '导航站', '起始页', '资源汇总', '阿虚', '储物间'],
  },
  {
    name: 'api_接口', parent: '站长资源', icon: '🔗', sort: 4,
    keywords: ['API接口', '热搜接口', '开放接口', '公共API', '免费API'],
  },

  // 技术工具
  {
    name: '排版工具', parent: '技术工具', icon: '📰', sort: 1,
    keywords: ['排版', '公众号排版', 'Markdown Editor', '秀米', '135编辑器', '微信编辑'],
  },
  {
    name: '编辑器', parent: '技术工具', icon: '✏️', sort: 2,
    keywords: ['在线编辑器', 'YAML', 'YML在线', '代码编辑', 'Monaco', 'CodeMirror'],
  },
  {
    name: '文本处理', parent: '技术工具', icon: '📝', sort: 3,
    keywords: ['JSON', '正则', '格式化', 'Base64', 'URL编码', 'Hash', '文字转拼音', 'Diff', '对比工具'],
  },
  {
    name: '技术教程', parent: '技术工具', icon: '📖', sort: 4,
    keywords: ['教程', '从入门', 'Docker', 'Linux', '技术文档', '官方文档', '开发文档'],
  },
  {
    name: '资源搜索', parent: '技术工具', icon: '🔍', sort: 5,
    keywords: ['盘搜', '超能搜', '网盘搜索', '磁力搜索', 'BT搜索', '种子搜索', '资源搜索', '茶杯狐', '飞鱼盘搜', '搜盘'],
  },
  {
    name: '科学上网', parent: '技术工具', icon: '🛡️', sort: 6,
    keywords: ['代理', 'Clash', 'V2Ray', 'SSR', '科学上网', '机场', '翻墙', 'VPN', 'HTTP代理', 'IP池', '青果云', '阿布云', 'Shadowsocks'],
  },

  // 设计专区
  {
    name: '设计素材', parent: '设计专区', icon: '🎭', sort: 1,
    keywords: ['素材', '壁纸', '图库', 'Unsplash', 'Pexels', 'Pixabay', '插画', '音效', '模板', '稿定', '创客贴', '包图', '千图'],
  },
  {
    name: '图片处理', parent: '设计专区', icon: '🖌️', sort: 2,
    keywords: ['在线PS', '抠图', '图片压缩', 'GIF', '修图', '图片编辑', '去水印', '加水印', 'Photopea', 'P图'],
  },
  {
    name: 'icon', parent: '设计专区', icon: '⭐', sort: 3,
    keywords: ['图标', 'iconfont', 'Iconify', 'Remix Icon', 'Lucide', 'Heroicons', 'IconPark', 'SVG图标'],
  },
  {
    name: '字体配色', parent: '设计专区', icon: '🔤', sort: 4,
    keywords: ['字体', '配色', '中国色', 'Coolors', '色板', '色卡', '渐变', 'Google Fonts', '猫啃', '字由', '字体天下', 'Adobe Color'],
  },
  {
    name: '设计灵感', parent: '设计专区', icon: '✨', sort: 5,
    keywords: ['Dribbble', 'Behance', '站酷', 'zcool', '设计灵感', 'UI设计', 'Awwwards', '花瓣', 'Pinterest', 'uisdc', '优设'],
  },
  {
    name: '原型设计', parent: '设计专区', icon: '📐', sort: 6,
    keywords: ['Figma', 'Axure', '墨刀', 'MasterGo', 'Framer', '原型', '蓝湖', '即时设计', 'Pixso', 'Sketch'],
  },

  // 开发编程
  {
    name: '前端开发', parent: '开发编程', icon: '🖥️', sort: 1,
    keywords: ['前端', 'Vue', 'React', 'CSS', 'JavaScript', 'TypeScript', 'Webpack', 'Vite', 'Tailwind', 'Bootstrap', 'Element', 'Ant Design', 'Nuxt', 'Next.js'],
  },
  {
    name: '后端开发', parent: '开发编程', icon: '⚙️', sort: 2,
    keywords: ['后端', 'MySQL', 'Redis', 'MongoDB', 'PostgreSQL', 'Node.js', 'Spring', 'Django', 'Flask', 'FastAPI', 'GraphQL', 'Swagger', 'Apifox', 'Postman'],
    exclude: ['AI API', 'API中转'],
  },
  {
    name: '开源社区', parent: '开发编程', icon: '🐙', sort: 3,
    keywords: ['GitHub', 'Gitee', 'HelloGitHub', '开源', '码云', '编程导航', '掘金', 'V2EX', 'CSDN', 'Stack Overflow'],
    hosts: ['github.com', 'gitee.com', 'hellogithub.com'],
  },
  {
    name: '运维部署', parent: '开发编程', icon: '🐳', sort: 4,
    keywords: ['Docker', 'Kubernetes', 'K8s', 'Nginx', 'VPS', '宝塔', '1Panel', 'Portainer', '服务器', '运维', 'Linux'],
  },
  {
    name: '云服务', parent: '开发编程', icon: '⛅', sort: 5,
    keywords: ['阿里云', '腾讯云', '华为云', 'AWS', 'OSS', '对象存储', 'CDN', '云服务器', 'ECS'],
  },

  // 学习教育
  {
    name: '英语语言', parent: '学习教育', icon: '🗣️', sort: 1,
    keywords: ['英语', '背单词', '口语', '听力', '四级', '六级', '雅思', '托福', '翻译', '词典', '有道', 'DeepL', '墨墨', 'Duolingo', '日语', '韩语'],
  },
  {
    name: 'K12教育', parent: '学习教育', icon: '🎒', sort: 2,
    keywords: ['小学', '初中', '高中', '课本', '教辅', '小灯塔', '竞赛', '奥数', '中考', '高考', 'K12', '学而思'],
  },
  {
    name: '考研职考', parent: '学习教育', icon: '🎓', sort: 3,
    keywords: ['考研', '公务员', '教资', '教师资格', '驾考', '司法考试', 'CPA', '建造师', '专升本', '成考', '自考'],
  },
  {
    name: '在线课程', parent: '学习教育', icon: '🎬', sort: 4,
    keywords: ['慕课', 'MOOC', '在线课程', '网易云课堂', 'Coursera', 'Udemy', 'B站课程', '付费课程', '腾讯课堂', '学堂在线'],
  },
  {
    name: '电子书阅读', parent: '学习教育', icon: '📖', sort: 5,
    keywords: ['电子书', '小说', 'Z-Library', 'zlib', 'Anna', 'Kindle', '推书', 'epub', 'mobi', '图书馆', '古籍'],
    exclude: ['有声', '听书'],
  },
  {
    name: '学术论文', parent: '学习教育', icon: '🔬', sort: 6,
    keywords: ['论文', '文献', '学术', '查重', '知网', 'CNKI', 'Sci-Hub', 'ResearchGate', '万方', '维普', '期刊', 'SCI'],
  },
  {
    name: '编程学习', parent: '学习教育', icon: '🧑‍💻', sort: 7,
    keywords: ['编程学习', '编程入门', '算法', 'LeetCode', '数据结构', '面试题', 'Python教程', 'Java教程'],
  },

  // 效率办公
  {
    name: '办公套件', parent: '效率办公', icon: '📎', sort: 1,
    keywords: ['Office', 'WPS', 'Excel', 'PowerPoint', 'Word', 'Notion', '飞书', '石墨', '思维导图', 'XMind', 'ProcessOn', '印象笔记', 'Obsidian', 'Logseq'],
    exclude: ['激活', '破解'],
  },
  {
    name: 'PDF文档', parent: '效率办公', icon: '📄', sort: 2,
    keywords: ['PDF', 'OCR', '扫描', '文档处理', '格式转换', '转Word', '转PDF', '合并PDF', 'CAJ'],
  },
  {
    name: '办公模板', parent: '效率办公', icon: '📊', sort: 3,
    keywords: ['PPT模板', '简历模板', 'Word模板', 'Excel模板', 'iSlide', '第一PPT', '简历'],
  },
  {
    name: '效率工具', parent: '效率办公', icon: '⏱️', sort: 4,
    keywords: ['待办', '番茄钟', '效率', '笔记', '日历', '提醒', 'GTD'],
  },

  // 网盘资源
  {
    name: '阿里云盘', parent: '网盘资源', icon: '📦', sort: 1,
    hosts: ['aliyundrive.com', 'alipan.com'],
  },
  {
    name: '百度网盘', parent: '网盘资源', icon: '🫐', sort: 2,
    hosts: ['pan.baidu.com'],
  },
  {
    name: '蓝奏云', parent: '网盘资源', icon: '📂', sort: 3,
    hosts: ['lanzou', 'lanzoux.com', 'lanzoui.com', 'lanzoul.com', 'lanzouw.com', 'woozooo.com'],
  },
  {
    name: '语雀知识库', parent: '网盘资源', icon: '📒', sort: 4,
    hosts: ['yuque.com'],
  },
  {
    name: 'FlowUs', parent: '网盘资源', icon: '🌊', sort: 5,
    hosts: ['flowus.cn'],
  },
  {
    name: '其他网盘', parent: '网盘资源', icon: '☁️', sort: 6,
    keywords: ['网盘', '云盘', '文件传输', '奶牛快传', '文叔叔', 'CowTransfer', '天翼云', '微云', '城通', '夸克网盘'],
    hosts: ['cowtransfer.com', 'wenshushu.cn', 'cloud.189.cn', 'ctfile.com'],
  },

  // 影音娱乐
  {
    name: '在线影视', parent: '影音娱乐', icon: '🍿', sort: 1,
    keywords: ['在线观看', '在线电影', '免费电影', '追剧', '蓝光影院', 'Gimy', '电视剧', '综艺', '纪录片', '影视站', '电影网站'],
    exclude: ['下载', '字幕组', '磁力', 'BT', '剪辑'],
  },
  {
    name: '影视下载', parent: '影音娱乐', icon: '🎞️', sort: 2,
    keywords: ['字幕组', '人人影视', '影视下载', 'PT', '高清下载', 'FIX字幕', '字幕侠', 'Hao4K', 'YYeTs', '电影下载', '蓝光下载'],
  },
  {
    name: '动漫二次元', parent: '影音娱乐', icon: '🌸', sort: 3,
    keywords: ['动漫', '追番', '二次元', '番剧', '漫画', 'ACG', 'Bilibili', '哔哩哔哩', 'Comicat', '米画师', '萌图'],
  },
  {
    name: '音乐有声', parent: '影音娱乐', icon: '🎵', sort: 4,
    keywords: ['音乐', 'MP3', '无损', '播客', '有声', '听书', '电台', '网易云', 'Spotify', '铃声', '喜马拉雅'],
  },
  {
    name: '视频剪辑', parent: '影音娱乐', icon: '🎥', sort: 5,
    keywords: ['剪辑', '剪映', 'Premiere', 'After Effects', '达芬奇', '视频编辑', '爱剪辑', '格式工厂', 'HandBrake', 'PotPlayer', '视频播放器', 'CapCut'],
  },
  {
    name: '体育直播', parent: '影音娱乐', icon: '⚽', sort: 6,
    keywords: ['体育', '足球', 'NBA', '赛事', '直播吧', '体育直播', 'CBA', '英超'],
  },
  {
    name: 'BT磁力', parent: '影音娱乐', icon: '🧲', sort: 7,
    keywords: ['磁力搜索', 'BT搜索', '种子搜索', 'Magnet', 'Torrent', 'Loadbt', 'Nyaa', '磁力链', 'BT站'],
  },

  // 软件应用
  {
    name: 'Windows系统', parent: '软件应用', icon: '🪟', sort: 1,
    keywords: ['Windows', 'Win10', 'Win11', 'Win7', 'MSDN', '系统镜像', '原版系统', '纯净版', '系统优化', 'PE', 'WePE', '微PE', '驱动', '激活'],
  },
  {
    name: 'Mac软件', parent: '软件应用', icon: '🍎', sort: 2,
    keywords: ['Mac', 'macOS', 'Mac软件', 'Mac应用', 'Homebrew'],
    exclude: ['iOS', 'iPhone', 'iPad'],
  },
  {
    name: '安卓应用', parent: '软件应用', icon: '📱', sort: 3,
    keywords: ['安卓', 'Android', 'APK', '手机软件', '安卓应用'],
    exclude: ['iOS', 'iPhone'],
  },
  {
    name: 'iOS应用', parent: '软件应用', icon: '📲', sort: 4,
    keywords: ['iOS', 'iPhone', 'iPad', 'App Store', 'TestFlight', '快捷指令'],
  },
  {
    name: '下载工具', parent: '软件应用', icon: '⬇️', sort: 5,
    keywords: ['下载器', '下载工具', 'IDM', 'Aria2', '迅雷', 'Motrix', 'qBittorrent', '下载管理', '离线下载'],
  },
  {
    name: '浏览器扩展', parent: '软件应用', icon: '🧩', sort: 6,
    keywords: ['浏览器扩展', '浏览器插件', '油猴', 'GreasyFork', 'Tampermonkey', 'Chrome扩展', 'Edge插件', '脚本猫'],
  },
  {
    name: '压缩解压', parent: '软件应用', icon: '📦', sort: 7,
    keywords: ['压缩软件', '解压', '7-Zip', 'WinRAR', 'Bandizip', 'ZIP', 'RAR', '分卷'],
  },
  {
    name: '系统维护', parent: '软件应用', icon: '🔧', sort: 8,
    keywords: ['清理', '卸载', 'Geek Uninstaller', '磁盘分区', '备份', '系统维护', '优化软件'],
  },

  // 游戏娱乐
  {
    name: '游戏平台', parent: '游戏娱乐', icon: '🎮', sort: 1,
    keywords: ['Steam', 'Epic', '游戏', 'TapTap', 'PS4', 'PS5', 'Xbox', '任天堂', 'Switch', '单机', '独立游戏'],
  },
  {
    name: '模拟器怀旧', parent: '游戏娱乐', icon: '🕹️', sort: 2,
    keywords: ['模拟器', 'ROM', '小霸王', '怀旧', 'GBA', 'FC', 'NDS', '塞尔达'],
  },

  // 资讯数据
  {
    name: '行业数据', parent: '资讯数据', icon: '📈', sort: 1,
    keywords: ['数据报告', '行业报告', '艾瑞', 'QuestMobile', '199IT', '数据分析', 'SimilarWeb', 'PowerBI', 'Tableau', '数据中心', '排行榜', '新榜'],
  },
  {
    name: '科技资讯', parent: '资讯数据', icon: '📡', sort: 2,
    keywords: ['少数派', 'sspai', '科技资讯', '数码', '虎嗅', '36氪', '爱范儿', 'IT之家', '异次元', 'Product Hunt'],
  },
  {
    name: '热榜资讯', parent: '资讯数据', icon: '🔥', sort: 3,
    keywords: ['热榜', '今日热榜', '热搜', '资讯聚合', '热点'],
  },
  {
    name: '财经股票', parent: '资讯数据', icon: '💰', sort: 4,
    keywords: ['股票', '财经', '投资', '理财', '基金', '证券', '行情', '雪球', '同花顺', '东方财富'],
  },

  // 生活常用
  {
    name: '地图出行', parent: '生活常用', icon: '🗺️', sort: 1,
    keywords: ['地图', '导航', '出行', '高铁', '机票', '票务', '快递', '外卖'],
  },
  {
    name: '购物优惠', parent: '生活常用', icon: '🛒', sort: 2,
    keywords: ['购物', '优惠', '优惠券', '支付宝', '电商', '海淘'],
  },
  {
    name: '生活工具', parent: '生活常用', icon: '🔧', sort: 3,
    keywords: ['天气', '日历', '二维码', '短链', '计算器', '单位换算', '在线工具箱', 'MikuTools'],
  },
  {
    name: '求职招聘', parent: '生活常用', icon: '🧳', sort: 4,
    keywords: ['求职', '招聘', '简历', '面试', 'Boss', '智联', '拉勾', '前程无忧', '猎聘', '校招'],
  },
  {
    name: '健康运动', parent: '生活常用', icon: '🏃', sort: 5,
    keywords: ['健身', '运动', '锻炼', '瑜伽', '冥想', '健康', '跑步', 'Keep'],
  },
  {
    name: '育儿亲子', parent: '生活常用', icon: '👶', sort: 6,
    keywords: ['育儿', '亲子', '儿童', '早教', '绘本', '米小圈', '幼儿园'],
  },
  {
    name: '邮箱通讯', parent: '生活常用', icon: '✉️', sort: 7,
    keywords: ['邮箱', '临时邮箱', '邮件', 'Gmail', 'Outlook', 'ProtonMail', '临时邮件'],
  },
  {
    name: '隐私安全', parent: '生活常用', icon: '🔐', sort: 8,
    keywords: ['密码管理', '临时号码', '隐私', '安全检测', '2FA', 'Bitwarden', '1Password', '病毒扫描', '沙箱'],
  },

  // 自媒体
  {
    name: '自媒体', parent: null,
    keywords: ['自媒体', '新媒体', '公众号', '短视频', '带货', '主播', '新榜', '西瓜数据', '飞瓜', '抖音运营', '视频号', '小红书运营'],
  },
  {
    name: '微信生态', parent: '自媒体', icon: '💚', sort: 1,
    keywords: ['微信', '文件传输助手', '小程序', 'weixin', '视频号'],
  },
  {
    name: '写作创作', parent: '自媒体', icon: '✍️', sort: 2,
    keywords: ['写作', '文案', '内容创作', '校对', '润色', 'Typora'],
  },

  // 安全网络（一级兜底关键词）
  {
    name: '安全网络', parent: null,
    keywords: ['安全工具', '网络工具', '防火墙', '证书', 'SSL'],
  },
]

// 去重树定义：同名只保留一条结构定义，keywords 合并到最后一条带 parent 的
function buildTreeSpecs() {
  const byKey = new Map() // name -> {name, parent, icon, sort, rules:[]}
  for (const item of FOLDER_TREE) {
    const key = item.name
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: item.name,
        parent: item.parent ?? null,
        icon: item.icon || '',
        sort: item.sort ?? 0,
        rules: [],
      })
    }
    const node = byKey.get(key)
    if (item.parent !== undefined) node.parent = item.parent
    if (item.icon) node.icon = item.icon
    if (item.sort != null) node.sort = item.sort
    if (item.keywords?.length || item.hosts?.length) {
      node.rules.push({
        keywords: item.keywords || [],
        hosts: item.hosts || [],
        exclude: item.exclude || [],
      })
    }
  }
  return [...byKey.values()]
}

// ── 确保文件夹存在 ────────────────────────────────────────
function ensureFolders(specs) {
  const now = Date.now()
  const existing = db.prepare(
    'SELECT id, name, parent_id FROM folders WHERE user_id = ?',
  ).all(USER_ID)

  const byNameParent = new Map() // `${parentId||0}::${name}` -> id
  const byName = new Map() // 同名优先取无 parent 冲突的；用于 parent 解析
  for (const f of existing) {
    byNameParent.set(`${f.parent_id || 0}::${f.name}`, f.id)
    // 同名可能有多个，记录第一个
    if (!byName.has(f.name)) byName.set(f.name, f.id)
  }

  const ins = db.prepare(`
    INSERT INTO folders (user_id, name, parent_id, sort_order, icon, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updIcon = db.prepare(`
    UPDATE folders SET icon = ?, sort_order = ?, updated_at = ? WHERE id = ? AND (COALESCE(icon,'') = '' OR sort_order != ?)
  `)

  // 先建一级，再建子级
  const tops = specs.filter(s => !s.parent)
  const children = specs.filter(s => s.parent)

  const idOf = new Map() // name -> id（树内唯一名假设）

  function createOrGet(name, parentId, icon, sort) {
    const key = `${parentId || 0}::${name}`
    if (byNameParent.has(key)) {
      const id = byNameParent.get(key)
      if (!DRY && icon) updIcon.run(icon, sort, now, id, sort)
      return id
    }
    // 兼容：已有同名文件夹（可能 parent 不同）则复用，避免重复
    if (byName.has(name)) {
      return byName.get(name)
    }
    if (DRY) {
      const fake = -Math.abs(name.hashCode?.() || name.length * 1000 + (parentId || 0))
      // dry 用负数伪 id
      const id = -(byName.size + 1)
      byName.set(name, id)
      byNameParent.set(key, id)
      return id
    }
    const r = ins.run(USER_ID, name, parentId, sort, icon || '', now, now)
    const id = Number(r.lastInsertRowid)
    byName.set(name, id)
    byNameParent.set(key, id)
    console.log(`  [NEW] folder #${id} ${parentId ? '└ ' : ''}${name}`)
    return id
  }

  // String hash helper unused — dry ids sequential above

  for (const s of tops) {
    const id = createOrGet(s.name, null, s.icon, s.sort)
    idOf.set(s.name, id)
  }
  for (const s of children) {
    const parentId = idOf.get(s.parent) || byName.get(s.parent) || null
    if (!parentId && !DRY) {
      // 父不存在则先建父
      const pSpec = specs.find(x => x.name === s.parent) || { name: s.parent, icon: '', sort: 0 }
      const pid = createOrGet(pSpec.name, null, pSpec.icon || '', pSpec.sort || 0)
      idOf.set(s.parent, pid)
    }
    const pid = idOf.get(s.parent) || byName.get(s.parent)
    const id = createOrGet(s.name, pid, s.icon, s.sort)
    idOf.set(s.name, id)
  }

  return idOf
}

// ── 匹配 ──────────────────────────────────────────────────
function textOf(b) {
  return `${b.title || ''} ${b.url || ''} ${b.description || ''}`.toLowerCase()
}

function matchRule(b, rule) {
  const t = textOf(b)
  const url = (b.url || '').toLowerCase()
  if (rule.exclude?.length) {
    for (const e of rule.exclude) {
      if (t.includes(e.toLowerCase())) return false
    }
  }
  if (rule.hosts?.length) {
    for (const h of rule.hosts) {
      if (url.includes(h.toLowerCase())) return true
    }
  }
  if (rule.keywords?.length) {
    for (const k of rule.keywords) {
      if (t.includes(k.toLowerCase())) return true
    }
  }
  return false
}

/**
 * 匹配顺序：所有带 rules 的「叶子优先」——子分类先于父分类
 */
function buildMatchers(specs, idOf) {
  // 子类在前
  const withRules = specs.filter(s => s.rules.length)
  withRules.sort((a, b) => {
    const ap = a.parent ? 0 : 1
    const bp = b.parent ? 0 : 1
    return ap - bp
  })
  return withRules.map(s => ({
    name: s.name,
    folderId: idOf.get(s.name),
    rules: s.rules,
  }))
}

function classify(b, matchers, otherId) {
  for (const m of matchers) {
    if (!m.folderId) continue
    for (const rule of m.rules) {
      if (matchRule(b, rule)) return m.folderId
    }
  }
  return otherId
}

// ── 主流程 ────────────────────────────────────────────────
const specs = buildTreeSpecs()
console.log(`分类定义: ${specs.length} 个文件夹节点`)
console.log(`模式: ${DRY ? 'DRY-RUN' : 'WRITE'}${RESET ? ' + RESET' : ''}`)

const idOf = ensureFolders(specs)
const otherId = idOf.get('其他')
const matchers = buildMatchers(specs, idOf)

if (RESET && !DRY) {
  const r = db.prepare(`UPDATE bookmarks SET folder_id = NULL WHERE user_id = ? AND COALESCE(label,'') = ''`).run(USER_ID)
  console.log(`已重置公共池 folder_id: ${r.changes} 条`)
}

const pool = db.prepare(`
  SELECT id, title, url, description, folder_id
  FROM bookmarks
  WHERE user_id = ? AND COALESCE(label,'') = ''
`).all(USER_ID)

console.log(`公共池书签: ${pool.length}`)

const counts = new Map()
let assigned = 0
let unchanged = 0
let toOther = 0

const upd = db.prepare(`UPDATE bookmarks SET folder_id = ?, updated_at = ? WHERE id = ?`)
const now = Date.now()

const apply = db.transaction(() => {
  for (const b of pool) {
    const fid = classify(b, matchers, otherId)
    const name = [...idOf.entries()].find(([, v]) => v === fid)?.[0] || '?'
    counts.set(name, (counts.get(name) || 0) + 1)
    if (fid === otherId) toOther++

    if (b.folder_id === fid) {
      unchanged++
      continue
    }
    assigned++
    if (!DRY) upd.run(fid, now, b.id)
  }
})
apply()

// 汇总
console.log('\n========== 分类结果 ==========')
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
for (const [name, c] of sorted) {
  console.log(`  ${String(c).padStart(4)}  ${name}`)
}

const stillNull = db.prepare(`
  SELECT COUNT(*) as c FROM bookmarks
  WHERE user_id = ? AND COALESCE(label,'') = '' AND folder_id IS NULL
`).get(USER_ID).c

const withFolder = db.prepare(`
  SELECT COUNT(*) as c FROM bookmarks
  WHERE user_id = ? AND COALESCE(label,'') = '' AND folder_id IS NOT NULL
`).get(USER_ID).c

// 个人书签未被误改
const personal = db.prepare(`
  SELECT COUNT(*) as c FROM bookmarks WHERE user_id = ? AND COALESCE(label,'') != ''
`).get(USER_ID).c

console.log(`\n变更: ${assigned}  未变: ${unchanged}  归入「其他」: ${toOther}`)
console.log(`公共池有分类: ${withFolder}/${pool.length}  仍无分类: ${stillNull}`)
console.log(`个人书签数(应不变): ${personal}`)
console.log(`文件夹总数: ${db.prepare('SELECT COUNT(*) as c FROM folders WHERE user_id=?').get(USER_ID).c}`)

db.close()
