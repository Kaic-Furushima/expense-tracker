import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {MIGRATIONS} from '../src/local-api/schema.js';

const SQL = await initSqlJs();
let api;
let n = 0;
const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
let main;
let usd;

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12), newId: () => `c-${++n}`});
    main = ok('GET', '/accounts')[0];
    usd = ok('POST', '/accounts', {name: 'Wise', currency: 'USD', initialBalance: 100});
});

describe('moeda por conta', () => {
    it('sem escolher, a conta usa a moeda principal; escolhendo outra, guarda a outra', () => {
        assert.equal(main.currency, 'BRL');
        assert.equal(usd.currency, 'USD');
        assert.equal(ok('POST', '/accounts', {name: 'Outra'}).currency, 'BRL');
    });

    it('escolher a moeda principal equivale a nao escolher: acompanha a principal se ela mudar', () => {
        const acc = ok('POST', '/accounts', {name: 'Brasil', currency: 'BRL'});
        ok('PUT', '/api/settings', {currency: 'EUR'});
        assert.equal(ok('GET', '/accounts').find(a => a.id === acc.id).currency, 'EUR');
        assert.equal(ok('GET', '/accounts').find(a => a.id === usd.id).currency, 'USD');
    });

    it('moeda invalida e recusada; editar sem mandar a moeda mantem a que a conta tinha', () => {
        assert.equal(call('POST', '/accounts', {name: 'X', currency: 'XYZ'}).status, 400);
        const {currency, ...rest} = usd;
        assert.equal(ok('PUT', `/accounts/${usd.id}`, {...rest, name: 'Wise 2'}).currency, 'USD');
    });
});

describe('totais com mais de uma moeda', () => {
    const spend = (accountId, amount) => ok('POST', '/expenses', {name: 'Compra', amount, date: '2026-05-10', accountId});

    it('o resumo do mes e os orcamentos so contam a moeda principal; a conta em outra moeda tem o proprio resumo', () => {
        spend(main.id, 50);
        spend(usd.id, 20);
        assert.equal(ok('GET', '/api/summary?month=2026-05').expense, 50);
        assert.equal(ok('GET', `/api/summary?month=2026-05&accountId=${usd.id}`).expense, 20);
        assert.equal(ok('GET', `/api/summary?month=2026-05&accountId=${main.id}`).expense, 50);
    });

    it('o saldo de cada conta continua na moeda dela', () => {
        spend(usd.id, 20);
        assert.equal(ok('GET', '/accounts').find(a => a.id === usd.id).balance, 80);
    });
});

describe('transferencia entre moedas', () => {
    it('pede o valor que chegou, e cada conta muda no valor da sua moeda', () => {
        const without = call('POST', '/transfers', {fromAccountId: main.id, toAccountId: usd.id, amount: 500, date: '2026-05-10'});
        assert.equal(without.status, 400);
        const t = ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: usd.id, amount: 500, toAmount: 90, date: '2026-05-10'});
        assert.equal(t.toAmount, 90);
        const balances = Object.fromEntries(ok('GET', '/accounts').map(a => [a.name, a.balance]));
        assert.equal(balances['Conta principal'], -500);
        assert.equal(balances.Wise, 190);
    });

    it('na mesma moeda o valor que chegou e ignorado', () => {
        const other = ok('POST', '/accounts', {name: 'Poupanca'});
        const t = ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: other.id, amount: 100, toAmount: 5, date: '2026-05-10'});
        assert.equal(t.toAmount, null);
        assert.equal(ok('GET', '/accounts').find(a => a.id === other.id).balance, 100);
    });
});

describe('migracao da moeda', () => {
    it('um banco anterior ao campo abre normalmente, com todas as contas na moeda principal', () => {
        const old = new SQL.Database();
        MIGRATIONS.slice(0, 6).forEach(sql => old.run(sql));
        old.run('pragma user_version = 6');
        old.run(`insert into accounts (id, uuid, name, type, color, icon, initial_cents, archived, parent_id, updated_at)
                 values (1, 'old-1', 'Banco', 'CHECKING', '#64B5F6', 'bank', 1000, 0, null, '2026-01-01T00:00:00')`);
        api = createApi(old, {clock: () => new Date(2026, 4, 15, 12), newId: () => `m-${++n}`});
        const account = ok('GET', '/accounts').find(a => a.name === 'Banco');
        assert.equal(account.currency, 'BRL');
        assert.equal(account.balance, 10);
    });
});

