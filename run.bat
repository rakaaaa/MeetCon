@echo off
setlocal
cd /d "%~dp0"
node run.mjs
exit /b %ERRORLEVEL%
