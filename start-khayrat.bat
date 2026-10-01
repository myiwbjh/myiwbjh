@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:4173
  py -m http.server 4173
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    start "" http://localhost:4173
    python -m http.server 4173
  ) else (
    echo Python was not found. Install Python 3 from https://www.python.org/downloads/windows/
    echo During installation, select "Add Python to PATH".
    pause
  )
)
