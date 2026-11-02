import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {closingDate, dueDate, invoiceMonthOf} from '../src/local-api/invoices.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;
let api;
let main;
let card;

const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const buy = (name, amount, date, extra = {}) => ok('POST', '/expenses', {name, amount, date, accountId: card.id, ...extra});
const balance = id => ok('GET', '/accounts').find(a => a.id === id).balance;

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `i-${++n}`}); // 15/05/2026
    main = ok('GET', '/accounts')[0];
    ok('PUT', `/accounts/${main.id}`, {...main, initialBalance: 2000});
    card = ok('POST', '/accounts', {name: 'Nubank', type: 'CREDIT_CARD', closingDay: 10, dueDay: 20});
});

describe('datas da fatura', () => {
    const c = (closing, due) => ({closing_day: closing, due_day: due});

    it('compra depois do fechamento cai na fatura seguinte', () => {
        assert.equal(invoiceMonthOf(c(10, 20), '2026-05-10'), '2026-05');
        assert.equal(invoiceMonthOf(c(10, 20), '2026-05-11'), '2026-06');
        assert.equal(invoiceMonthOf(c(10, 20), '2026-12-25'), '2027-01');
    });

    it('vencimento no mesmo mes ou no seguinte, e dia 31 ajustado ao mes', () => {
        assert.equal(dueDate(c(10, 20), '2026-05'), '2026-05-20');
        assert.equal(dueDate(c(25, 5), '2026-05'), '2026-06-05');
        assert.equal(dueDate(c(25, 5), '2026-12'), '2027-01-05');
        assert.equal(closingDate(c(31, 10), '2026-02'), '2026-02-28');
        assert.equal(closingDate(c(31, 10), '2026-04'), '2026-04-30');
    });
});

