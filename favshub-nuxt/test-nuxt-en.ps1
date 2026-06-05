# FavsHub Nuxt Test Script

Write-Output "=========================================="
Write-Output "       FavsHub Nuxt Full Test"
Write-Output "==========================================`n"

# Test Static Pages
Write-Output "【1. Static Pages Test】"
$pages = @(
    @{url="/"; name="Home"},
    @{url="/index.html"; name="Home(index.html)"},
    @{url="/login.html"; name="Login"},
    @{url="/admin/index.html"; name="Admin"},
    @{url="/promptpro/index.html"; name="Prompts"}
)

foreach ($page in $pages) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$($page.url)"
    $status = if ($statusCode -eq "200") { "[OK]" } else { "[FAIL]" }
    Write-Output "$status $($page.name): $statusCode"
}

# Test CSS Resources
Write-Output "`n【2. CSS Resources Test】"
$cssFiles = @(
    "css/main-bundle.css",
    "css/index-sidebar-fix.css",
    "css/mobile-responsive.css",
    "vendor/remixicon.css"
)

foreach ($file in $cssFiles) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/$file"
    $status = if ($statusCode -eq "200") { "[OK]" } else { "[FAIL]" }
    Write-Output "$status $file: $statusCode"
}

# Test JS Resources
Write-Output "`n【3. JS Resources Test】"
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
    $status = if ($statusCode -eq "200") { "[OK]" } else { "[FAIL]" }
    Write-Output "$status $file: $statusCode"
}

# Test Image Resources
Write-Output "`n【4. Image Resources Test】"
$images = @(
    "images/logo.svg",
    "images/google-logo.svg",
    "images/bing-logo.png",
    "favicon.ico"
)

foreach ($image in $images) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/$image"
    $status = if ($statusCode -eq "200") { "[OK]" } else { "[FAIL]" }
    Write-Output "$status $image: $statusCode"
}

# Test API Endpoints
Write-Output "`n【5. API Endpoints Test】"
$apis = @(
    @{url="/api/health"; name="Health Check"},
    @{url="/api/search-engines"; name="Search Engines"},
    @{url="/api/tdk"; name="TDK Config"}
)

foreach ($api in $apis) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$($api.url)"
    $status = if ($statusCode -eq "200") { "[OK]" } else { "[FAIL]" }
    Write-Output "$status $($api.name): $statusCode"
}

# Test Auth Required APIs
Write-Output "`n【6. Auth Required APIs Test】"
$authApis = @(
    @{url="/api/bookmarks"; name="Bookmarks"},
    @{url="/api/folders"; name="Folders"},
    @{url="/api/tags"; name="Tags"},
    @{url="/api/settings"; name="Settings"},
    @{url="/api/prompts"; name="Prompts"}
)

foreach ($api in $authApis) {
    $statusCode = curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$($api.url)"
    $status = if ($statusCode -in @("200", "401")) { "[OK]" } else { "[FAIL]" }
    Write-Output "$status $($api.name): $statusCode"
}

Write-Output "`n=========================================="
Write-Output "           Test Complete"
Write-Output "=========================================="
