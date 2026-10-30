# 子代理视觉验证指南（kimi-webbridge）

> **为什么需要这份文档**：本项目的所有前端改动（水印、徽标、排版、颜色遮挡）都**无法**靠源码匹配或 CSS 推算来自证。
> 真实渲染只有浏览器能回答。你（子代理）现在也有视觉能力了 —— 请**主动用它**，不要只在报告末尾写「需 lead 浏览器复核」。

## 关键前提：daemon 在 Windows 宿主，不在 WSL

- daemon 地址：`http://127.0.0.1:10086`
- **在 WSL 里 `curl 127.0.0.1:10086` 会返回 HTTP 000（连不上）** —— 这是正常的，不是 daemon 挂了。
- 必须用 **`pwsh` 工具**（PowerShell）调用 Windows 的 `curl.exe`。

## 复制即用的 PowerShell 封装

每次调用前先定义这个函数（每次 pwsh 调用都是新进程，所以要重新定义）：

```powershell
function Send-WB($obj) {
  $json = $obj | ConvertTo-Json -Depth 10 -Compress
  [System.IO.File]::WriteAllText("$env:TEMP\wb-body.json", $json, [System.Text.UTF8Encoding]::new($false))
  curl.exe -s -X POST http://127.0.0.1:10086/command -H "Content-Type: application/json" --data-binary "@$env:TEMP\wb-body.json"
}
```

> 必须写文件再 `--data-binary "@文件"`：直接把 JSON 塞进 `-d` 会被 PowerShell 的引号规则弄坏（中文/花括号会报错）。

## 健康检查

```powershell
function Send-WB($obj) { ... }
Send-WB @{ action="status"; args=@{}; session="<你的名字>" }
```

返回 `{"ok":true,...}` 即正常。

## 常用动作

### 1. 打开页面

```powershell
Send-WB @{ action="navigate"; args=@{ url="http://172.21.204.216:3270/tokens/xxx.html"; newTab=$true; group_title="FavsHub <你的任务名>" }; session="<你的名字>" } | Out-Null
Start-Sleep -Seconds 5
```

- **本地服务**：WSL 里起的服务用 **WSL IP**（不是 127.0.0.1）：先 `ip -4 addr show eth0 | grep -oP 'inet \K[\d.]+'` 拿 IP，再用 `http://<IP>:<PORT>`。Windows 浏览器能直连 WSL 的 IP。
- **生产**：`https://hao.bx9y.com.cn`
- `session` 用你自己的名字（如 `detail-ui`），这样各代理的标签页互不干扰。

### 2. 量尺寸 / 读计算样式（最重要）

```powershell
$js = @'
(()=>{
 const e=document.querySelector('.deal-badge');
 const cs=getComputedStyle(e);
 const r=e.getBoundingClientRect();
 return JSON.stringify({
   w:Math.round(r.width), h:Math.round(r.height),
   top:cs.top, bottom:cs.bottom, opacity:cs.opacity,
   bg:cs.backgroundColor, border:cs.borderTopColor,
   rectTop:Math.round(r.top), rectBottom:Math.round(r.bottom)
 });
})()
'@
Send-WB @{ action='evaluate'; args=@{ code=$js }; session="<你的名字>" }
```

> `evaluate` 返回 `{"ok":true,"data":{"value":"<你 return 的字符串>"}}` —— 值是字符串，要自己 `JSON.parse`。

### 3. 截图（肉眼判断观感）

```powershell
Send-WB @{ action='screenshot'; args=@{ format='png'; path='C:\Users\WIN11\AppData\Local\Temp\<你的名字>-<用途>.png' }; session="<你的名字>" }
```

拿到 `path` 后**用 `read_image` 工具直接看图**（不要试图用脚本分析像素）。截图是你判断「观感好不好、有没有被遮挡、字看不看得清」的唯一手段。

### 4. 检测遮挡（背景色盖住水印这类问题）

思路：水印层是 `z-index:-1`，任何**不透明背景**的兄弟块都会盖住它。

