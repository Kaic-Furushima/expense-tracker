import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {MIGRATIONS} from '../src/local-api/schema.js';

const SQL = await initSqlJs();
let n = 0;
const options = {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `kp-${++n}`};

let api;
const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const status = (method, url, body) => call(method, url, body).status;
beforeEach(() => { api = createApi(new SQL.Database(), options); });

describe('categorias de despesa e de receita', () => {
    it('as padrao ja vem separadas: salario so em receita', () => {
        const all = ok('GET', '/categories');
        assert.ok(all.find(c => c.name === 'Salário' && c.kind === 'INCOME'));
        assert.ok(!all.find(c => c.name === 'Salário' && c.kind === 'EXPENSE'));
        assert.ok(all.find(c => c.name === 'Outros' && c.kind === 'INCOME'));
        assert.ok(all.find(c => c.name === 'Outros' && c.kind === 'EXPENSE'));
    });

    it('o mesmo nome pode existir nos dois tipos, mas nao duas vezes no mesmo', () => {
        ok('POST', '/categories', {name: 'Freela', kind: 'INCOME'});
        ok('POST', '/categories', {name: 'Freela', kind: 'EXPENSE'});
        assert.equal(status('POST', '/categories', {name: 'freela', kind: 'INCOME'}), 409);
        assert.equal(ok('POST', '/categories', {name: 'Sem tipo'}).kind, 'EXPENSE');
    });

    it('subcategoria herda o tipo do pai e nao muda de tipo', () => {
        const parent = ok('POST', '/categories', {name: 'Renda extra', kind: 'INCOME'});
        const child = ok('POST', '/categories', {name: 'Aluguel recebido', kind: 'EXPENSE', parentId: parent.id});
        assert.equal(child.kind, 'INCOME');
        const other = ok('POST', '/categories', {name: 'Mercado 2', kind: 'EXPENSE'});
        assert.equal(status('PUT', `/categories/${child.id}`, {name: 'Aluguel recebido', parentId: other.id}), 400);
    });

    it('despesa so aceita categoria de despesa e receita so de receita', () => {
        const food = ok('GET', '/categories').find(c => c.name === 'Alimentação');
        const salary = ok('GET', '/categories').find(c => c.name === 'Salário');
        assert.equal(status('POST', '/expenses', {name: 'x', amount: 10, date: '2026-05-01', type: 'INCOME', categoryId: food.id}), 400);
        assert.equal(status('POST', '/expenses', {name: 'x', amount: 10, date: '2026-05-01', type: 'EXPENSE', categoryId: salary.id}), 400);
        assert.equal(status('POST', '/expenses', {name: 'x', amount: 10, date: '2026-05-01', type: 'INCOME', categoryId: salary.id}), 201);
        assert.equal(status('POST', '/expenses', {name: 'y', amount: 10, date: '2026-05-01', type: 'EXPENSE', categoryId: food.id}), 201);
    });

    it('copiar leva a categoria e as subcategorias para o outro tipo, sem duplicar nomes', () => {
        const parent = ok('POST', '/categories', {name: 'Casa', kind: 'EXPENSE'});
        ok('POST', '/categories', {name: 'Luz', parentId: parent.id});
        ok('POST', '/categories', {name: 'Agua', parentId: parent.id});
        const copy = ok('POST', `/categories/${parent.id}/copy`);
        assert.equal(copy.kind, 'INCOME');
        assert.equal(copy.name, 'Casa');
        const incomeKids = ok('GET', '/categories').filter(c => c.kind === 'INCOME' && c.parentId === copy.id).map(c => c.name).sort();
        assert.deepEqual(incomeKids, ['Agua', 'Luz']);
        ok('POST', `/categories/${parent.id}/copy`); // de novo: nada duplica
        assert.equal(ok('GET', '/categories').filter(c => c.name === 'Casa').length, 2);
        // so uma subcategoria
        const luz = ok('GET', '/categories').find(c => c.name === 'Luz' && c.kind === 'EXPENSE');
        const back = ok('POST', `/categories/${copy.id}/copy`);
        assert.equal(back.kind, 'EXPENSE');
        assert.equal(back.id, parent.id);
        assert.ok(luz);
    });
});

