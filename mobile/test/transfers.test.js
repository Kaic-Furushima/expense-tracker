import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;
let now;
let api;
let main;
let savings;

const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const transfer = (amount, date, extra = {}) => ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: savings.id, amount, date, ...extra});
const balance = id => ok('GET', '/accounts').find(a => a.id === id).balance;

beforeEach(() => {
    now = new Date(2026, 4, 15, 12, 0, 0);
    api = createApi(new SQL.Database(), {clock: () => now, newId: () => `t-${++n}`});
    main = ok('GET', '/accounts')[0];
    savings = ok('POST', '/accounts', {name: 'Reserva', type: 'SAVINGS', parentId: main.id});
    ok('PUT', `/accounts/${main.id}`, {...main, initialBalance: 1000});
});

describe('transferencias', () => {
    it('move saldo entre contas sem virar receita nem despesa', () => {
        const t = transfer(250.4, '2026-05-10', {description: '  Reserva do mês '});
        assert.deepEqual([t.amount, t.date, t.description, t.fromAccountName, t.toAccountName], [250.4, '2026-05-10', 'Reserva do mês', 'Conta principal', 'Reserva']);
        assert.equal(balance(main.id), 749.6);
        assert.equal(balance(savings.id), 250.4);
        const s = ok('GET', '/api/summary?month=2026-05');
        assert.equal(s.income, 0);
        assert.equal(s.expense, 0);
    });

    it('lista por mes e por conta, mais novas primeiro', () => {
        const other = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET'});
        const a = transfer(10, '2026-05-01');
        const b = transfer(20, '2026-05-20');
        ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: other.id, amount: 5, date: '2026-05-05'});
        transfer(99, '2026-04-30');
        assert.deepEqual(ok('GET', '/transfers?month=2026-05').map(t => t.amount), [20, 5, 10]);
        assert.deepEqual(ok('GET', `/transfers?month=2026-05&accountId=${savings.id}`).map(t => t.id), [b.id, a.id]);
        assert.equal(ok('GET', '/transfers').length, 3); // sem mes: o mes atual (maio de 2026)
        assert.equal(call('GET', '/transfers?month=maio').status, 400);
    });

    it('usa hoje quando a data nao e informada', () => {
        assert.equal(transfer(5, undefined).date, '2026-05-15');
    });

    it('valida origem, destino, valor e data', () => {
        const res = call('POST', '/transfers', {amount: 0});
        assert.equal(res.status, 400);
        assert.equal(res.body.errors.fromAccountId, 'Informe a conta de origem.');
        assert.equal(res.body.errors.toAccountId, 'Informe a conta de destino.');
        assert.equal(res.body.errors.amount, 'O valor deve ser de pelo menos 0,01.');
        assert.equal(call('POST', '/transfers', {fromAccountId: main.id, toAccountId: main.id, amount: 1}).status, 400);
        assert.equal(call('POST', '/transfers', {fromAccountId: main.id, toAccountId: 999, amount: 1}).status, 404);
        assert.equal(call('POST', '/transfers', {fromAccountId: main.id, toAccountId: savings.id, amount: 1, date: '1999-01-01'}).status, 400);
    });

    it('conta arquivada nao recebe transferencia nova, mas a antiga continua valendo', () => {
        const t = transfer(10, '2026-05-01');
        ok('PUT', `/accounts/${savings.id}`, {...savings, archived: true});
        assert.equal(call('POST', '/transfers', {fromAccountId: main.id, toAccountId: savings.id, amount: 1}).status, 409);
        assert.equal(ok('PUT', `/transfers/${t.id}`, {fromAccountId: main.id, toAccountId: savings.id, amount: 15, date: '2026-05-01'}).amount, 15);
    });

    it('edita e exclui (vai para a lixeira)', () => {
        const t = transfer(100, '2026-05-01');
        const up = ok('PUT', `/transfers/${t.id}`, {fromAccountId: savings.id, toAccountId: main.id, amount: 30, date: '2026-05-02', description: 'Voltou'});
        assert.equal(up.fromAccountName, 'Reserva');
        assert.equal(balance(main.id), 1030);
        assert.equal(call('DELETE', `/transfers/${t.id}`).status, 204);
        assert.equal(ok('GET', '/transfers?month=2026-05').length, 0);
        assert.equal(balance(main.id), 1000);
        assert.equal(call('DELETE', `/transfers/${t.id}`).status, 404);
        assert.equal(call('PUT', `/transfers/${t.id}`, {}).status, 404);
    });

    it('conta com transferencia nao pode ser excluida (nem se estiver na lixeira)', () => {
        const t = transfer(1, '2026-05-01');
        ok('DELETE', `/transfers/${t.id}`);
        assert.equal(call('DELETE', `/accounts/${savings.id}`).status, 409);
    });
});

