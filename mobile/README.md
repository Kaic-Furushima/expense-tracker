# Expense Tracker para Android

O mesmo front-end do app (`src/main/resources/static`), empacotado com o [Capacitor](https://capacitorjs.com) num APK.
**Não precisa de servidor nem de internet** (o build `offline` nem tem a permissão; o build `sync` usa a internet só se você ligar a sincronização): a lógica que no computador roda em Java (Spring) roda aqui em JavaScript,
dentro do aparelho, com SQLite (sql.js, WebAssembly). O front-end continua chamando `fetch('/expenses…')`; o arquivo
`src/browser.js` intercepta essas chamadas e a API local (`src/local-api/`) responde.

```
front-end (static/)  ──fetch──▶  src/browser.js  ──▶  src/local-api/ (rotas, serviços)  ──▶  SQLite (sql.js)
                                                                                                 │
                                                          IndexedDB do WebView (arquivo do banco) ◀┘
```

## Rodar e testar

```bash
cd mobile
npm install
npm test            # testes da API local (Node, sem Android)
npm run serve       # app no navegador do computador: http://localhost:5173 (sem Java)
```

## Gerar o APK

Precisa do [Android Studio](https://developer.android.com/studio) (traz o SDK e o JDK 21).

```bash
npm run android:open   # empacota, sincroniza e abre o projeto no Android Studio (Run ▶ para instalar no celular/emulador)
npm run android:apk:offline   # APK sem permissão de internet: android/app/build/outputs/apk/offline/debug/
npm run android:apk:sync      # APK com sincronização PC ⇄ celular: android/app/build/outputs/apk/sync/debug/ (pacote com sufixo .sync)
```

No Windows, o caminho do projeto tem "ó" (`Códigos`); por isso `android/gradle.properties` traz `android.overridePathCheck=true`
e `android/local.properties` aponta o SDK (`sdk.dir=D:/Android/Sdk`, arquivo local, não versionado). Se `npm run android:apk` não achar o
`gradlew.bat`, rode `cd android && ./gradlew.bat assembleDebug` (com `ANDROID_HOME` apontando para o SDK).

Testado num emulador Android 15 (x86_64, `D:\Android\Sdk`, AVD `pixel35`): o app abre, carrega dados de exemplo, mantém os dados depois de fechar à força, agenda as notificações e abre o menu Compartilhar no backup. Não testado ainda: aparelho real, seletor de arquivos para restaurar, disparo real do aviso às 9h.

Para instalar o `app-debug.apk` no celular: copie o arquivo, abra-o e permita "instalar apps desconhecidos". A cada mudança
no front-end ou em `src/`, rode `npm run sync` de novo.

## O que já funciona no celular

Lançamentos (receitas, despesas, a pagar, parcelas, tags, lixeira, ações em lote, filtros e busca), categorias e
subcategorias, formas de pagamento, contas e cofrinhos (saldos), cartões de crédito com faturas (fechamento, vencimento,
pagamento total ou parcial), pagamentos recorrentes (ocorrência por mês, pagar/pular/reabrir, pagamento automático,
entrada no resumo e no "Por vir"), caixinhas (aporte mensal automático, depósito e retirada) e lista de desejos
(comprar, descartar, pagar com a caixinha), modelos (favoritos) e comprovantes anexados aos lançamentos (foto ou PDF,
até 5 MB e 5 por lançamento; o tipo vem do conteúdo do arquivo), lembretes (sino com contas vencidas ou a vencer,
orçamentos a partir de 80% e fim do mês; no Android, notificações agendadas às 9h que aparecem com o app fechado),
importação de extratos (OFX, CSV de banco/cartão e o CSV exportado pelo app, com revisão, duplicados e sugestão de categoria),
relatórios do extrato em PDF e Excel (.xlsx) gerados no aparelho, perfis (um banco separado para cada pessoa) e senha de
abertura, transferências entre contas, lixeira (restaurar, apagar de vez,
limpeza automática após 30 dias), orçamentos por mês (com sobra acumulada), resumo do
mês, "Por vir" (lançamentos a pagar/receber), moeda e idioma, dados de exemplo, **backup e restauração** e **exportação CSV**.
Os testes comparam o comportamento com as regras do back-end Java.

## Backup e levar os dados do PC para o celular

- **Mais → Backup e restauração → Fazer backup agora** guarda uma cópia dentro do app (arquivo `.json` com tudo). Ao restaurar,
  o app guarda antes uma cópia do que existia. Com "Backup automático todo dia" ligado em Configurações, ele guarda uma por dia
  (as 7 mais recentes). **Salvar uma cópia…** abre o menu Compartilhar do Android (Drive, WhatsApp, e-mail, "Salvar em arquivos").
- **Pasta dos backups (alterável):** em **Backup e restauração → Pasta dos backups → Escolher pasta…** você escolhe qualquer pasta
  do celular (seletor do Android). Daí em diante, todo backup, manual ou automático, também é gravado lá, fora do app, e
  sobrevive a desinstalar o app. Mantém as mesmas 30 manuais / 7 automáticas e só apaga arquivos `backup-….json` do próprio app.
  "Trocar pasta…" muda o destino e "Parar de usar" volta ao padrão (os arquivos já gravados ficam). Se a pasta falhar (apagada,
  permissão perdida), o backup interno continua valendo e a tela mostra o erro. Perfis que não são o principal gravam com o
  prefixo `<id-do-perfil>_`. Plugin nativo: `android/.../BackupFolderPlugin.java`.
- **Trazer os dados do PC:** no programa do computador, Mais → Backup e restauração → abra um backup → "Salvar uma cópia no
  computador…" (arquivo `.sql`). Envie o arquivo ao celular e, no app, use **Restaurar de um arquivo…**. O app reconhece sozinho
  o backup do computador (script do H2) e converte tudo: lançamentos, contas, categorias, orçamentos, tags, anexos e configurações.
  Isso substitui o que está no celular. O contrário (celular → PC) ainda não existe.
- Toda alteração só é confirmada depois de gravada no aparelho (fechar o app logo em seguida não perde nada).

## O que falta portar do Java

Nada do que o programa do computador faz. As funções são as mesmas (inclusive os dados de exemplo, em Mais → Carregar dados de
exemplo). O que existe só no celular: backup em arquivo `.json`, notificações agendadas e a trava por senha com "Esqueci a senha".
O que continua só no PC: tudo que depende do computador (janela própria, bandeja, iniciar com o Windows, acesso pela rede local).

## Perfis e senha

- **Perfis:** cada perfil é um banco separado no aparelho (lançamentos, contas, categorias, orçamentos e cópias de backup). O idioma
  vale para o app todo. Criar um perfil já passa a usá-lo, com as categorias e formas de pagamento padrão. **Remover um perfil apaga os
  dados dele do aparelho** (no PC os dados ficam numa pasta ".removido"; aqui não há pasta para guardar). Lembretes, notificações e o
  backup automático valem só para o perfil em uso. O limite é de 10 perfis.
- **Senha:** opcional, uma só para todos os perfis. Guarda-se apenas o hash (PBKDF2-HMAC-SHA256, 210 mil iterações, sal aleatório, no
  mesmo formato do PC). Com senha, o app pede ao abrir, ao voltar depois de 5 minutos em segundo plano, e recusa qualquer chamada de
  dados enquanto estiver trancado. Cinco erros seguidos pausam as tentativas por 30 segundos.
- **A senha é uma trava, não criptografia.** Os dados continuam no armazenamento do app, sem cifra: ela impede abrir o app, não
  protege contra quem tem acesso ao sistema do aparelho. Para proteger de verdade, use também o bloqueio de tela do Android.
- **Esqueci a senha:** não há arquivo para apagar como no PC. O botão na tela de entrada **apaga todos os dados do aparelho** e remove a
  senha (só um backup guardado fora do app recupera os dados). É de propósito: quem pegasse o celular não entraria nos dados.

## Notificações no Android

O app agenda, no próprio celular, um aviso `N dias antes` (configurável, 1 a 15) e outro no dia do vencimento de cada conta a pagar
(lançamentos a pagar, recorrentes e faturas de cartão), e dois no fim do mês, sempre às 9h, para os próximos 45 dias (os 60 mais
próximos). O que depende dos números do momento (conta vencida, orçamento perto do limite) é mostrado quando o app abre, uma vez só.
Tudo é recalculado ao abrir, ao voltar para o app e depois de cada alteração. Na primeira vez o app pede a permissão (obrigatória no
Android 13+); se for recusada, há o botão "Ativar notificações" no sino. Esta parte só roda no celular e **foi testada só num emulador
(Android 15)**: os avisos ficaram agendados para as 9h, usando alarme inexato (não pede a permissão "Alarmes e lembretes"); confira num aparelho real o primeiro agendamento (crie uma conta a pagar para amanhã e veja se o aviso chega às 9h).
A ordem sugerida está no fim deste arquivo.

## Sincronização com o computador

Opcional e só no build `sync` (a flavor `sync` tem a permissão de internet e um `flavor.json` com `sync: true`; a `offline` não tem nenhuma das duas).
O código está em `src/sync/`: `tables.js` (o formato dos dados, o mesmo do computador), `crypto.js` (PBKDF2 → AES-GCM), `engine.js` (enviar o que mudou,
ler o que mudou, vale a alteração mais recente, chaves estrangeiras por uuid, registros iguais criados nos dois lados viram um só),
`registry.js` (a lista de perfis), `service.js` (conexão, gatilhos automáticos) e `hub-supabase.js` (o cliente do Supabase). O esquema do hub está em
`../src/main/resources/static/sync/supabase-hub.sql`. A tela e o passo a passo são os mesmos do computador (Mais → Sincronização).
Cada tabela sincronizada tem gatilhos do SQLite que anotam as mudanças em `sync_outbox`; anexos acima de 3 MB não sincronizam.
O servidor padrão (opcional) vem de `sync-hub.json` (`url` e `anonKey`), copiado para `www/hub.json` no build.

## Cuidados

- Os dados ficam no armazenamento do app (IndexedDB do WebView). **Desinstalar o app ou limpar os dados apaga tudo**: faça um
  backup e guarde o arquivo fora do celular (Compartilhar → Drive, por exemplo). As cópias guardadas *dentro* do app somem junto (escolha uma "Pasta dos backups" para evitar isso).
- Dinheiro é guardado em centavos inteiros (`*_cents`).
- Para mudar o esquema, acrescente uma entrada em `MIGRATIONS` (`schema.js`); nunca edite as antigas.

## Botão voltar do Android

O Capacitor sozinho fecha o app ao apertar voltar. `src/native-back.js` (plugin `@capacitor/app`) faz o botão voltar pelas "camadas" do front-end (formulário aberto, página dentro de Mais, aba que não é o Início) e só sai do app quando não há mais nada para voltar.

O PDF usa as fontes padrão do formato (Helvetica), que só têm os caracteres do Windows-1252: letras de outros alfabetos nos
nomes viram "?" no PDF (a planilha .xlsx mantém tudo). O app ficou maior (~640 KB de JavaScript) por causa das bibliotecas
`pdf-lib` e `fflate`.
