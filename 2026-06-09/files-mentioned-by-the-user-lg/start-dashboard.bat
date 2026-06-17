@echo off
setlocal
cd /d "%~dp0"
set "URL=http://127.0.0.1:8765/lg-plan-benefit-dashboard.html"

:: Node.js 경로 탐색: PATH -> 로컬 캐시 순서로 확인
set "NODE="
where node >nul 2>&1
if %errorlevel% equ 0 (
    set "NODE=node"
) else if exist "%LOCALAPPDATA%\..\..\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE=%LOCALAPPDATA%\..\..\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

if "%NODE%"=="" (
    echo [오류] Node.js를 찾지 못했습니다.
    echo Node.js를 설치하거나 PATH에 추가한 뒤 다시 실행하세요.
    echo   다운로드: https://nodejs.org
    pause
    exit /b 1
)

:: 이미 서버가 실행 중인지 확인
netstat -ano | findstr ":8765 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo 서버가 이미 실행 중입니다. 브라우저를 엽니다.
    start "" "%URL%"
    exit /b 0
)

start "LG Benefit Dashboard Server" /min "%NODE%" "work\local_dashboard_server.mjs"

:: 서버가 응답할 때까지 대기 (최대 10초)
set /a tries=0
:wait_loop
timeout /t 1 >nul
netstat -ano | findstr ":8765 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 goto server_ready
set /a tries+=1
if %tries% lss 10 goto wait_loop
echo [경고] 서버 응답을 확인하지 못했습니다. 브라우저를 열어 연결을 시도합니다.

:server_ready
start "" "%URL%"
endlocal
