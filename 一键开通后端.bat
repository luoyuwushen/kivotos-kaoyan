@echo off
chcp 65001 >nul
title Enable Supabase backend (optional)

echo.
echo ============================================================
echo   Enable cloud sync backend (Supabase)  - optional
echo ============================================================
echo.
echo   This opens the pages you need in your browser.
echo   Do these 4 things, then come back to the site:
echo.
echo     1. Create a free project            (supabase.com)
echo     2. SQL Editor - paste the schema    (docs\supabase-schema.sql)
echo     3. Project Settings - API - copy    Project URL + anon public key
echo     4. Site - Settings - Cloud Sync - paste them, then sign in
echo.
echo   No backend? The site works fine without all of this.
echo.

if not exist "docs\supabase-schema.sql" (
  echo   [X] docs\supabase-schema.sql not found. Run this from the project folder.
  pause
  exit /b 1
)

echo   Opening the schema file (you will paste its content into Supabase)...
start "" notepad "%~dp0docs\supabase-schema.sql"

echo   Copying the schema to your clipboard too...
powershell -NoProfile -Command "Get-Content -Raw -Encoding UTF8 '%~dp0docs\supabase-schema.sql' | Set-Clipboard"
if errorlevel 1 (
  echo   [!] Could not copy to clipboard automatically - just select all in Notepad and copy.
) else (
  echo   [OK] Schema copied. In Supabase SQL Editor: Ctrl+V then click Run.
)

echo.
echo   Opening Supabase...
start "" "https://supabase.com/dashboard/projects"

echo.
echo ============================================================
echo   Next, after step 3 gives you the two values:
echo.
echo     Option A (recommended, no typing): paste them into the
echo     site's Settings - Cloud Sync page.
echo.
echo     Option B (bake into a local build):
echo       run  npm run supabase:setup  and answer the prompts.
echo       It writes .env.local and then runs a live check.
echo ============================================================
echo.
pause
