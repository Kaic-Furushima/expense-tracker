import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {SyncCrypto, newSalt} from '../src/sync/crypto.js';
import {MAX_SYNC_ATTACHMENT_BYTES, SyncEngine} from '../src/sync/engine.js';
import {MemoryHub} from '../src/sync/hub-memory.js';
import {SupabaseHub} from '../src/sync/hub-supabase.js';

const SQL = await initSqlJs();
const PASSWORD = 'senha-de-teste';
const T0 = new Date(2026, 4, 15, 12, 0, 0).getTime();

/** Um aparelho: banco + API local + relogio proprio (o mesmo relogio vale para o app e para os gatilhos do sync). */
class Device {
    constructor(hub) {
        this.hub = hub;
        this.api = createApi(new SQL.Database(), {clock: () => new Date(this.now)});
        this.db = this.api.db;
        this.at(T0);
    }

    at(ms) {
        this.now = ms;
        this.db.sql.run('update sync_ctl set clock_ms = ?', [ms]);
        return this;
    }

    async engine() {
        this.sync = await SyncEngine.open(this.db, this.hub, PASSWORD);
        return this;
    }

    call(method, url, body) {
        const res = this.api.handle(method, url, body);
        assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
        return res.body;
    }

    expenses() { return this.call('GET', '/expenses?size=100').content ?? this.call('GET', '/expenses'); }
    names(table) { return this.db.all(`select name from ${table} order by name`).map(r => r.name); }
    uuids(table) { return this.db.all(`select uuid from ${table} order by uuid`).map(r => r.uuid); }
    row(table, name) { return this.db.get(`select * from ${table} where name = ?`, [name]); }
}

async function pair() {
    const hub = new MemoryHub();
    const a = await new Device(hub).engine();
    const b = await new Device(hub).engine();
    return {hub, a, b};
}

const accountId = d => d.call('GET', '/accounts')[0].id;
const spend = (d, name, extra = {}) => d.call('POST', '/expenses', {name, amount: 10, date: '2026-05-10', accountId: accountId(d), ...extra});
async function settle(...devices) { for (let i = 0; i < 2; i++) for (const d of devices) await d.sync.sync(); }

describe('criptografia', () => {
    it('cifra e decifra, e uma senha errada falha', async () => {
        const salt = newSalt();
        const good = await SyncCrypto.fromPassword('abc', salt, 1000);
        const token = await good.encrypt('olá, mundo');
        assert.match(token, /^v1\.[^.]+\.[^.]+$/);
        assert.equal(await good.decrypt(token), 'olá, mundo');
        const bad = await SyncCrypto.fromPassword('abd', salt, 1000);
        await assert.rejects(() => bad.decrypt(token), /Senha de sync incorreta/);
        assert.equal(await good.verify(await good.makeCheck()), true);
    });

    it('o segundo aparelho com senha errada nao entra', async () => {
        const hub = new MemoryHub();
        const db = new Device(hub).db;
        await SyncEngine.open(db, hub, 'certa');
        await assert.rejects(() => SyncEngine.open(db, hub, 'errada'), /Senha de sync incorreta/);
    });

    it('o hub so ve texto cifrado', async () => {
        const {hub, a} = await pair();
        spend(a, 'Segredo do mercado');
        await a.sync.sync();
        const stored = JSON.stringify([...hub.rows.values()]);
        assert.ok(!stored.includes('Segredo do mercado'));
        assert.ok(!stored.includes('Conta principal'));
    });
});