describe('lixeira', () => {
    const spend = (name, amount, extra = {}) => ok('POST', '/expenses', {name, amount, date: '2026-05-01', ...extra});

    it('lista lancamentos e transferencias excluidos, o mais recente primeiro', () => {
        const e = spend('Almoço', 30, {categoryId: ok('GET', '/categories')[0].id});
        const t = transfer(50, '2026-05-02');
        ok('DELETE', `/expenses/${e.id}`);
        now = new Date(2026, 4, 15, 13, 0, 0);
        ok('DELETE', `/transfers/${t.id}`);
        const items = ok('GET', '/trash');
        assert.deepEqual(items.map(i => [i.kind, i.title, i.amount, i.detail]),
            [['TRANSFER', 'Transferência', 50, 'Conta principal → Reserva'], ['EXPENSE', 'Almoço', 30, 'Conta principal · Alimentação']]);
    });

    it('restaura (desfazer) e o saldo volta', () => {
        const e = spend('Almoço', 30);
        const t = transfer(50, '2026-05-02');
        ok('DELETE', `/expenses/${e.id}`);
        ok('DELETE', `/transfers/${t.id}`);
        assert.equal(balance(main.id), 1000);
        ok('POST', `/trash/EXPENSE/${e.id}/restore`);
        ok('POST', `/trash/TRANSFER/${t.id}/restore`);
        assert.equal(balance(main.id), 920);
        assert.equal(ok('GET', '/trash').length, 0);
        assert.equal(ok('GET', `/expenses/${e.id}`).name, 'Almoço');
        assert.equal(call('POST', `/trash/EXPENSE/${e.id}/restore`).status, 404);
        assert.equal(call('POST', '/trash/OUTRO/1/restore').status, 404);
    });

    it('apaga um item de vez, com etiquetas e anexos, ou esvazia tudo', () => {
        const e = spend('Com tag', 5, {tags: ['x']});
        api.db.run(`insert into attachments (uuid, expense_id, file_name, content_type, size_bytes, data, created_at, updated_at)
                    values ('a', ?, 'n.png', 'image/png', 1, 'AA==', 'x', 'x')`, [e.id]);
        const other = spend('Outro', 6);
        const t = transfer(7, '2026-05-02');
        ok('DELETE', `/expenses/${e.id}`);
        ok('DELETE', `/expenses/${other.id}`);
        ok('DELETE', `/transfers/${t.id}`);
        assert.equal(call('DELETE', `/trash/EXPENSE/${e.id}`).status, 204);
        assert.equal(api.db.value('select count(*) from attachments'), 0);
        assert.equal(api.db.value('select count(*) from expense_tags'), 0);
        assert.equal(ok('GET', '/trash').length, 2);
        assert.equal(call('DELETE', '/trash').status, 204);
        assert.equal(ok('GET', '/trash').length, 0);
        assert.equal(api.db.value('select count(*) from expenses'), 0);
        assert.equal(api.db.value('select count(*) from transfers'), 0);
    });

    it('itens com mais de 30 dias saem sozinhos ao abrir o app', () => {
        const old = spend('Velho', 1);
        const recent = spend('Recente', 2);
        ok('DELETE', `/expenses/${old.id}`);
        now = new Date(2026, 5, 20, 12, 0, 0); // 36 dias depois
        ok('DELETE', `/expenses/${recent.id}`);
        api.services.trash.purgeExpired();
        assert.deepEqual(ok('GET', '/trash').map(i => i.title), ['Recente']);
    });

    it('limpar tudo leva lancamentos e transferencias para uma copia completa na lixeira', () => {
        transfer(5, '2026-05-02');
        spend('A', 1);
        ok('DELETE', '/api/data');
        assert.equal(ok('GET', '/transfers?month=2026-05').length, 0);
        assert.deepEqual(ok('GET', '/trash').map(i => i.kind), ['EVERYTHING']);
    });
});
