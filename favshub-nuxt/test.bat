@echo off
echo === FavsHub Nuxt Test ===
echo.

echo [1. API Health Check]
curl -s http://localhost:3001/api/health
echo.
echo.

echo [2. Static Pages]
curl -s -o nul -w "Home: %%{http_code}\n" http://localhost:3001/
curl -s -o nul -w "Login: %%{http_code}\n" http://localhost:3001/login.html
curl -s -o nul -w "Admin: %%{http_code}\n" http://localhost:3001/admin/index.html
echo.

echo [3. CSS Resources]
curl -s -o nul -w "main-bundle.css: %%{http_code}\n" http://localhost:3001/css/main-bundle.css
curl -s -o nul -w "remixicon.css: %%{http_code}\n" http://localhost:3001/vendor/remixicon.css
echo.

echo [4. JS Resources]
curl -s -o nul -w "api.js: %%{http_code}\n" http://localhost:3001/js/api.js
curl -s -o nul -w "script.js: %%{http_code}\n" http://localhost:3001/js/script.js
echo.

echo [5. Images]
curl -s -o nul -w "logo.svg: %%{http_code}\n" http://localhost:3001/images/logo.svg
curl -s -o nul -w "favicon.ico: %%{http_code}\n" http://localhost:3001/favicon.ico
echo.

echo === Test Complete ===
pause
