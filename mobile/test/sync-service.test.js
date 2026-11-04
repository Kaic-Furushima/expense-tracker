import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {MemoryBackupStore, createBackupHttp} from '../src/backups-http.js';
import {createApi} from '../src/local-api/index.js';
import {MAIN, Profiles} from '../src/profiles.js';
import {createRestoreHttp} from '../src/restore-http.js';
import {MemoryHub} from '../src/sync/hub-memory.js';
import {MemorySyncStore, SyncService} from '../src/sync/service.js';
import {createSyncHttp} from '../src/sync/sync-http.js';

const SQL = await initSqlJs();

/** Um aparelho falando com o mesmo hub em memoria, com o login do Supabase de mentira (uma conta, uma senha). */
class AccountHub {
    constructor(core, shared) { this.core = core; this.shared = shared; this.in = false; this.failNext = null; }
    check() { if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; } }
    async signUp(email, password) { if (this.shared.account) throw new Error('User already registered'); this.shared.account = {email, password}; this.in = true; }
    async signIn(email, password) {
        const a = this.shared.account;
        if (!a || a.email !== email || a.password !== password) throw new Error('Invalid login credentials');
        this.in = true;
    }
    signedIn() { return this.in; }
    async getVault() { this.check(); return this.core.getVault(); }
    async setVault(v) { this.check(); return this.core.setVault(v); }
    async push(...args) { this.check(); return this.core.push(...args); }
    async pull(...args) { this.check(); return this.core.pull(...args); }
}

let counter = 0;

/** Um aparelho inteiro: perfis (com banco e backups proprios), servico de sync e as rotas de restauracao. */
async function makeDevice(core, shared, options = {}) {
    const files = {};
    const backupStores = {};
    let meta = null;
    const hub = new AccountHub(core, shared);
    const timers = [];
    const storage = {
        readMeta: async () => (meta ? structuredClone(meta) : null),
        writeMeta: async value => { meta = structuredClone(value); },
        deleteProfile: async id => { delete files[id]; },
        deleteAll: async () => { for (const k of Object.keys(files)) delete files[k]; meta = null; }
    };
    async function openRuntime(id, languageStore) {
        let pending = null;
        const api = createApi(files[id] ? new SQL.Database(files[id]) : new SQL.Database(), {
            languageStore, clock: () => new Date(2026, 4, 15, 12), persist: exportFn => { pending = exportFn; }
        });
        backupStores[id] ??= new MemoryBackupStore();
        return {
            id, api, backups: createBackupHttp({backup: api.services.backup, store: backupStores[id]}),
            flush: async () => { if (pending) { files[id] = pending(); pending = null; } },
            close() { if (pending) { files[id] = pending(); pending = null; } api.db.close(); }
        };
    }
    const profiles = await new Profiles({storage, openRuntime, newId: () => `p${String(++counter).padStart(7, '0')}`}).init();
    const service = await new SyncService({
        store: new MemorySyncStore(), profiles, hubFactory: () => hub, setTimer: fn => { timers.push(fn); return timers.length; },
        clearTimer: () => {}, now: () => 1234, ...options
    }).init();
    const http = createSyncHttp(() => service);
    const restore = createRestoreHttp({profiles, sync: service, backupsFor: (id, runtime) => runtime.backups});

    const call = (runtime, method, url, body) => {
        const res = runtime.api.handle(method, url, body);
        assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
        return res.body;
    };
    return {
        hub, service, profiles, http, restore, timers, files,
        /** Roda fn com o banco do perfil e devolve o que ela devolver. */
        in: (id, fn) => profiles.withRuntime(id, async rt => fn(rt, (m, u, b) => call(rt, m, u, b))),
        spend: (id, name) => profiles.withRuntime(id, async rt => {
            call(rt, 'POST', '/expenses', {name, amount: 10, date: '2026-05-10', accountId: call(rt, 'GET', '/accounts')[0].id});
        }),
        expenses: id => profiles.withRuntime(id, async rt => call(rt, 'GET', '/expenses').map(e => e.name).sort()),
        idByName: name => profiles.list().find(p => p.name === name)?.id
    };
}

function world() {
    const shared = {account: null};
    const core = new MemoryHub();
    return {shared, core, device: options => makeDevice(core, shared, options)};
}

const form = (extra = {}) => ({url: 'https://x.supabase.co', anonKey: 'anon', email: 'eu@exemplo.com', password: 'senha-conta', syncPassword: 'senha-de-sync', createAccount: true, ...extra});
const settle = async (...devices) => { for (let i = 0; i < 2; i++) for (const d of devices) await d.service.syncNow(); };
const wait = ms => new Promise(r => setTimeout(r, ms));

