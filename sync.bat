@echo off
REM One-click sync: copies the source-of-truth HTML into this deploy folder as index.html.
REM Double-click this file whenever you've changed the calculator and want to deploy.

set "SRC=%~dp0..\retirement-portfolio-calculator.html"
set "DEST=%~dp0index.html"

echo Syncing source into deploy folder...
echo   FROM: %SRC%
echo   TO:   %DEST%
echo.

if not exist "%SRC%" (
  echo ERROR: Source file not found:
  echo   %SRC%
  echo Make sure retirement-portfolio-calculator.html is on your Desktop.
  echo.
  pause
  exit /b 1
)

copy /Y "%SRC%" "%DEST%" >nul
if errorlevel 1 (
  echo ERROR: Copy failed.
  pause
  exit /b 1
)

echo Done. index.html is now in sync with the source.
echo You can now deploy:  vercel --prod
echo.
pause
