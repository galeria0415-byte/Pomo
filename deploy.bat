@echo off
REM Quick deployment script for Pomodoro Timer

echo.
echo ===================================
echo Pomodoro Timer - Deployment Script
echo ===================================
echo.

REM Check if dist folder exists
if exist dist (
    echo ✓ Build folder found (dist/)
    echo.
    echo Build Contents:
    dir /s dist | find /c /v "" > nul
    
    echo.
    echo Choose deployment option:
    echo.
    echo 1. Vercel (npm run build ^& vercel)
    echo 2. Netlify (netlify deploy --prod --dir=dist)
    echo 3. Firebase (firebase deploy)
    echo 4. Show build stats
    echo 5. Start dev server (npm run dev)
    echo 6. Clean and rebuild
    echo.
    
    set /p choice="Enter your choice (1-6): "
    
    if "%choice%"=="1" (
        echo Installing Vercel CLI...
        call npm install -g vercel
        call vercel
    ) else if "%choice%"=="2" (
        echo Installing Netlify CLI...
        call npm install -g netlify-cli
        call netlify deploy --prod --dir=dist
    ) else if "%choice%"=="3" (
        echo Installing Firebase CLI...
        call npm install -g firebase-tools
        call firebase login
        call firebase deploy
    ) else if "%choice%"=="4" (
        echo.
        echo Build Statistics:
        echo ================
        for /f "delims=" %%A in ('dir /s /b dist ^| find /c /v ""') do set file_count=%%A
        echo Total files: %file_count%
        echo.
        dir dist\assets
    ) else if "%choice%"=="5" (
        call npm run dev
    ) else if "%choice%"=="6" (
        echo Cleaning dist folder...
        rmdir /s /q dist
        echo Rebuilding...
        call npm run build
        echo ✓ Build complete!
    ) else (
        echo Invalid choice!
    )
) else (
    echo ✗ Build not found! Run 'npm run build' first
    echo.
    set /p build_now="Build now? (y/n): "
    if /i "%build_now%"=="y" (
        call npm run build
        echo ✓ Build complete! Run this script again.
    )
)

echo.
pause
