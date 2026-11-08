@echo off
setlocal EnableExtensions

rem Upload this folder to the GitHub repo in "origin".
rem If origin is missing, ask once and save the URL only.
rem The push asks for a personal access token and discards it.
rem Saved Git Credential Manager logins are left unchanged.
rem The push uses --force and replaces the remote branch history.

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git for Windows is not installed or not on PATH.
  echo Install it from https://git-scm.com/download/win
  goto :failed
)

if not exist ".git" (
  git init
  if errorlevel 1 goto :failed
)

git config --get user.name >nul 2>&1
if errorlevel 1 goto :needidentity
git config --get user.email >nul 2>&1
if errorlevel 1 goto :needidentity

call :resolve_remote
if errorlevel 1 goto :failed

echo.
echo Remote:
echo   %REPO_URL%
echo.

git add -A
if errorlevel 1 goto :failed

call :unstage_secrets
if errorlevel 1 goto :failed

git diff --cached --quiet
if not errorlevel 1 (
  echo Nothing new to commit.
  goto :push
)

echo Files to commit:
git diff --cached --name-only
echo.
set "COMMIT_MSG="
set /p COMMIT_MSG=Enter commit message: 
powershell -NoProfile -Command "if ([string]::IsNullOrWhiteSpace($env:COMMIT_MSG)) { exit 2 }; [System.IO.File]::WriteAllText($env:TEMP + '\meetcon-upload-commit.txt', $env:COMMIT_MSG.Trim()); exit 0"
if errorlevel 2 goto :empty_message
if errorlevel 1 goto :failed
git commit -F "%TEMP%\meetcon-upload-commit.txt"
set "COMMIT_ERROR=%ERRORLEVEL%"
del "%TEMP%\meetcon-upload-commit.txt" >nul 2>&1
if not "%COMMIT_ERROR%"=="0" (
  echo Commit failed. Fix the problem above, then run this script again.
  goto :failed
)

:push
git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
  echo There is nothing to push.
  goto :failed
)

set "BRANCH_LINE="
for /f "delims=" %%B in ('git status -sb') do (
  set "BRANCH_LINE=%%B"
  goto :branch_ready
)
:branch_ready
if "%BRANCH_LINE%"=="## master" (
  echo Publishing the first upload on main.
  git branch -M main
  if errorlevel 1 goto :failed
)

echo.
echo This push replaces the remote branch history.
echo It asks for a personal access token and does not change saved GitHub credentials.
echo An account password will not work. Create a token at:
echo   https://github.com/settings/tokens
echo.
call :push_incognito
if "%PUSH_ERROR%"=="2" (
  echo A GitHub username and personal access token are required.
  goto :failed
)
if not "%PUSH_ERROR%"=="0" (
  echo.
  echo Push failed. Saved GitHub credentials were left unchanged.
  echo GitHub recognized the account and refused the write.
  echo Open the token, choose only rakaaaa/MeetCon, and set Contents to Read and write.
  echo A classic token needs the repo scope. Metadata read alone cannot push.
  goto :failed
)

echo.
echo Upload completed.
goto :done

:push_incognito
set "MEETCON_UPLOAD_BAT=%~f0"
set "REPO_URL=%REPO_URL%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw=Get-Content -LiteralPath $env:MEETCON_UPLOAD_BAT -Raw; $m='### INCOGNITO-PUSH ###'; $i=$raw.LastIndexOf($m); if($i -lt 0){exit 3}; $s=$raw.Substring($i+$m.Length).TrimStart(); & ([scriptblock]::Create($s))"
set "PUSH_ERROR=%ERRORLEVEL%"
exit /b 0

:empty_message
echo A commit message is required.
call :unstage_all
goto :failed

:needidentity
echo Git needs your name and email before it can commit.
echo This script will not change git config. Set them, then run it again:
echo   git config --global user.name "Your Name"
echo   git config --global user.email "you@example.com"
goto :failed

:resolve_remote
set "REPO_URL="
for /f "delims=" %%U in ('git remote get-url origin 2^>nul') do set "REPO_URL=%%U"
if defined REPO_URL exit /b 0

echo This folder has no GitHub remote yet.
echo Example: https://github.com/rakaaaa/MeetCon.git
set /p REPO_URL=GitHub repository URL: 
if not defined REPO_URL (
  echo A repository URL is required.
  exit /b 1
)
if "%REPO_URL%"=="" (
  echo A repository URL is required.
  exit /b 1
)
call :validate_url
if errorlevel 1 exit /b 1
git remote add origin "%REPO_URL%"
if errorlevel 1 exit /b 1
exit /b 0