describe('sincronizacao entre dois aparelhos', () => {
    it('um lancamento criado em A chega em B com categoria, conta e etiquetas', async () => {
        const {a, b} = await pair();
        const cat = a.call('GET', '/categories')[0];
        spend(a, 'Pao', {categoryId: cat.id, tags: ['padaria', 'cafe']});
        await settle(a, b);

        const got = b.expenses().find(e => e.name === 'Pao');
        assert.ok(got, 'lancamento chegou');
        assert.equal(got.categoryName, cat.name);
        assert.equal(got.accountName, 'Conta principal');
        assert.deepEqual([...got.tags].sort(), ['cafe', 'padaria']);
    });

    it('os dados iniciais criados em cada aparelho viram uma coisa so, com o menor uuid', async () => {
        const {a, b} = await pair();
        const before = a.uuids('categories').concat(b.uuids('categories'));
        assert.equal(new Set(before).size, 24, 'cada aparelho semeou os seus');
        await settle(a, b);

        assert.deepEqual(a.uuids('categories'), b.uuids('categories'));
        assert.deepEqual(a.uuids('payment_methods'), b.uuids('payment_methods'));
        assert.deepEqual(a.uuids('accounts'), b.uuids('accounts'));
        assert.equal(a.uuids('categories').length, 12);
        assert.equal(a.uuids('accounts').length, 1);
    });

    it('lancamentos feitos na conta padrao dos dois lados ficam todos na mesma conta', async () => {
        const {a, b} = await pair();
        spend(a, 'Do A');
        spend(b, 'Do B');
        await settle(a, b);
        for (const d of [a, b]) {
            assert.deepEqual(d.expenses().map(e => e.name).sort(), ['Do A', 'Do B']);
            assert.equal(d.db.value('select count(distinct account_id) from expenses'), 1);
            assert.equal(d.db.value('select count(*) from accounts'), 1);
        }
    });

    it('editando o mesmo lancamento nos dois, vale a edicao mais recente', async () => {
        const {a, b} = await pair();
        const created = spend(a, 'Luz');
        await settle(a, b);
        const idB = b.expenses().find(e => e.name === 'Luz').id;

        a.at(T0 + 60000);
        a.call('PUT', `/expenses/${created.id}`, {...created, name: 'Luz do A', accountId: accountId(a), categoryId: null, tags: []});
        b.at(T0 + 120000); // mais recente
        const seenB = b.expenses().find(e => e.name === 'Luz');
        b.call('PUT', `/expenses/${idB}`, {name: 'Luz do B', amount: seenB.amount, date: seenB.date, accountId: accountId(b), tags: []});
        await settle(a, b);

        assert.equal(a.expenses().find(e => e.id === created.id).name, 'Luz do B');
        assert.equal(b.expenses().find(e => e.id === idB).name, 'Luz do B');
    });

    it('trocar so as etiquetas tambem sincroniza', async () => {
        const {a, b} = await pair();
        const e = spend(a, 'Taxa', {tags: ['x']});
        await settle(a, b);
        a.at(T0 + 5000);
        a.call('PUT', `/expenses/${e.id}`, {name: 'Taxa', amount: 10, date: '2026-05-10', accountId: accountId(a), tags: ['y', 'z']});
        await settle(a, b);
        assert.deepEqual([...b.expenses().find(x => x.name === 'Taxa').tags].sort(), ['y', 'z']);
    });

    it('lixeira (exclusao leve) e exclusao definitiva chegam no outro aparelho', async () => {
        const {a, b} = await pair();
        const e1 = spend(a, 'Vai para a lixeira');
        const e2 = spend(a, 'Some de vez');
        await settle(a, b);
        assert.equal(b.expenses().length, 2);

        a.at(T0 + 1000);
        a.call('DELETE', `/expenses/${e1.id}`);
        a.call('DELETE', `/expenses/${e2.id}`);
        a.call('DELETE', `/trash/EXPENSE/${e2.id}`);
        await settle(a, b);

        assert.equal(b.expenses().length, 0);
        assert.equal(b.db.value('select count(*) from expenses where deleted_at is not null'), 1, 'um na lixeira');
        assert.equal(b.db.value("select count(*) from expenses where name = 'Some de vez'"), 0, 'o outro foi de vez');
    });

    it('exclusao mais antiga que uma edicao em outro aparelho nao apaga a edicao', async () => {
        const {a, b} = await pair();
        const cat = a.call('POST', '/categories', {name: 'Temporaria'});
        await settle(a, b);

        a.at(T0 + 1000);
        a.call('DELETE', `/categories/${cat.id}`);
        b.at(T0 + 9000); // editou depois
        const idB = b.row('categories', 'Temporaria').id;
        b.call('PUT', `/categories/${idB}`, {name: 'Temporaria editada'});
        await settle(a, b);

        assert.ok(a.names('categories').includes('Temporaria editada'));
        assert.ok(b.names('categories').includes('Temporaria editada'));
    });

    it('sem rede nada se perde: o que ficou na caixa de saida sai na proxima vez', async () => {
        const {hub, a, b} = await pair();
        spend(a, 'Offline');
        hub.failNext = new Error('sem rede');
        await assert.rejects(() => a.sync.sync(), /sem rede/);
        assert.ok(a.sync.outboxCount() > 0);
        await settle(a, b);
        assert.ok(b.expenses().some(e => e.name === 'Offline'));
        assert.equal(a.sync.outboxCount(), 0);
    });

    it('mudancas vindas do hub nao voltam para o hub (sem eco)', async () => {
        const {hub, a, b} = await pair();
        spend(a, 'Sem eco');
        await settle(a, b);
        const seq = hub.seq;
        await settle(a, b);
        assert.equal(hub.seq, seq, 'nenhuma gravacao nova no hub');
        assert.equal(b.sync.outboxCount(), 0);
    });

    it('filho que chega antes do pai espera e entra quando o pai chega', async () => {
        const hub = new MemoryHub();
        const b = await new Device(hub).engine();
        const send = async (table, uuid, payload, at) => hub.push('default', 'outro', [
            {table, uuid, updatedAt: at, deleted: false, payload: await b.sync.crypto.encrypt(JSON.stringify(payload))}]);
        // 1) subcategoria que cita uma categoria que ainda nao existe
        await send('categories', 'zzz-filha', {name: 'Filha', icon: null, color: null, kind: 'EXPENSE', parent_uuid: 'zzz-mae'}, T0 + 10);
        await b.sync.pull();
        assert.equal(b.sync.pendingCount(), 1);
        assert.ok(!b.names('categories').includes('Filha'));
        // 2) a mae chega
        await send('categories', 'zzz-mae', {name: 'Mae', icon: null, color: null, kind: 'EXPENSE', parent_uuid: null}, T0 + 20);
        await b.sync.pull();
        assert.equal(b.sync.pendingCount(), 0);
        const child = b.db.get("select c.name, p.name as parent from categories c join categories p on p.id = c.parent_id where c.name = 'Filha'");
        assert.equal(child.parent, 'Mae');
    });

    it('depois de restaurar um backup, a sincronizacao completa reenvia tudo', async () => {
        const {a, b} = await pair();
        spend(a, 'Antigo');
        await settle(a, b);
        a.sync.fullResync();
        assert.ok(a.sync.outboxCount() > 0);
        await settle(a, b);
        assert.equal(b.expenses().filter(e => e.name === 'Antigo').length, 1);
    });
});

