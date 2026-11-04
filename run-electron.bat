@echo off
set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
set FIREBASE_PROJECT_ID=demo-drug-project
"e:\programs and applications\desktop\drug-manager\node_modules\.bin\electron.cmd" "e:\programs and applications\desktop\drug-manager" > "e:\programs and applications\desktop\drug-manager\electron-out.txt" 2> "e:\programs and applications\desktop\drug-manager\electron-err.txt"
echo EXITCODE=%ERRORLEVEL% >> "e:\programs and applications\desktop\drug-manager\electron-out.txt"
