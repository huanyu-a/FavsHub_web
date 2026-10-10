@echo off
REM tokenhub round pipeline (architecture: local crawl -> server-side push).
REM Why: linux.sb is DNS-poisoned from the mainland server (resolves to a
REM Facebook-range IP, connection dies in ~11ms), so enrichment cannot run
REM there; the tux298 aggregator only serves the list API. The crawler stays
REM local, its DB snapshot is uploaded, and the server pushes to the site over
REM loopback with the admin-bound PAT stored in the server-side .env.
REM NOTE: keep this file ASCII-only -- cmd.exe parses it as GBK/ANSI here.
REM 2026-10-10: project moved from D:\project\wwwroot to WSL Ubuntu. Windows
REM python cannot open SQLite on the 9P UNC path (always "database is locked"),
REM so crawl + snapshot run inside WSL; only scp/ssh stay Windows-side.
setlocal
set WSLDIR=/home/win11/projects/wwwroot/FavsHub_web/tokenhub
set WSLPATH=\\wsl.localhost\Ubuntu\home\win11\projects\wwwroot\FavsHub_web\tokenhub
set SSH=C:\Windows\System32\OpenSSH\ssh.exe
set SCP=C:\Windows\System32\OpenSSH\scp.exe
set KEY=C:\Users\WIN11\.ssh\id_ed25519_panseek
set SRV=root@152.136.49.237
set RDIR=/www/dk_project/dk_app/scripts/tokenhub-crawler

echo [%date% %time%] round start >> %WSLPATH%\crawler\data\cron.log

wsl -d Ubuntu -- bash -lc "cd %WSLDIR% && python3 crawler/main.py --once >> crawler/data/cron.log 2>&1"
if errorlevel 1 (
  echo [%date% %time%] crawl FAILED >> %WSLPATH%\crawler\data\cron.log
  exit /b 1
)

wsl -d Ubuntu -- bash -lc "cd %WSLDIR% && python3 scripts/make-snapshot.py >> crawler/data/cron.log 2>&1"
if errorlevel 1 (
  echo [%date% %time%] snapshot FAILED >> %WSLPATH%\crawler\data\cron.log
  exit /b 1
)

%SCP% -i %KEY% -o StrictHostKeyChecking=no %WSLPATH%\crawler\data\snapshot.db %SRV%:%RDIR%/data/tokenhub.db >> %WSLPATH%\crawler\data\cron.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] scp FAILED >> %WSLPATH%\crawler\data\cron.log
  exit /b 1
)

%SSH% -i %KEY% -o StrictHostKeyChecking=no %SRV% "cd %RDIR% && .venv/bin/python push_to_favshub.py --source data/tokenhub.db --env .env --json >> data/push.log 2>&1"
if errorlevel 1 (
  echo [%date% %time%] push FAILED >> %WSLPATH%\crawler\data\cron.log
  exit /b 1
)

echo [%date% %time%] round done >> %WSLPATH%\crawler\data\cron.log
endlocal