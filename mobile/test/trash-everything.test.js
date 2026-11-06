import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;
let now;
let api;

const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const names = url => ok('GET', url).map(x => x.name).sort();
const snapshots = () => ok('GET', '/trash').filter(i => i.kind === 'EVERYTHING');

beforeEach(() => {
    now = new Date(2026, 4, 15, 12, 0, 0);
    api = createApi(new SQL.Database(), {clock: () => now, newId: () => `e-${++n}`});
});

describe('limpar tudo (tudo para a lixeira)', () => {
    it('deixa o app como recem-instalado e guarda uma copia completa na lixeira', () => {
        ok('POST', '/api/demo-data');
        ok('PUT', '/api/settings', {currency: 'USD'});
        ok('DELETE', '/api/data');

        assert.deepEqual(names('/accounts'), ['Conta principal']);
        assert.equal(ok('GET', '/expenses').length, 0);
        assert.deepEqual([ok('GET', '/budgets').length, ok('GET', '/recurring').length, ok('GET', '/pots').length, ok('GET', '/wishes').length,
            ok('GET', '/templates').length, ok('GET', '/tags').length], [0, 0, 0, 0, 0, 0]);
        assert.deepEqual(names('/payment-methods'), ['Boleto', 'Crédito', 'Dinheiro', 'Débito', 'Pix', 'Transferência']);
        assert.ok(ok('GET', '/categories').length >= 11); // as categorias padrao voltam
        assert.equal(ok('GET', '/api/settings').currency, 'BRL'); // as configuracoes tambem voltam ao padrao

        const [copy] = snapshots();
        assert.deepEqual([copy.title, copy.amount, copy.date, copy.deletedAt], ['Todos os dados', null, null, '2026-05-15T12:00:00.000']);
        assert.equal(copy.detail, '122 lançamentos · 7 contas · 17 categorias · 7 orçamentos · 4 recorrentes · 3 caixinhas');
    });

    it('o app volta a funcionar do zero (ids recomecam, da para lançar)', () => {
        ok('POST', '/api/demo-data');
        ok('DELETE', '/api/data');
        const account = ok('GET', '/accounts')[0];
        assert.equal(account.id, 1);
        const created = ok('POST', '/expenses', {name: 'Novo', amount: 5, date: '2026-05-02'});
        assert.equal(created.id, 1);
        assert.equal(ok('GET', '/accounts')[0].balance, -5);
    });

    it('restaurar a copia devolve tudo como estava (lancamentos, contas, caixinhas, parcelas, tags...)', () => {
        ok('POST', '/api/demo-data');
        const before = {
            accounts: ok('GET', '/accounts').map(a => [a.name, a.balance]),
            expenses: ok('GET', '/expenses').length,
            pots: ok('GET', '/pots').map(p => [p.name, p.balance, p.accountName]),
            tags: ok('GET', '/tags'),
            summary: ok('GET', '/api/summary?month=2026-04')
        };
        ok('DELETE', '/api/data');
        const [copy] = snapshots();
        assert.equal(call('POST', `/trash/EVERYTHING/${copy.id}/restore`).status, 204);

        assert.deepEqual(ok('GET', '/accounts').map(a => [a.name, a.balance]), before.accounts);
        assert.equal(ok('GET', '/expenses').length, before.expenses);
        assert.deepEqual(ok('GET', '/pots').map(p => [p.name, p.balance, p.accountName]), before.pots);
        assert.deepEqual(ok('GET', '/tags'), before.tags);
        assert.deepEqual(ok('GET', '/api/summary?month=2026-04'), before.summary);
        assert.equal(snapshots().length, 0); // a copia foi usada
    });

    it('restaurar guarda tambem o que existe agora, para nada se perder', () => {
        ok('POST', '/api/demo-data');
        ok('DELETE', '/api/data');
        ok('POST', '/expenses', {name: 'Depois de limpar', amount: 9, date: '2026-05-03'});
        ok('POST', `/trash/EVERYTHING/${snapshots()[0].id}/restore`);

        const [saved] = snapshots();
        assert.ok(saved, 'o estado de antes da restauracao esta na lixeira');
        ok('POST', `/trash/EVERYTHING/${saved.id}/restore`); // desfazer: volta o app so com o lancamento
        assert.deepEqual(ok('GET', '/expenses').map(e => e.name), ['Depois de limpar']);
    });

    it('limpar um app vazio de novo nao enche a lixeira com copias iguais ao vazio ao restaurar', () => {
        ok('DELETE', '/api/data'); // app novo: nada para guardar alem do padrao
        ok('POST', `/trash/EVERYTHING/${snapshots()[0].id}/restore`);
        assert.equal(snapshots().length, 0); // sem dados do usuario, o estado de agora nao vira copia
    });

    it('excluir uma copia de vez, esvaziar a lixeira e o prazo de 30 dias', () => {
        ok('POST', '/api/demo-data');
        ok('DELETE', '/api/data');
        ok('POST', '/api/demo-data');
        now = new Date(2026, 4, 20, 12);
        ok('DELETE', '/api/data');
        assert.equal(snapshots().length, 2);

        assert.equal(call('DELETE', `/trash/EVERYTHING/${snapshots()[1].id}`).status, 204); // a mais antiga
        assert.equal(snapshots().length, 1);
        assert.equal(call('DELETE', '/trash/EVERYTHING/999').status, 404);
        assert.equal(call('POST', '/trash/EVERYTHING/999/restore').status, 404);

        now = new Date(2026, 5, 25, 12); // 36 dias depois da copia
        api.services.trash.purgeExpired();
        assert.equal(snapshots().length, 0);

        ok('POST', '/api/demo-data');
        ok('DELETE', '/api/data');
        ok('DELETE', '/trash');
        assert.equal(ok('GET', '/trash').length, 0);
    });

    it('o idioma escolhido continua depois de limpar tudo, e as categorias padrao vem nele', () => {
        api = createApi(new SQL.Database(), {clock: () => now, newId: () => `e-${++n}`});
        ok('PUT', '/app/language', {language: 'en'});
        ok('DELETE', '/api/data');
        assert.ok(ok('GET', '/categories').some(c => c.name === 'Food'));
        assert.equal(ok('GET', '/profiles').language, 'en');
    });

    it('a copia nao entra no backup e um backup restaurado nao a apaga', () => {
        ok('POST', '/api/demo-data');
        ok('DELETE', '/api/data');
        const dump = JSON.parse(api.services.backup.dump());
        assert.ok(!('trash_snapshots' in dump.tables));
        api.services.backup.restore(JSON.stringify(dump));
        assert.equal(snapshots().length, 1);
    });
});
