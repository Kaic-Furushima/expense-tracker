import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {KEEP, KEEP_AUTOMATIC, MemoryBackupStore, createBackupHttp} from '../src/backups-http.js';
import {parseH2Script} from '../src/local-api/h2script.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
const PC_BACKUP = readFileSync(new URL('./fixtures/pc-backup.sql', import.meta.url), 'utf8');

let n = 0;
let now = new Date(2026, 4, 15, 12, 0, 0);
const newApi = () => createApi(new SQL.Database(), {clock: () => now, newId: () => `id-${++n}`});

let api;
const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const spend = (name, amount, date, extra = {}) => ok('POST', '/expenses', {name, amount, date, ...extra});

beforeEach(() => {
    now = new Date(2026, 4, 15, 12, 0, 0);
    api = newApi();
});

describe('backup no formato do app (JSON)', () => {
    it('salva e restaura tudo em outro aparelho', () => {
        const cat = ok('GET', '/categories').find(c => c.name === 'Mercado');
        const card = ok('POST', '/accounts', {name: 'Nubank', type: 'CREDIT_CARD', closingDay: 5, dueDay: 12, initialBalance: 10});
        spend('Feira', 80.5, '2026-05-02', {categoryId: cat.id, tags: ['casa'], accountId: card.id});
        spend('Luz', 120, '2026-05-20', {status: 'PENDING'});
        ok('PUT', `/budgets/${cat.id}?month=2026-01`, {amount: 400});
        const gone = spend('Erro', 1, '2026-05-03');
        call('DELETE', `/expenses/${gone.id}`);
        const file = api.services.backup.dump();

        api = newApi();
        api.services.backup.restore(file);

        assert.deepEqual(ok('GET', '/expenses').map(e => [e.name, e.amount, e.tags, e.categoryName, e.accountName]),
            [['Luz', 120, [], null, 'Conta principal'], ['Feira', 80.5, ['casa'], 'Mercado', 'Nubank']]);
        assert.equal(ok('GET', '/accounts').find(a => a.name === 'Nubank').balance, -70.5);
        assert.equal(ok('GET', '/budgets?month=2026-05')[0].amount, 400);
        assert.equal(api.db.value('select count(*) from expenses where deleted_at is not null'), 1);
        // continua funcionando: novos registros nao colidem com os restaurados
        assert.ok(spend('Novo', 5, '2026-05-10').id > 3);
    });

    it('a restauracao substitui os dados atuais', () => {
        const file = api.services.backup.dump();
        spend('Depois do backup', 9, '2026-05-01');
        api.services.backup.restore(file);
        assert.equal(ok('GET', '/expenses').length, 0);
        assert.equal(ok('GET', '/categories').length, 12);
    });

    it('arquivo invalido e recusado sem mexer nos dados', () => {
        spend('Fica', 9, '2026-05-01');
        for (const bad of ['', 'qualquer texto', '{"app":"outro"}', '{nao e json', JSON.stringify({app: 'expense-tracker', tables: {}, schemaVersion: 99})]) {
            assert.throws(() => api.services.backup.restore(bad), e => e.status === 400, bad);
        }
        assert.equal(ok('GET', '/expenses').length, 1);
    });

    it('backup com referencia quebrada desfaz tudo', () => {
        spend('Fica', 9, '2026-05-01');
        const data = JSON.parse(api.services.backup.dump());
        data.tables.expenses[0].account_id = 9999;
        assert.throws(() => api.services.backup.restore(JSON.stringify(data)), e => e.status === 400);
        assert.equal(ok('GET', '/expenses').length, 1);
        assert.equal(ok('GET', '/accounts').length, 1);
    });
});

describe('gravacao do banco', () => {
    it('exportar nao desliga as chaves estrangeiras', () => {
        api.db.export();
        assert.equal(api.db.value('pragma foreign_keys'), 1);
        assert.throws(() => api.db.run(`insert into expenses (uuid, name, amount_cents, date, account_id, created_at, updated_at)
                                        values ('x', 'x', 1, '2026-01-01', 999, 'x', 'x')`));
    });

    it('o banco exportado reabre com todos os dados', () => {
        spend('Fica', 7.77, '2026-05-01', {tags: ['t']});
        const again = createApi(new SQL.Database(api.db.export()), {clock: () => now});
        assert.deepEqual(again.handle('GET', '/expenses').body.map(e => [e.name, e.amount, e.tags]), [['Fica', 7.77, ['t']]]);
    });
});

