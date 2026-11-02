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
const pot = (extra = {}) => ok('POST', '/pots', {name: 'Viagem', ...extra});
const wish = (extra = {}) => ok('POST', '/wishes', {name: 'Notebook', estimatedPrice: 4000, ...extra});
const balance = id => ok('GET', '/pots').find(p => p.id === id).balance;

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `p-${++n}`}); // 15/05/2026
    main = ok('GET', '/accounts')[0];
});

describe('caixinhas', () => {
    it('cria uma variavel com padroes e saldo zero', () => {
        const p = pot({goal: 5000});
        assert.deepEqual([p.name, p.mode, p.goal, p.monthlyAmount, p.color, p.active, p.balance, p.startMonth],
            ['Viagem', 'VARIABLE', 5000, null, '#81C784', true, 0, '2026-05']);
    });

    it('a fixa recebe o aporte de cada mes desde o inicio, uma vez so', () => {
        const p = pot({mode: 'FIXED', monthlyAmount: 200, startMonth: '2026-03'});
        assert.equal(p.balance, 600); // marco, abril e maio
        assert.equal(balance(p.id), 600);
        const entries = ok('GET', `/pots/${p.id}/entries`);
        assert.deepEqual(entries.map(e => [e.date, e.kind, e.amount, e.note]), [
            ['2026-05-01', 'AUTO', 200, 'Aporte mensal'], ['2026-04-01', 'AUTO', 200, 'Aporte mensal'], ['2026-03-01', 'AUTO', 200, 'Aporte mensal']]);
    });

    it('inativa nao recebe aporte; editar o valor vale para os meses sem aporte; inicio nao muda', () => {
        const p = pot({mode: 'FIXED', monthlyAmount: 100});
        assert.equal(p.balance, 100);
        const up = ok('PUT', `/pots/${p.id}`, {name: 'Viagem', mode: 'FIXED', monthlyAmount: 300, startMonth: '2025-01'});
        assert.deepEqual([up.startMonth, up.balance, up.monthlyAmount], ['2026-05', 100, 300]);
        const off = ok('POST', '/pots', {name: 'Parada', mode: 'FIXED', monthlyAmount: 50, active: false});
        assert.equal(off.balance, 0);
    });

    it('depositar e retirar; nao retira mais do que tem', () => {
        const p = pot();
        const d = ok('POST', `/pots/${p.id}/deposit`, {amount: 500, date: '2026-05-02', note: ' Salário '});
        assert.deepEqual([d.kind, d.amount, d.note, d.date], ['MANUAL', 500, 'Salário', '2026-05-02']);
        const w = ok('POST', `/pots/${p.id}/withdraw`, {amount: 120.5});
        assert.deepEqual([w.kind, w.amount, w.date], ['WITHDRAWAL', -120.5, '2026-05-15']);
        assert.equal(balance(p.id), 379.5);
        assert.equal(call('POST', `/pots/${p.id}/withdraw`, {amount: 1000}).body.detail, 'Saldo da caixinha insuficiente.');
        assert.equal(call('POST', `/pots/${p.id}/deposit`, {amount: 0}).status, 400);
        assert.equal(call('POST', `/pots/${p.id}/deposit`, {}).body.errors.amount, 'Informe o valor.');
        assert.equal(call('POST', '/pots/99/deposit', {amount: 1}).status, 404);
    });

    it('so movimentos manuais podem ser removidos', () => {
        const p = pot({mode: 'FIXED', monthlyAmount: 100});
        const manual = ok('POST', `/pots/${p.id}/deposit`, {amount: 50});
        const auto = ok('GET', `/pots/${p.id}/entries`).find(e => e.kind === 'AUTO');
        assert.equal(call('DELETE', `/pots/entries/${auto.id}`).status, 409);
        assert.equal(call('DELETE', `/pots/entries/${manual.id}`).status, 204);
        assert.equal(call('DELETE', `/pots/entries/${manual.id}`).status, 404);
        assert.equal(balance(p.id), 100);
    });

    it('valida nome repetido, aporte da fixa, meta e mes', () => {
        pot();
        assert.equal(call('POST', '/pots', {name: 'viagem'}).status, 409);
        assert.equal(call('POST', '/pots', {name: ' '}).body.errors.name, 'Informe o nome da caixinha.');
        assert.equal(call('POST', '/pots', {name: 'A', mode: 'FIXED'}).body.detail, 'Informe o valor do aporte mensal.');
        assert.equal(call('POST', '/pots', {name: 'B', goal: 0}).status, 400);
        assert.equal(call('POST', '/pots', {name: 'C', startMonth: '05/2026'}).status, 400);
        const other = pot({name: 'Outra'});
        assert.equal(call('PUT', `/pots/${other.id}`, {name: 'VIAGEM'}).status, 409);
        assert.equal(call('PUT', `/pots/${other.id}`, {name: 'OUTRA'}).status, 200); // o proprio nome, com outra caixa
    });

    it('excluir apaga o historico e solta os desejos', () => {
        const p = pot();
        ok('POST', `/pots/${p.id}/deposit`, {amount: 10});
        const w = wish({potId: p.id});
        assert.equal(w.potName, 'Viagem');
        assert.equal(call('DELETE', `/pots/${p.id}`).status, 204);
        assert.equal(ok('GET', '/pots').length, 0);
        assert.equal(api.db.value('select count(*) from pot_entries'), 0);
        assert.equal(ok('GET', '/wishes')[0].potId, null);
        assert.equal(call('DELETE', `/pots/${p.id}`).status, 404);
    });
});

