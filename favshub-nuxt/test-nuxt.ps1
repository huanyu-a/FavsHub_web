# FavsHub Nuxt 测试脚本

Write-Output "=========================================="
Write-Output "       FavsHub Nuxt 全面测试"
Write-Output "==========================================`n"

# 测试静态页面
Write-Output "【1. 静态页面测试】"
$pages = @(
    @{url="/"; name="主页"},
    @{url="/index.html"; name="主页(index.html)"},
    @{url="/login.html"; name="登录页"},
    @{url="/admin/index.html"; name="管理后台"},
    @{url="/promptpro/index.html"; name="提示词管理"}
)

foreach ($page in $pages) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$($page.url)"
    $status = if ($statusCode -eq "200") { "✅" } else { "❌" }
    Write-Output "$status $($page.name): $statusCode"
}

# 测试CSS资源
Write-Output "`n【2. CSS资源测试】"
$cssFiles = @(
    "css/main-bundle.css",
    "css/index-sidebar-fix.css",
    "css/mobile-responsive.css",
    "vendor/remixicon.css"
)

foreach ($file in $cssFiles) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/$file"
    $status = if ($statusCode -eq "200") { "✅" } else { "❌" }
    Write-Output "$status $file: $statusCode"
}

# 测试JS资源
Write-Output "`n【3. JS资源测试】"
$jsFiles = @(
    "js/api.js",
    "js/script.js",
    "js/chrome-shim.js",
    "js/settings-store.js",
    "vendor/Sortable.min.js",
    "vendor/lodash.min.js"
)

foreach ($file in $jsFiles) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/$file"
    $status = if ($statusCode -eq "200") { "✅" } else { "❌" }
    Write-Output "$status $file: $statusCode"
}

# 测试图片资源
Write-Output "`n【4. 图片资源测试】"
$images = @(
    "images/logo.svg",
    "images/google-logo.svg",
    "images/bing-logo.png",
    "favicon.ico"
)

foreach ($image in $images) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/$image"
    $status = if ($statusCode -eq "200") { "✅" } else { "❌" }
    Write-Output "$status $image: $statusCode"
}

# 测试API端点
Write-Output "`n【5. API端点测试】"
$apis = @(
    @{url="/api/health"; name="健康检查"},
    @{url="/api/search-engines"; name="搜索引擎"},
    @{url="/api/tdk"; name="TDK配置"}
)

foreach ($api in $apis) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$($api.url)"
    $status = if ($statusCode -eq "200") { "✅" } else { "❌" }
    Write-Output "$status $($api.name): $statusCode"
}

# 测试需要认证的API（应该返回401或200）
Write-Output "`n【6. 认证API测试】"
$authApis = @(
    @{url="/api/bookmarks"; name="书签"},
    @{url="/api/folders"; name="文件夹"},
    @{url="/api/tags"; name="标签"},
    @{url="/api/settings"; name="设置"},
    @{url="/api/prompts"; name="提示词"}
)

foreach ($api in $authApis) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$($api.url)"
    $status = if ($statusCode -in @("200", "401")) { "✅" } else { "❌" }
    Write-Output "$status $($api.name): $statusCode"
}

Write-Output "`n=========================================="
Write-Output "           测试完成"
Write-Output "=========================================="