describe('importar o backup do computador (script do H2)', () => {
    it('le tabelas, colunas e valores especiais', () => {
        const t = parseH2Script(PC_BACKUP);
        assert.equal(t.get('accounts').rows.length, 12);
        assert.equal(t.get('categories').rows.length, 13);
        assert.equal(t.get('categories').rows[0].name, 'Alimentação');
        assert.equal(t.get('categories').rows[0].icon, '🍽️');
        assert.equal(t.get('expenses').rows[0].amount, 10);
        assert.equal(t.get('expenses').rows[0].date, '2026-04-01');
        assert.equal(t.get('accounts').rows[2].archived, true);
    });

    it('le textos com aspas, barras, quebras de linha e STRINGDECODE', () => {
        const script = `CREATE MEMORY TABLE "PUBLIC"."T"(
    "ID" BIGINT NOT NULL,
    "NOTE" CHARACTER VARYING(255),
    "AT" TIMESTAMP WITH TIME ZONE
);
INSERT INTO "PUBLIC"."T" VALUES
(1, 'it''s, (a), b', TIMESTAMP WITH TIME ZONE '2026-01-02 03:04:05+00'),
(2, U&'barra \\\\ e \\00e9 e \\+01f600', NULL),
(3, STRINGDECODE('linha1\\nlinha2 \\u00e7'), NULL);`;
        const rows = parseH2Script(script).get('t').rows;
        assert.equal(rows[0].note, "it's, (a), b");
        assert.equal(rows[0].at, '2026-01-02 03:04:05+00');
        assert.equal(rows[1].note, 'barra \\ e é e 😀');
        assert.equal(rows[2].note, 'linha1\nlinha2 ç');
    });

    it('recusa script que nao e um backup valido', () => {
        assert.throws(() => parseH2Script(`CREATE TABLE "PUBLIC"."T"("A" INT);\nINSERT INTO "PUBLIC"."T" VALUES\n(1, 2);`), e => e.status === 400);
        assert.throws(() => api.services.backup.restore('CREATE TABLE x (a int);'), e => e.status === 400);
    });

    it('importa o backup real: contas, categorias, lancamento, anexo e saldos', () => {
        spend('Vai sumir', 1, '2026-05-01');
        api.services.backup.restore(PC_BACKUP);

        const accounts = ok('GET', '/accounts');
        assert.equal(accounts.length, 12);
        assert.equal(accounts.find(a => a.name === 'Conta de teste saldo').initialBalance, 100);
        assert.equal(accounts.find(a => a.name === 'Conta de teste arquivo').archived, true);
        assert.ok(ok('GET', '/categories').some(c => c.name === 'Alimentação'));
        assert.deepEqual(ok('GET', '/tags'), ['reembolso']);
        assert.equal(ok('GET', '/payment-methods').length, 6);

        const [e] = ok('GET', '/expenses');
        assert.deepEqual([e.name, e.amount, e.date, e.status, e.type], ['Nota no backup', 10, '2026-04-01', 'PAID', 'EXPENSE']);
        assert.match(e.createdAt, /^2026-11-01T22:14:10\.010$/);
        assert.equal(api.db.value('select count(*) from attachments'), 1);
        assert.equal(ok('GET', '/accounts').find(a => a.id === e.accountId).balance, -10);

        const month = ok('GET', '/api/summary?month=2026-04');
        assert.equal(month.expense, 10);
        // e o app continua gravando normalmente depois da importacao
        assert.ok(spend('Depois', 5, '2026-05-01').id > e.id);
    });
});