describe('anexos grandes', () => {
    const png = bytes => {
        const buffer = Buffer.alloc(bytes);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
        return buffer.toString('base64');
    };

    it('anexos de ate 3 MB sincronizam; os maiores ficam so no aparelho, e a tela avisa', async () => {
        const {a, b} = await pair();
        const e = spend(a, 'Com anexos');
        a.call('POST', `/expenses/${e.id}/attachments`, {fileName: 'pequeno.png', data: png(1024)});
        a.call('POST', `/expenses/${e.id}/attachments`, {fileName: 'medio.png', data: png(2 * 1024 * 1024)});
        a.call('POST', `/expenses/${e.id}/attachments`, {fileName: 'grande.png', data: png(3 * 1024 * 1024 + 1)});
        await settle(a, b);

        assert.deepEqual(b.db.all('select file_name from attachments order by file_name').map(r => r.file_name), ['medio.png', 'pequeno.png']);
        assert.equal(b.db.value("select count(*) from attachments where file_name = 'medio.png' and size_bytes = ?", [2 * 1024 * 1024]), 1);
        assert.equal(a.db.value('select count(*) from attachments'), 3, 'o grande continua aqui');
        assert.equal(a.sync.outboxCount(), 0, 'e nao fica preso na caixa de saida');
        assert.equal(MAX_SYNC_ATTACHMENT_BYTES, 3 * 1024 * 1024);
    });

    it('envia em lotes por tamanho: varios anexos grandes nao viram um envio gigante', async () => {
        const {hub, a, b} = await pair();
        const e = spend(a, 'Varios');
        for (let i = 0; i < 5; i++) a.call('POST', `/expenses/${e.id}/attachments`, {fileName: `f${i}.png`, data: png(2 * 1024 * 1024 + i)});
        const sizes = [];
        const push = hub.push.bind(hub);
        hub.push = async (profile, device, changes) => { sizes.push(changes.reduce((n, c) => n + (c.payload?.length ?? 0), 0)); return push(profile, device, changes); };
        await settle(a, b);

        assert.equal(b.db.value('select count(*) from attachments'), 5);
        assert.ok(Math.max(...sizes) < 4 * 1024 * 1024 + 4 * 1024 * 1024, 'nenhum envio passa muito de 4 MB');
        assert.ok(sizes.filter(n => n > 0).length > 2, 'foram varios envios');
    });
});

