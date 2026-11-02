@echo off
chcp 65001 >nul
title Expense Tracker
if /i "%~1"=="celular" goto celular

echo ===================================================
echo   Expense Tracker - somente neste computador
echo   http://localhost:8080
echo   Para usar pelo celular (mesmo Wi-Fi): run.bat celular
echo ===================================================
echo.
call "%~dp0mvnw.cmd" spring-boot:run "-Dspring-boot.run.jvmArguments=-Dapp.bind-address=127.0.0.1"
pause
goto :eof

:celular
echo ===================================================
echo   Expense Tracker - acesso pela rede local (celular)
echo   Neste computador: http://localhost:8080
echo   No celular (mesmo Wi-Fi): use o endereco "rede local" do log
echo   Recomendado: defina uma senha em Mais -^> Configuracoes.
echo ===================================================
echo.
call "%~dp0mvnw.cmd" spring-boot:run "-Dspring-boot.run.jvmArguments=-Dapp.bind-address=0.0.0.0"
pause
