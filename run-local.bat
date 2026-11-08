@echo off
setlocal
cd /d "%~dp0"
node run-local.mjs
exit /b %ERRORLEVEL%