describe('orcamentos', () => {
    const catId = (d, name) => d.db.value('select id from categories where name = ?', [name]);
    const budgets = d => d.db.all('select b.uuid, b.from_month, b.amount_cents, c.name as category from budgets b left join categories c on c.id = b.category_id order by b.from_month, c.name');

    it('o mesmo orcamento (categoria e mes) criado nos dois aparelhos vira um so, e vale o mais recente', async () => {
        const {a, b} = await pair();
        a.at(T0 + 1000);
        a.call('PUT', `/budgets/${catId(a, 'Mercado')}?month=2026-05`, {amount: 100});
        b.at(T0 + 9000); // mais recente
        b.call('PUT', `/budgets/${catId(b, 'Mercado')}?month=2026-05`, {amount: 200});
        await settle(a, b);

        for (const d of [a, b]) {
            const rows = budgets(d).filter(r => r.category === 'Mercado');
            assert.equal(rows.length, 1, 'uma linha so em cada aparelho');
            assert.equal(rows[0].amount_cents, 20000);
        }
        assert.equal(budgets(a)[0].uuid, budgets(b)[0].uuid, 'com o mesmo uuid');
    });

    it('o limite geral do mes (sem categoria) tambem casa, e meses diferentes continuam separados', async () => {
        const {a, b} = await pair();
        a.at(T0 + 1000);
        a.call('PUT', '/budgets/total?month=2026-05', {amount: 3000});
        a.call('PUT', `/budgets/${catId(a, 'Lazer')}?month=2026-06`, {amount: 50});
        b.at(T0 + 9000);
        b.call('PUT', '/budgets/total?month=2026-05', {amount: 3500});
        await settle(a, b);

        for (const d of [a, b]) {
            const rows = budgets(d);
            assert.equal(rows.filter(r => r.category == null && r.from_month === '2026-05').length, 1);
            assert.equal(rows.find(r => r.category == null).amount_cents, 350000);
            assert.equal(rows.find(r => r.category === 'Lazer').from_month, '2026-06');
            assert.equal(rows.length, 2);
        }
    });

    it('remover o orcamento (voltar a "sem orcamento") e o limite sem valor chegam no outro aparelho', async () => {
        const {a, b} = await pair();
        a.at(T0 + 1000);
        a.call('PUT', `/budgets/${catId(a, 'Mercado')}?month=2026-05`, {amount: 100});
        await settle(a, b);
        assert.equal(budgets(b).length, 1);

        a.at(T0 + 5000);
        a.call('DELETE', `/budgets/${catId(a, 'Mercado')}?month=2026-05`);
        await settle(a, b);
        assert.equal(budgets(a).length, budgets(b).length);
        assert.deepEqual(a.call('GET', '/budgets?month=2026-05').find(e => e.categoryName === 'Mercado')?.amount ?? null,
            b.call('GET', '/budgets?month=2026-05').find(e => e.categoryName === 'Mercado')?.amount ?? null);
    });
});

describe('cliente do Supabase', () => {
    it('entra, envia e busca com os cabecalhos e o corpo esperados', async () => {
        const calls = [];
        const respond = (body, status = 200) => ({ok: status < 300, status, text: async () => JSON.stringify(body)});
        const fetchImpl = async (url, init) => {
            calls.push({url, init});
            if (url.includes('/auth/v1/token')) return respond({access_token: 'tok', refresh_token: 'ref', expires_in: 3600});
            if (url.includes('rpc/push_changes')) return respond(2);
            if (url.includes('/rest/v1/changes')) return respond([{seq: 7, table_name: 'tags', row_uuid: 'u1', updated_at: 5, deleted: false, payload: 'v1.x.y', device_id: 'd'}]);
            if (url.includes('/rest/v1/vault')) return respond([]);
            return respond({}, 404);
        };
        const hub = new SupabaseHub({url: 'https://x.supabase.co/', anonKey: 'anon', fetchImpl});
        await hub.signIn('a@b.c', 'pw');
        assert.equal(hub.signedIn(), true);
        assert.equal(await hub.getVault(), null);
        assert.deepEqual(await hub.push('default', 'dev', [{table: 'tags', uuid: 'u1', updatedAt: 5, deleted: false, payload: 'v1.x.y'}]), {accepted: 2});
        const pulled = await hub.pull('default', 3, 200);
        assert.deepEqual(pulled, [{seq: 7, table: 'tags', uuid: 'u1', updatedAt: 5, deleted: false, payload: 'v1.x.y', deviceId: 'd'}]);

        const push = calls.find(c => c.url.includes('rpc/push_changes'));
        assert.equal(push.init.headers.Authorization, 'Bearer tok');
        assert.equal(push.init.headers.apikey, 'anon');
        assert.equal(JSON.parse(push.init.body).p_changes[0].row_uuid, 'u1');
        assert.match(calls.at(-1).url, /profile_id=eq\.default&seq=gt\.3&order=seq\.asc&limit=200/);
    });

    it('renova a sessao perto de vencer e mostra o erro do servidor', async () => {
        let now = 0;
        let tokens = 0;
        const fetchImpl = async url => {
            if (url.includes('/auth/v1/token')) { tokens++; return {ok: true, status: 200, text: async () => JSON.stringify({access_token: `t${tokens}`, refresh_token: 'r', expires_in: 100})}; }
            return {ok: false, status: 401, text: async () => JSON.stringify({message: 'JWT expired'})};
        };
        const hub = new SupabaseHub({url: 'https://x', anonKey: 'k', fetchImpl, now: () => now});
        await hub.signIn('a', 'b');
        now = 50000; // faltam 50 s: renova
        await assert.rejects(() => hub.getVault(), /JWT expired/);
        assert.equal(tokens, 2);
    });
});