```powershell
$js = @'
(()=>{
 const layer=document.querySelector('.tdd-seal-layer');
 const ir=layer.getBoundingClientRect();
 const opaque=[...document.querySelectorAll('.tdd-body-inner *')].filter(e=>{
   if(e.closest('.tdd-seal-layer')) return false;
   const bg=getComputedStyle(e).backgroundColor;
   const m=bg.match(/[\d.]+\)$/);
   return bg && !/transparent/.test(bg) && (!m || parseFloat(m[0])>0.5);
 }).map(e=>{const r=e.getBoundingClientRect();return{
   sel:e.tagName.toLowerCase()+'.'+(e.className||'').split(' ')[0],
   bg:getComputedStyle(e).backgroundColor,
   range:[Math.round(r.top-ir.top),Math.round(r.bottom-ir.top)], w:Math.round(r.width)};
 }).filter(x=>x.w>200);
 const seals=[...document.querySelectorAll('.deal-badge')].map(e=>{
   const r=e.getBoundingClientRect();
   return {label:e.querySelector('.badge-label').innerText, range:[Math.round(r.top-ir.top),Math.round(r.bottom-ir.top)]};
 });
 return JSON.stringify({seals, opaque});
})()
'@
Send-WB @{ action='evaluate'; args=@{ code=$js }; session="<你的名字>" }
```

### 5. 多视口测试的正确做法（重要陷阱）

**`window.open` 指定尺寸会被浏览器合并成标签页 → 拿不到真实窄视口。**
**iframe 的 `contentDocument` 跨进程不可访问。**
**`documentElement.style.zoom` 不改变 `vw` 单位。**

所以唯一可靠的窄视口模拟方式是：**直接量容器宽度并强制改写容器尺寸**，或用 `--badge-size` 这类 CSS 变量直接设值复现：

```powershell
$js = @'
(async()=>{
 const modal=document.querySelector('.tdd-modal');
 const out=[];
 for(const w of [295,310,349,703,747]){
   modal.style.maxWidth = w+'px';
   await new Promise(r=>setTimeout(r,280));
   const e=document.querySelector('.deal-badge');
   const r=e.getBoundingClientRect();
   out.push({containerW:w, badgeW:Math.round(r.width), badgeH:Math.round(r.height)});
 }
 modal.style.maxWidth='';
 return JSON.stringify(out);
})()
'@
Send-WB @{ action='evaluate'; args=@{ code=$js }; session="<你的名字>" }
```

**验证「不占布局」的正确做法**：把水印 `display:none` 前后对比目标元素的 `offsetTop`：

```powershell
$js = @'
(()=>{
 const fm=()=>[...document.querySelectorAll('.tdd-section')].find(s=>/支持模型/.test(s.innerText));
 const bs=[...document.querySelectorAll('.deal-badge')];
 const before=fm()?.offsetTop;
 bs.forEach(x=>x.style.display='none');
 const after=fm()?.offsetTop;
 bs.forEach(x=>x.style.display='');
 return JSON.stringify({before, after, same:before===after});
})()
'@
Send-WB @{ action='evaluate'; args=@{ code=$js }; session="<你的名字>" }
```

## 验收纪律（请照做）

1. **改完前端，先起本地服务量一遍、截一张图，再报结果。** 不要在报告里写「需 lead 复核」当作交付 —— 你有能力自己验。
2. **截图必须自己看**（`read_image`），不能只看数字。数字对但观感差 = 没做完。
3. **报告里附上**：实测数字 + 截图路径 + 你对观感的一句判断（「可读」「偏淡」「被遮挡」）。
4. **发现源码与渲染不一致**（比如类名没挂上、prop 声明了没渲染）—— 优先相信渲染结果，那就是 bug。

## 起本地服务的标准流程

```bash
# 在 WSL 里
cd /home/win11/projects/wwwroot/FavsHub_web/favshub-nuxt
# 1) 准备数据库（首次会跑迁移）
rm -f /tmp/<你的名字>.db*
cp /tmp/prodcopy.db /tmp/<你的名字>.db
# 2) 起服务（后台，避开别人的端口）
(NUXT_DB_PATH=/tmp/<你的名字>.db PORT=<你的端口> setsid nohup node .output/server/index.mjs > /tmp/<你的名字>-srv.log 2>&1 < /dev/null &)
sleep 12
# 3) 拿 WSL IP 给 Windows 浏览器用
ip -4 addr show eth0 | grep -oP 'inet \K[\d.]+'
```

**端口分配**（避免冲突，用完 `fuser -k <端口>/tcp` 释放）：

| 代理 | 端口 |
|---|---|
| lead | 3270 |
| detail-ui | 3261 |
| server-data | 3262 |
| admin-reviews | 3263 |
| notify-format | 3264 |
| ratelimit-guard | 3265 |

**注意**：`pkill -f "node .output/server/index.mjs"` 会匹配到你自己的命令行导致自杀。**用 `fuser -k <端口>/tcp` 停服务。**
