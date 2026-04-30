@echo off
REM Questbee CLI launcher (Windows)
SET SCRIPT_DIR=%~dp0
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python "%SCRIPT_DIR%questbee.py" %*
) else (
    where py >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        py "%SCRIPT_DIR%questbee.py" %*
    ) else (
        echo Python 3 is required to run Questbee. Install it from https://www.python.org/
        exit /b 1
    )
)
