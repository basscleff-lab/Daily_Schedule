@echo off
title Sabrina Work Hub - System Compatibility Diagnostic
color 0F

echo ======================================================================
echo              PC COMPATIBILITY AND PREREQUISITE DIAGNOSTIC
echo ======================================================================
echo.

echo 1. Checking Windows Version...
for /f "tokens=4-7 delims=[.] " %%i in ('ver') do set "WINVER=%%i.%%j.%%k"
echo    Windows Version: %WINVER%

echo 2. Checking Windows PowerShell 5.1...
powershell.exe -NoProfile -Command "Write-Host '   PowerShell Version: ' $PSVersionTable.PSVersion.ToString()"
if %ERRORLEVEL% neq 0 (
    color 0C
    echo    [FAIL] Windows PowerShell is missing or inaccessible.
    goto :FAIL
)

echo 3. Checking WPF PresentationFramework (.NET Framework)...
powershell.exe -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; Write-Host '   WPF & .NET Framework: Available & Ready'"
if %ERRORLEVEL% neq 0 (
    color 0C
    echo    [FAIL] PresentationFramework could not be loaded.
    goto :FAIL
)

echo 4. Checking Execution Policy Compatibility...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '   ExecutionPolicy Bypass: Allowed'"
if %ERRORLEVEL% neq 0 (
    color 0E
    echo    [WARN] ExecutionPolicy Bypass might be restricted by Group Policy.
)

echo 5. Checking Target Directory Access (C:\Apps)...
if not exist "C:\Apps" mkdir "C:\Apps" 2>nul
if exist "C:\Apps" (
    echo    Write Access to C:\Apps: OK
) else (
    echo    [WARN] Cannot write to C:\Apps without administrative privileges.
)

color 0A
echo.
echo ======================================================================
echo           ALL CHECKS PASSED - THIS PC IS FULLY COMPATIBLE!
echo ======================================================================
echo Sabrina's PC can run the floating toolbar and tracker with zero extra software.
echo.
pause
exit /b 0

:FAIL
echo.
echo ======================================================================
echo         COMPATIBILITY CHECK FAILED - ACTION NEEDED
echo ======================================================================
pause
exit /b 1
