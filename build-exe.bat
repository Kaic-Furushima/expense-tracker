@echo off
chcp 65001 >nul
rem Gera dist\Pocketful\Pocketful.exe (JRE embutido, nao precisa de Java instalado).
rem Requer JDK 21 (jpackage e jlink). Nao precisa de WiX: gera uma pasta portatil ("app-image").
rem O runtime embutido tem so os modulos que o app usa (jlink), o que reduz o pacote de ~250 MB para ~185 MB.

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

if exist "%~dp0dist" rmdir /s /q "%~dp0dist"
if exist "%~dp0target\jpackage-input" rmdir /s /q "%~dp0target\jpackage-input"
mkdir "%~dp0target\jpackage-input"
copy /y "%~dp0target\expensetracker-0.0.1-SNAPSHOT.jar" "%~dp0target\jpackage-input\" >nul
"%JPACKAGE%" --type app-image --name Pocketful --app-version 0.0.1 --vendor "Kaic F" ^
  --description "Pocketful: controle de gastos pessoais" ^
  --input "%~dp0target\jpackage-input" --main-jar expensetracker-0.0.1-SNAPSHOT.jar ^
  --dest "%~dp0dist" --runtime-image "%~dp0target\runtime" ^
  --icon "%~dp0packaging\app.ico" ^
  --java-options "-Dapp.window-mode=true" ^
  --java-options "-Dfile.encoding=UTF-8" || exit /b 1

echo.
echo Pronto: %~dp0dist\Pocketful\Pocketful.exe
echo Dados salvos em %%APPDATA%%\ExpenseTracker
pause