describe('caixinhas, desejos e orcamentos em outra moeda', () => {
    it('a caixinha tem a propria moeda; ligada a uma conta, vale a moeda da conta', () => {
        const alone = ok('POST', '/pots', {name: 'Viagem', currency: 'USD', goal: 1000});
        assert.equal(alone.currency, 'USD');
        assert.equal(ok('POST', '/pots', {name: 'Reserva'}).currency, 'BRL');
        const linked = ok('POST', '/pots', {name: 'Wise pot', accountId: usd.id});
        assert.equal(linked.currency, 'USD');
    });

    it('o item da lista de desejos tem moeda, a caixinha dele precisa ser da mesma e a compra, numa conta dela', () => {
        const pot = ok('POST', '/pots', {name: 'Viagem', currency: 'USD'});
        const brl = call('POST', '/wishes', {name: 'Mala', estimatedPrice: 100, potId: pot.id});
        assert.equal(brl.status, 400);
        const wish = ok('POST', '/wishes', {name: 'Mala', estimatedPrice: 100, potId: pot.id, currency: 'USD'});
        assert.equal(wish.currency, 'USD');
        const wrong = call('POST', `/wishes/${wish.id}/buy`, {price: 90, accountId: main.id, date: '2026-05-10'});
        assert.equal(wrong.status, 400);
        assert.equal(call('POST', `/wishes/${wish.id}/buy`, {price: 90, accountId: usd.id, date: '2026-05-10'}).status, 200);
    });

    it('o limite de orcamento tem moeda: so vale, e so conta o gasto, naquela moeda', () => {
        const food = ok('GET', '/categories').find(c => c.name === 'Alimentação');
        ok('PUT', `/budgets/${food.id}?month=2026-05`, {amount: 300});
        assert.equal(ok('GET', '/api/summary?month=2026-05').categories.find(c => c.categoryId === food.id).budget, 300);
        ok('PUT', `/budgets/${food.id}?month=2026-05`, {amount: 80, currency: 'USD'});
        // a linha em vigor agora e em dolar: some da visao em real e aparece na visao em dolar
        assert.equal(ok('GET', '/api/summary?month=2026-05').categories.find(c => c.categoryId === food.id)?.budget ?? null, null);
        ok('POST', '/expenses', {name: 'Jantar', amount: 25, date: '2026-05-10', accountId: usd.id, categoryId: food.id});
        const view = ok('GET', '/api/summary?month=2026-05&currency=USD');
        assert.equal(view.currency, 'USD');
        const row = view.categories.find(c => c.categoryId === food.id);
        assert.equal(row.budget, 80);
        assert.equal(row.budgetSpent, 25);
    });

    it('o resumo por moeda junta todas as contas dessa moeda', () => {
        const second = ok('POST', '/accounts', {name: 'Cofre USD', currency: 'USD'});
        ok('POST', '/expenses', {name: 'A', amount: 10, date: '2026-05-10', accountId: usd.id});
        ok('POST', '/expenses', {name: 'B', amount: 5, date: '2026-05-11', accountId: second.id});
        ok('POST', '/expenses', {name: 'C', amount: 99, date: '2026-05-11', accountId: main.id});
        assert.equal(ok('GET', '/api/summary?month=2026-05&currency=USD').expense, 15);
        assert.equal(ok('GET', '/api/summary?month=2026-05').expense, 99);
    });

    it('a caixinha ligada a uma conta guardada mostra o saldo da conta e nao aceita aportes proprios', () => {
        const cofre = ok('POST', '/accounts', {name: 'Cofre', saved: true, initialBalance: 300});
        const pot = ok('POST', '/pots', {name: 'Reserva', accountId: cofre.id, goal: 1000});
        assert.equal(pot.mirrored, true);
        assert.equal(pot.balance, 300);
        assert.equal(call('POST', `/pots/${pot.id}/deposit`, {amount: 10}).status, 409);
        ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: cofre.id, amount: 50, date: '2026-05-10'});
        assert.equal(ok('GET', '/pots').find(p => p.id === pot.id).balance, 350);
        // uma conta que nao e guardada nao espelha: a caixinha continua com o saldo proprio
        const plain = ok('POST', '/pots', {name: 'Outra', accountId: main.id});
        assert.equal(plain.mirrored, false);
        assert.equal(call('POST', `/pots/${plain.id}/deposit`, {amount: 10}).status, 200);
    });
});

describe('CSV com moeda', () => {
    it('exporta a moeda da conta e o valor que chegou, e importa de volta criando a conta na moeda do arquivo', () => {
        ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: usd.id, amount: 500, toAmount: 90, date: '2026-05-10'});
        ok('POST', '/expenses', {name: 'Cafe', amount: 12.5, date: '2026-05-11', accountId: usd.id});
        const csv = call('GET', '/api/export.csv').text;
        const lines = csv.split('\n');
        assert.ok(lines[0].endsWith(';descricao;moeda;valor_destino;moeda_destino'));
        assert.ok(lines.some(l => l.includes('"Wise"') && l.endsWith(';"USD";;')));
        assert.ok(lines.some(l => l.includes('TRANSFER') && l.endsWith(';"BRL";90.00;"USD"')));

        const fresh = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12), newId: () => `i-${++n}`});
        const preview = fresh.handle('POST', '/import/preview', {content: csv});
        assert.ok(preview.status < 300, JSON.stringify(preview.body));
        const result = fresh.handle('POST', '/import/commit', {rows: preview.body.rows});
        assert.ok(result.status < 300, JSON.stringify(result.body));
        const accounts = fresh.handle('GET', '/accounts').body;
        const wise = accounts.find(a => a.name === 'Wise');
        assert.equal(wise.currency, 'USD');
        assert.equal(wise.balance, 90 - 12.5);
    });
});
