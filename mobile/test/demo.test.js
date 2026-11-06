import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {javaHash} from '../src/local-api/demo.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;
let api;

const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const load = () => assert.equal(call('POST', '/api/demo-data').status, 204);
const newApi = (extra = {}) => createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12), newId: () => `d-${++n}`, ...extra}); // 15/05/2026

beforeEach(() => { api = newApi(); });

describe('dados de exemplo', () => {
    it('hash igual ao String.hashCode() do Java', () => {
        assert.equal(javaHash(''), 0);
        assert.equal(javaHash('a'), 97);
        assert.equal(javaHash('Hello'), 69609650); // valor conhecido do Java
        assert.equal(javaHash('polygenelubricants'), -2147483648); // estoura o int de 32 bits (Integer.MIN_VALUE)
    });

    it('cria contas (com um cartao), a caixinha dentro do Nubank, 6 meses de lancamentos, transferencias e orcamentos', () => {
        load();
        const accounts = ok('GET', '/accounts');
        assert.deepEqual(accounts.map(a => a.name).sort(), ['Bradesco', 'Caixinha Nubank', 'Carteira', 'Cartão Nubank', 'Conta principal', 'Nubank', 'Santander']);
        const card = accounts.find(a => a.name === 'Cartão Nubank');
        assert.deepEqual([card.type, card.closingDay, card.dueDay], ['CREDIT_CARD', 25, 5]);
        assert.equal(accounts.find(a => a.name === 'Carteira').type, 'WALLET');
        const caixinha = accounts.find(a => a.name === 'Caixinha Nubank');
        assert.deepEqual([caixinha.type, caixinha.parentName, caixinha.balance, caixinha.color], ['INVESTMENT', 'Nubank', 2489.1, '#43A047']);
        assert.equal(accounts.find(a => a.name === 'Santander').color, '#E53935');

        const all = ok('GET', '/expenses?sort=date,asc');
        assert.equal(all.length, 122); // 6 meses de lancamentos + as parcelas do notebook (10) e da geladeira (12) + 2 a pagar/receber
        assert.equal(ok('GET', '/transfers?month=2026-05').length, 2); // aporte na caixinha e saque para a carteira
        assert.equal(ok('GET', '/transfers?month=2026-04').length, 1);
        const mercado = all.filter(e => e.name === 'Mercado').map(e => [e.date, e.amount]);
        assert.deepEqual(mercado.slice(-4), [['2026-04-03', 405.9], ['2026-04-18', 157.6], ['2026-05-03', 380.9], ['2026-05-15', 150.6]]); // 2a compra do dia 18, limitada a hoje
        assert.deepEqual(ok('GET', '/budgets?month=2026-05').map(b => b.amount).sort((a, b) => a - b), [120, 150, 150, 250, 300, 500, 700]);
    });

    it('parcelados, tags, recorrentes, caixinhas, desejos e modelos', () => {
        load();
        const notebook = ok('GET', '/expenses?sort=date,asc').filter(e => e.name === 'Notebook');
        assert.deepEqual([notebook.length, notebook[0].date, notebook[0].amount, notebook[0].accountName, notebook[9].date], [10, '2026-02-10', 450, 'Cartão Nubank', '2026-11-10']);
        assert.equal(ok('GET', '/expenses').filter(e => e.name === 'Geladeira').length, 12);
        assert.deepEqual(ok('GET', '/tags'), ['presente', 'trabalho', 'viagem']);
        assert.deepEqual(ok('GET', '/expenses?tag=viagem').map(e => e.name).sort(), ['Hospedagem', 'Passagem aérea']);
        assert.deepEqual(ok('GET', '/recurring').map(r => r.name), ['Aluguel recebido', 'Conta de água', 'Plano de saúde', 'Seguro do carro']);
        assert.equal(ok('GET', '/recurring').find(r => r.name === 'Conta de água').variableAmount, true);
        const pots = ok('GET', '/pots');
        assert.deepEqual(pots.map(p => [p.name, p.balance, p.accountName]), [['Equipamentos', 600, null], ['Reserva de emergência', 1800, 'Santander'], ['Viagem', 1700, 'Nubank']]);
        assert.deepEqual(ok('GET', '/wishes').map(w => w.name), ['Bicicleta', 'Cadeira ergonômica', 'Fone de ouvido']);
        assert.deepEqual(ok('GET', '/templates').map(t => t.name), ['Almoço', 'Café', 'Uber']);
    });

    it('no mes atual so vai ate hoje; a conta de luz fica a pagar no dia 28', () => {
        load();
        const may = ok('GET', '/expenses?month=2026-05');
        assert.ok(may.every(e => e.date <= '2026-05-28'));
        assert.equal(may.find(e => e.name === 'Transporte por app').date, '2026-05-15'); // dia 17 limitado a hoje
        assert.ok(may.filter(e => e.status === 'PAID' && !e.installmentTotal).every(e => e.date <= '2026-05-15'));
        const pending = ok('GET', '/expenses?status=PENDING').map(e => [e.name, e.date, e.amount, e.paymentMethodId, e.accountName]).sort();
        assert.deepEqual(pending, [['Conta de luz', '2026-05-28', 142.3, null, 'Santander'], ['Freelance a receber', '2026-05-27', 600, null, 'Nubank']]);
    });

    it('formas de pagamento, categorias e saldo do painel', () => {
        load();
        const salary = ok('GET', '/expenses?q=Sal%C3%A1rio&sort=date,asc')[0];
        assert.deepEqual([salary.type, salary.amount, salary.accountName, salary.paymentMethodName, salary.categoryName], ['INCOME', 5200, 'Santander', 'Transferência', 'Salário']);
        const s = ok('GET', '/api/summary?month=2026-04');
        assert.equal(s.income, 6063.35); // salario + freelance (850) + rendimentos da caixinha (13,35)
        assert.equal(s.expense, 3365.8);
        assert.ok(s.categories.find(c => c.name === 'Mercado').budget === 700);
        assert.equal(ok('GET', '/accounts').find(a => a.name === 'Santander').balance, 22121.2);
    });

    it('rodar de novo nao duplica nada', () => {
        load();
        const snapshot = () => [ok('GET', '/expenses').length, ok('GET', '/accounts').length, ok('GET', '/categories').length,
            api.db.value('select count(*) from transfers'), api.db.value('select count(*) from budgets')];
        const first = snapshot();
        load();
        assert.deepEqual(snapshot(), first);
    });

    it('depois de limpar tudo, carregar de novo traz tudo de volta (a copia continua na lixeira)', () => {
        load();
        ok('DELETE', '/api/data');
        assert.equal(ok('GET', '/expenses').length, 0);
        load();
        assert.equal(ok('GET', '/expenses').length, 122);
        assert.deepEqual(ok('GET', '/trash').map(t => t.kind), ['EVERYTHING']);
    });

    it('nao mexe no que a pessoa ja tinha', () => {
        ok('POST', '/expenses', {name: 'Meu lançamento', amount: 9, date: '2026-05-02'});
        const cat = ok('POST', '/categories', {name: 'Minha categoria'});
        load();
        assert.ok(ok('GET', '/expenses').some(e => e.name === 'Meu lançamento'));
        assert.ok(ok('GET', '/categories').some(c => c.id === cat.id));
    });

    it('num app em ingles cria as categorias que faltam, com cor estavel', () => {
        ok('PUT', '/app/language', {language: 'en'});
        api = newApi({languageStore: {get: () => 'en', set: () => {}}});
        load();
        const cats = ok('GET', '/categories');
        const moradia = cats.find(c => c.name === 'Moradia');
        assert.ok(moradia && /^#[0-9A-F]{6}$/.test(moradia.color));
        assert.equal(moradia.color, ['#E57373', '#81C784', '#64B5F6', '#FFB74D', '#BA68C8', '#4DB6AC', '#F06292', '#A1887F'][((javaHash('Moradia') % 8) + 8) % 8]);
        assert.ok(cats.some(c => c.name === 'Food')); // as padrao em ingles continuam la
    });

    it('janeiro: os meses anteriores viram o ano', () => {
        api = createApi(new SQL.Database(), {clock: () => new Date(2027, 0, 20, 12), newId: () => `d-${++n}`});
        load();
        const months = [...new Set(ok('GET', '/expenses').map(e => e.date.slice(0, 7)))].sort();
        assert.equal(months[0], '2026-08'); // 6 meses: de agosto de 2026 a janeiro de 2027
        assert.ok(months.includes('2026-12') && months.includes('2027-01'));
    });
});