describe('servico de sincronizacao', () => {
    it('na versao sem internet tudo e indisponivel', async () => {
        const a = await world().device({available: false});
        assert.deepEqual(a.service.status(), {available: false, configured: false});
        await assert.rejects(() => a.service.connect(form()), /não está disponível/);
        const res = await a.http.handle('GET', '/api/sync');
        assert.equal(res.body.available, false);
    });

    it('conecta (criando a conta), sincroniza e mostra o estado', async () => {
        const a = await world().device();
        assert.equal(a.service.status().configured, false);
        const status = await a.service.connect(form());
        assert.equal(status.configured, true);
        assert.equal(status.email, 'eu@exemplo.com');
        assert.equal(status.lastSyncAt, 1234);
        assert.equal(status.lastError, null);
        assert.equal(status.unsent, 0);
    });

    it('o segundo aparelho entra com a mesma conta e recebe os dados', async () => {
        const w = world();
        const a = await w.device();
        const b = await w.device();
        await a.service.connect(form());
        await a.spend(MAIN, 'Do primeiro');
        await a.service.syncNow();

        await b.service.connect(form({createAccount: false}));
        assert.deepEqual(await b.expenses(MAIN), ['Do primeiro']);
    });

    it('erros ficam claros: conta repetida, senha da conta errada, senha de sync errada', async () => {
        const w = world();
        const a = await w.device();
        const b = await w.device();
        await a.service.connect(form());
        await assert.rejects(() => b.service.connect(form()), /já tem conta/);
        await assert.rejects(() => b.service.connect(form({createAccount: false, password: 'outra'})), /incorretos/);
        await assert.rejects(() => b.service.connect(form({createAccount: false, syncPassword: 'senha-errada-1'})), /Senha de sync incorreta/);
        assert.equal(b.service.status().configured, false, 'nada guardado quando falha');
        await assert.rejects(() => b.service.connect(form({syncPassword: 'curta'})), /pelo menos 8/);
        await assert.rejects(() => b.service.connect(form({url: ''})), /Preencha/);
    });

    it('sem rede o erro e guardado e a proxima tentativa funciona', async () => {
        const a = await world().device();
        await a.service.connect(form());
        a.hub.failNext = new TypeError('Failed to fetch');
        const failed = await a.service.syncNow();
        assert.match(failed.lastError, /Sem conexão/);
        assert.equal(failed.lastSyncAt, 1234, 'mantem a ultima sincronizacao boa');
        assert.equal((await a.service.syncNow()).lastError, null);
    });

    it('sincroniza sozinho depois de salvar (agrupando) e respeita o interruptor', async () => {
        const a = await world().device();
        await a.service.connect(form());
        a.service.notifyChange();
        a.service.notifyChange();
        assert.equal(a.timers.length, 2);
        await a.in(MAIN, (rt, call) => call('POST', '/categories', {name: 'Nova'}));
        a.timers.at(-1)();
        await wait(300);
        assert.equal(a.service.status().unsent, 0);

        await a.service.setAuto(false);
        a.service.notifyChange();
        assert.equal(a.timers.length, 2, 'desligado: nao agenda');
        assert.equal(a.service.status().autoSync, false);
    });

    it('desconectar esquece a conexao mas nao apaga dados', async () => {
        const a = await world().device();
        await a.service.connect(form());
        const before = await a.in(MAIN, (rt, call) => call('GET', '/categories').length);
        await a.service.disconnect();
        assert.equal(a.service.status().configured, false);
        assert.equal(await a.in(MAIN, (rt, call) => call('GET', '/categories').length), before);
        await assert.rejects(() => a.service.syncNow(), /Conecte/);
    });

    it('as rotas /api/sync respondem como as do computador', async () => {
        const a = await world().device();
        assert.equal((await a.http.handle('GET', '/api/sync')).body.configured, false);
        assert.equal(await a.http.handle('GET', '/outra-coisa'), null);
        assert.equal((await a.http.handle('PUT', '/api/sync', form())).body.configured, true);
        assert.equal((await a.http.handle('PUT', '/api/sync/auto', {enabled: false})).body.autoSync, false);
        assert.equal((await a.http.handle('POST', '/api/sync/now')).body.lastError, null);
        assert.equal((await a.http.handle('DELETE', '/api/sync')).body.configured, false);
        await assert.rejects(() => a.http.handle('PUT', '/api/sync', form({email: ''})), /Preencha/);
    });

    it('o servidor padrao do build so vale quando existe', async () => {
        const w = world();
        const without = await w.device();
        assert.equal(without.service.status().central, false);
        await assert.rejects(() => without.service.connect({email: 'a@b.c', password: 'senha-conta', syncPassword: 'senha-de-sync', useCentral: true}), /servidor padrão/);

        let seen;
        const withCentral = await w.device({central: {url: 'https://central.example', anonKey: 'chave'}});
        const hub = withCentral.hub;
        withCentral.service.hubFactory = cfg => { seen = cfg; return hub; };
        assert.equal(withCentral.service.status().central, true);
        const status = await withCentral.service.connect({email: 'a@b.c', password: 'senha-conta', syncPassword: 'senha-de-sync', createAccount: true, useCentral: true});
        assert.equal(seen.url, 'https://central.example');
        assert.equal(status.mode, 'central');
        assert.equal(status.url, null);
        assert.equal(status.lastError, null);
    });

    it('a conexao e da pessoa: fica fora dos bancos dos perfis', async () => {
        const a = await world().device();
        await a.service.connect(form());
        assert.match(JSON.stringify(a.service.state), /senha-de-sync/);
        const inDb = await a.in(MAIN, rt => JSON.stringify(rt.api.db.all('select * from sync_state')));
        assert.ok(!inDb.includes('senha-de-sync'), 'nem a senha nem a conta ficam no banco');
    });
});

