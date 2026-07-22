import Database from 'better-sqlite3'

const db = new Database('./data/favshub.db')

console.log('=== PERSONAL BY FOLDER ===')
const folders = db.prepare(`SELECT f.id, f.name, f.parent_id, pf.name as parent_name
  FROM folders f LEFT JOIN folders pf ON f.parent_id = pf.id
  WHERE f.user_id=1 ORDER BY COALESCE(f.parent_id, f.id), f.id`).all()
for (const f of folders) {
  const cnt = db.prepare(`SELECT COUNT(*) as c FROM bookmarks WHERE folder_id=? AND COALESCE(label,'')!=''`).get(f.id).c
  if (!cnt) continue
  const bms = db.prepare(`SELECT title, url FROM bookmarks WHERE folder_id=? AND COALESCE(label,'')!='' LIMIT 5`).all(f.id)
  console.log((f.parent_name ? f.parent_name + '/' : '') + f.name, '(' + cnt + ')')
  bms.forEach(b => console.log('   -', b.title.slice(0, 35)))
}

console.log('\n=== KEYWORD HITS (public pool) ===')
const keywords = [
  'AI', 'ChatGPT', 'Claude', 'DeepSeek', 'Kimi', 'Midjourney', 'Stable Diffusion',
  '设计', '字体', '图标', '配色', 'Figma', 'Canva', 'Photoshop', '壁纸', '素材', '模板',
  '视频', '音乐', '电影', '影视', '动漫', '漫画', '小说', '字幕', '直播', '体育', '游戏',
  '网盘', '阿里', '百度', '蓝奏', '下载', '磁力', 'BT', '种子', '资源',
  '软件', '编程', 'GitHub', '开发', 'API', 'Docker', 'Linux', '前端', 'Python',
  '学习', '教程', '课程', '英语', '考试', '考研', '论文', '学术', '电子书',
  '办公', 'PDF', '转换', '压缩', 'Office', 'Excel', 'PPT', 'Word', '简历',
  '搜索', 'VPN', '代理', 'Clash', '科学', '系统', '安全', '密码', '邮箱', '临时',
  '微信', '知乎', 'B站', 'iOS', '安卓', 'Android', 'Mac', 'Windows',
  '翻译', '地图', '购物', '优惠', '天气', '二维码', 'JSON', '正则', 'Markdown',
  'Steam', '模拟器', '小霸王', '摄影', 'iconfont', '剪映', '剪辑', '听书',
  '股票', '财经', '求职', '驾考', '公务员', '播客', '有声', '追番',
]
const seen = new Set()
for (const k of keywords) {
  if (seen.has(k.toLowerCase())) continue
  seen.add(k.toLowerCase())
  const c = db.prepare(`SELECT COUNT(*) as c FROM bookmarks WHERE COALESCE(label,'')='' AND (title LIKE ? OR url LIKE ? OR COALESCE(description,'') LIKE ?)`)
    .get('%' + k + '%', '%' + k + '%', '%' + k + '%').c
  if (c >= 5) console.log(String(c).padStart(4), k)
}

console.log('\n=== PUBLIC COUNT ===')
console.log(db.prepare(`SELECT COUNT(*) as c FROM bookmarks WHERE COALESCE(label,'')=''`).get())
console.log('collections:', db.prepare('SELECT COUNT(*) as c FROM collections').get())

db.close()
