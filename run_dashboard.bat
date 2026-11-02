@echo off
cd /d "%~dp0"
where python >nul 2>nul && (python dashboard.py %*) || (py dashboard.py %*)
if errorlevel 1 pause
