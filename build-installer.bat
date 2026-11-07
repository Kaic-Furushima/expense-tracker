@echo off
chcp 65001 >nul
rem Gera um instalador .msi (E2): atalho no Menu Iniciar, desinstalador e atualizacao no lugar da versao anterior.
rem Requer JDK 21 e o WiX Toolset 3.x (candle.exe e light.exe no PATH) - o jpackage usa o WiX para gerar o .msi.
rem Ainda nao foi gerado nesta maquina porque o WiX nao estava instalado. Antes de distribuir, rode e confira.

set "JDK=%JAVA_HOME%"
if not defined JDK set "JDK=C:\Program Files\Java\jdk-21.0.10"
set "JPACKAGE=%JDK%\bin\jpackage.exe"
set "JLINK=%JDK%\bin\jlink.exe"
where jpackage >nul 2>nul && set "JPACKAGE=jpackage"
where jlink >nul 2>nul && set "JLINK=jlink"

set "MODULES=java.base,java.desktop,java.sql,jdk.jsobject,java.logging,java.naming,java.management,java.instrument,java.xml,jdk.unsupported,jdk.unsupported.desktop,java.net.http,java.prefs,java.scripting,java.security.jgss,jdk.crypto.ec,java.compiler"

call "%~dp0mvnw.cmd" -q -DskipTests package || exit /b 1

if exist "%~dp0target\runtime" rmdir /s /q "%~dp0target\runtime"
"%JLINK%" --add-modules %MODULES% --strip-debug --no-header-files --no-man-pages --output "%~dp0target\runtime" || exit /b 1

if exist "%~dp0installer" rmdir /s /q "%~dp0installer"
if exist "%~dp0target\jpackage-input" rmdir /s /q "%~dp0target\jpackage-input"
mkdir "%~dp0target\jpackage-input"
copy /y "%~dp0target\expensetracker-0.0.1-SNAPSHOT.jar" "%~dp0target\jpackage-input\" >nul
rem The upgrade UUID must never change: it lets a new .msi replace the installed version instead of installing beside it.
"%JPACKAGE%" --type msi --name Pocketful --app-version 0.0.1 --vendor "Kaic F" ^
  --description "Pocketful: controle de gastos pessoais" ^
  --input "%~dp0target\jpackage-input" --main-jar expensetracker-0.0.1-SNAPSHOT.jar ^
  --dest "%~dp0installer" --runtime-image "%~dp0target\runtime" ^
  --icon "%~dp0packaging\app.ico" ^
  --win-menu --win-menu-group "Pocketful" --win-shortcut --win-dir-chooser ^
  --win-upgrade-uuid 6f1d2b0e-3c4a-4e8b-9a7d-5b2c8e1f4a90 ^
  --java-options "-Dapp.window-mode=true" ^
  --java-options "-Dfile.encoding=UTF-8" || exit /b 1

echo.
echo Pronto: %~dp0installer\Pocketful-0.0.1.msi
pause
