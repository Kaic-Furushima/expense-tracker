@echo off
chcp 65001 >nul
title Instalar o Pocketful
rem Instala o Pocketful para o usuario atual (sem administrador): copia para %LOCALAPPDATA%\Pocketful e cria os atalhos
rem na Area de Trabalho e no Menu Iniciar. Rodar de novo atualiza. Os dados ficam em %APPDATA%\ExpenseTracker.

set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\Pocketful"
set "JAR=%DEST%\app\expense-tracker-1.0.0.jar"
set "JW=%DEST%\runtime\bin\javaw.exe"
set "ICO=%DEST%\app\app.ico"
set "DATA=%APPDATA%\ExpenseTracker"

if not exist "%SRC%runtime\bin\javaw.exe" (
    echo Rode este arquivo de dentro da pasta do pacote (extraia o .zip antes^).
    pause
    exit /b 1
)

echo Instalando em %DEST% ...
rem Fecha o Pocketful se estiver aberto (inclusive na bandeja do sistema): so o javaw que roda desta pasta de instalacao
powershell -NoProfile -Command "Get-Process javaw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:DEST + '\*') } | Stop-Process -Force"
ping -n 3 127.0.0.1 >nul
if exist "%DEST%\runtime" rmdir /s /q "%DEST%\runtime"
if exist "%DEST%\runtime" (
    echo O Pocketful esta aberto. Feche-o e rode este arquivo de novo.
    pause
    exit /b 1
)
if exist "%DEST%\app" rmdir /s /q "%DEST%\app"
mkdir "%DEST%" 2>nul
xcopy /e /i /q /y "%SRC%runtime" "%DEST%\runtime" >nul || goto erro
xcopy /e /i /q /y "%SRC%app" "%DEST%\app" >nul || goto erro

rem startup-command=self: o programa monta sozinho o comando que grava em "Iniciar com o Windows" (nao ha .exe)
set ARGS=-Dapp.window-mode=true -Dfile.encoding=UTF-8 "-Dapp.data-dir=%DATA%" -Dapp.startup-command=self -jar "%JAR%"

powershell -NoProfile -Command "$s = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $l = $s.CreateShortcut($d + '\Pocketful.lnk'); $l.TargetPath = $env:JW; $l.Arguments = $env:ARGS; $l.WorkingDirectory = $env:DEST; $l.IconLocation = $env:ICO; $l.Description = 'Pocketful'; $l.Save() }" || goto erro

echo.
echo Pronto! O atalho "Pocketful" foi criado na Area de Trabalho e no Menu Iniciar.
echo Seus dados ficam em %DATA%
echo Para remover: %DEST%\app\desinstalar.bat
pause
exit /b 0

:erro
echo.
echo Algo deu errado na instalacao.
pause
exit /b 1