describe('varios perfis', () => {
    it('um perfil criado em um aparelho aparece no outro, com os dados dele e separado dos outros', async () => {
        const w = world();
        const a = await w.device();
        const b = await w.device();
        await a.service.connect(form());
        await b.service.connect(form({createAccount: false}));

        const casa = (await a.profiles.create('Casa')).id;
        await a.spend(casa, 'Luz da casa');
        await a.spend(MAIN, 'Do principal');
        await settle(a, b);

        const onB = b.idByName('Casa');
        assert.ok(onB, 'o perfil apareceu sozinho');
        assert.deepEqual(await b.expenses(onB), ['Luz da casa']);
        assert.deepEqual(await b.expenses(MAIN), ['Do principal']);
        assert.equal(a.profiles.syncIdOf(casa), b.profiles.syncIdOf(onB));
    });

    it('renomear e a lixeira vao junto, e restaurar volta nos dois', async () => {
        const w = world();
        const a = await w.device();
        const b = await w.device();
        await a.service.connect(form());
        await b.service.connect(form({createAccount: false}));
        const id = (await a.profiles.create('Casa')).id;
        await settle(a, b);
        const onB = b.idByName('Casa');

        await a.profiles.rename(id, 'Apartamento');
        await settle(a, b);
        assert.equal(b.profiles.list().find(p => p.id === onB).name, 'Apartamento');

        await a.profiles.remove(id); // primeira exclusao: so para a lixeira, nos dois
        await settle(a, b);
        assert.equal(b.profiles.exists(onB), false);
        assert.deepEqual(b.profiles.trashed().map(t => t.name), ['Apartamento']);

        await b.profiles.restore(onB);
        await settle(a, b);
        assert.equal(a.profiles.exists(id), true);
        assert.deepEqual(a.profiles.trashed(), []);
    });

    it('excluir de vez, da lixeira, exclui nos dois e nao volta', async () => {
        const w = world();
        const a = await w.device();
        const b = await w.device();
        await a.service.connect(form());
        await b.service.connect(form({createAccount: false}));
        const id = (await a.profiles.create('Temporario')).id;
        await a.spend(id, 'x');
        await settle(a, b);
        const onB = b.idByName('Temporario');
        assert.deepEqual(await b.expenses(onB), ['x']);

        await a.profiles.remove(id);
        await settle(a, b);
        await a.profiles.purge(id);
        await settle(a, b);
        await settle(a, b);

        assert.equal(b.profiles.existsAny(onB), false, 'a exclusao oficial chegou no outro aparelho');
        assert.equal(a.profiles.purged().length, 0, 'e o aviso foi entregue');
        for (const d of [a, b]) assert.ok(!d.profiles.list().some(p => p.name === 'Temporario'));
    });
});

