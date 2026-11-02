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

    it('cria contas, a caixinha dentro do Nubank, 3 meses de lancamentos, transferencias e orcamentos', () => {
        load();
        const accounts = ok('GET', '/accounts');
        assert.deepEqual(accounts.map(a => a.name).sort(), ['Bradesco', 'Caixinha Nubank', 'Conta principal', 'Nubank', 'Santander']);
        const caixinha = accounts.find(a => a.name === 'Caixinha Nubank');
        assert.deepEqual([caixinha.type, caixinha.parentName, caixinha.balance, caixinha.color], ['INVESTMENT', 'Nubank', 1200, '#43A047']);
        assert.equal(accounts.find(a => a.name === 'Santander').color, '#E53935');

        const all = ok('GET', '/expenses?sort=date,asc');
        assert.equal(all.length, 22); // 7 por mes em 3 meses + a conta de luz a pagar
        assert.equal(ok('GET', '/transfers?month=2026-05').length, 1);
        assert.equal(ok('GET', '/transfers?month=2026-03').length, 1);
        const mercado = all.filter(e => e.name === 'Mercado').map(e => [e.date, e.amount]);
        assert.deepEqual(mercado, [['2026-03-03', 430.9], ['2026-04-03', 405.9], ['2026-05-03', 380.9]]);
        assert.deepEqual(ok('GET', '/budgets?month=2026-05').map(b => [b.categoryId, b.amount]).sort((a, b) => a[1] - b[1]).map(x => x[1]), [150, 500, 700]);
    });

    it('no mes atual so vai ate hoje; a conta de luz fica a pagar no dia 28', () => {
        load();
        const may = ok('GET', '/expenses?month=2026-05');
        assert.ok(may.every(e => e.date <= '2026-05-28'));
        assert.equal(may.filter(e => e.status === 'PAID').every(e => e.date <= '2026-05-15'), true);
        assert.equal(may.find(e => e.name === 'Transporte por app').date, '2026-05-15'); // dia 17 limitado a hoje
        const luz = ok('GET', '/expenses?status=PENDING');
        assert.deepEqual(luz.map(e => [e.name, e.date, e.amount, e.paymentMethodId, e.accountName]), [['Conta de luz', '2026-05-28', 142.3, null, 'Santander']]);
    });

    it('formas de pagamento, categorias e saldo do painel', () => {
        load();
        const salary = ok('GET', '/expenses?q=Sal%C3%A1rio&sort=date,asc')[0];
        assert.deepEqual([salary.type, salary.amount, salary.accountName, salary.paymentMethodName, salary.categoryName], ['INCOME', 5200, 'Santander', 'Transferência', 'Salário']);
        const s = ok('GET', '/api/summary?month=2026-04');
        assert.equal(s.income, 5200);
        assert.equal(s.expense, 2160.5); // 1450 + 405,90 + 99,90 + 55,90 + 100,50 + 48,30
        assert.ok(s.categories.find(c => c.name === 'Mercado').budget === 700);
        // 3 salarios (15.600) - 3 alugueis (4.350) - 3 aportes na caixinha (1.200) - transportes (54,30 + 48,30 + 42,30)
        assert.equal(ok('GET', '/accounts').find(a => a.name === 'Santander').balance, 9905.1);
    });

    it('rodar de novo nao duplica nada', () => {
        load();
        const snapshot = () => [ok('GET', '/expenses').length, ok('GET', '/accounts').length, ok('GET', '/categories').length,
            api.db.value('select count(*) from transfers'), api.db.value('select count(*) from budgets')];
        const first = snapshot();
        load();
        assert.deepEqual(snapshot(), first);
    });

    it('depois de limpar tudo, carregar de novo traz os lancamentos de volta (a lixeira nao conta)', () => {
        load();
        ok('DELETE', '/api/data');
        assert.equal(ok('GET', '/expenses').length, 0);
        load();
        assert.equal(ok('GET', '/expenses').length, 22);
        assert.equal(ok('GET', '/trash').length, 22 + 3); // os antigos continuam na lixeira
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
        assert.deepEqual([...new Set(ok('GET', '/expenses').map(e => e.date.slice(0, 7)))].sort(), ['2026-11', '2026-12', '2027-01']);
    });
});
