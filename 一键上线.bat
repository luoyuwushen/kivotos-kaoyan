@echo off
title Deploy to GitHub Pages

echo.
echo ============================================================
echo   Kivotos Tactical HQ - One-click deploy
echo ============================================================
echo.
echo   BEFORE YOU RUN THIS:
echo     1. Create a PUBLIC repo named  kivotos-kaoyan  on GitHub
echo        If you have not: open  https://github.com/new
echo        Repo name: kivotos-kaoyan ,  visibility: Public
echo        Do NOT tick "Add a README file"
echo     2. Make sure your proxy / VPN software is RUNNING,
echo        otherwise this machine cannot reach github.com
echo.
echo   Then type your GitHub username below and press Enter.
echo.

set /p GHUSER=GitHub username: 
if "%GHUSER%"=="" (
  echo.
  echo   No username entered. Cancelled.
  pause
  exit /b 1
)

echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1" -Username %GHUSER%

echo.
echo ============================================================
echo   If it says "Push succeeded", do the LAST step manually:
echo     https://github.com/%GHUSER%/kivotos-kaoyan/settings/pages
echo     Set  Source  to  "GitHub Actions"
echo.
echo   Your site will be at:
echo     https://%GHUSER%.github.io/kivotos-kaoyan/
echo ============================================================
echo.
pause
