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
const rule = (extra = {}) => ok('POST', '/recurring', {name: 'Aluguel', amount: 1000, dayOfMonth: 5, startMonth: '2026-05', ...extra});
const occurrences = month => ok('GET', `/recurring/occurrences?month=${month}`);

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `r-${++n}`}); // 15/05/2026
    main = ok('GET', '/accounts')[0];
});

describe('regras', () => {
    it('cria a regra com valores padrao e gera a ocorrencia do mes', () => {
        const r = ok('POST', '/recurring', {name: ' Internet ', amount: 99.9, dayOfMonth: 10});
        assert.deepEqual([r.name, r.type, r.amount, r.variableAmount, r.active, r.accountName, r.startMonth, r.endMonth],
            ['Internet', 'EXPENSE', 99.9, false, true, 'Conta principal', '2026-05', null]);
        const [o] = occurrences('2026-05');
        assert.deepEqual([o.name, o.dueDate, o.status, o.amount, o.recurringId], ['Internet', '2026-05-10', 'PENDING', 99.9, r.id]);
        assert.equal(occurrences('2026-06').length, 0); // meses futuros so existem depois de chegar
    });

    it('cria as ocorrencias atrasadas desde o inicio da regra, uma so vez', () => {
        rule({startMonth: '2026-03'});
        assert.deepEqual(occurrences('2026-03').map(o => o.dueDate), ['2026-03-05']);
        assert.equal(occurrences('2026-04').length, 1);
        assert.equal(occurrences('2026-05').length, 1);
        assert.equal(api.db.value('select count(*) from recurring_occurrences'), 3);
    });

    it('dia 31 cai no ultimo dia de meses curtos; mes final limita; regra inativa nao gera', () => {
        rule({name: 'Fim do mês', dayOfMonth: 31, startMonth: '2026-02'});
        assert.equal(occurrences('2026-02')[0].dueDate, '2026-02-28');
        assert.equal(occurrences('2026-04')[0].dueDate, '2026-04-30');
        rule({name: 'Acabou', startMonth: '2026-02', endMonth: '2026-03'});
        assert.equal(occurrences('2026-05').filter(o => o.name === 'Acabou').length, 0);
        assert.equal(occurrences('2026-03').filter(o => o.name === 'Acabou').length, 1);
        rule({name: 'Parada', active: false});
        assert.equal(occurrences('2026-05').filter(o => o.name === 'Parada').length, 0);
    });

    it('valida os campos', () => {
        const res = call('POST', '/recurring', {name: ' ', dayOfMonth: 40});
        assert.equal(res.status, 400);
        assert.equal(res.body.errors.name, 'Informe o nome do pagamento.');
        assert.equal(res.body.errors.dayOfMonth, 'O dia deve estar entre 1 e 31.');
        assert.equal(call('POST', '/recurring', {name: 'x', dayOfMonth: 5}).body.detail, 'Informe o valor ou marque como variável.');
        assert.equal(call('POST', '/recurring', {name: 'x', dayOfMonth: 5, amount: 1, startMonth: '05/2026'}).status, 400);
        assert.equal(call('POST', '/recurring', {name: 'x', dayOfMonth: 5, amount: 1, startMonth: '2026-05', endMonth: '2026-04'}).status, 400);
        assert.equal(call('POST', '/recurring', {name: 'x', dayOfMonth: 5, amount: 1, accountId: 99}).status, 404);
        assert.equal(call('PUT', '/recurring/99', {name: 'x', dayOfMonth: 5, amount: 1}).status, 404);
    });

    it('valor variavel nao tem valor fixo', () => {
        const r = rule({name: 'Luz', variableAmount: true, amount: undefined});
        assert.deepEqual([r.amount, r.variableAmount], [null, true]);
        assert.equal(occurrences('2026-05')[0].amount, null);
    });

    it('alterar a regra muda so as pendentes; as pagas mantem o valor', () => {
        const r = rule({startMonth: '2026-04'});
        const april = occurrences('2026-04')[0];
        ok('POST', `/recurring/occurrences/${april.id}/pay`, {});
        ok('PUT', `/recurring/${r.id}`, {name: 'Aluguel novo', amount: 1200, dayOfMonth: 8, startMonth: '2026-04'});
        const paid = occurrences('2026-04')[0];
        const pending = occurrences('2026-05')[0];
        assert.deepEqual([paid.status, paid.amount, paid.dueDate], ['PAID', 1000, '2026-04-05']);
        assert.deepEqual([pending.status, pending.amount, pending.dueDate, pending.name], ['PENDING', 1200, '2026-05-08', 'Aluguel novo']);
    });

    it('excluir a regra apaga as ocorrencias mas mantem os lancamentos', () => {
        const r = rule();
        ok('POST', `/recurring/occurrences/${occurrences('2026-05')[0].id}/pay`, {});
        assert.equal(call('DELETE', `/recurring/${r.id}`).status, 204);
        assert.equal(ok('GET', '/recurring').length, 0);
        assert.equal(occurrences('2026-05').length, 0);
        assert.equal(ok('GET', '/expenses').length, 1);
        assert.equal(call('DELETE', `/recurring/${r.id}`).status, 404);
    });

    it('conta e categoria usadas pela regra nao somem sem aviso', () => {
        const cat = ok('GET', '/categories')[0];
        const r = rule({categoryId: cat.id});
        assert.equal(r.categoryName, cat.name);
        ok('DELETE', `/categories/${cat.id}`);
        assert.equal(ok('GET', '/recurring')[0].categoryId, null);
        assert.equal(call('DELETE', `/accounts/${main.id}`).status, 409);
    });
});

