import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;

/** API nova em memoria, com relogio fixo em 15/05/2026 (um sabado). */
function newApi() {
    return createApi(new SQL.Database(), {
        clock: () => new Date(2026, 4, 15, 12, 0, 0),
        newId: () => `id-${++n}`
    });
}

let api;
const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};

beforeEach(() => { api = newApi(); });

const spend = (name, amount, date, extra = {}) => ok('POST', '/expenses', {name, amount, date, ...extra});

describe('primeiro uso', () => {
    it('cria formas de pagamento, conta principal e categorias', () => {
        assert.equal(ok('GET', '/payment-methods').length, 6);
        const accounts = ok('GET', '/accounts');
        assert.deepEqual(accounts.map(a => a.name), ['Conta principal']);
        assert.equal(accounts[0].balance, 0);
        assert.equal(ok('GET', '/categories').length, 11);
    });

    it('nao duplica os dados iniciais ao reabrir o mesmo banco', () => {
        const again = createApi(api.db.sql, {clock: () => new Date(2026, 4, 15)});
        assert.equal(again.handle('GET', '/categories').body.length, 11);
        assert.equal(again.handle('GET', '/accounts').body.length, 1);
    });

    it('responde o que o front pede ao abrir', () => {
        for (const url of ['/recurring/occurrences?month=2026-05', '/pots', '/wishes', '/tags', '/transfers?month=2026-05',
            '/attachments/counts', '/templates', '/profiles', '/api/settings', '/api/summary?month=2026-05', '/expenses?status=PENDING']) {
            ok('GET', url);
        }
        assert.equal(ok('GET', '/api/auth/status').unlocked, true);
    });
});

