@echo off
chcp 65001 >nul
title Remover o Pocketful
rem Remove o programa e os atalhos. Seus dados (%APPDATA%\ExpenseTracker) NAO sao apagados.

set "DEST=%LOCALAPPDATA%\Pocketful"
echo Isto remove o Pocketful deste computador. Seus dados em %APPDATA%\ExpenseTracker continuam la.
choice /m "Continuar"
if errorlevel 2 exit /b 0

rem Fecha o Pocketful se estiver aberto (inclusive na bandeja do sistema): so o javaw que roda desta pasta de instalacao
powershell -NoProfile -Command "Get-Process javaw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:DEST + '\*') } | Stop-Process -Force"
ping -n 3 127.0.0.1 >nul

powershell -NoProfile -Command "foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { Remove-Item -LiteralPath ($d + '\Pocketful.lnk') -ErrorAction SilentlyContinue }"
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ExpenseTracker /f >nul 2>nul

rem Este arquivo esta dentro da pasta que vai ser apagada: a remocao roda depois que ele terminar.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & rmdir /s /q "%DEST%""
echo Removido. Seus dados continuam em %APPDATA%\ExpenseTracker