describe('ocorrencias', () => {
    it('pagar cria o lancamento com os dados da regra', () => {
        const cat = ok('GET', '/categories')[1];
        const pix = ok('GET', '/payment-methods').find(m => m.name === 'Pix');
        rule({categoryId: cat.id, paymentMethodId: pix.id});
        const o = occurrences('2026-05')[0];
        const paid = ok('POST', `/recurring/occurrences/${o.id}/pay`, {});
        assert.deepEqual([paid.status, paid.paidDate, paid.amount], ['PAID', '2026-05-15', 1000]);
        const e = ok('GET', `/expenses/${paid.expenseId}`);
        assert.deepEqual([e.name, e.description, e.amount, e.date, e.status, e.type, e.categoryId, e.paymentMethodName, e.accountName],
            ['Aluguel', 'Pagamento recorrente', 1000, '2026-05-15', 'PAID', 'EXPENSE', cat.id, 'Pix', 'Conta principal']);
        assert.equal(call('POST', `/recurring/occurrences/${o.id}/pay`, {}).status, 409);
    });

    it('pode pagar em outra data, com outro valor, outra conta e outra forma de pagamento', () => {
        const wallet = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET'});
        const cash = ok('GET', '/payment-methods').find(m => m.name === 'Dinheiro');
        rule();
        const o = occurrences('2026-05')[0];
        const paid = ok('POST', `/recurring/occurrences/${o.id}/pay`, {date: '2026-05-03', amount: 950.5, accountId: wallet.id, paymentMethodId: cash.id});
        assert.deepEqual([paid.paidDate, paid.amount, paid.accountName === undefined], ['2026-05-03', 950.5, false]);
        const e = ok('GET', `/expenses/${paid.expenseId}`);
        assert.deepEqual([e.date, e.amount, e.accountName, e.paymentMethodName], ['2026-05-03', 950.5, 'Carteira', 'Dinheiro']);
    });

    it('variavel exige o valor; receita vira receita', () => {
        rule({name: 'Luz', variableAmount: true, amount: undefined});
        rule({name: 'Salário', type: 'INCOME', amount: 5000});
        const luz = occurrences('2026-05').find(o => o.name === 'Luz');
        assert.equal(call('POST', `/recurring/occurrences/${luz.id}/pay`, {}).status, 400);
        assert.equal(call('POST', `/recurring/occurrences/${luz.id}/pay`, {amount: 0}).status, 400);
        assert.equal(ok('POST', `/recurring/occurrences/${luz.id}/pay`, {amount: 87.3}).amount, 87.3);
        const salary = occurrences('2026-05').find(o => o.name === 'Salário');
        const paid = ok('POST', `/recurring/occurrences/${salary.id}/pay`, null);
        assert.equal(ok('GET', `/expenses/${paid.expenseId}`).type, 'INCOME');
        assert.equal(ok('GET', '/accounts')[0].balance, 4912.7);
    });

    it('pular e reabrir', () => {
        rule();
        const o = occurrences('2026-05')[0];
        assert.equal(ok('POST', `/recurring/occurrences/${o.id}/skip`).status, 'SKIPPED');
        assert.equal(call('POST', `/recurring/occurrences/${o.id}/pay`, {}).status, 200); // pulada ainda pode ser paga
        const paid = occurrences('2026-05')[0];
        assert.equal(call('POST', `/recurring/occurrences/${paid.id}/skip`).status, 409);
        assert.equal(call('POST', `/recurring/occurrences/${paid.id}/reopen`).status, 409);
        assert.equal(call('POST', '/recurring/occurrences/999/skip').status, 404);
    });

    it('reabrir traz de volta uma ocorrencia pulada', () => {
        rule();
        const o = occurrences('2026-05')[0];
        ok('POST', `/recurring/occurrences/${o.id}/skip`);
        assert.equal(ok('POST', `/recurring/occurrences/${o.id}/reopen`).status, 'PENDING');
    });

    it('excluir o lancamento pago pula a ocorrencia (para o automatico nao recriar)', () => {
        rule();
        const paid = ok('POST', `/recurring/occurrences/${occurrences('2026-05')[0].id}/pay`, {});
        ok('DELETE', `/expenses/${paid.expenseId}`);
        const o = occurrences('2026-05')[0];
        assert.deepEqual([o.status, o.expenseId, o.paidDate], ['SKIPPED', null, null]);
    });
});

