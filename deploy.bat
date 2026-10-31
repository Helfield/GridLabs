@echo off
REM ---------------------------------------------------------------
REM  GridLabs website - push changes live
REM
REM  Double-click this after editing any file in this folder. It
REM  commits everything, pushes to GitHub, then waits and tells you
REM  the moment the site is actually serving your new commit.
REM
REM  Goes in the lmu-coach-web folder, next to package.json.
REM ---------------------------------------------------------------

setlocal
cd /d "%~dp0"

if not exist ".git" (
  echo This folder isn't a git repository - deploy.bat is in the wrong place.
  echo It belongs in lmu-coach-web, next to package.json.
  pause
  exit /b 1
)

echo.
echo === What's changed =========================================
git status --short
echo.

REM Three separate questions. Files you've edited, files git has never
REM seen, and commits made but never pushed. The old version asked only
REM the first two, so a commit that was sitting there unpushed read as
REM "nothing has changed" and the script stopped before the push.
git diff --quiet
set CHANGED=%errorlevel%
git diff --cached --quiet
set STAGED=%errorlevel%
git ls-files --others --exclude-standard >"%TEMP%\gl_untracked.txt"
for %%A in ("%TEMP%\gl_untracked.txt") do set UNTRACKED=%%~zA
del "%TEMP%\gl_untracked.txt" >nul 2>&1

set AHEAD=0
for /f "usebackq delims=" %%A in (`git rev-list --count origin/main..HEAD 2^>nul`) do set AHEAD=%%A

if "%CHANGED%"=="0" if "%STAGED%"=="0" if "%UNTRACKED%"=="0" if "%AHEAD%"=="0" (
  echo Nothing to deploy. No files changed and nothing waiting to be pushed.
  pause
  exit /b 0
)

REM Safety check before anything is staged: .env holds real credentials
REM and `git add -A` below would happily commit it if .gitignore ever
REM stopped covering it. Refuse to deploy in that case.
git ls-files --error-unmatch .env >nul 2>&1
if not errorlevel 1 (
  echo ERROR: .env is tracked by git. It must never be committed.
  echo Remove it from the repo with:  git rm --cached .env
  echo then commit that before deploying again.
  pause
  exit /b 1
)
git check-ignore -q .env 2>nul
if errorlevel 1 (
  echo ERROR: .env is not ignored by git - .gitignore is broken.
  echo Add ".env" to .gitignore before deploying.
  pause
  exit /b 1
)

REM A clean tree with commits to push still needs deploying, and running
REM git commit there fails with "nothing to commit", which used to abort
REM the whole script. Skip straight to the push instead.
if "%CHANGED%"=="0" if "%STAGED%"=="0" if "%UNTRACKED%"=="0" (
  echo Nothing to commit. Pushing %AHEAD% commit^(s^) already made.
  goto push
)

REM A message is optional. Leaving it blank stamps the date and time,
REM which is still more useful in the history than nothing at all.
set "MSG="
set /p "MSG=Describe the change (or press Enter): "
if "%MSG%"=="" set "MSG=update %date% %time%"

echo.
echo === Committing =============================================
git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo Commit failed - read the message above.
  pause
  exit /b 1
)

:push
echo.
echo === Pushing ================================================
git push
if errorlevel 1 (
  echo.
  echo Push failed. If it mentions authentication, a browser window
  echo may be waiting for you to sign in to GitHub.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%A in (`git rev-parse --short=7 HEAD`) do set SHA=%%A

echo.
echo === Waiting for the site ===================================
echo   Pushed %SHA%. Railway builds for about a minute, then restarts the
echo   site. This checks https://gridlabs-production.up.railway.app/version
echo   every 10 seconds and stops when it reports %SHA%.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$sha='%SHA%'; for($i=0;$i -lt 30;$i++){ try{ $v=Invoke-RestMethod 'https://gridlabs-production.up.railway.app/version' -TimeoutSec 10; if($v.commit -eq $sha){ Write-Host ('  Live: commit ' + $v.commit + ' on ' + $v.branch + ', started ' + $v.bootedAt); exit 0 } } catch {}; Write-Host ('  still on the previous build (' + ($i*10) + 's elapsed)'); Start-Sleep 10 }; Write-Host '  Not live after 5 minutes. Railway may still be building, or autodeploy is off.'; exit 0"

echo.
pause