describe('lancamentos', () => {
    it('cria e le um lancamento na conta principal', () => {
        const e = spend('Almoço', 32.9, '2026-05-10');
        assert.equal(e.amount, 32.9);
        assert.equal(e.type, 'EXPENSE');
        assert.equal(e.status, 'PAID');
        assert.equal(e.accountName, 'Conta principal');
        assert.deepEqual(ok('GET', `/expenses/${e.id}`), e);
    });

    it('valida os campos como o back-end', () => {
        const res = call('POST', '/expenses', {name: ' ', amount: 0, date: null});
        assert.equal(res.status, 400);
        assert.equal(res.body.errors.name, 'Informe uma descrição.');
        assert.equal(res.body.errors.amount, 'O valor deve ser de pelo menos 0,01.');
        assert.equal(res.body.errors.date, 'Informe a data.');
        assert.equal(call('POST', '/expenses', {name: 'x', amount: 1, date: '1999-01-01'}).status, 400);
        assert.equal(call('GET', '/expenses/999').status, 404);
    });

    it('atualiza com tags e categoria', () => {
        const cat = ok('GET', '/categories').find(c => c.name === 'Mercado');
        const e = spend('Feira', 50, '2026-05-02');
        const up = ok('PUT', `/expenses/${e.id}`, {name: 'Feira grande', amount: 80.5, date: '2026-05-03', categoryId: cat.id, tags: ['#Casa', 'semana 1']});
        assert.equal(up.name, 'Feira grande');
        assert.equal(up.categoryName, 'Mercado');
        assert.deepEqual(up.tags, ['casa', 'semana-1']);
        assert.deepEqual(ok('GET', '/tags'), ['casa', 'semana-1']);
    });

    it('filtra por mes, texto, tipo, categoria e pagina', () => {
        const mercado = ok('GET', '/categories').find(c => c.name === 'Mercado');
        spend('Arroz', 20, '2026-05-01', {categoryId: mercado.id});
        spend('Feijão', 10, '2026-05-02', {categoryId: mercado.id});
        spend('Salário', 3000, '2026-05-05', {type: 'INCOME'});
        spend('Cinema', 40, '2026-04-30');
        assert.equal(ok('GET', '/expenses?month=2026-05').length, 3);
        assert.deepEqual(ok('GET', '/expenses?month=2026-05').map(e => e.name), ['Salário', 'Feijão', 'Arroz']);
        assert.equal(ok('GET', '/expenses?type=INCOME').length, 1);
        assert.equal(ok('GET', `/expenses?categoryId=${mercado.id}`).length, 2);
        assert.deepEqual(ok('GET', '/expenses?q=FEIJ').map(e => e.name), ['Feijão']);
        assert.deepEqual(ok('GET', '/expenses?sort=amount,asc').map(e => e.amount), [10, 20, 40, 3000]);
        assert.equal(ok('GET', '/expenses?size=2&page=1').length, 2);
        assert.equal(ok('GET', '/expenses?size=3&page=1').length, 1);
    });

    it('parcela a compra: centavos na primeira e demais a pagar', () => {
        const first = spend('Geladeira', 100, '2026-01-31', {installments: 3});
        assert.equal(first.amount, 33.34);
        assert.equal(first.installmentNumber, 1);
        const all = ok('GET', '/expenses?sort=date,asc');
        assert.deepEqual(all.map(e => e.amount), [33.34, 33.33, 33.33]);
        assert.deepEqual(all.map(e => e.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
        assert.deepEqual(all.map(e => e.status), ['PAID', 'PENDING', 'PENDING']);
        assert.equal(call('POST', '/expenses', {name: 'x', amount: 0.05, date: '2026-01-01', installments: 10}).status, 400);
    });

    it('no cartao de credito todas as parcelas contam', () => {
        const card = ok('POST', '/accounts', {name: 'Nubank', type: 'CREDIT_CARD', closingDay: 5, dueDay: 12});
        spend('TV', 300, '2026-05-01', {installments: 3, accountId: card.id});
        assert.deepEqual(ok('GET', '/expenses').map(e => e.status), ['PAID', 'PAID', 'PAID']);
    });

    it('paga um pendente (e nao deixa pagar duas vezes)', () => {
        const e = spend('Luz', 120, '2026-05-20', {status: 'PENDING'});
        assert.equal(ok('GET', '/expenses?status=PENDING').length, 1);
        const paid = ok('POST', `/expenses/${e.id}/pay`, {});
        assert.equal(paid.status, 'PAID');
        assert.equal(paid.date, '2026-05-15');
        assert.equal(call('POST', `/expenses/${e.id}/pay`, {}).status, 409);
    });

    it('lixeira: some das listas e do saldo; escopo FOLLOWING leva as parcelas seguintes', () => {
        const a = spend('Mesa', 10, '2026-05-01');
        assert.equal(call('DELETE', `/expenses/${a.id}`).status, 204);
        assert.equal(ok('GET', '/expenses').length, 0);
        assert.equal(call('GET', `/expenses/${a.id}`).status, 404);

        const first = spend('Sofá', 90, '2026-05-01', {installments: 3});
        const second = ok('GET', '/expenses?sort=date,asc')[1];
        const res = ok('DELETE', `/expenses/${second.id}?scope=FOLLOWING`);
        assert.equal(res.ids.length, 2);
        assert.deepEqual(ok('GET', '/expenses').map(e => e.id), [first.id]);
    });

    it('acoes em lote', () => {
        const a = spend('A', 1, '2026-05-01', {status: 'PENDING'});
        const b = spend('B', 2, '2026-05-02', {status: 'PENDING'});
        const cat = ok('GET', '/categories')[0];
        assert.equal(ok('POST', '/expenses/batch', {ids: [a.id, b.id], action: 'SET_CATEGORY', categoryId: cat.id}).count, 2);
        assert.equal(ok('POST', '/expenses/batch', {ids: [a.id, b.id], action: 'ADD_TAG', tag: 'viagem'}).count, 2);
        assert.equal(ok('POST', '/expenses/batch', {ids: [a.id, b.id], action: 'MARK_PAID'}).count, 2);
        assert.equal(ok('POST', '/expenses/batch', {ids: [a.id], action: 'DELETE'}).count, 1);
        assert.deepEqual(ok('GET', '/expenses').map(e => [e.name, e.categoryId, e.tags, e.status]), [['B', cat.id, ['viagem'], 'PAID']]);
        assert.equal(call('POST', '/expenses/batch', {ids: [], action: 'DELETE'}).status, 400);
    });

    it('sugere descricoes ja usadas', () => {
        spend('Padaria do Zé', 8, '2026-05-01');
        spend('Padaria do Zé', 9, '2026-05-08');
        const found = ok('GET', '/expenses/suggestions?q=pada');
        assert.equal(found.length, 1);
        assert.equal(found[0].amount, 9);
    });
});

describe('contas', () => {
    it('o saldo soma o que esta pago e ignora pendentes e lixeira', () => {
        const main = ok('GET', '/accounts')[0];
        ok('PUT', `/accounts/${main.id}`, {...main, initialBalance: 100});
        spend('Salário', 1000, '2026-05-01', {type: 'INCOME'});
        spend('Aluguel', 400, '2026-05-02');
        spend('Conta futura', 50, '2026-05-30', {status: 'PENDING'});
        const gone = spend('Erro', 999, '2026-05-03');
        call('DELETE', `/expenses/${gone.id}`);
        assert.equal(ok('GET', '/accounts')[0].balance, 700);
    });

    it('nao repete nome, exige uma conta ativa e protege conta com historico', () => {
        const main = ok('GET', '/accounts')[0];
        assert.equal(call('POST', '/accounts', {name: 'conta PRINCIPAL'}).status, 409);
        assert.equal(call('PUT', `/accounts/${main.id}`, {...main, archived: true}).status, 409);
        const other = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET', initialBalance: 10});
        spend('Lanche', 5, '2026-05-01', {accountId: other.id});
        assert.equal(call('DELETE', `/accounts/${other.id}`).status, 409);
        assert.equal(ok('PUT', `/accounts/${other.id}`, {...other, archived: true}).archived, true);
    });

    it('cofrinho so tem um nivel', () => {
        const main = ok('GET', '/accounts')[0];
        const part = ok('POST', '/accounts', {name: 'Reserva', parentId: main.id});
        assert.equal(part.parentName, 'Conta principal');
        assert.equal(call('POST', '/accounts', {name: 'Neto', parentId: part.id}).status, 400);
    });
});

describe('categorias e formas de pagamento', () => {
    it('excluir categoria mantem o lancamento sem categoria e promove subcategorias', () => {
        const parent = ok('POST', '/categories', {name: 'Casa', icon: '🏠', color: '#112233'});
        const child = ok('POST', '/categories', {name: 'Reforma', parentId: parent.id});
        const e = spend('Tinta', 70, '2026-05-01', {categoryId: child.id});
        assert.equal(ok('GET', `/expenses/${e.id}`).categoryParentId, parent.id);
        ok('DELETE', `/categories/${parent.id}`);
        assert.equal(ok('GET', '/categories').find(c => c.id === child.id).parentId, null);
        ok('DELETE', `/categories/${child.id}`);
        assert.equal(ok('GET', `/expenses/${e.id}`).categoryId, null);
    });

    it('nao repete nome de categoria nem de forma de pagamento', () => {
        assert.equal(call('POST', '/categories', {name: 'mercado'}).status, 409);
        assert.equal(call('POST', '/payment-methods', {name: 'PIX'}).status, 409);
        const m = ok('POST', '/payment-methods', {name: 'Vale'});
        const e = spend('Almoço', 30, '2026-05-01', {paymentMethodId: m.id});
        ok('DELETE', `/payment-methods/${m.id}`);
        assert.equal(ok('GET', `/expenses/${e.id}`).paymentMethodId, null);
    });
});

describe('resumo e orcamentos', () => {
    it('totais do mes, pendentes, previsao e tendencia', () => {
        spend('Salário', 3000, '2026-05-05', {type: 'INCOME'});
        spend('Aluguel', 1000, '2026-05-06');
        spend('Mercado', 500, '2026-04-06');
        spend('Internet', 100, '2026-05-25', {status: 'PENDING'});
        spend('Bônus', 200, '2026-05-28', {type: 'INCOME', status: 'PENDING'});
        const s = ok('GET', '/api/summary?month=2026-05');
        assert.equal(s.income, 3000);
        assert.equal(s.expense, 1000);
        assert.equal(s.balance, 2000);
        assert.equal(s.previousExpense, 500);
        assert.equal(s.pendingExpense, 100);
        assert.equal(s.pendingIncome, 200);
        assert.equal(s.projectedBalance, 2100);
        assert.equal(s.trend.length, 6);
        assert.equal(s.trend.at(-1).month, '2026-05');
        assert.equal(s.categories[0].name, 'Sem categoria');
        assert.equal(s.categories[0].percent, 100);
    });

    it('filtra o resumo por conta', () => {
        const wallet = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET'});
        spend('A', 10, '2026-05-01');
        spend('B', 5, '2026-05-01', {accountId: wallet.id});
        assert.equal(ok('GET', `/api/summary?month=2026-05&accountId=${wallet.id}`).expense, 5);
        assert.equal(ok('GET', '/api/summary?month=2026-05').expense, 15);
    });

    it('limite por categoria com vigencia e escopo so deste mes', () => {
        const food = ok('GET', '/categories').find(c => c.name === 'Alimentação');
        spend('Jantar', 150, '2026-05-02', {categoryId: food.id});
        ok('PUT', `/budgets/${food.id}?month=2026-01`, {amount: 400});
        ok('PUT', `/budgets/${food.id}?month=2026-05`, {amount: 600, scope: 'ONLY_MONTH'});
        assert.equal(ok('GET', '/budgets?month=2026-03')[0].amount, 400);
        assert.equal(ok('GET', '/budgets?month=2026-05')[0].amount, 600);
        assert.equal(ok('GET', '/budgets?month=2026-06')[0].amount, 400);
        const cat = ok('GET', '/api/summary?month=2026-05').categories.find(c => c.categoryId === food.id);
        assert.equal(cat.budget, 600);
        assert.equal(cat.budgetSpent, 150);
        ok('DELETE', `/budgets/${food.id}?month=2026-07`);
        assert.equal(ok('GET', '/budgets?month=2026-07').length, 0);
        assert.equal(ok('GET', '/budgets?month=2026-06').length, 1);
        assert.equal(call('PUT', `/budgets/${food.id}`, {amount: 0}).status, 400);
    });

    it('limite geral e sobra acumulada', () => {
        const food = ok('GET', '/categories').find(c => c.name === 'Alimentação');
        ok('PUT', '/budgets/total?month=2026-01', {amount: 1000});
        assert.deepEqual(ok('GET', '/budgets/total?month=2026-05'), {amount: 1000, fromMonth: '2026-01'});
        ok('PUT', `/budgets/${food.id}?month=2026-01`, {amount: 300});
        ok('PUT', '/api/settings', {budgetRollover: true});
        // a sobra comeca a contar no mes atual (maio): nada sobra de abril para maio
        const may = ok('GET', '/api/summary?month=2026-05');
        assert.equal(may.budgetRollover, true);
        assert.equal(may.totalCarry, 0);
        spend('Pizza', 100, '2026-05-10', {categoryId: food.id});
        const june = ok('GET', '/api/summary?month=2026-06');
        assert.equal(june.totalCarry, 900);
        assert.equal(june.totalBudget, 1900);
        assert.equal(june.categories.find(c => c.categoryId === food.id).carry, 200);
    });
});

describe('por vir', () => {
    it('soma o que falta pagar e receber a partir de hoje, com atrasados', () => {
        const main = ok('GET', '/accounts')[0];
        ok('PUT', `/accounts/${main.id}`, {...main, initialBalance: 1000});
        spend('Luz', 120, '2026-05-20', {status: 'PENDING'});
        spend('Aluguel atrasado', 800, '2026-05-01', {status: 'PENDING'});
        spend('Freela', 500, '2026-06-01', {type: 'INCOME', status: 'PENDING'});
        spend('Depois do periodo', 99, '2026-09-01', {status: 'PENDING'});
        const u = ok('GET', '/api/upcoming');
        assert.equal(u.from, '2026-05-15');
        assert.equal(u.to, '2026-06-15');
        assert.equal(u.startBalance, 1000);
        assert.equal(u.outgoing, 920);
        assert.equal(u.incoming, 500);
        assert.equal(u.endBalance, 580);
        assert.deepEqual(u.items.map(i => [i.name, i.overdue]), [['Aluguel atrasado', true], ['Luz', false], ['Freela', false]]);
        assert.equal(call('GET', '/api/upcoming?from=2026-06-01&to=2026-05-01').status, 400);
    });
});

describe('configuracoes', () => {
    it('guarda moeda, lembretes e idioma', () => {
        const s = ok('PUT', '/api/settings', {currency: 'usd', reminderDays: 5, remindersEnabled: false});
        assert.equal(s.currency, 'USD');
        assert.equal(s.reminderDays, 5);
        assert.equal(s.remindersEnabled, false);
        assert.equal(call('PUT', '/api/settings', {reminderDays: 99}).status, 400);
        assert.equal(call('PUT', '/api/settings', {currency: 'XXX'}).status, 400);
        assert.equal(ok('PUT', '/app/language', {language: 'en'}).language, 'en');
    });

    it('falha numa configuracao desfaz as outras da mesma chamada', () => {
        call('PUT', '/api/settings', {currency: 'EUR', reminderDays: 99});
        assert.equal(ok('GET', '/api/settings').currency, 'BRL');
    });

    it('limpar tudo manda os lancamentos para a lixeira', () => {
        spend('A', 1, '2026-05-01');
        assert.equal(call('DELETE', '/api/data').status, 204);
        assert.equal(ok('GET', '/expenses').length, 0);
    });

    it('recursos ainda nao portados avisam', () => {
        assert.equal(call('POST', '/profiles', {name: 'x'}).status, 501);
        assert.equal(call('GET', '/nao-existe').status, 404);
    });
});
