@echo off
rem Double-click to start the system, or run: run stop / run reset / run logs
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
if errorlevel 1 pause