describe('restaurar um backup escolhendo onde', () => {
    const backupOf = async (device, id) => device.in(id, rt => rt.api.services.backup.dump());

    it('sobre um perfil existente (nao so o em uso), com copia antes se a pessoa quiser', async () => {
        const w = world();
        const a = await w.device();
        const casa = (await a.profiles.create('Casa')).id;
        await a.spend(casa, 'da casa');
        const content = await backupOf(a, casa);
        await a.spend(casa, 'depois do backup');
        await a.profiles.select(MAIN); // o em uso e outro

        const res = await a.restore.handle('POST', '/backups/restore', {content, profileId: casa, backupFirst: true});

        assert.deepEqual([res.status, res.body.profileId, res.body.created], [200, casa, false]);
        assert.deepEqual(await a.expenses(casa), ['da casa'], 'o perfil escolhido foi sobrescrito');
        assert.deepEqual(await a.expenses(MAIN), [], 'o em uso nao foi tocado');
        const kept = await a.in(casa, rt => rt.backups.handle('GET', '/backups'));
        assert.ok(kept.body.some(b => !b.name.includes('antes-de-restaurar')), 'a copia pedida foi feita antes de sobrescrever');
    });

    it('sem pedir copia, so fica a de seguranca automatica', async () => {
        const a = await world().device();
        const content = await backupOf(a, MAIN);
        await a.restore.handle('POST', '/backups/restore', {content, profileId: MAIN, backupFirst: false});
        const kept = (await a.in(MAIN, rt => rt.backups.handle('GET', '/backups'))).body;
        assert.deepEqual(kept.map(b => b.name.includes('antes-de-restaurar')), [true]);
    });

    it('num perfil novo: nada e sobrescrito', async () => {
        const a = await world().device();
        await a.spend(MAIN, 'principal');
        const content = await backupOf(a, MAIN);
        await a.spend(MAIN, 'depois');

        const res = await a.restore.handle('POST', '/backups/restore', {content, newProfileName: 'Recuperado'});

        assert.equal(res.body.created, true);
        assert.deepEqual(await a.expenses(res.body.profileId), ['principal']);
        assert.deepEqual(await a.expenses(MAIN), ['depois', 'principal'], 'o perfil existente continua como estava');
        assert.equal(a.profiles.list().some(p => p.name === 'Recuperado'), true);
    });

    it('um arquivo invalido nao deixa um perfil novo para tras nem mexe no existente', async () => {
        const a = await world().device();
        await a.spend(MAIN, 'fica');
        await assert.rejects(() => a.restore.handle('POST', '/backups/restore', {content: 'isto nao e um backup', newProfileName: 'Vazio'}));
        assert.equal(a.profiles.list().length, 1);
        await assert.rejects(() => a.restore.handle('POST', '/backups/restore', {content: 'isto nao e um backup', profileId: MAIN}));
        assert.deepEqual(await a.expenses(MAIN), ['fica']);
        await assert.rejects(() => a.restore.handle('POST', '/backups/restore', {content: '  '}), /vazio|inválidos/i);
        await assert.rejects(() => a.restore.handle('POST', '/backups/restore', {content: '{}', profileId: 'naoexiste'}), /não encontrado/);
    });

    it('com o sync ligado, sobrescrever tambem sobrescreve a nuvem e o outro aparelho', async () => {
        const w = world();
        const a = await w.device();
        const b = await w.device();
        await a.service.connect(form());
        await b.service.connect(form({createAccount: false}));
        await a.spend(MAIN, 'no backup');
        const content = await backupOf(a, MAIN);
        await a.spend(MAIN, 'sera apagado');
        await settle(a, b);
        assert.deepEqual(await b.expenses(MAIN), ['no backup', 'sera apagado']);

        const res = await a.restore.handle('POST', '/backups/restore', {content, profileId: MAIN});
        assert.equal(res.body.syncError, null);
        await settle(a, b);

        assert.deepEqual(await a.expenses(MAIN), ['no backup']);
        assert.deepEqual(await b.expenses(MAIN), ['no backup'], 'o que o backup nao tem foi apagado no outro aparelho');
    });

    it('a restauracao forcada vence ate uma edicao mais recente feita no outro aparelho', async () => {
        const w = world();
        const a = await w.device();
        const b = await w.device();
        await a.service.connect(form());
        await b.service.connect(form({createAccount: false}));
        await a.spend(MAIN, 'original');
        const content = await backupOf(a, MAIN);
        await settle(a, b);
        await b.in(MAIN, (rt, call) => {
            rt.api.db.sql.run('update sync_ctl set clock_ms = ?', [Date.now() + 3_600_000]); // relogio adiantado
            const e = call('GET', '/expenses')[0];
            call('PUT', `/expenses/${e.id}`, {name: 'editado no B', amount: 10, date: '2026-05-10', accountId: e.accountId, tags: []});
        });
        await b.service.syncNow();

        await a.restore.handle('POST', '/backups/restore', {content, profileId: MAIN});
        await settle(a, b);

        assert.deepEqual(await b.expenses(MAIN), ['original']);
    });

    it('o erro da nuvem nao desfaz a restauracao: avisa e segue', async () => {
        const w = world();
        const a = await w.device();
        await a.service.connect(form());
        const content = await backupOf(a, MAIN);
        await a.spend(MAIN, 'depois');
        a.hub.failNext = new TypeError('Failed to fetch');
        const res = await a.restore.handle('POST', '/backups/restore', {content, profileId: MAIN});
        assert.match(res.body.syncError, /fetch/i);
        assert.deepEqual(await a.expenses(MAIN), [], 'restaurou mesmo assim');
    });
});
