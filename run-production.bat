@echo off
setlocal
cd /d "%~dp0"
node run-production.mjs
exit /b %ERRORLEVEL%