:validate_url
echo %REPO_URL%| findstr /i /c:"https://" | findstr /c:"@" >nul
if not errorlevel 1 (
  echo Do not put a token or password in the repository URL.
  exit /b 1
)
echo %REPO_URL%| findstr /i /c:"ghp_" /c:"github_pat_" >nul
if not errorlevel 1 (
  echo Do not put a token or password in the repository URL.
  exit /b 1
)
echo %REPO_URL%| findstr /i /r /c:"^https://github.com/[^/ ][^/ ]*/[^/ ][^/ ]*" /c:"^git@github.com:[^/ ][^/ ]*/[^/ ][^/ ]*" >nul
if errorlevel 1 (
  echo Use an existing GitHub repository URL, for example:
  echo   https://github.com/OWNER/REPO.git
  echo   git@github.com:OWNER/REPO.git
  exit /b 1
)
exit /b 0

:unstage_secrets
set "FOUND_SECRET="
set "LIST=%TEMP%\meetcon-upload-secrets.txt"
del "%LIST%" >nul 2>&1
for /f "delims=" %%F in ('git diff --cached --name-only') do (
  echo %%F| findstr /i /r /c:"\.env$" /c:"\.env\." /c:"\.pem$" /c:"\.key$" /c:"\.pfx$" /c:"id_rsa" /c:"credentials\.json" >nul
  if not errorlevel 1 (
    echo %%F| findstr /i /c:".example" /c:".sample" >nul
    if errorlevel 1 (
      echo %%F>>"%LIST%"
      set "FOUND_SECRET=1"
    )
  )
)
if not defined FOUND_SECRET (
  del "%LIST%" >nul 2>&1
  exit /b 0
)

echo Leaving these files out of the upload:
type "%LIST%"
echo.

git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
  for /f "usebackq delims=" %%F in ("%LIST%") do git rm --cached -q -- "%%F"
) else (
  for /f "usebackq delims=" %%F in ("%LIST%") do git restore --staged -- "%%F"
)
del "%LIST%" >nul 2>&1
exit /b 0

:unstage_all
git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
  git rm -r --cached -q . >nul 2>&1
) else (
  git reset -q
)
exit /b 0

:failed
echo.
echo Upload stopped.
pause
endlocal
exit /b 1

:done
echo.
pause
endlocal
exit /b 0

### INCOGNITO-PUSH ###
$ErrorActionPreference = 'Stop'
$ask = $null
$bstr = [IntPtr]::Zero
$pushCode = 1
try {
  $defaultUser = ''
  if ($env:REPO_URL -match 'github\.com[:/]([^/]+)/') { $defaultUser = $Matches[1] }
  $prompt = 'GitHub username'
  if (-not [string]::IsNullOrWhiteSpace($defaultUser)) { $prompt = "GitHub username [$defaultUser]" }
  $entered = Read-Host $prompt
  if ([string]::IsNullOrWhiteSpace($entered)) { $user = $defaultUser } else { $user = $entered.Trim() }
  if ([string]::IsNullOrWhiteSpace($user)) { exit 2 }
  $secure = Read-Host 'Personal access token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($token)) { exit 2 }
  if ($user -match '[&|<>^%\s]') { Write-Host 'Username has characters this uploader cannot pass safely.'; exit 2 }
  if ($token -match '[&|<>^%\s]') { Write-Host 'Token has characters this uploader cannot pass safely.'; exit 2 }
  $ask = Join-Path $env:TEMP ("git-cred-{0}.cmd" -f [guid]::NewGuid().ToString('n'))
  @(
    '@echo off',
    "echo username=$user",
    "echo password=$token"
  ) | Set-Content -LiteralPath $ask -Encoding ASCII
  $helper = 'cmd.exe /C "' + ($ask.Replace('\', '/')) + '"'
  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GCM_INTERACTIVE = 'Never'
  & git -c credential.helper= -c credential.https://github.com.helper= -c "credential.helper=!$helper" push --force -u origin HEAD
  if ($null -eq $LASTEXITCODE) { $pushCode = 1 } else { $pushCode = $LASTEXITCODE }
}
finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Item Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue
  Remove-Item Env:GCM_INTERACTIVE -ErrorAction SilentlyContinue
  if ($ask -and (Test-Path -LiteralPath $ask)) { Remove-Item -LiteralPath $ask -Force }
}
exit $pushCode
