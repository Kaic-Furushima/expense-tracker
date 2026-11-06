# Expense Tracker

> 🚧 **Projeto em andamento**  
> Este projeto ainda está em desenvolvimento. Novas funcionalidades, melhorias de desempenho e ajustes visuais estão sendo implementados constantemente.

Controle de gastos, receitas e orçamentos. Roda no **PC (Windows)** e no **celular (Android)**.

## Tecnologias

- Java 21
- Spring Boot, Spring Data JPA, Flyway
- H2 (banco embutido; é o único suportado)
- JavaFX WebView
- HTML, CSS e JavaScript
- Capacitor 8 (Android)
- sql.js (SQLite)
- pdf-lib, fflate
- Supabase (Postgres, opcional) e Web Crypto / AES-GCM para a sincronização PC ⇄ celular
- JUnit, `node --test`

## Como rodar e gerar

### PC

**Requisitos:** JDK 21 (o Maven vem junto, pelo `mvnw`).

```bat
run.bat                :: roda só neste computador (http://localhost:8080)
run.bat celular        :: libera acesso pela rede local (abra o endereço do log no celular)
run-jar.bat            :: roda o .jar já gerado
build-exe.bat          :: gera dist\ExpenseTracker\ExpenseTracker.exe (com Java embutido)
build-installer.bat    :: gera o instalador .msi (precisa do WiX Toolset 3.x)
```

### Celular (Android)

**Requisitos:** Node 20+ e Android Studio (traz o SDK e o JDK).

```bat
cd mobile
npm install
npm run serve          :: testa no navegador (http://localhost:5173), sem Android
npm run android:open   :: empacota e abre o projeto no Android Studio (▶ Run)
npm run android:apk:offline :: gera o APK offline (android\app\build\outputs\apk\offline\debug\)
npm run android:apk:sync    :: gera o APK com sincronização (android\app\build\outputs\apk\sync\debug\)
```

Há dois builds (*flavors* do Android): **offline** (sem permissão de internet, nada sai do celular) e **sync** (o mesmo app mais a sincronização PC ⇄ celular abaixo; instala ao lado do offline, com dados próprios). `npm run android:apk` gera o offline.

Depois de mudar o front-end ou `mobile/src`, rode `npm run sync` antes de executar de novo.

### Testes

```bat
mvnw test              :: Java
npm test               :: front-end
cd mobile && npm test  :: API local do celular
```
