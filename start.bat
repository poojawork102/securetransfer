@echo off
echo SecureTransfer - starting...
echo.

if not exist ".venv\Scripts\activate.bat" (
    echo Creating virtual environment...
    python -m venv .venv
)
call .venv\Scripts\activate.bat

echo Installing Python dependencies...
pip install -q -r requirements.txt

if exist "frontend\package.json" (
    if not exist "frontend\dist\index.html" (
        echo Building frontend...
        cd frontend
        call npm install
        call npm run build
        cd ..
    )
)

echo.
echo Starting server, proxy, and dashboard...
echo Open http://localhost:5050 in your browser.
echo.
start http://localhost:5050
python run_all.py
