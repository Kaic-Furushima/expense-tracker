import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {MAX_SCHEDULED, notificationId, planNotifications} from '../src/notification-plan.js';

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
const bill = (name, amount, date, extra = {}) => ok('POST', '/expenses', {name, amount, date, status: 'PENDING', ...extra});
const reminders = () => ok('GET', '/api/reminders').map(r => ({...r, detail: r.detail.replace(/ /g, ' ')}));
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);

beforeEach(() => {
    now = at(2026, 5, 15); // sexta-feira
    api = createApi(new SQL.Database(), {clock: () => now, newId: () => `l-${++n}`});
});

describe('lembretes de contas', () => {
    it('vencida: alerta com os dias de atraso e o valor', () => {
        bill('Luz', 120, '2026-05-10');
        const [r] = reminders();
        assert.deepEqual([r.kind, r.level, r.title, r.detail, r.date], ['OVERDUE', 'ALERT', 'Vencida: Luz', 'Venceu em 10/05 (5 dias de atraso) · R$ 120,00', '2026-05-10']);
        assert.match(r.key, /^overdue:EXPENSE:\d+:Luz:2026-05-10$/);
        bill('Água', 50, '2026-05-14');
        assert.equal(reminders().find(x => x.title === 'Vencida: Água').detail, 'Venceu em 14/05 (1 dia de atraso) · R$ 50,00');
    });

    it('hoje e amanha sao avisos; ate o fim da janela e informativo; depois, nada', () => {
        bill('Hoje', 10, '2026-05-15');
        bill('Amanhã', 20, '2026-05-16');
        bill('Em três dias', 30, '2026-05-18');
        bill('Longe', 40, '2026-05-19'); // fora da janela padrao de 3 dias
        const found = reminders().map(r => [r.title, r.level, r.detail]);
        assert.deepEqual(found, [
            ['Hoje vence hoje', 'WARN', 'R$ 10,00 · Conta principal'],
            ['Amanhã vence amanhã', 'WARN', 'R$ 20,00 · Conta principal'],
            ['Em três dias vence em 3 dias (18/05)', 'INFO', 'R$ 30,00 · Conta principal']
        ]);
    });

    it('a janela de aviso e configuravel', () => {
        bill('Longe', 40, '2026-05-19');
        ok('PUT', '/api/settings', {reminderDays: 5});
        assert.equal(reminders()[0].title, 'Longe vence em 4 dias (19/05)');
    });

    it('receitas a receber nao geram lembrete; valor variavel pede o valor', () => {
        bill('Freela', 500, '2026-05-16', {type: 'INCOME'});
        ok('POST', '/recurring', {name: 'Gás', variableAmount: true, dayOfMonth: 16, startMonth: '2026-05'});
        const found = reminders();
        assert.equal(found.length, 1);
        assert.deepEqual([found[0].title, found[0].detail], ['Gás vence amanhã', 'valor a informar · Conta principal']);
    });

    it('fatura de cartao e parcela recorrente entram', () => {
        const card = ok('POST', '/accounts', {name: 'Nubank', type: 'CREDIT_CARD', closingDay: 5, dueDay: 16});
        ok('POST', '/expenses', {name: 'Compra', amount: 300, date: '2026-05-02', accountId: card.id});
        ok('POST', '/recurring', {name: 'Aluguel', amount: 1000, dayOfMonth: 15, startMonth: '2026-05'});
        assert.deepEqual(reminders().map(r => r.title), ['Aluguel vence hoje', 'Fatura Nubank 05/2026 vence amanhã']);
    });

    it('desligar os lembretes esvazia a lista', () => {
        bill('Luz', 120, '2026-05-10');
        ok('PUT', '/api/settings', {remindersEnabled: false});
        assert.deepEqual(ok('GET', '/api/reminders'), []);
    });

    it('conta paga deixa de lembrar', () => {
        const e = bill('Luz', 120, '2026-05-10');
        ok('POST', `/expenses/${e.id}/pay`, {});
        assert.deepEqual(reminders(), []);
    });

    it('as mensagens seguem o idioma', () => {
        bill('Luz', 120, '2026-05-10');
        ok('PUT', '/app/language', {language: 'en'});
        let [r] = reminders();
        assert.deepEqual([r.title, r.detail], ['Overdue: Luz', 'Was due on 10/05 (5 days late) · R$120.00']);
        ok('PUT', '/app/language', {language: 'es'});
        [r] = reminders();
        assert.equal(r.title, 'Vencida: Luz');
        assert.match(r.detail, /^Venció el 10\/05 \(5 días de atraso\) · 120,00 /);
    });
});