describe('copias guardadas no aparelho', () => {
    let store;
    let http;
    const go = (method, path, body) => http.handle(method, path, body);
    const okGo = async (method, path, body) => {
        const res = await go(method, path, body);
        assert.ok(res.status < 300, `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
        return res;
    };

    beforeEach(() => {
        store = new MemoryBackupStore();
        http = createBackupHttp({backup: api.services.backup, store, clock: () => now});
    });

    it('cria, lista (mais nova primeiro), baixa e exclui', async () => {
        spend('A', 1, '2026-05-01');
        const first = (await okGo('POST', '/backups')).body;
        assert.match(first.name, /^backup-20260515-120000\.json$/);
        now = new Date(2026, 4, 16, 8, 30, 0);
        const second = (await okGo('POST', '/backups')).body;
        assert.deepEqual((await okGo('GET', '/backups')).body.map(b => b.name), [second.name, first.name]);
        const file = (await okGo('GET', `/backups/${first.name}`)).text;
        assert.equal(JSON.parse(file).app, 'expense-tracker');
        assert.equal((await go('DELETE', `/backups/${first.name}`)).status, 204);
        assert.equal((await okGo('GET', '/backups')).body.length, 1);
    });

    it('duas copias no mesmo segundo nao se sobrescrevem', async () => {
        const a = (await okGo('POST', '/backups')).body.name;
        const b = (await okGo('POST', '/backups')).body.name;
        assert.notEqual(a, b);
        assert.equal((await okGo('GET', '/backups')).body.length, 2);
    });

    it('restaurar guarda antes uma copia do que existe agora', async () => {
        spend('Antes', 1, '2026-05-01');
        const saved = (await okGo('POST', '/backups')).body;
        spend('Depois', 2, '2026-05-02');
        now = new Date(2026, 4, 15, 13, 0, 0);
        await okGo('POST', `/backups/${saved.name}/restore`);
        assert.deepEqual(ok('GET', '/expenses').map(e => e.name), ['Antes']);
        const names = (await okGo('GET', '/backups')).body.map(b => b.name);
        assert.equal(names.length, 2);
        const safety = names.find(x => x.includes('antes-de-restaurar'));
        // a copia de seguranca tem o "Depois": restaurar de volta traz o que foi perdido
        await okGo('POST', `/backups/${safety}/restore`);
        assert.deepEqual(ok('GET', '/expenses').map(e => e.name), ['Depois', 'Antes']);
    });

    it('restaura de um arquivo escolhido (inclusive o do computador) e recusa arquivo ruim sem deixar copia', async () => {
        await okGo('POST', '/backups/restore', {content: PC_BACKUP});
        assert.equal(ok('GET', '/accounts').length, 12);
        const before = (await okGo('GET', '/backups')).body.length;
        await assert.rejects(go('POST', '/backups/restore', {content: 'lixo'}), e => e.status === 400);
        await assert.rejects(go('POST', '/backups/restore', {content: ''}), e => e.status === 400);
        assert.equal((await okGo('GET', '/backups')).body.length, before);
        assert.equal(ok('GET', '/accounts').length, 12);
    });

    it('nome invalido ou inexistente e 404; rota que nao e de backup passa adiante', async () => {
        await assert.rejects(go('GET', '/backups/..%2Fsegredo'), e => e.status === 404);
        await assert.rejects(go('GET', '/backups/backup-20200101-000000.json'), e => e.status === 404);
        assert.equal(await go('GET', '/expenses', null), null);
    });

    it('guarda so as ultimas copias manuais', async () => {
        for (let i = 0; i < KEEP + 3; i++) {
            now = new Date(2026, 4, 15, 12, 0, i);
            await okGo('POST', '/backups');
        }
        const all = (await okGo('GET', '/backups')).body;
        assert.equal(all.length, KEEP);
        assert.ok(all[0].name.endsWith('120032.json'));
    });

    it('copia automatica: so se ligada, uma por dia, e nao expulsa as manuais', async () => {
        assert.equal(await http.automaticIfDue(false), false);
        assert.equal(await http.automaticIfDue(true), true);
        assert.equal(await http.automaticIfDue(true), false);
        now = new Date(2026, 4, 15, 20, 0, 0);
        assert.equal(await http.automaticIfDue(true), false);
        for (let day = 16; day < 16 + KEEP_AUTOMATIC + 2; day++) {
            now = new Date(2026, 4, day, 12, 0, 0);
            assert.equal(await http.automaticIfDue(true), true);
        }
        await okGo('POST', '/backups');
        const names = (await okGo('GET', '/backups')).body.map(b => b.name);
        assert.equal(names.filter(x => x.endsWith('-auto.json')).length, KEEP_AUTOMATIC);
        assert.equal(names.filter(x => !x.endsWith('-auto.json')).length, 1);
    });
});

describe('exportar CSV', () => {
    it('mesmo formato do computador, com protecao contra formulas', () => {
        const cat = ok('GET', '/categories').find(c => c.name === 'Mercado');
        const wallet = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET'});
        spend('=SOMA(A1)', 12.5, '2026-05-02', {categoryId: cat.id, tags: ['a', 'b'], description: 'linha 1\nlinha 2'});
        spend('Luz "forte"', 100, '2026-05-01', {status: 'PENDING', accountId: wallet.id});
        const res = call('GET', '/api/export.csv');
        assert.equal(res.status, 200);
        assert.match(res.contentType, /^text\/csv/);
        const lines = res.text.split('\n');
        assert.equal(lines[0], '﻿data;tipo;nome;categoria;valor;conta;conta_destino;forma_pagamento;situacao;tags;descricao');
        assert.equal(lines[1], '2026-05-01;EXPENSE;"Luz ""forte""";;100.00;"Carteira";;;A_PAGAR;"";');
        assert.equal(lines[2], `2026-05-02;EXPENSE;"'=SOMA(A1)";"Mercado";12.50;"Conta principal";;;PAGO;"a b";"linha 1 linha 2"`);
    });
});

describe('pasta de backups escolhida pela pessoa', () => {
    const fakeFolder = () => {
        const files = new Map();
        let current = null;
        let failing = false;
        return {
            files, setFailing: v => { failing = v; },
            get: async () => current,
            pick: async () => { current = {name: 'Documentos/Backups'}; return current; },
            clear: async () => { current = null; },
            write: async (name, text) => { if (failing) throw new Error('Sem permissão para esta pasta.'); files.set(name, text); },
            list: async () => [...files.keys(), 'foto.jpg'],
            remove: async name => { files.delete(name); }
        };
    };

    it('sem pasta escolhida nada e gravado fora do app', async () => {
        const folder = fakeFolder();
        const http = createBackupHttp({backup: api.services.backup, store: new MemoryBackupStore(), clock: () => now, folder});
        const made = (await http.handle('POST', '/backups')).body;
        assert.equal(made.folder, undefined);
        assert.equal(folder.files.size, 0);
        assert.deepEqual((await http.handle('GET', '/backups/folder')).body, {configured: false, name: null, changed: false, error: null});
    });

    it('com pasta, cada backup (manual e automatico) tambem vai para la, com o mesmo conteudo', async () => {
        const folder = fakeFolder();
        const http = createBackupHttp({backup: api.services.backup, store: new MemoryBackupStore(), clock: () => now, folder});
        assert.equal((await http.handle('POST', '/backups/folder')).body.changed, true);
        const made = (await http.handle('POST', '/backups')).body;
        assert.equal(made.folder, 'Documentos/Backups');
        assert.equal(folder.files.get(made.name), await http.read(made.name));
        await http.automaticIfDue(true);
        assert.equal(folder.files.size, 2);
        assert.equal((await http.handle('DELETE', '/backups/folder')).status, 204);
        assert.equal((await http.handle('GET', '/backups/folder')).body.configured, false);
    });

    it('se a pasta falhar o backup continua valendo e o erro aparece', async () => {
        const folder = fakeFolder();
        const http = createBackupHttp({backup: api.services.backup, store: new MemoryBackupStore(), clock: () => now, folder});
        await http.handle('POST', '/backups/folder');
        folder.setFailing(true);
        const made = (await http.handle('POST', '/backups')).body;
        assert.match(made.folderError, /permissão/);
        assert.equal((await http.handle('GET', '/backups')).body.length, 1);
        assert.match((await http.handle('GET', '/backups/folder')).body.error, /permissão/);
        folder.setFailing(false);
        await http.handle('POST', '/backups');
        assert.equal((await http.handle('GET', '/backups/folder')).body.error, null);
    });

    it('limpa os antigos da pasta, so os do app e so os do proprio perfil', async () => {
        const folder = fakeFolder();
        const http = createBackupHttp({backup: api.services.backup, store: new MemoryBackupStore(), clock: () => now, folder, folderPrefix: 'p1_'});
        folder.files.set('backup-20200101-000000.json', 'outro perfil');
        await http.handle('POST', '/backups/folder');
        for (let i = 0; i < KEEP + 3; i++) {
            now = new Date(2026, 4, 15, 12, 0, i);
            await http.handle('POST', '/backups');
        }
        const mine = [...folder.files.keys()].filter(k => k.startsWith('p1_'));
        assert.equal(mine.length, KEEP);
        assert.ok(folder.files.has('backup-20200101-000000.json'));
        assert.ok(mine.includes('p1_backup-20260515-120000.json') === false, 'os mais antigos saem primeiro');
    });

    it('no navegador (sem pasta) a rota responde 404', async () => {
        const http = createBackupHttp({backup: api.services.backup, store: new MemoryBackupStore(), clock: () => now});
        await assert.rejects(http.handle('GET', '/backups/folder'), e => e.status === 404);
    });
});
