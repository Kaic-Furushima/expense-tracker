@echo off
chcp 65001 >nul
rem Gera dist\Pocketful-portatil (e o .zip): Java embutido + o .jar + instalar.bat, SEM executavel proprio.
rem Serve para PCs com o Controle Inteligente de Aplicativos (Smart App Control), que bloqueia .exe sem assinatura:
rem aqui quem roda e o javaw.exe do Java embutido (assinado pelo fabricante), nao um .exe sem assinatura.
rem Requer JDK 21 (jlink).

set "JDK=%JAVA_HOME%"
if not defined JDK set "JDK=C:\Program Files\Java\jdk-21.0.10"
set "JLINK=%JDK%\bin\jlink.exe"
where jlink >nul 2>nul && set "JLINK=jlink"

set "MODULES=java.base,java.desktop,java.sql,jdk.jsobject,java.logging,java.naming,java.management,java.instrument,java.xml,jdk.unsupported,jdk.unsupported.desktop,java.net.http,java.prefs,java.scripting,java.security.jgss,jdk.crypto.ec,java.compiler"
set "OUT=%~dp0dist\Pocketful-portatil"

call "%~dp0mvnw.cmd" -q -DskipTests package || exit /b 1

if exist "%~dp0target\runtime" rmdir /s /q "%~dp0target\runtime"
"%JLINK%" --add-modules %MODULES% --strip-debug --no-header-files --no-man-pages --output "%~dp0target\runtime" || exit /b 1

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%\app" || exit /b 1
xcopy /e /i /q /y "%~dp0target\runtime" "%OUT%\runtime" >nul || exit /b 1
copy /y "%~dp0target\expense-tracker-1.0.0.jar" "%OUT%\app\" >nul || exit /b 1
copy /y "%~dp0packaging\app.ico" "%OUT%\app\" >nul
copy /y "%~dp0packaging\instalar.bat" "%OUT%\" >nul || exit /b 1
copy /y "%~dp0packaging\desinstalar.bat" "%OUT%\app\" >nul || exit /b 1

if exist "%~dp0dist\Pocketful-portatil.zip" del "%~dp0dist\Pocketful-portatil.zip"
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%\*' -DestinationPath '%~dp0dist\Pocketful-portatil.zip'"

echo.
echo Pronto: %OUT%
echo Zip:    %~dp0dist\Pocketful-portatil.zip
echo Para instalar: abra a pasta (ou o zip extraido) e de dois cliques em instalar.bat
pause
