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

## Sincronização entre PC e celular (opcional)

Mantém o computador e o celular com os mesmos dados, de forma automática: lançamentos, contas, categorias, orçamentos, metas,
recorrentes, modelos e anexos. **Fica desligada até você conectar**; sem isso, os dois apps funcionam como sempre.

- **Como funciona:** cada aparelho envia o que mudou e lê o que mudou no outro, por um pequeno hub no
  [Supabase](https://supabase.com). Vale a edição mais recente de cada registro; as exclusões também viajam. Tudo é **cifrado no
  aparelho** (PBKDF2 → AES-256-GCM) com uma *senha de sincronização* que nunca sai dos seus aparelhos: o servidor guarda só texto
  ilegível. Sincroniza ao abrir o app, poucos segundos depois de salvar algo e a cada 5 minutos; sem internet, as mudanças esperam.
- **Duas formas de conectar** (as duas explicadas passo a passo dentro do app, em **Mais → Sincronização → Como configurar**):
  1. **Servidor padrão** — um projeto Supabase embutido no build: só e-mail, senha e senha de sincronização. Para oferecê-lo,
     preencha `sync.hub.url` e `sync.hub.anon-key` em `src/main/resources/application.properties` (PC) e `url` / `anonKey` em
     `mobile/sync-hub.json` (celular). Vazio = a opção não aparece.
  2. **O seu próprio projeto Supabase** — grátis; crie-o, rode o [`sync/supabase-hub.sql`](src/main/resources/static/sync/supabase-hub.sql)
     no SQL Editor dele (o app tem o botão *Copiar o script*), desligue o *Confirm email* e cole a URL do projeto e a chave `anon`.
- **Vários perfis:** cada perfil sincroniza os próprios dados, e a lista de perfis fica igual em todos os aparelhos: um perfil novo
  aparece sozinho nos outros, renomear vai junto e **remover um perfil o manda para a lixeira de perfis** em todos
  (**Mais → Perfis → Lixeira de perfis**: restaurar, ou *Excluir de vez*, que também exclui em todos).
- **Restaurar um backup** pergunta onde: sobre qualquer perfil existente (um aviso diz que não tem volta e oferece um backup desse
  perfil antes) ou num **perfil novo**. Sobrescrever com o sync ligado também sobrescreve a nuvem e os outros aparelhos, à força:
  o que o backup não tiver é apagado lá.
- **Limites e cuidados:** anexos maiores que **3 MB** ficam só no aparelho onde foram adicionados (o app aceita até 5 MB); se você
  esquecer a senha de sincronização, os dados na nuvem não podem ser recuperados (os dos aparelhos continuam); os dados da conexão
  (inclusive a senha de sincronização) ficam em texto no aparelho, fora dos backups; projetos grátis do Supabase são pausados após
  cerca de 7 dias sem atividade (reative pelo painel). Use a mesma senha de sincronização em todos os aparelhos.

### Testes

```bat
mvnw test              :: Java
npm test               :: front-end
cd mobile && npm test  :: API local do celular
```
