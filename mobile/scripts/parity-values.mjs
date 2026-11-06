// Ferramenta de conferencia (nao faz parte do app): roda o MESMO cenario no back-end Java (PC) e na API local do celular
// e compara os VALORES devolvidos (nao so o formato). Precisa do app do PC rodando num banco novo. Uso:
//   node scripts/parity-values.mjs http://127.0.0.1:18080
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';

const PC = process.argv[2] ?? 'http://127.0.0.1:18080';
const SQL = await initSqlJs();
const mobile = createApi(new SQL.Database(), {clock: () => new Date(), newId: () => crypto.randomUUID()});

async function pc(method, url, body) {
    const res = await fetch(PC + url, {method, headers: {'Content-Type': 'application/json', Origin: PC}, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await res.text();
    let json = text;
    try { json = text ? JSON.parse(text) : null; } catch { /* texto */ }
    return {status: res.status, body: json};
}
async function mob(method, url, body) {
    try {
        const r = mobile.handle(method, url, body);
        return {status: r.status, body: r.body !== undefined && r.body !== null ? r.body : (r.text ?? null)};
    } catch (e) { return {status: 'ERRO ' + e.message, body: null}; }
}

const IGNORE = new Set(['createdAt', 'updatedAt', 'now', 'generatedAt', 'version', 'dataFolder', 'folder']);
const clean = v => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !IGNORE.has(k)).map(([k, x]) => [k, clean(x)]));
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    return v;
};
const diffs = [];
function deepDiff(a, b, path, out) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) deepDiff(a[k], b[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`, out);
        return;
    }
    out.push(`${path}: pc=${JSON.stringify(a)} celular=${JSON.stringify(b)}`);
}

const ids = {pc: {}, mob: {}};
async function both(label, method, url, body, {compare = true} = {}) {
    const resolve = (side, v) => (typeof v === 'function' ? v(side) : v);
    const u = side => resolve(side, url), b = side => resolve(side, body);
    const a = await pc(method, u('pc'), b('pc'));
    const m = await mob(method, u('mob'), b('mob'));
    if (compare) {
        const out = [];
        if (a.status !== m.status) out.push(`status pc=${a.status} celular=${m.status} (${JSON.stringify(a.body)?.slice(0, 120)} | ${JSON.stringify(m.body)?.slice(0, 120)})`);
        else deepDiff(clean(a.body), clean(m.body), '', out);
        if (out.length) diffs.push({label, out: out.slice(0, 8), more: Math.max(0, out.length - 8)});
    }
    return {pc: a.body, mob: m.body};
}
const id = (side, key) => ids[side][key];

// ---------- cenario ----------
const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
const ymd = (monthsBack, day) => { const d = new Date(today.getFullYear(), today.getMonth() - monthsBack, day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const month = n => ymd(n, 1).slice(0, 7);

const base = await both('contas iniciais', 'GET', '/accounts');
const cats = await both('categorias iniciais', 'GET', '/categories');
await both('formas de pagamento iniciais', 'GET', '/payment-methods');
for (const side of ['pc', 'mob']) {
    ids[side].main = base[side][0].id;
    const find = (name, kind = 'EXPENSE') => cats[side].find(c => c.name === name && (c.kind ?? 'EXPENSE') === kind)?.id;
    ids[side].food = find('Alimentação');
    ids[side].salary = cats[side].find(c => c.kind === 'INCOME')?.id;
}

const acc = async (key, body) => {
    const r = await both(`criar conta ${key}`, 'POST', '/accounts', body);
    ids.pc[key] = r.pc.id; ids.mob[key] = r.mob.id;
};
await acc('bank', {name: 'Banco X', type: 'CHECKING', initialBalance: 1000, color: '#112233', icon: 'bank'});
await acc('sub', side => ({name: 'Cofrinho', type: 'INVESTMENT', initialBalance: 50, parentId: id(side, 'bank')}));
await acc('card', {name: 'Cartão Y', type: 'CREDIT_CARD', closingDay: 10, dueDay: 20});
await acc('card2', {name: 'Cartão Z', type: 'CREDIT_CARD', closingDay: 31, dueDay: 5});
// os testes do mobile passam parentId como numero; no Java side-specific
const A = side => id(side, 'bank'), CARD = side => id(side, 'card'), CARD2 = side => id(side, 'card2'), SUB = side => id(side, 'sub');

const cat = await both('criar categoria', 'POST', '/categories', {name: 'Mercado extra', icon: 'tag', color: '#334455', kind: 'EXPENSE'});
await both('criar subcategoria', 'POST', '/categories', side => ({name: 'Feira', icon: 'tag', color: '#334455', kind: 'EXPENSE', parentId: id(side, 'food')}));
await both('categoria duplicada', 'POST', '/categories', {name: 'Mercado extra', icon: 'tag', color: '#334455', kind: 'EXPENSE'});
await both('criar forma', 'POST', '/payment-methods', {name: 'Vale'});
const catX = side => (side === 'pc' ? cat.pc.id : cat.mob.id);

const e = (name, amount, date, extra = {}) => side => ({name, amount, date, accountId: A(side), categoryId: id(side, 'food'), ...extra});
const post = (label, body) => both(label, 'POST', '/expenses', body);
await post('despesa paga', e('Mercado', 123.45, ymd(0, 2)));
await post('despesa pendente', e('Luz', 99.9, ymd(0, 20), {status: 'PENDING'}));
await post('despesa atrasada', e('Água', 40, ymd(0, 1), {status: 'PENDING'}));
await post('despesa com tags', e('Padaria', 15.5, ymd(1, 5), {tags: ['pao', 'manha'], description: 'obs'}));
await post('receita', side => ({name: 'Salário', amount: 3000, date: ymd(0, 3), type: 'INCOME', accountId: A(side), categoryId: id(side, 'salary')}));
await post('parcelado 3x', e('TV', 1000, ymd(0, 4), {installments: 3}));
await post('parcelado 7x (centavos)', e('Sofá', 100.01, ymd(1, 28), {installments: 7}));
await post('parcelado no cartão', side => ({name: 'Celular', amount: 1200, date: ymd(0, 8), accountId: CARD(side), installments: 4, categoryId: id(side, 'food')}));
await post('compra no cartão após fechamento', side => ({name: 'Jantar', amount: 80, date: ymd(0, 12), accountId: CARD(side)}));
await post('compra no cartão dia 31', side => ({name: 'Cinema', amount: 60, date: ymd(0, 1), accountId: CARD2(side)}));
await post('plano próprio', side => ({name: 'Viagem', amount: 600, date: ymd(0, 6), accountId: A(side), installmentPlan: [
    {date: ymd(0, 6), status: 'PAID', amount: 100}, {date: ymd(-1, 10), amount: 300}, {date: ymd(-2, 10)}]}));
await post('estorno no cartão', side => ({name: 'Estorno', amount: 30, date: ymd(0, 9), accountId: CARD(side), type: 'INCOME'}));
await post('despesa na subconta', e('Ajuda', 10, ymd(0, 7), {accountId: undefined}));
await post('valor inválido', e('Zero', 0, ymd(0, 2)));
await post('sem nome', e('', 5, ymd(0, 2)));
await post('data ruim', e('X', 5, '2026-13-45'));

const exps = await both('lista de lançamentos do mês', 'GET', `/expenses?month=${month(0)}`);
const expsAll = await both('lista de lançamentos (todos)', 'GET', '/expenses?size=500');
await both('lançamentos ordenados por valor', 'GET', `/expenses?month=${month(0)}&sort=amount,desc`);
await both('filtro por conta', 'GET', side => `/expenses?accountId=${A(side)}`);
await both('filtro por texto', 'GET', '/expenses?q=mercado');
await both('filtro por status', 'GET', '/expenses?status=PENDING');
await both('filtro por tag', 'GET', '/expenses?tag=pao');
await both('filtro por valor', 'GET', '/expenses?minAmount=50&maxAmount=200');
await both('filtro por período', 'GET', side => `/expenses?from=${ymd(1, 1)}&to=${ymd(0, 15)}`);
await both('sugestões', 'GET', '/expenses/suggestions?q=Mer');
await both('tags', 'GET', '/tags');

// editar, pagar, excluir
const firstPending = side => (side === 'pc' ? exps.pc : exps.mob).find(x => x.name === 'Luz').id;
await both('pagar pendente', 'POST', side => `/expenses/${firstPending(side)}/pay`, {});
const mercado = side => (side === 'pc' ? exps.pc : exps.mob).find(x => x.name === 'Mercado').id;
await both('editar despesa', 'PUT', side => `/expenses/${mercado(side)}`, side => ({name: 'Mercado 2', amount: 130, date: ymd(0, 2), accountId: A(side), categoryId: id(side, 'food'), tags: ['x']}));
const padaria = side => (side === 'pc' ? exps.pc : exps.mob);
await both('excluir despesa', 'DELETE', side => `/expenses/${mercado(side)}`);
await both('lixeira', 'GET', '/trash');
const trash = await pc('GET', '/trash');
const trashM = await mob('GET', '/trash');
await both('restaurar da lixeira', 'POST', side => `/trash/${(side === 'pc' ? trash : trashM).body[0].kind.toLowerCase?.() ?? 'expense'}/${(side === 'pc' ? trash : trashM).body[0].id}/restore`, {});

// transferências e faturas
await both('transferência', 'POST', '/transfers', side => ({fromAccountId: A(side), toAccountId: SUB(side), amount: 100, date: ymd(0, 5), description: 'guardar'}));
await both('transferência mesma conta', 'POST', '/transfers', side => ({fromAccountId: A(side), toAccountId: A(side), amount: 1, date: ymd(0, 5)}));
await both('lista de transferências', 'GET', '/transfers');
await both('faturas do cartão', 'GET', side => `/accounts/${CARD(side)}/invoices`);
await both('fatura do mês', 'GET', side => `/accounts/${CARD(side)}/invoices/${month(0)}`);
await both('fatura do mês seguinte', 'GET', side => `/accounts/${CARD(side)}/invoices/${month(-1)}`);
await both('faturas do cartão 2', 'GET', side => `/accounts/${CARD2(side)}/invoices`);
await both('pagar fatura', 'POST', side => `/accounts/${CARD(side)}/invoices/${month(0)}/pay`, side => ({fromAccountId: A(side), amount: 50, date: ymd(0, 15)}));
await both('fatura depois do pagamento', 'GET', side => `/accounts/${CARD(side)}/invoices/${month(0)}`);

// orçamentos
await both('orçamento total', 'PUT', '/budgets/total', {amount: 3000, fromMonth: month(1)});
await both('orçamento por categoria', 'PUT', side => `/budgets/${id(side, 'food')}`, {amount: 400, fromMonth: month(1)});
await both('orçamento outro mês', 'PUT', side => `/budgets/${id(side, 'food')}`, {amount: 500, fromMonth: month(0)});
await both('orçamentos', 'GET', '/budgets');
await both('orçamento total GET', 'GET', '/budgets/total');
await both('configurações', 'PUT', '/api/settings', {budgetRollover: true, autoPayRecurring: true, currency: 'USD', reminderDays: 5, remindersEnabled: true, autoBackup: true});
await both('configurações GET', 'GET', '/api/settings');

// recorrentes
const rec = await both('recorrente fixo', 'POST', '/recurring', side => ({name: 'Internet', type: 'EXPENSE', amount: 100, dayOfMonth: 10, accountId: A(side), startMonth: month(1), categoryId: id(side, 'food')}));
await both('recorrente variável', 'POST', '/recurring', side => ({name: 'Energia', type: 'EXPENSE', variableAmount: true, dayOfMonth: 31, accountId: A(side), startMonth: month(1)}));
await both('recorrente receita', 'POST', '/recurring', side => ({name: 'Aluguel', type: 'INCOME', amount: 500, dayOfMonth: 5, accountId: A(side), startMonth: month(0), endMonth: month(-2)}));
await both('recorrentes', 'GET', '/recurring');
const occ = await both('ocorrências do mês', 'GET', `/recurring/occurrences?month=${month(0)}`);
await both('ocorrências mês passado', 'GET', `/recurring/occurrences?month=${month(1)}`);
await both('ocorrências mês futuro', 'GET', `/recurring/occurrences?month=${month(-1)}`);
const occId = (side, name) => (side === 'pc' ? occ.pc : occ.mob).find(o => o.name === name || o.recurringName === name)?.id;
await both('pagar ocorrência', 'POST', side => `/recurring/occurrences/${occId(side, 'Internet')}/pay`, {});
await both('pular ocorrência', 'POST', side => `/recurring/occurrences/${occId(side, 'Aluguel')}/skip`, {});
await both('ocorrência variável sem valor', 'POST', side => `/recurring/occurrences/${occId(side, 'Energia')}/pay`, {});
await both('ocorrência variável com valor', 'POST', side => `/recurring/occurrences/${occId(side, 'Energia')}/pay`, {amount: 77.7});
await both('ocorrências depois', 'GET', `/recurring/occurrences?month=${month(0)}`);

// caixinhas e desejos
const pot = await both('caixinha fixa', 'POST', '/pots', side => ({name: 'Viagem', mode: 'FIXED', monthlyAmount: 200, startMonth: month(2), goal: 2000, accountId: A(side)}));
await both('caixinha variável', 'POST', '/pots', {name: 'Reserva', mode: 'VARIABLE'});
await both('caixinhas', 'GET', '/pots');
const potId = (side, n) => ((side === 'pc' ? pot.pc : pot.mob), n);
const pots = await pc('GET', '/pots'); const potsM = await mob('GET', '/pots');
const potOf = (side, name) => (side === 'pc' ? pots : potsM).body.find(p => p.name === name).id;
await both('aporte', 'POST', side => `/pots/${potOf(side, 'Reserva')}/deposit`, {amount: 300, note: 'x', date: ymd(0, 3)});
await both('retirada', 'POST', side => `/pots/${potOf(side, 'Reserva')}/withdraw`, {amount: 50});
await both('retirada maior que o saldo', 'POST', side => `/pots/${potOf(side, 'Reserva')}/withdraw`, {amount: 5000});
await both('extrato da caixinha', 'GET', side => `/pots/${potOf(side, 'Reserva')}/entries`);
await both('extrato caixinha fixa', 'GET', side => `/pots/${potOf(side, 'Viagem')}/entries`);
const wish = await both('desejo', 'POST', '/wishes', side => ({name: 'Notebook', estimatedPrice: 2500, potId: potOf(side, 'Reserva'), url: 'http://x', notes: 'n'}));
await both('comprar desejo parcelado com caixinha', 'POST', side => `/wishes/${(side === 'pc' ? wish.pc : wish.mob).id}/buy`,
    side => ({price: 200, accountId: A(side), installments: 2, date: ymd(0, 10), usePot: true, categoryId: id(side, 'food')}));
await both('desejos', 'GET', '/wishes');
await both('caixinhas depois', 'GET', '/pots');
await both('desejo 2', 'POST', '/wishes', {name: 'Fone', estimatedPrice: 300});
await both('descartar desejo', 'POST', side => `/wishes/${(side === 'pc' ? wish.pc : wish.mob).id + 1}/discard`, {});

// modelos
await both('modelo', 'POST', '/templates', side => ({name: 'Café', type: 'EXPENSE', amount: 8, accountId: A(side), categoryId: id(side, 'food'), tags: ['cafe']}));
await both('modelos', 'GET', '/templates');

// correção de saldo
await both('correção de saldo', 'POST', side => `/accounts/${A(side)}/adjust-balance`, {balance: 5000});

// leituras finais
for (const n of [0, 1, 2]) await both(`resumo ${month(n)}`, 'GET', `/api/summary?month=${month(n)}`);
await both('resumo por conta', 'GET', side => `/api/summary?month=${month(0)}&accountId=${A(side)}`);
await both('resumo próximo mês', 'GET', `/api/summary?month=${month(-1)}`);
await both('contas depois', 'GET', '/accounts');
await both('por vir 1 mês', 'GET', `/api/upcoming?from=${iso(today)}&to=${ymd(-1, today.getDate())}`);
await both('por vir 6 meses', 'GET', `/api/upcoming?from=${iso(today)}&to=${ymd(-6, today.getDate())}`);
await both('por vir por conta', 'GET', side => `/api/upcoming?from=${iso(today)}&to=${ymd(-3, 1)}&accountId=${A(side)}`);
await both('lembretes', 'GET', '/api/reminders');
await both('lançamentos finais', 'GET', '/expenses?size=500');
await both('lixeira final', 'GET', '/trash');
{
    const a = await pc('GET', '/api/export.csv'), b = await mob('GET', '/api/export.csv');
    const norm = t => String(t).replace(/^﻿/, '').split('\n').map(l => l.trimEnd());
    const out = [];
    deepDiff(norm(a.body), norm(b.body), '', out);
    if (out.length) diffs.push({label: 'exportar CSV', out: out.slice(0, 8), more: Math.max(0, out.length - 8)});
}

console.log(diffs.length ? `${diffs.length} PONTOS COM DIFERENCA:` : 'Nenhuma diferenca de valor.');
for (const d of diffs) console.log(`\n## ${d.label}\n  - ${d.out.join('\n  - ')}${d.more ? `\n  ... e mais ${d.more}` : ''}`);