describe('lembretes de orcamento e fim do mes', () => {
    const food = () => ok('GET', '/categories').find(c => c.name === 'Alimentação');
    const limit = (amount) => ok('PUT', `/budgets/${food().id}?month=2026-05`, {amount});
    const eat = amount => ok('POST', '/expenses', {name: 'Jantar', amount, date: '2026-05-02', categoryId: food().id});

    it('perto do limite (80%) e estourado (100%)', () => {
        limit(500);
        eat(399.99);
        assert.deepEqual(reminders(), []);
        eat(0.01);
        let [r] = reminders();
        assert.deepEqual([r.kind, r.level, r.title, r.detail, r.key], ['BUDGET', 'WARN', 'Alimentação: perto do limite', 'R$ 400,00 de R$ 500,00 (80%)', `budget:cat${food().id}:2026-05:80`]);
        eat(100);
        [r] = reminders();
        assert.deepEqual([r.level, r.title, r.detail, r.key], ['ALERT', 'Alimentação: orçamento estourado', 'R$ 500,00 de R$ 500,00 (100%)', `budget:cat${food().id}:2026-05:100`]);
    });

    it('o limite geral tambem avisa', () => {
        ok('PUT', '/budgets/total?month=2026-05', {amount: 1000});
        ok('POST', '/expenses', {name: 'Tudo', amount: 900, date: '2026-05-03'});
        const [r] = reminders();
        assert.deepEqual([r.title, r.detail, r.key], ['Limite geral do mês: perto do limite', 'R$ 900,00 de R$ 1.000,00 (90%)', 'budget:total:2026-05:80']);
    });

    it('fim do mes: no penultimo e no ultimo dia', () => {
        assert.deepEqual(reminders(), []);
        now = at(2026, 5, 30);
        let [r] = reminders();
        assert.deepEqual([r.kind, r.level, r.title, r.date, r.key], ['MONTH_END', 'INFO', 'O mês termina amanhã', '2026-05-31', 'monthend:2026-05']);
        now = at(2026, 5, 31);
        assert.equal(reminders()[0].title, 'Hoje é o último dia do mês');
    });
});

describe('avisos agendados no celular', () => {
    const messages = () => api.services.messages;
    const plan = (extra = {}) => {
        const today = '2026-05-15';
        const {items} = api.services.upcoming.compute(today, '2026-06-30', null);
        return planNotifications({items, today, now, reminderDays: 3, messages: messages(), ...extra});
    };
    const brief = p => p.map(x => [x.at.getDate() + '/' + (x.at.getMonth() + 1) + ' ' + x.at.getHours() + 'h', x.title]);

    it('um aviso N dias antes e outro no dia, as 9h; sem o que ja passou', () => {
        bill('Luz', 120, '2026-05-20');
        bill('Velha', 10, '2026-05-10'); // atrasada: aparece no app, nao e agendada
        const found = brief(plan());
        assert.deepEqual(found.slice(0, 2), [['17/5 9h', 'Luz vence em 3 dias'], ['20/5 9h', 'Luz vence hoje']]);
        assert.ok(!found.some(([, t]) => t.includes('Velha')));
    });

    it('o corpo traz valor e conta; valor variavel pede o valor', () => {
        bill('Luz', 120, '2026-05-20');
        ok('POST', '/recurring', {name: 'Gás', variableAmount: true, dayOfMonth: 25, startMonth: '2026-05'});
        const bodies = plan().filter(p => !p.title.includes('mês')).map(p => p.body.replace(/ /g, ' '));
        assert.ok(bodies.includes('R$ 120,00 · Conta principal'));
        assert.ok(bodies.includes('valor a informar · Conta principal'));
    });

    it('nao agenda o que ja passou do horario, nem receitas', () => {
        bill('Hoje cedo', 10, '2026-05-15'); // 9h de hoje ja passou (agora sao 12h)
        bill('Freela', 500, '2026-05-20', {type: 'INCOME'});
        assert.ok(!plan().some(p => p.title.includes('Hoje cedo')));
        assert.ok(!plan().some(p => p.title.includes('Freela')));
        assert.ok(plan({now: at(2026, 5, 15, 8)}).some(p => p.title === 'Hoje cedo vence hoje'));
    });

    it('fim do mes: dois avisos', () => {
        assert.deepEqual(brief(plan()), [['30/5 9h', 'O mês termina amanhã'], ['31/5 9h', 'Hoje é o último dia do mês']]);
    });

    it('sem antecedencia, so o aviso do dia', () => {
        bill('Luz', 120, '2026-05-20');
        assert.deepEqual(brief(plan({reminderDays: 0})).filter(([, t]) => t.startsWith('Luz')), [['20/5 9h', 'Luz vence hoje']]);
    });

    it('ids estaveis, unicos e positivos; replanejar nao muda nada', () => {
        bill('Luz', 120, '2026-05-20');
        bill('Água', 80, '2026-05-22');
        const a = plan();
        const b = plan();
        assert.deepEqual(a.map(p => p.id), b.map(p => p.id));
        assert.equal(new Set(a.map(p => p.id)).size, a.length);
        assert.ok(a.every(p => Number.isInteger(p.id) && p.id > 0 && p.id <= 0x7fffffff));
        assert.equal(notificationId('x'), notificationId('x'));
        assert.notEqual(notificationId('x'), notificationId('y'));
    });

    it('guarda so os mais proximos, em ordem', () => {
        for (let i = 0; i < 40; i++) bill(`Conta ${i}`, 10, `2026-06-${String((i % 28) + 1).padStart(2, '0')}`);
        const found = plan();
        assert.equal(found.length, MAX_SCHEDULED);
        assert.deepEqual(found.map(p => +p.at), found.map(p => +p.at).sort((x, y) => x - y));
    });

    it('as mensagens seguem o idioma', () => {
        bill('Luz', 120, '2026-05-20');
        ok('PUT', '/app/language', {language: 'en'});
        assert.deepEqual(brief(plan()).slice(0, 2), [['17/5 9h', 'Luz is due in 3 days'], ['20/5 9h', 'Luz is due today']]);
    });
});
