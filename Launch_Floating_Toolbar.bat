@echo off
title Sabrina Floating Transport Bar
start "" powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0floating_toolbar.ps1"
exit /b
