import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {buildSnapshot} from '../src/widget-snapshot.js';

const SQL = await initSqlJs();
let api;
let n = 0;
const ok = (method, url, body) => {
    const res = api.handle(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const snapshot = (extra = {}) => buildSnapshot({api, messages: api.services.messages, now: 1, ...extra});
const norm = text => text.replace(/\s/g, ' ');

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12), newId: () => `w-${++n}`});
    const main = ok('GET', '/accounts')[0];
    ok('PUT', `/accounts/${main.id}`, {...main, initialBalance: 1000});
    ok('POST', '/accounts', {name: 'Reserva', type: 'SAVINGS', parentId: main.id, initialBalance: 500, saved: true});
});

describe('resumo dos widgets', () => {
    it('saldo total e saldo de cada conta (o saldo atual, nao o do mes)', () => {
        const s = snapshot();
        assert.deepEqual(s.balances.map(b => [b.key, b.name, norm(b.main)]), [
            ['total', 'Saldo total', 'R$ 1.000,00'],
            [`a${ok('GET', '/accounts')[0].id}`, 'Conta principal', 'R$ 1.000,00'],
            [`a${ok('GET', '/accounts')[1].id}`, 'Reserva', 'R$ 500,00']
        ]);
        assert.equal(s.balances[2].sub, 'dentro de Conta principal');
        assert.equal(norm(s.balances[0].sub), 'Guardado: R$ 500,00'); // o guardado fica fora do total e aparece a parte
    });

    it('contas arquivadas ficam de fora e saldo negativo e marcado', () => {
        const [main, savings] = ok('GET', '/accounts');
        ok('PUT', `/accounts/${savings.id}`, {...savings, archived: true});
        ok('PUT', `/accounts/${main.id}`, {...main, initialBalance: -20});
        const s = snapshot();
        assert.deepEqual(s.balances.map(b => b.name), ['Saldo total', 'Conta principal']);
        assert.equal(s.balances[0].negative, true);
    });

    it('orcamento: quanto resta do limite do mes, com a barra de uso', () => {
        const food = ok('GET', '/categories').find(c => c.name === 'Alimentação');
        ok('PUT', `/budgets/${food.id}`, {amount: 500, month: '2026-05'});
        ok('POST', '/expenses', {name: 'Mercado', amount: 125, date: '2026-05-10', categoryId: food.id});
        const s = snapshot();
        const item = s.progress.find(p => p.key === `b${food.id}`);
        assert.equal(norm(item.main), 'R$ 375,00');
        assert.equal(item.progress, 25);
        assert.equal(norm(item.sub), 'restante de R$ 500,00 · 25%');
        assert.equal(item.negative, false);
    });

    it('orcamento estourado fica negativo e a barra para em 100', () => {
        const food = ok('GET', '/categories').find(c => c.name === 'Alimentação');
        ok('PUT', `/budgets/${food.id}`, {amount: 100, month: '2026-05'});
        ok('POST', '/expenses', {name: 'Festa', amount: 160, date: '2026-05-10', categoryId: food.id});
        const item = snapshot().progress.find(p => p.key === `b${food.id}`);
        assert.equal(norm(item.main), '-R$ 60,00');
        assert.equal(item.progress, 100);
        assert.equal(item.negative, true);
    });

    it('caixinha: quanto ja foi guardado da meta', () => {
        const pot = ok('POST', '/pots', {name: 'Viagem', goal: 1000, mode: 'VARIABLE', color: '#43A047', icon: 'plane'});
        ok('POST', `/pots/${pot.id}/deposit`, {amount: 250, date: '2026-05-01'});
        const item = snapshot().progress.find(p => p.key === `p${pot.id}`);
        assert.equal(item.choice, 'Caixinha · Viagem');
        assert.equal(norm(item.main), 'R$ 250,00');
        assert.equal(item.progress, 25);
        assert.equal(norm(item.sub), 'guardado de R$ 1.000,00 · 25%');
    });

    it('os textos seguem o idioma do app', () => {
        api.services.messages.settings.setLanguage('en');
        const s = snapshot();
        assert.equal(s.texts.missing, 'Item not found. Tap to open the app.');
    });
});

describe('widgets com contas em outra moeda', () => {
    it('o total soma so a moeda principal e cada conta mostra o saldo na moeda dela', () => {
        ok('POST', '/accounts', {name: 'Wise', currency: 'USD', initialBalance: 50});
        const s = snapshot();
        assert.equal(norm(s.balances[0].main), 'R$ 1.000,00');
        const wise = s.balances.find(b => b.name === 'Wise');
        assert.equal(norm(wise.main), 'US$ 50,00');
    });
});
