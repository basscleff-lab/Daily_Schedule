@echo off
title Daily Work Hub - Floating Toolbar
start "" powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0floating_toolbar.ps1"
exit /b
