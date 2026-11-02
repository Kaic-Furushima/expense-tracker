@echo off
chcp 65001 >nul
title Expense Tracker
set BIND=127.0.0.1
if /i "%~1"=="celular" set BIND=0.0.0.0
if not exist "%~dp0target\expensetracker-0.0.1-SNAPSHOT.jar" (
    echo Jar nao encontrado. Gerando...
    call "%~dp0mvnw.cmd" -q -DskipTests package
)
rem Padrao: so este computador. "run-jar.bat celular" libera o acesso pela rede local (celular).
java -Dapp.bind-address=%BIND% -jar "%~dp0target\expensetracker-0.0.1-SNAPSHOT.jar"
pause