describe('pagamento automatico', () => {
    it('paga o que venceu (mes atual e anterior), nao o variavel, o inativo nem os muito antigos', () => {
        rule({name: 'Fixa venceu', dayOfMonth: 10, startMonth: '2026-03'});
        rule({name: 'Fixa depois', dayOfMonth: 20, startMonth: '2026-05'});
        rule({name: 'Variável', variableAmount: true, amount: undefined, dayOfMonth: 1, startMonth: '2026-05'});
        const off = rule({name: 'Inativa', dayOfMonth: 1, startMonth: '2026-05'});
        ok('PUT', `/recurring/${off.id}`, {...off, active: false});

        ok('PUT', '/api/settings', {autoPayRecurring: true});

        const status = (month, name) => occurrences(month).find(o => o.name === name)?.status;
        assert.equal(status('2026-05', 'Fixa venceu'), 'PAID');
        assert.equal(status('2026-04', 'Fixa venceu'), 'PAID');
        assert.equal(status('2026-03', 'Fixa venceu'), 'PENDING'); // mais de um mes atras: pede confirmacao
        assert.equal(status('2026-05', 'Fixa depois'), 'PENDING');
        assert.equal(status('2026-05', 'Variável'), 'PENDING');
        assert.equal(status('2026-05', 'Inativa'), 'PENDING');
        const expense = ok('GET', '/expenses?q=Fixa venceu').find(e => e.date === '2026-05-10');
        assert.ok(expense, 'o lancamento usa a data de vencimento');
        // chamar de novo nao duplica
        occurrences('2026-05');
        assert.equal(ok('GET', '/expenses?q=Fixa venceu').length, 2);
    });

    it('desligado, nada e pago sozinho', () => {
        rule({dayOfMonth: 1});
        occurrences('2026-05');
        assert.equal(ok('GET', '/expenses').length, 0);
    });
});

describe('resumo e "Por vir"', () => {
    it('as pendentes entram na previsao do mes', () => {
        rule({name: 'Aluguel', amount: 1000});
        rule({name: 'Salário', type: 'INCOME', amount: 3000});
        rule({name: 'Variável', variableAmount: true, amount: undefined});
        const s = ok('GET', '/api/summary?month=2026-05');
        assert.deepEqual([s.pendingExpense, s.pendingIncome, s.projectedBalance], [1000, 3000, 2000]);
        assert.equal(ok('GET', `/api/summary?month=2026-05&accountId=${main.id}`).pendingExpense, 1000);
    });

    it('lista as pendentes e as dos proximos meses que ainda nao existem', () => {
        rule({name: 'Aluguel', dayOfMonth: 5, amount: 1000, startMonth: '2026-04'});
        rule({name: 'Luz', variableAmount: true, amount: undefined, dayOfMonth: 20, startMonth: '2026-05'});
        rule({name: 'Acaba em junho', dayOfMonth: 25, amount: 50, startMonth: '2026-05', endMonth: '2026-06'});
        const u = ok('GET', '/api/upcoming?from=2026-05-15&to=2026-07-31');
        assert.deepEqual(u.items.map(i => [i.name, i.date, i.amount, i.overdue]), [
            ['Aluguel', '2026-04-05', 1000, true], // atrasada desde abril
            ['Aluguel', '2026-05-05', 1000, true],
            ['Luz', '2026-05-20', null, false],
            ['Acaba em junho', '2026-05-25', 50, false],
            ['Aluguel', '2026-06-05', 1000, false],
            ['Luz', '2026-06-20', null, false],
            ['Acaba em junho', '2026-06-25', 50, false],
            ['Aluguel', '2026-07-05', 1000, false],
            ['Luz', '2026-07-20', null, false]
        ]);
        assert.equal(u.unknownAmounts, 3);
        assert.equal(u.outgoing, 1000 + 1000 + 50 + 1000 + 50 + 1000);
        assert.equal(call('GET', '/api/upcoming?from=2026-05-15&to=2026-07-31&accountId=99').body.items.length, 0);
    });

    it('com inicio no futuro, o que vence antes entra no saldo inicial (valor variavel conta zero)', () => {
        rule({name: 'Aluguel', dayOfMonth: 5, amount: 1000, startMonth: '2026-05'});
        rule({name: 'Luz', variableAmount: true, amount: undefined, dayOfMonth: 20, startMonth: '2026-05'});
        const u = ok('GET', '/api/upcoming?from=2026-06-01&to=2026-06-30');
        assert.equal(u.startBalance, -1000);
        assert.deepEqual(u.items.map(i => i.date), ['2026-06-05', '2026-06-20']);
        assert.equal(Number.isNaN(u.endBalance), false);
    });
});
