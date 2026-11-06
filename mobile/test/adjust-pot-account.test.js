import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;
let api;
let main;

const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const balanceOf = id => ok('GET', '/accounts').find(a => a.id === id).balance;

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `a-${++n}`}); // 15/05/2026
    main = ok('GET', '/accounts')[0];
});

describe('correcao de saldo', () => {
    it('leva o saldo ao valor informado, mas nao conta como receita nem despesa', () => {
        const before = balanceOf(main.id);
        const up = ok('POST', `/accounts/${main.id}/adjust-balance`, {balance: before + 250.5});
        assert.equal(up.balance, before + 250.5);
        const down = ok('POST', `/accounts/${main.id}/adjust-balance`, {balance: before + 200});
        assert.equal(down.balance, before + 200);

        const entries = ok('GET', '/expenses').filter(e => e.adjustment);
        assert.deepEqual(entries.map(e => [e.name, e.type, e.amount, e.status]).sort(),
            [['Correção de saldo', 'EXPENSE', 50.5, 'PAID'], ['Correção de saldo', 'INCOME', 250.5, 'PAID']]);

        const summary = ok('GET', `/api/summary?month=2026-05&accountId=${main.id}`);
        assert.equal(summary.income, 0);
        assert.equal(summary.expense, 0);
        assert.equal(summary.adjustment, 200);
        assert.equal(summary.balance, 200);
        assert.deepEqual(summary.categories, []);
        assert.equal(summary.trend.at(-1).income, 0);
    });

    it('nao faz nada se o saldo ja for esse, recusa saldo vazio e cartao', () => {
        const same = ok('POST', `/accounts/${main.id}/adjust-balance`, {balance: balanceOf(main.id)});
        assert.equal(same.balance, balanceOf(main.id));
        assert.equal(ok('GET', '/expenses').length, 0);
        assert.equal(call('POST', `/accounts/${main.id}/adjust-balance`, {}).status, 400);
        const card = ok('POST', '/accounts', {name: 'Cartão', type: 'CREDIT_CARD', closingDay: 5, dueDay: 12});
        assert.equal(call('POST', `/accounts/${card.id}/adjust-balance`, {balance: 10}).status, 400);
    });

    it('um lancamento comum continua contando normalmente ao lado da correcao', () => {
        ok('POST', '/expenses', {name: 'Mercado', amount: 80, date: '2026-05-10', accountId: main.id});
        ok('POST', `/accounts/${main.id}/adjust-balance`, {balance: 1000});
        const summary = ok('GET', '/api/summary?month=2026-05');
        assert.equal(summary.expense, 80);
        assert.equal(summary.adjustment, 1000 - (0 - 80));
        assert.equal(summary.balance, 1000);
    });
});

describe('caixinha atrelada a uma conta', () => {
    it('guarda e devolve a conta; trocar e desatrelar funcionam', () => {
        const p = ok('POST', '/pots', {name: 'Reserva', accountId: main.id});
        assert.deepEqual([p.accountId, p.accountName], [main.id, main.name]);
        const other = ok('POST', '/accounts', {name: 'Outro banco', type: 'CHECKING'});
        assert.equal(ok('PUT', `/pots/${p.id}`, {name: 'Reserva', accountId: other.id}).accountName, 'Outro banco');
        const loose = ok('PUT', `/pots/${p.id}`, {name: 'Reserva'});
        assert.deepEqual([loose.accountId, loose.accountName], [null, null]);
        assert.equal(call('POST', '/pots', {name: 'X', accountId: 9999}).status, 400);
    });

    it('excluir a conta so desfaz o vinculo da caixinha', () => {
        const other = ok('POST', '/accounts', {name: 'Banco temporario', type: 'CHECKING'});
        const p = ok('POST', '/pots', {name: 'Reserva', accountId: other.id});
        assert.equal(call('DELETE', `/accounts/${other.id}`).status, 204);
        assert.equal(ok('GET', '/pots').find(x => x.id === p.id).accountId, null);
    });
});

describe('compra parcelada da lista de desejos', () => {
    it('divide o total, a primeira fica paga e as outras a pagar', () => {
        const item = ok('POST', '/wishes', {name: 'Notebook', estimatedPrice: 3000});
        const bought = ok('POST', `/wishes/${item.id}/buy`, {price: 1000, date: '2026-05-03', accountId: main.id, installments: 3});
        assert.equal(bought.status, 'BOUGHT');
        assert.equal(bought.realPrice, 1000);
        const list = ok('GET', '/expenses').filter(e => e.name === 'Notebook').sort((a, b) => a.installmentNumber - b.installmentNumber);
        assert.deepEqual(list.map(e => [e.installmentNumber, e.installmentTotal, e.amount, e.status, e.date]), [
            [1, 3, 333.34, 'PAID', '2026-05-03'], [2, 3, 333.33, 'PENDING', '2026-06-03'], [3, 3, 333.33, 'PENDING', '2026-07-03']]);
        assert.equal(bought.expenseId, list[0].id);
    });

    it('a vista continua igual e parcelas invalidas sao recusadas', () => {
        const item = ok('POST', '/wishes', {name: 'Fone', estimatedPrice: 300});
        assert.equal(call('POST', `/wishes/${item.id}/buy`, {price: 300, accountId: main.id, installments: 0}).status, 400);
        assert.equal(call('POST', `/wishes/${item.id}/buy`, {price: 300, accountId: main.id, installments: 61}).status, 400);
        ok('POST', `/wishes/${item.id}/buy`, {price: 300, date: '2026-05-03', accountId: main.id});
        assert.equal(ok('GET', '/expenses').filter(e => e.name === 'Fone').length, 1);
    });
});
