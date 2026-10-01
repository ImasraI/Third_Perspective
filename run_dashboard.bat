@echo off
setlocal
REM ---------------------------------------------------------------------------
REM  Goal Tracker - local dashboard launcher
REM  Starts a small static server (works on the laptop AND on your phone over
REM  Wi-Fi) and prints the URL to open.
REM ---------------------------------------------------------------------------

cd /d "%~dp0web"

set PORT=5500

echo.
echo   Goal Tracker
echo   =============
echo.

REM Find a free-ish port: try python first, fall back to node, then just open.
where python >nul 2>nul
if %errorlevel%==0 (
    echo   Serving on http://localhost:%PORT%/
    echo   Phone on same Wi-Fi: see the LAN address below.
    echo.
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
        set IP=%%a
        set IP=%IP: =%
        echo     http://%IP%:%PORT%/   ^(LAN^)
    )
    echo.
    start "" "http://localhost:%PORT%/"
    python -m http.server %PORT%
    goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
    echo   Serving on http://localhost:%PORT%/
    echo.
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
        set IP=%%a
        set IP=%IP: =%
        echo     http://%IP%:%PORT%/   ^(LAN^)
    )
    echo.
    start "" "http://localhost:%PORT%/"
    npx --yes serve -l %PORT% .
    goto :eof
)

echo   Python or Node not found - opening the file directly.
echo   NOTE: opening index.html via file:// can block backend calls.
start "" "%~dp0web\index.html"
endlocal
