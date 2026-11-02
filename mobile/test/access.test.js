import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import {Access, MAX_LENGTH, MIN_LENGTH, MemorySession} from '../src/access.js';

let now;
let stored;
let session;
let resets;

const store = {get: async () => stored, set: async hash => { stored = hash; }, delete: async () => { stored = null; }};

/** Um "aparelho": usa o mesmo armazenamento de hash, com a sessao dada (reabrir o app = sessao nova). */
const open = async (sessionToUse = session) => new Access({
    store, session: sessionToUse, clock: () => now, iterations: 1000, onReset: async () => { resets++; }
}).init();

const status = access => access.status();
const rejects = (promise, code, message) => assert.rejects(promise, e => e.status === code && (message === undefined || message.test?.(e.message) || e.message === message), `esperava ${code}`);
const call = async (access, method, path, body) => (await access.handle(method, path, body)).body;

beforeEach(() => {
    now = 1_800_000_000_000;
    stored = null;
    session = new MemorySession();
    resets = 0;
});

describe('sem senha', () => {
    it('abre direto', async () => {
        const access = await open();
        assert.deepEqual(status(access), {passwordSet: false, unlocked: true, localOnly: true});
        assert.doesNotThrow(() => access.guard());
        assert.deepEqual(await call(access, 'GET', '/api/auth/status'), {passwordSet: false, unlocked: true, localOnly: true});
    });

    it('login sem senha definida e recusado', async () => {
        await rejects((await open()).login('qualquer'), 401, 'Senha incorreta.');
    });
});

describe('definir e usar a senha', () => {
    it('guarda so o hash, no formato do back-end Java, e ja deixa o app aberto', async () => {
        const access = await open();
        await access.change(null, 'segredo');
        assert.match(stored, /^pbkdf2\$1000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
        assert.ok(!stored.includes('segredo'));
        assert.deepEqual(status(access), {passwordSet: true, unlocked: true, localOnly: true});
    });

    it('o mesmo texto gera hashes diferentes (sal aleatorio)', async () => {
        const a = await open();
        await a.change(null, 'segredo');
        const first = stored;
        await a.change('segredo', 'segredo');
        assert.notEqual(stored, first);
    });

    it('reabrir o app pede a senha; sem entrar, nenhuma chamada de dados passa', async () => {
        await (await open()).change(null, 'segredo');
        const reopened = await open(new MemorySession());
        assert.deepEqual(status(reopened), {passwordSet: true, unlocked: false, localOnly: true});
        assert.throws(() => reopened.guard(), e => e.status === 401 && e.message === 'Entre com a senha.');
        await rejects(reopened.login('errada'), 401, 'Senha incorreta.');
        assert.equal(reopened.unlocked(), false);
        await reopened.login('segredo');
        assert.equal(reopened.unlocked(), true);
        assert.doesNotThrow(() => reopened.guard());
    });

    it('recarregar a pagina (mesma sessao) nao pede a senha; sair pede', async () => {
        const first = await open();
        await first.change(null, 'segredo');
        assert.equal((await open(session)).unlocked(), true);
        first.logout();
        assert.equal((await open(session)).unlocked(), false);
    });

    it('a sessao vale 30 dias', async () => {
        const access = await open();
        await access.change(null, 'segredo');
        now += 29 * 24 * 3600 * 1000;
        assert.equal(access.unlocked(), true);
        now += 2 * 24 * 3600 * 1000;
        assert.equal(access.unlocked(), false);
    });

    it('valida o tamanho da senha', async () => {
        const access = await open();
        await rejects(access.change(null, 'abc'), 400, `A senha deve ter entre ${MIN_LENGTH} e ${MAX_LENGTH} caracteres.`);
        await rejects(access.change(null, 'x'.repeat(MAX_LENGTH + 1)), 400);
        await access.change(null, 'x'.repeat(MAX_LENGTH));
        assert.equal(access.passwordSet(), true);
    });
});

describe('trocar e remover', () => {
    let access;
    beforeEach(async () => {
        access = await open();
        await access.change(null, 'segredo');
    });

    it('exige a senha atual', async () => {
        await rejects(access.change(null, 'nova1234'), 403, 'Senha atual incorreta.');
        await rejects(access.change('errada', 'nova1234'), 403, 'Senha atual incorreta.');
        await rejects(access.change('errada', ''), 403, 'Senha atual incorreta.');
        assert.equal(access.passwordSet(), true);
    });

    it('trocar fecha as outras sessoes e vale a senha nova', async () => {
        const other = await open(new MemorySession());
        await other.login('segredo');
        await access.change('segredo', 'nova1234');
        assert.equal(access.unlocked(), true); // quem trocou continua dentro
        const reopened = await open(new MemorySession());
        await rejects(reopened.login('segredo'), 401);
        await reopened.login('nova1234');
        // a sessao antiga de "other" nao vale mais com o hash novo
        assert.equal((await open(other.session)).unlocked(), false);
    });

    it('remover apaga o hash e abre direto', async () => {
        await access.change('segredo', '');
        assert.equal(stored, null);
        assert.deepEqual(status(access), {passwordSet: false, unlocked: true, localOnly: true});
        assert.equal((await open(new MemorySession())).unlocked(), true);
    });

    it('senha nova invalida nao muda nada', async () => {
        await rejects(access.change('segredo', 'abc'), 400);
        const reopened = await open(new MemorySession());
        await reopened.login('segredo');
    });
});

describe('tentativas erradas', () => {
    it('cinco erros pausam por 30 segundos, mesmo com a senha certa; depois volta', async () => {
        await (await open()).change(null, 'segredo');
        const access = await open(new MemorySession());
        for (let i = 0; i < 5; i++) await rejects(access.login('errada'), 401);
        await rejects(access.login('segredo'), 429, /^Muitas tentativas\. Espere 30 segundos\.$/);
        now += 10_000;
        await rejects(access.login('segredo'), 429, /Espere 20 segundos/);
        now += 20_001;
        await access.login('segredo');
        assert.equal(access.unlocked(), true);
    });

    it('acertar zera a contagem', async () => {
        await (await open()).change(null, 'segredo');
        const access = await open(new MemorySession());
        for (let i = 0; i < 4; i++) await rejects(access.login('errada'), 401);
        await access.login('segredo');
        access.logout();
        for (let i = 0; i < 4; i++) await rejects(access.login('errada'), 401);
        await access.login('segredo');
    });
});

describe('rotas /api/auth', () => {
    it('status, login, sair, trocar e esqueci a senha', async () => {
        const access = await open();
        assert.equal(await access.handle('GET', '/expenses'), null);
        assert.deepEqual(await call(access, 'PUT', '/api/auth/password', {current: null, password: 'segredo'}), {passwordSet: true, unlocked: true, localOnly: true});
        assert.deepEqual(await call(access, 'POST', '/api/auth/logout'), {passwordSet: true, unlocked: false, localOnly: true});
        await assert.rejects(access.handle('POST', '/api/auth/login', {password: 'x'}), e => e.status === 401);
        assert.equal((await call(access, 'POST', '/api/auth/login', {password: 'segredo'})).unlocked, true);
        await assert.rejects(access.handle('GET', '/api/auth/outra'), e => e.status === 404);

        await assert.rejects(access.handle('POST', '/api/auth/reset', {}), e => e.status === 400);
        assert.equal(resets, 0);
        assert.deepEqual(await call(access, 'POST', '/api/auth/reset', {confirm: true}), {passwordSet: false, unlocked: true, localOnly: true});
        assert.equal(resets, 1);
        assert.equal(stored, null);
    });
});