describe('faturas', () => {
    it('agrupa as compras por fatura, com periodo, vencimento e situacao', () => {
        buy('Mercado', 100, '2026-05-02');
        buy('Farmácia', 50.5, '2026-05-10');
        buy('Roupa', 200, '2026-05-11');
        const list = ok('GET', `/accounts/${card.id}/invoices`);
        assert.deepEqual(list.map(i => [i.month, i.total, i.status]), [['2026-06', 200, 'OPEN'], ['2026-05', 150.5, 'CLOSED']]);
        const may = ok('GET', `/accounts/${card.id}/invoices/2026-05`);
        assert.deepEqual([may.startDate, may.closingDate, may.dueDate], ['2026-04-11', '2026-05-10', '2026-05-20']);
        assert.deepEqual(may.items.map(i => i.name), ['Mercado', 'Farmácia']);
        assert.equal(list[0].items.length, 0); // a lista nao traz as compras
        assert.equal(list[0].remainingCents, undefined);
        assert.equal(balance(card.id), -350.5);
    });

    it('sempre mostra a fatura atual, mesmo vazia', () => {
        const list = ok('GET', `/accounts/${card.id}/invoices`);
        assert.deepEqual(list.map(i => [i.month, i.total, i.status]), [['2026-06', 0, 'OPEN']]);
    });

    it('estorno (receita no cartao) abate da fatura', () => {
        buy('Compra', 100, '2026-05-02');
        buy('Estorno', 30, '2026-05-03', {type: 'INCOME'});
        assert.equal(ok('GET', `/accounts/${card.id}/invoices/2026-05`).total, 70);
    });

    it('paga em partes e depois o resto, saindo de outra conta', () => {
        buy('Compra', 100, '2026-05-02');
        let inv = ok('POST', `/accounts/${card.id}/invoices/2026-05/pay`, {fromAccountId: main.id, amount: 40, date: '2026-05-12'});
        assert.deepEqual([inv.paid, inv.remaining, inv.status], [40, 60, 'CLOSED']);
        assert.equal(inv.payments[0].description, 'Fatura Nubank 05/2026');
        assert.equal(inv.payments[0].date, '2026-05-12');
        inv = ok('POST', `/accounts/${card.id}/invoices/2026-05/pay`, {fromAccountId: main.id});
        assert.deepEqual([inv.paid, inv.remaining, inv.status], [100, 0, 'PAID']);
        assert.equal(inv.payments[1].date, '2026-05-15'); // hoje, quando nao informa
        assert.equal(balance(card.id), 0);
        assert.equal(balance(main.id), 1900);
        assert.equal(call('POST', `/accounts/${card.id}/invoices/2026-05/pay`, {fromAccountId: main.id}).status, 409);
        // o pagamento tambem aparece como transferencia do mes
        assert.equal(ok('GET', '/transfers?month=2026-05').length, 2);
    });

    it('validacoes do pagamento', () => {
        buy('Compra', 100, '2026-05-02');
        const url = `/accounts/${card.id}/invoices/2026-05/pay`;
        assert.equal(call('POST', url, {}).body.errors.fromAccountId, 'Informe de qual conta sai o pagamento.');
        assert.equal(call('POST', url, {fromAccountId: main.id, amount: 0}).status, 400);
        assert.equal(call('POST', url, {fromAccountId: card.id}).status, 400); // origem = destino
        assert.equal(call('POST', `/accounts/${card.id}/invoices/maio/pay`, {fromAccountId: main.id}).status, 400);
        assert.equal(ok('GET', '/transfers?month=2026-05').length, 0);
    });

    it('so cartao com dias de fechamento e vencimento tem fatura', () => {
        assert.equal(call('GET', `/accounts/${main.id}/invoices`).status, 400);
        const bare = ok('POST', '/accounts', {name: 'Sem dias', type: 'CREDIT_CARD'});
        assert.equal(call('GET', `/accounts/${bare.id}/invoices`).status, 409);
        assert.equal(call('GET', '/accounts/999/invoices').status, 404);
    });

    it('transferencia de pagamento excluida deixa de contar', () => {
        buy('Compra', 100, '2026-05-02');
        const inv = ok('POST', `/accounts/${card.id}/invoices/2026-05/pay`, {fromAccountId: main.id});
        ok('DELETE', `/transfers/${inv.payments[0].id}`);
        assert.equal(ok('GET', `/accounts/${card.id}/invoices/2026-05`).remaining, 100);
    });
});

describe('"Por vir" com faturas', () => {
    it('mostra a fatura a pagar, sem duplicar a compra a pagar do cartao, e nao conta o cartao no saldo', () => {
        buy('Compra', 100, '2026-05-02');
        buy('Parcela a pagar', 40, '2026-05-25', {status: 'PENDING'});
        const u = ok('GET', '/api/upcoming?from=2026-05-15&to=2026-06-30');
        assert.equal(u.startBalance, 2000);
        assert.deepEqual(u.items.map(i => [i.kind, i.name, i.date, i.amount]), [
            ['INVOICE', 'Fatura Nubank 05/2026', '2026-05-20', 100],
            ['INVOICE', 'Fatura Nubank 06/2026', '2026-06-20', 40]
        ]);
        assert.equal(u.outgoing, 140);
        assert.equal(u.endBalance, 1860);
    });

    it('fatura paga some do "Por vir"; filtro por conta e cartao arquivado', () => {
        buy('Compra', 100, '2026-05-02');
        ok('POST', `/accounts/${card.id}/invoices/2026-05/pay`, {fromAccountId: main.id});
        assert.equal(ok('GET', '/api/upcoming').items.length, 0);
        buy('Outra', 10, '2026-05-12');
        const until = '&to=2026-06-30';
        assert.equal(ok('GET', `/api/upcoming?accountId=${main.id}${until}`).items.length, 0);
        assert.equal(ok('GET', `/api/upcoming?accountId=${card.id}${until}`).items.length, 1);
        ok('PUT', `/accounts/${card.id}`, {...card, archived: true});
        assert.equal(ok('GET', `/api/upcoming?from=2026-05-15${until}`).items.length, 0);
    });
});
