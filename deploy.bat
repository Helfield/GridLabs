@echo off
REM ---------------------------------------------------------------
REM  GridLabs website - push changes live
REM
REM  Double-click this after editing any file in this folder. It
REM  commits everything and pushes to GitHub; Railway sees the push
REM  and redeploys the site on its own a minute or so later.
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

REM No changes at all? Nothing to do -- say so rather than making an
REM empty commit and a pointless redeploy.
git diff --quiet
set CHANGED=%errorlevel%
git diff --cached --quiet
set STAGED=%errorlevel%
git ls-files --others --exclude-standard >"%TEMP%\gl_untracked.txt"
for %%A in ("%TEMP%\gl_untracked.txt") do set UNTRACKED=%%~zA
del "%TEMP%\gl_untracked.txt" >nul 2>&1

if "%CHANGED%"=="0" if "%STAGED%"=="0" if "%UNTRACKED%"=="0" (
  echo Nothing has changed since the last deploy.
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

echo.
echo === Done ===================================================
echo.
echo   Pushed. Railway is redeploying - give it a minute, then
echo   refresh https://gridlabs-production.up.railway.app
echo.
pause