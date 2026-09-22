@echo off
setlocal enabledelayedexpansion
title Daily Work Hub - PC Setup and Deployment Tool
color 0B

echo ======================================================================
echo           DAILY WORK HUB - PC SETUP AND DEPLOYMENT TOOL
echo ======================================================================
echo.

set "TARGET_DIR=C:\Apps\Daily_Schedule"
set "SOURCE_DIR=%~dp0"
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"

if "%1"=="--github" goto do_github
if "%1"=="--update" goto do_github

if /i "%SOURCE_DIR%"=="%TARGET_DIR%" goto menu_local
goto menu_external

:menu_local
echo Note: Running directly inside target folder %TARGET_DIR%
echo   [1] Verify Setup and Refresh Desktop Shortcuts
echo   [2] Pull latest release directly from GitHub (Update)
echo.
set "MODE=2"
set /p "MODE=Select option (1 or 2, default is 2 to update from GitHub): "
goto check_mode

:menu_external
echo Deployment Source:
echo   [1] Install/Deploy from this folder (Default)
echo   [2] Pull latest release directly from GitHub (No Git required)
echo.
set "MODE=1"
set /p "MODE=Select option (1 or 2, default is 1): "
goto check_mode

:check_mode
if "%MODE%"=="2" goto do_github
goto start_deploy

:do_github
echo.
echo Connecting to GitHub repository (basscleff-lab/Daily_Schedule)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$repoZip = 'https://github.com/basscleff-lab/Daily_Schedule/archive/refs/heads/main.zip';" ^
    "$tempZip = Join-Path $env:TEMP 'daily_sched_update.zip';" ^
    "$tempExt = Join-Path $env:TEMP 'daily_sched_update_ext';" ^
    "Remove-Item $tempZip, $tempExt -Recurse -Force -ErrorAction SilentlyContinue;" ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
    "Invoke-WebRequest -Uri $repoZip -OutFile $tempZip -UseBasicParsing;" ^
    "Expand-Archive -Path $tempZip -DestinationPath $tempExt -Force;" ^
    "if (Test-Path (Join-Path $tempExt 'Daily_Schedule-main')) { exit 0 } else { exit 1 }"
if %ERRORLEVEL% neq 0 (
    color 0C
    echo [ERROR] Could not download update from GitHub. Please check your internet connection.
    pause
    exit /b 1
)
set "SOURCE_DIR=%TEMP%\daily_sched_update_ext\Daily_Schedule-main"
echo       - Downloaded latest release from GitHub successfully!
echo.

:start_deploy
echo [1/5] Checking System Compatibility...
powershell.exe -Command "if ($PSVersionTable.PSVersion.Major -ge 5) { exit 0 } else { exit 1 }"
if %ERRORLEVEL% neq 0 (
    color 0C
    echo [ERROR] Windows PowerShell 5.1 or newer was not detected.
    echo Please update Windows or install Windows Management Framework 5.1.
    pause
    exit /b 1
)
echo       - Windows PowerShell 5.1: OK
powershell.exe -Command "Add-Type -AssemblyName PresentationFramework; exit 0"
if %ERRORLEVEL% neq 0 (
    color 0C
    echo [ERROR] WPF PresentationFramework is not available on this machine.
    pause
    exit /b 1
)
echo       - Windows Presentation Framework (WPF): OK
echo.

echo [2/5] Preparing Target Folder: %TARGET_DIR%...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
if not exist "%TARGET_DIR%\data" mkdir "%TARGET_DIR%\data"
if not exist "%TARGET_DIR%\data\backups" mkdir "%TARGET_DIR%\data\backups"
echo       - Folders created / verified.
echo.

echo [3/5] Deploying Application Files...
:: Preserve existing data files with pre-deployment backups
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "timestamp=%%I"
if exist "%TARGET_DIR%\data\shifts.json" (
    echo       - Found existing shifts.json! Creating automatic backup...
    copy /y "%TARGET_DIR%\data\shifts.json" "%TARGET_DIR%\data\backups\shifts_backup_predeploy_!timestamp!.json" >nul
    echo       - Backup saved to: %TARGET_DIR%\data\backups\shifts_backup_predeploy_!timestamp!.json
)
if exist "%TARGET_DIR%\data\callbacks.json" (
    echo       - Found existing callbacks.json! Creating automatic backup...
    copy /y "%TARGET_DIR%\data\callbacks.json" "%TARGET_DIR%\data\backups\callbacks_backup_predeploy_!timestamp!.json" >nul
    echo       - Backup saved to: %TARGET_DIR%\data\backups\callbacks_backup_predeploy_!timestamp!.json
)
if exist "%TARGET_DIR%\data\calls.json" (
    echo       - Found existing calls.json! Creating automatic backup...
    copy /y "%TARGET_DIR%\data\calls.json" "%TARGET_DIR%\data\backups\calls_backup_predeploy_!timestamp!.json" >nul
    echo       - Backup saved to: %TARGET_DIR%\data\backups\calls_backup_predeploy_!timestamp!.json
)
if exist "%TARGET_DIR%\data\sales_reps.json" (
    echo       - Found existing sales_reps.json! Creating automatic backup...
    copy /y "%TARGET_DIR%\data\sales_reps.json" "%TARGET_DIR%\data\backups\sales_reps_backup_predeploy_!timestamp!.json" >nul
    echo       - Backup saved to: %TARGET_DIR%\data\backups\sales_reps_backup_predeploy_!timestamp!.json
)