describe('migracao de quem ja tinha dados', () => {
    it('receitas que usavam uma categoria ganham uma copia de receita', () => {
        const db = new SQL.Database();
        db.run('pragma foreign_keys = on');
        db.run(MIGRATIONS[0]);
        db.run(MIGRATIONS[1]);
        db.run('pragma user_version = 2');
        db.run("insert into accounts (uuid, name, type, updated_at) values ('a1', 'Conta principal', 'CHECKING', '2026-01-01T00:00:00.000')");
        db.run("insert into categories (uuid, name, updated_at) values ('c1', 'Mistura', '2026-01-01T00:00:00.000'), ('c2', 'So despesa', '2026-01-01T00:00:00.000')");
        db.run(`insert into expenses (uuid, name, amount_cents, date, type, category_id, account_id, created_at, updated_at) values
            ('e1', 'Gasto', 1000, '2026-01-02', 'EXPENSE', 1, 1, '2026-01-02T00:00:00.000', '2026-01-02T00:00:00.000'),
            ('e2', 'Ganho', 5000, '2026-01-03', 'INCOME', 1, 1, '2026-01-03T00:00:00.000', '2026-01-03T00:00:00.000')`);
        api = createApi(db, options);
        const cats = ok('GET', '/categories');
        const mistura = cats.filter(c => c.name === 'Mistura');
        assert.deepEqual(mistura.map(c => c.kind).sort(), ['EXPENSE', 'INCOME']);
        assert.deepEqual(cats.filter(c => c.name === 'So despesa').map(c => c.kind), ['EXPENSE']);
        const all = ok('GET', '/expenses');
        const gasto = all.find(e => e.name === 'Gasto'), ganho = all.find(e => e.name === 'Ganho');
        assert.equal(gasto.categoryId, mistura.find(c => c.kind === 'EXPENSE').id);
        assert.equal(ganho.categoryId, mistura.find(c => c.kind === 'INCOME').id);
        // o nome agora e unico por tipo: criar de novo no mesmo tipo continua barrado
        assert.equal(status('POST', '/categories', {name: 'Mistura', kind: 'INCOME'}), 409);
    });
});

describe('parcelas com plano proprio', () => {
    const base = {name: 'Geladeira', amount: 1000, date: '2026-05-10', type: 'EXPENSE'};
    const group = () => ok('GET', '/expenses').filter(e => e.installmentTotal).sort((a, b) => a.installmentNumber - b.installmentNumber);

    it('cada parcela tem a sua data e situacao; o total e dividido igualmente', () => {
        ok('POST', '/expenses', {...base, installmentPlan: [
            {date: '2026-05-10', status: 'PAID'}, {date: '2026-06-02', status: 'PAID'}, {date: '2026-06-20', status: 'PENDING'}]});
        const g = group();
        assert.deepEqual(g.map(e => [e.installmentNumber, e.date, e.status, e.amount]),
            [[1, '2026-05-10', 'PAID', 333.34], [2, '2026-06-02', 'PAID', 333.33], [3, '2026-06-20', 'PENDING', 333.33]]);
        assert.ok(g.every(e => e.installmentTotal === 3));
    });

    it('valores proprios valem como estao e as parcelas sem valor dividem o que sobra', () => {
        ok('POST', '/expenses', {...base, installmentPlan: [
            {date: '2026-05-10', amount: 400}, {date: '2026-06-10'}, {date: '2026-07-10'}]});
        assert.deepEqual(group().map(e => e.amount), [400, 300, 300]);
    });

    it('sem situacao informada: a primeira segue o pedido e as outras ficam a pagar (cartao: todas)', () => {
        ok('POST', '/expenses', {...base, installmentPlan: [{date: '2026-05-10'}, {date: '2026-06-10'}]});
        assert.deepEqual(group().map(e => e.status), ['PAID', 'PENDING']);
    });

    it('recusa data faltando, valor zero e valores que estouram o total', () => {
        assert.equal(status('POST', '/expenses', {...base, installmentPlan: [{date: '2026-05-10'}, {}]}), 400);
        assert.equal(status('POST', '/expenses', {...base, installmentPlan: [{date: '2026-05-10', amount: 0}, {date: '2026-06-10'}]}), 400);
        assert.equal(status('POST', '/expenses', {...base, installmentPlan: [{date: '2026-05-10', amount: 1000}, {date: '2026-06-10'}]}), 400);
        assert.equal(ok('GET', '/expenses').length, 0);
    });

    it('o jeito antigo (so a quantidade) continua valendo', () => {
        ok('POST', '/expenses', {...base, installments: 2});
        assert.deepEqual(group().map(e => e.date), ['2026-05-10', '2026-06-10']);
    });
});
