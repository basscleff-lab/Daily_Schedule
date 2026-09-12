@echo off
title Sabrina Work Hub & Schedule Tracker
set HTML_PATH=%~dp0index.html

:: Try launching in Edge App Mode (clean window, no browser tabs/URL bar)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="file:///%HTML_PATH%" --window-size=1100,820
    exit /b
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app="file:///%HTML_PATH%" --window-size=1100,820
    exit /b
)

:: Try Google Chrome App Mode
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="file:///%HTML_PATH%" --window-size=1100,820
    exit /b
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app="file:///%HTML_PATH%" --window-size=1100,820
    exit /b
)

:: Fallback to default browser
start "" "file:///%HTML_PATH%"
exit /b