:: Copy Core Files (excluding git, tests, and temporary storage)
if /i "%SOURCE_DIR%"=="%TARGET_DIR%" goto skip_copy
goto do_copy

:skip_copy
echo       - Running directly from target directory %TARGET_DIR%
echo       - Core application files are already in place; skipping self-copy.
goto after_copy

:do_copy
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" floating_toolbar.ps1 Launch_Floating_Toolbar.bat Verify_PC_Compatibility.bat version.json index.html app.js styles.css popup.html popup.js popup.css README.md REQUIREMENTS.md optima_reference.html Launch_Optima_Reference.bat /IS /IT /nfl /ndl /njh /njs /R:1 /W:1
if errorlevel 8 (
    echo       - [WARNING] Some files could not be copied. Please close open browser tabs or applications and retry.
) else (
    echo       - Core application files successfully deployed.
)

:: Copy initial data files if target doesn't have them yet (NEVER overwrite existing data)
if not exist "%TARGET_DIR%\data\shifts.json" (
    if exist "%SOURCE_DIR%\data\shifts.json" copy /y "%SOURCE_DIR%\data\shifts.json" "%TARGET_DIR%\data\shifts.json" >nul
)
if not exist "%TARGET_DIR%\data\callbacks.json" (
    if exist "%SOURCE_DIR%\data\callbacks.json" copy /y "%SOURCE_DIR%\data\callbacks.json" "%TARGET_DIR%\data\callbacks.json" >nul
)
if not exist "%TARGET_DIR%\data\calls.json" (
    if exist "%SOURCE_DIR%\data\calls.json" copy /y "%SOURCE_DIR%\data\calls.json" "%TARGET_DIR%\data\calls.json" >nul
)
if not exist "%TARGET_DIR%\data\sales_reps.json" (
    if exist "%SOURCE_DIR%\data\sales_reps.json" copy /y "%SOURCE_DIR%\data\sales_reps.json" "%TARGET_DIR%\data\sales_reps.json" >nul
)
if not exist "%TARGET_DIR%\data\shifts_data.js" (
    if exist "%SOURCE_DIR%\data\shifts_data.js" copy /y "%SOURCE_DIR%\data\shifts_data.js" "%TARGET_DIR%\data\shifts_data.js" >nul
)

:after_copy
echo.

echo [4/5] Creating Desktop Shortcuts...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell;" ^
    "$desktop = [Environment]::GetFolderPath('Desktop');" ^
    "$shortcutPath = Join-Path $desktop 'Daily Work Tracker.lnk';" ^
    "$sc = $ws.CreateShortcut($shortcutPath);" ^
    "$sc.TargetPath = '%TARGET_DIR%\Launch_Floating_Toolbar.bat';" ^
    "$sc.WorkingDirectory = '%TARGET_DIR%';" ^
    "$sc.Description = 'Daily Floating Work Tracker';" ^
    "$sc.IconLocation = 'shell32.dll,265';" ^
    "$sc.Save();" ^
    "$reportPath = Join-Path $desktop 'Work Hub Invoices & Reports.lnk';" ^
    "$rc = $ws.CreateShortcut($reportPath);" ^
    "$rc.TargetPath = '%TARGET_DIR%\index.html';" ^
    "$rc.WorkingDirectory = '%TARGET_DIR%';" ^
    "$rc.Description = 'Daily Shift History and Invoices';" ^
    "$rc.IconLocation = 'shell32.dll,264';" ^
    "$rc.Save();" ^
    "$refPath = Join-Path $desktop 'Optima Product Reference.lnk';" ^
    "$orc = $ws.CreateShortcut($refPath);" ^
    "$orc.TargetPath = '%TARGET_DIR%\optima_reference.html';" ^
    "$orc.WorkingDirectory = '%TARGET_DIR%';" ^
    "$orc.Description = 'Optima Windows & Doors Sales Booking Quick Reference';" ^
    "$orc.IconLocation = 'shell32.dll,220';" ^
    "$orc.Save();"

echo       - Created "Daily Work Tracker" shortcut on Desktop.
echo       - Created "Work Hub Invoices & Reports" shortcut on Desktop.
echo       - Created "Optima Product Reference" shortcut on Desktop.
echo.

echo [5/5] Verification Complete!
color 0A
echo ======================================================================
echo                     INSTALLATION SUCCESSFUL!
echo ======================================================================
echo.
echo Application location: %TARGET_DIR%
echo Shortcuts are now on your Desktop.
echo.
set /p "LAUNCH=Would you like to launch the Floating Toolbar now? (Y/N): "
if /i "%LAUNCH%"=="Y" (
    start "" "%TARGET_DIR%\Launch_Floating_Toolbar.bat"
)

echo.
echo You can safely remove the USB drive.
pause
exit /b 0
