import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {MAIN, MAX_PROFILES, Profiles} from '../src/profiles.js';

const SQL = await initSqlJs();
let n = 0;
let files; // id -> bytes do banco, como o IndexedDB
let meta;
let deleted;
let wiped;
let opened;

const storage = {
    readMeta: async () => (meta ? structuredClone(meta) : null),
    writeMeta: async value => { meta = structuredClone(value); },
    deleteProfile: async id => { deleted.push(id); delete files[id]; },
    deleteAll: async () => { wiped++; files = {}; meta = null; }
};

async function openRuntime(id, languageStore) {
    opened.push(id);
    let pending = null;
    const api = createApi(files[id] ? new SQL.Database(files[id]) : new SQL.Database(), {
        languageStore, clock: () => new Date(2026, 4, 15, 12), newId: () => `p-${++n}`,
        persist: exportFn => { pending = exportFn; }
    });
    return {
        id, api,
        flush: async () => { if (pending) { files[id] = pending(); pending = null; } },
        close() { if (pending) { files[id] = pending(); pending = null; } api.db.close(); }
    };
}

let profiles;
const fresh = async () => new Profiles({storage, openRuntime, newId: () => `abc${String(++n).padStart(5, '0')}`}).init();
const call = (method, path, body) => profiles.handle(method, path, body);
const ok = async (method, path, body) => {
    const res = await call(method, path, body);
    assert.equal(res.status, 200, JSON.stringify(res));
    return res.body;
};
const api = () => profiles.runtime.api;
const ask = (method, url, body) => {
    const res = api().handle(method, url, body);
    assert.ok(res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const rejects = (promise, status, message) => assert.rejects(promise, e => e.status === status && (message === undefined || e.message === message));

beforeEach(async () => {
    files = {};
    meta = null;
    deleted = [];
    wiped = 0;
    opened = [];
    profiles = await fresh();
});

describe('perfil principal', () => {
    it('comeca com so o principal', async () => {
        assert.deepEqual(await ok('GET', '/profiles'), {profiles: [{id: MAIN, name: 'Principal'}], current: MAIN, language: 'pt', canCreate: true});
        assert.equal(ask('GET', '/accounts').length, 1);
    });

    it('so responde as proprias rotas', async () => {
        assert.equal(await call('GET', '/expenses'), null);
        assert.equal(await call('GET', '/profilesx'), null);
        await rejects(call('PATCH', '/profiles'), 405);
        await rejects(call('GET', '/app/language'), 405);
    });
});

describe('criar', () => {
    it('perfil novo comeca vazio, com os dados padrao, e ja e o perfil em uso', async () => {
        const snap = await ok('POST', '/profiles', {name: '  Maria   Silva '});
        assert.deepEqual(snap.profiles.map(p => p.name), ['Principal', 'Maria Silva']);
        assert.equal(snap.current, snap.profiles[1].id);
        assert.match(snap.current, /^abc\d{5}$/);
        assert.deepEqual([ask('GET', '/categories').length, ask('GET', '/accounts').length, ask('GET', '/payment-methods').length, ask('GET', '/expenses').length], [11, 1, 6, 0]);
    });

    it('os dados de cada perfil sao separados', async () => {
        ask('POST', '/expenses', {name: 'Do principal', amount: 10, date: '2026-05-01'});
        await ok('POST', '/profiles', {name: 'Maria'});
        assert.equal(ask('GET', '/expenses').length, 0);
        ask('POST', '/expenses', {name: 'Da Maria', amount: 20, date: '2026-05-02'});
        ask('POST', '/accounts', {name: 'Conta da Maria', type: 'WALLET'});

        await ok('POST', `/profiles/${MAIN}/switch`);
        assert.deepEqual(ask('GET', '/expenses').map(e => e.name), ['Do principal']);
        assert.deepEqual(ask('GET', '/accounts').map(a => a.name), ['Conta principal']);
    });

    it('guarda a lista e o perfil em uso: reabrir o app volta para ele, com os dados', async () => {
        await ok('POST', '/profiles', {name: 'Maria'});
        ask('POST', '/expenses', {name: 'Da Maria', amount: 20, date: '2026-05-02'});
        await profiles.runtime.flush();
        const maria = profiles.current;

        profiles = await fresh(); // fechou e abriu o app
        assert.equal(profiles.current, maria);
        assert.deepEqual(ask('GET', '/expenses').map(e => e.name), ['Da Maria']);
        assert.deepEqual(profiles.list().map(p => p.name), ['Principal', 'Maria']);
    });

    it('valida o nome, nao repete nome e tem limite', async () => {
        await rejects(call('POST', '/profiles', {name: '   '}), 400, 'Dê um nome ao perfil.');
        await rejects(call('POST', '/profiles', {}), 400, 'Dê um nome ao perfil.');
        await rejects(call('POST', '/profiles', {name: 'x'.repeat(41)}), 400, 'O nome pode ter no máximo 40 caracteres.');
        await rejects(call('POST', '/profiles', {name: 'principal'}), 409, 'Já existe um perfil com esse nome.');
        await ok('POST', '/profiles', {name: 'Maria'});
        await rejects(call('POST', '/profiles', {name: 'MARIA'}), 409);
        for (let i = 2; i < MAX_PROFILES; i++) await ok('POST', '/profiles', {name: `Pessoa ${i}`});
        assert.equal(profiles.list().length, MAX_PROFILES);
        await rejects(call('POST', '/profiles', {name: 'Demais'}), 400, `Limite de ${MAX_PROFILES} perfis atingido.`);
        assert.equal(profiles.list().length, MAX_PROFILES);
    });
});

describe('trocar, renomear e remover', () => {
    let maria;
    beforeEach(async () => {
        maria = (await ok('POST', '/profiles', {name: 'Maria'})).current;
    });

    it('trocar grava o que estava pendente no perfil que sai', async () => {
        ask('POST', '/expenses', {name: 'Pendente de gravar', amount: 5, date: '2026-05-03'});
        await ok('POST', `/profiles/${MAIN}/switch`);
        await ok('POST', `/profiles/${maria}/switch`);
        assert.deepEqual(ask('GET', '/expenses').map(e => e.name), ['Pendente de gravar']);
        await rejects(call('POST', '/profiles/naoexiste/switch'), 404, 'Perfil não encontrado.');
    });

    it('trocar para o perfil em uso nao reabre o banco', async () => {
        const before = opened.length;
        await ok('POST', `/profiles/${maria}/switch`);
        assert.equal(opened.length, before);
    });

    it('renomear (inclusive o principal), sem repetir nome', async () => {
        assert.equal((await ok('PUT', `/profiles/${maria}`, {name: ' Maria José '})).profiles[1].name, 'Maria José');
        assert.equal((await ok('PUT', `/profiles/${MAIN}`, {name: 'Eu'})).profiles[0].name, 'Eu');
        assert.equal((await ok('PUT', `/profiles/${maria}`, {name: 'MARIA JOSÉ'})).profiles[1].name, 'MARIA JOSÉ'); // o proprio nome, com outra caixa
        await rejects(call('PUT', `/profiles/${maria}`, {name: 'eu'}), 409);
        await rejects(call('PUT', '/profiles/naoexiste', {name: 'x'}), 404);
        await rejects(call('PUT', `/profiles/${maria}`, {name: ''}), 400);
    });

    it('remover o perfil em uso volta para o principal e apaga os dados dele', async () => {
        ask('POST', '/expenses', {name: 'Da Maria', amount: 20, date: '2026-05-02'});
        const snap = await ok('DELETE', `/profiles/${maria}`);
        assert.deepEqual([snap.current, snap.profiles.map(p => p.id)], [MAIN, [MAIN]]);
        assert.deepEqual(deleted, [maria]);
        assert.equal(files[maria], undefined);
        assert.equal(ask('GET', '/expenses').length, 0);
        profiles = await fresh();
        assert.equal(profiles.list().length, 1);
    });

    it('remover outro perfil nao troca o que esta em uso', async () => {
        await ok('POST', `/profiles/${MAIN}/switch`);
        const snap = await ok('DELETE', `/profiles/${maria}`);
        assert.equal(snap.current, MAIN);
        assert.deepEqual(deleted, [maria]);
    });

    it('o principal nao pode ser removido; perfil inexistente e 404', async () => {
        await rejects(call('DELETE', `/profiles/${MAIN}`), 400, 'O principal não pode ser removido.'.replace('O principal', 'O perfil principal'));
        await rejects(call('DELETE', '/profiles/naoexiste'), 404);
    });
});

describe('idioma do app', () => {
    it('vale para todos os perfis e fica guardado', async () => {
        const snap = await ok('PUT', '/app/language', {language: 'en'});
        assert.equal(snap.language, 'en');
        assert.equal(api().services.settings.language(), 'en');
        await ok('POST', '/profiles', {name: 'Maria'});
        assert.equal(api().services.settings.language(), 'en');
        assert.ok(ask('GET', '/categories').some(c => c.name === 'Food')); // o perfil novo ja nasce no idioma do app
        profiles = await fresh();
        assert.equal(profiles.meta.language, 'en');
    });

    it('idioma invalido e recusado', async () => {
        await rejects(call('PUT', '/app/language', {language: 'fr'}), 400, 'Idioma inválido.');
        assert.equal(profiles.meta.language, 'pt');
    });
});

describe('apagar tudo (esqueci a senha)', () => {
    it('apaga todos os perfis e recomeca com um principal vazio', async () => {
        ask('POST', '/expenses', {name: 'Do principal', amount: 10, date: '2026-05-01'});
        await ok('POST', '/profiles', {name: 'Maria'});
        await profiles.wipeAll();
        assert.equal(wiped, 1);
        assert.deepEqual(profiles.snapshot().profiles.map(p => p.id), [MAIN]);
        assert.equal(profiles.current, MAIN);
        assert.equal(ask('GET', '/expenses').length, 0);
        assert.equal(ask('GET', '/categories').length, 11);
        profiles = await fresh();
        assert.deepEqual(profiles.list().map(p => p.id), [MAIN]);
    });
});