describe('lista de desejos', () => {
    it('cria, edita e lista do mais novo para o mais antigo', () => {
        const a = wish({name: ' Fone ', estimatedPrice: 300, notes: ' bluetooth ', url: 'https://loja.example/fone'});
        assert.deepEqual([a.name, a.estimatedPrice, a.notes, a.status, a.createdAt, a.realPrice], ['Fone', 300, 'bluetooth', 'WISHED', '2026-05-15', null]);
        const b = wish({name: 'Mochila', estimatedPrice: undefined});
        assert.equal(b.estimatedPrice, null);
        assert.deepEqual(ok('GET', '/wishes').map(w => w.name), ['Mochila', 'Fone']);
        assert.equal(ok('PUT', `/wishes/${a.id}`, {name: 'Fone BT', estimatedPrice: 250}).name, 'Fone BT');
    });

    it('valida nome, preco, link e caixinha', () => {
        assert.equal(call('POST', '/wishes', {name: ' '}).body.errors.name, 'Informe o nome do produto.');
        assert.equal(call('POST', '/wishes', {name: 'x', estimatedPrice: 0}).status, 400);
        assert.equal(call('POST', '/wishes', {name: 'x', url: 'a'.repeat(501)}).status, 400);
        assert.equal(call('POST', '/wishes', {name: 'x', potId: 99}).status, 404);
        assert.equal(call('PUT', '/wishes/99', {name: 'x'}).status, 404);
    });

    it('descartar e voltar para a lista', () => {
        const w = wish();
        assert.equal(ok('POST', `/wishes/${w.id}/discard`).status, 'DISCARDED');
        assert.equal(call('POST', `/wishes/${w.id}/discard`).status, 200);
        assert.equal(ok('POST', `/wishes/${w.id}/restore`).status, 'WISHED');
        assert.equal(call('POST', `/wishes/${w.id}/restore`).status, 409);
    });

    it('comprar cria a despesa com os dados do item', () => {
        const cat = ok('GET', '/categories')[0];
        const pix = ok('GET', '/payment-methods').find(m => m.name === 'Pix');
        const w = wish({notes: 'garantia 1 ano'});
        const bought = ok('POST', `/wishes/${w.id}/buy`, {price: 3800.9, date: '2026-05-10', accountId: main.id, paymentMethodId: pix.id, categoryId: cat.id});
        assert.deepEqual([bought.status, bought.realPrice, bought.purchaseDate], ['BOUGHT', 3800.9, '2026-05-10']);
        const e = ok('GET', `/expenses/${bought.expenseId}`);
        assert.deepEqual([e.name, e.description, e.amount, e.date, e.type, e.status, e.accountName, e.paymentMethodName, e.categoryId],
            ['Notebook', 'garantia 1 ano', 3800.9, '2026-05-10', 'EXPENSE', 'PAID', 'Conta principal', 'Pix', cat.id]);
        assert.equal(ok('GET', '/accounts')[0].balance, -3800.9);
        assert.equal(call('POST', `/wishes/${w.id}/buy`, {price: 1, accountId: main.id}).status, 409);
        assert.equal(call('POST', `/wishes/${w.id}/discard`).status, 409);
    });

    it('validacoes da compra', () => {
        const w = wish();
        const res = call('POST', `/wishes/${w.id}/buy`, {});
        assert.equal(res.body.errors.price, 'Informe o preço pago.');
        assert.equal(res.body.errors.accountId, 'Informe em qual conta foi a compra.');
        assert.equal(call('POST', `/wishes/${w.id}/buy`, {price: 1, accountId: 99}).status, 404);
        assert.equal(ok('GET', '/expenses').length, 0);
    });

    it('pagar com a caixinha tira o dinheiro dela; sem saldo nada acontece', () => {
        const p = pot();
        ok('POST', `/pots/${p.id}/deposit`, {amount: 1000});
        const w = wish({potId: p.id});
        const poor = call('POST', `/wishes/${w.id}/buy`, {price: 4000, accountId: main.id, usePot: true});
        assert.equal(poor.body.detail, 'Saldo da caixinha insuficiente.');
        assert.equal(ok('GET', '/expenses').length, 0); // tudo ou nada
        assert.equal(ok('GET', '/wishes')[0].status, 'WISHED');

        ok('POST', `/pots/${p.id}/deposit`, {amount: 3500});
        ok('POST', `/wishes/${w.id}/buy`, {price: 4000, accountId: main.id, usePot: true, date: '2026-05-11'});
        assert.equal(balance(p.id), 500);
        const entry = ok('GET', `/pots/${p.id}/entries`).find(e => e.kind === 'PURCHASE');
        assert.deepEqual([entry.amount, entry.note, entry.date], [-4000, 'Compra: Notebook', '2026-05-11']);
        assert.equal(call('DELETE', `/pots/entries/${entry.id}`).status, 409);
    });

    it('sem usePot a caixinha nao e tocada', () => {
        const p = pot();
        ok('POST', `/pots/${p.id}/deposit`, {amount: 5000});
        const w = wish({potId: p.id});
        ok('POST', `/wishes/${w.id}/buy`, {price: 4000, accountId: main.id});
        assert.equal(balance(p.id), 5000);
    });

    it('excluir a despesa da compra devolve o item para a lista e o dinheiro para a caixinha', () => {
        const p = pot();
        ok('POST', `/pots/${p.id}/deposit`, {amount: 5000});
        const w = wish({potId: p.id});
        const bought = ok('POST', `/wishes/${w.id}/buy`, {price: 4000, accountId: main.id, usePot: true});
        assert.equal(balance(p.id), 1000);
        ok('DELETE', `/expenses/${bought.expenseId}`);
        const back = ok('GET', '/wishes')[0];
        assert.deepEqual([back.status, back.realPrice, back.purchaseDate, back.expenseId], ['WISHED', null, null, null]);
        assert.equal(balance(p.id), 5000);
    });

    it('excluir um item comprado mantem a despesa; devolve o dinheiro da caixinha', () => {
        const p = pot();
        ok('POST', `/pots/${p.id}/deposit`, {amount: 5000});
        const w = wish({potId: p.id});
        const bought = ok('POST', `/wishes/${w.id}/buy`, {price: 4000, accountId: main.id, usePot: true});
        assert.equal(call('DELETE', `/wishes/${w.id}`).status, 204);
        assert.equal(ok('GET', '/wishes').length, 0);
        assert.equal(ok('GET', `/expenses/${bought.expenseId}`).name, 'Notebook');
        assert.equal(balance(p.id), 5000);
    });
});
