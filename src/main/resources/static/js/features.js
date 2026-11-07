'use strict';

/* Accounts, payment methods, recurring payments, pots ("caixinhas") and the wish list.
   Loaded after app.js; it reuses its helpers ($, api, openSheet, run, state, ...). */

/* ---------- Shared helpers ---------- */
/* The kind of account (corrente, poupança…) is no longer shown nor asked: the only distinction that matters is the credit card. */
const accountKind = a => (a.type === 'CREDIT_CARD' ? 'Cartão de crédito' : '');
const ACCOUNT_ICONS = ['bank', 'wallet', 'cash', 'credit-card', 'trending'];
const POT_ICONS = ['coins', 'gift', 'home', 'target', 'sparkles', 'leaf', 'book', 'gamepad', 'tv', 'bus'];

const fmtInput = v => (v == null ? '' : String(v).replace('.', ','));
const activeAccounts = () => state.accounts.filter(a => !a.archived);
/** The main account: the oldest active one (the same the server uses when none is given). */
const mainAccountId = () => activeAccounts().reduce((m, a) => (m == null || a.id < m ? a.id : m), null);
const accountById = id => state.accounts.find(a => a.id === id);
/** Per currency: what is available, what is saved (accounts marked as saved money) and whether any account is saved. */
function accountTotalsByCurrency(list) {
    const result = new Map();
    for (const a of list) {
        const code = a.currency || currencyCode();
        const t = result.get(code) || {available: 0, saved: 0, hasSaved: false};
        if (a.saved) { t.saved += Number(a.balance); t.hasSaved = true; } else t.available += Number(a.balance);
        result.set(code, t);
    }
    return result;
}
const nextId = value => (value === '' || value == null ? null : Number(value));

function options(list, selected, {none = null} = {}) {
    return (none ? `<option value="">${esc(none)}</option>` : '')
        + list.map(x => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}

/** The currencies the app offers, as the options of a select. */
function currencyOptions(selected) {
    return Object.entries(CURRENCY_NAMES).map(([code, name]) => `<option value="${code}" ${code === selected ? 'selected' : ''}>${esc(name)}</option>`).join('');
}

/** Account select: active accounts plus the one currently chosen, even if archived. */
function accountOptions(selected, {exclude} = {}) {
    const list = orderedAccounts(state.accounts.filter(a => (!a.archived || a.id === selected) && a.id !== exclude));
    return list.map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(accountLabel(a))}</option>`).join('');
}

/** "Nubank › Caixinha" for a part of an account, just the name otherwise. */
const accountLabel = a => (a.parentName ? `${a.parentName} › ${a.name}` : a.name);
const byName = (a, b) => a.name.localeCompare(b.name, LOCALE);

/** Accounts in display order: each top-level account followed by its parts ("cofrinhos"). */
const accountSortMode = () => ['name', 'value', 'manual'].includes(safeStorage.get('accountSort')) ? safeStorage.get('accountSort') : 'name';
/** The arranged order is kept per profile, because account ids belong to a profile. */
const orderKey = () => `accountOrder:${state.profiles ? state.profiles.current : ''}`;
const manualOrder = () => { try { const o = JSON.parse(safeStorage.get(orderKey()) || '[]'); return Array.isArray(o) ? o : []; } catch { return []; } };
/** Comparator for the chosen order: by name, by balance (biggest first) or by the order the person arranged. */
function accountComparator() {
    const mode = accountSortMode();
    if (mode === 'value') {
        // balances of different currencies are not comparable: the main currency comes first, then each other one in a
        // group of its own (their order does not matter); inside a group, the biggest balance first
        const rank = a => ((a.currency || currencyCode()) === currencyCode() ? '' : '~' + (a.currency || ''));
        return (a, b) => rank(a).localeCompare(rank(b)) || Number(b.balance) - Number(a.balance) || byName(a, b);
    }
    if (mode === 'manual') {
        const order = manualOrder();
        const pos = a => { const i = order.indexOf(a.id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
        return (a, b) => pos(a) - pos(b) || byName(a, b);
    }
    return byName;
}

function orderedAccounts(list = state.accounts) {
    const cmp = accountComparator();
    const roots = list.filter(a => !a.parentId).sort(cmp);
    const result = [];
    roots.forEach(r => {
        result.push(r);
        list.filter(a => a.parentId === r.id).sort(cmp).forEach(c => result.push(c));
    });
    list.filter(a => a.parentId && !list.some(r => r.id === a.parentId)).forEach(a => result.push(a));
    return result;
}

function monthOptions(months, selected, {none = null} = {}) {
    return (none ? `<option value="">${esc(none)}</option>` : '')
        + months.map(m => `<option value="${m}" ${m === selected ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('');
}
const monthRange = (fromYm, count) => Array.from({length: count}, (_, i) => shiftMonth(fromYm, i));

/* Dates are typed as dd/mm/aaaa or picked from our own calendar (U2). The same field works in the browser and in the
   desktop WebView, which has no usable native date picker. */
function dateField(id, iso, label = 'Data') {
    return `<div class="field"><label for="${id}">${label}</label>
        <div class="date-row"><input id="${id}" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" autocomplete="off" value="${esc(isoToBr(iso))}">
            <button type="button" class="icon-btn small date-cal" data-cal="${id}" aria-label="Abrir calendário">${ico('calendar')}</button></div>
        <span class="date-quick" data-for="${id}"><button type="button" data-days="-1">Ontem</button><button type="button" data-days="0">Hoje</button><button type="button" data-days="1">Amanhã</button><button type="button" data-days="7">Semana que vem</button><button type="button" data-months="1">Mês que vem</button></span></div>`;
}
/** Wires the field created by dateField() and returns a function that reads it as yyyy-mm-dd ('' if invalid). */
function bindDate(sheet, id) {
    const input = $('#' + id, sheet);
    input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '').slice(0, 8);
        input.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
    });
    $$(`.date-quick[data-for="${id}"] button`, sheet).forEach(b => b.onclick = () => {
        input.value = isoToBr(b.dataset.months ? addMonthsIso(todayIso(), Number(b.dataset.months)) : shiftIso(todayIso(), Number(b.dataset.days)));
        input.dispatchEvent(new Event('input')); // lets whoever depends on the date (the installment plan) react
    });
    const calendarButton = $(`[data-cal="${id}"]`, sheet);
    if (calendarButton) calendarButton.onclick = () => openCalendar(input);
    return () => brToIso(input.value);
}

/** The calendar for a date field. It opens over the form (in the confirmation layer), so the form keeps what was typed. */
function openCalendar(input) {
    const root = $('#confirm-root');
    const today = todayIso();
    let shown = (brToIso(input.value) || today).slice(0, 7);
    const weekdays = Array.from({length: 7}, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE, {weekday: 'short'}).replace('.', ''));
    const close = () => {
        layerClose('confirm');
        root.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        input.focus();
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    layerOpen('confirm', close);
    const paint = () => {
        const [y, m] = shown.split('-').map(Number);
        const selected = brToIso(input.value);
        const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // weeks start on Monday
        const cells = Array.from({length: offset}, () => '<span></span>');
        for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
            const iso = `${y}-${pad(m)}-${pad(d)}`;
            cells.push(`<button type="button" class="cal-day ${iso === selected ? 'selected' : ''} ${iso === today ? 'today' : ''}" data-iso="${iso}" aria-label="${isoToBr(iso)}" ${iso === selected ? 'aria-current="date"' : ''}>${d}</button>`);
        }
        root.innerHTML = `<div class="overlay confirm-overlay"><div class="sheet calendar" role="dialog" aria-modal="true" aria-label="Escolher data">
            <div class="cal-head"><button type="button" class="back-btn" id="cal-prev" aria-label="Mês anterior">${ico('chevron-left')}</button>
                <strong>${esc(monthLabel(shown))}</strong>
                <button type="button" class="back-btn" id="cal-next" aria-label="Próximo mês">${ico('chevron-right')}</button></div>
            <div class="cal-grid">${weekdays.map(w => `<span class="cal-wd">${esc(w)}</span>`).join('')}${cells.join('')}</div>
            <div class="form-actions"><button type="button" class="btn" id="cal-close">Fechar</button></div>
        </div></div>`;
        $('#cal-prev', root).onclick = () => { shown = shiftMonth(shown, -1); paint(); };
        $('#cal-next', root).onclick = () => { shown = shiftMonth(shown, 1); paint(); };
        $$('.cal-day', root).forEach(b => b.onclick = () => {
            input.value = isoToBr(b.dataset.iso);
            input.dispatchEvent(new Event('input')); // lets the filters react as they do to typing
            close();
        });
        $('#cal-close', root).onclick = close;
        $('.overlay', root).addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) close(); });
    };
    paint();
    document.addEventListener('keydown', onKey, true);
    const start = $('.cal-day.selected', root) || $('.cal-day.today', root) || $('#cal-next', root);
    start.focus();
}

/* ---------- Colours (U7) ---------- */
/** Colours offered for categories, accounts and pots: a palette in place of the system colour picker, which differs
    between the browser and the desktop WebView. */
const COLOR_CHOICES = ['#2F7D6D', '#5C6BC0', '#E07A3F', '#C2557A', '#6A9F3C', '#3D8FC4', '#9A6BB5', '#B08D2A',
    '#E57373', '#64B5F6', '#FFB74D', '#81C784', '#4DB6AC', '#7986CB', '#A1887F', '#90A4AE',
    '#D32F2F', '#F06292', '#BA68C8', '#7E57C2', '#1976D2', '#00ACC1', '#00897B', '#388E3C',
    '#AFB42B', '#FBC02D', '#F57C00', '#8D6E63', '#546E7A', '#37474F', '#212121', '#9E9E9E'];

const HEX_RE = /^#[0-9a-f]{6}$/i;
/** Accepts "abc", "#abc", "aabbcc" or "#aabbcc" and returns "#AABBCC", or '' when it is not a colour. */
function normalizeHex(text) {
    let h = String(text || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
    return HEX_RE.test('#' + h) ? '#' + h.toUpperCase() : '';
}
/** Black or white, whichever reads better on the colour (used for text over an account colour). */
function readableOn(color) {
    const h = normalizeHex(color);
    if (!h) return '#fff';
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
        .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#10231e' : '#fff';
}

/** Paints the swatches into {@code container} and returns a function with the chosen colour.
    Besides the palette there is a free colour: a hex field plus the system picker. */
function colorPicker(sheet, container, current) {
    let value = current;
    const choices = COLOR_CHOICES.includes(current) || !current ? COLOR_CHOICES : [current, ...COLOR_CHOICES];
    const paint = () => {
        const box = $(container, sheet);
        const custom = normalizeHex(value) || '#2F7D6D';
        box.innerHTML = choices.map(c =>
            `<button type="button" class="swatch ${c === value ? 'active' : ''}" data-color="${esc(c)}" style="background:${esc(c)}" aria-label="${esc(c)}" aria-pressed="${c === value}"></button>`).join('')
            + `<div class="color-custom"><input type="color" class="color-native" value="${esc(custom.toLowerCase())}" aria-label="Escolher cor livre">
                <input class="color-hex" maxlength="7" placeholder="#RRGGBB" value="${esc(custom)}" aria-label="Código da cor" autocomplete="off"></div>`;
        $$('.swatch', box).forEach(b => b.onclick = () => { value = b.dataset.color; paint(); });
        const native = $('.color-native', box), hex = $('.color-hex', box);
        native.oninput = () => { value = native.value.toUpperCase(); hex.value = value; $$('.swatch', box).forEach(s => s.classList.toggle('active', s.dataset.color === value)); };
        hex.oninput = () => { const h = normalizeHex(hex.value); if (h) { value = h; native.value = h.toLowerCase(); $$('.swatch', box).forEach(s => s.classList.toggle('active', s.dataset.color === value)); } };
    };
    paint();
    return () => value;
}

function iconPicker(sheet, container, choices, current) {
    let value = current;
    const choicesWithCurrent = choices.includes(current) || !current ? choices : [current, ...choices];
    const paint = () => {
        $(container, sheet).innerHTML = choicesWithCurrent.map(k =>
            `<button type="button" class="icon-opt ${k === value ? 'active' : ''}" data-icon="${esc(k)}" aria-label="${esc(k)}">${ico(k)}</button>`).join('');
        $$('.icon-opt', sheet).forEach(b => b.onclick = () => { value = b.dataset.icon; paint(); });
    };
    paint();
    return () => value;
}

function pageHeader(title, back = true) {
    return `<div class="page-head">${back ? `<button class="back-btn" id="back" aria-label="Voltar">${ico('chevron-left')}</button>` : ''}<h2>${esc(title)}</h2></div>`;
}
function bindBack() {
    const back = $('#back');
    if (back) back.onclick = () => { state.sub = null; render(); window.scrollTo({top: 0}); };
}
function menuRow(sub, icon, title, detail) {
    return `<button class="row" data-sub="${sub}"><span class="avatar" style="background:var(--surface-2)">${ico(icon)}</span>
        <span class="grow"><span class="title">${esc(title)}</span>${detail ? `<span class="small muted">${esc(detail)}</span>` : ''}</span>
        <span class="muted">${ico('chevron-right')}</span></button>`;
}
const statusLabel = o => o.status === 'PAID' ? `Pago em ${isoToBr(o.paidDate)}` : o.status === 'SKIPPED' ? 'Pulado' : `Vence em ${isoToBr(o.dueDate)}`;

/* ---------- Account filter (top bar) ---------- */
function paintAccountButton() {
    const btn = $('#account-btn');
    const acc = accountById(state.accountFilter);
    btn.innerHTML = `${ico(acc ? (acc.icon || 'bank') : 'layers')}<span>${esc(acc ? accountLabel(acc) : state.currencyFilter ? T('Contas em {}').replace('{}', state.currencyFilter) : 'Todas as contas')}</span>`;
    btn.onclick = openAccountPicker;
}

function openAccountPicker() {
    const active = activeAccounts();
    const mainTotals = accountTotalsByCurrency(active).get(currencyCode()) || {available: 0, saved: 0};
    const available = mainTotals.available, saved = mainTotals.saved;
    const totalsByCode = accountTotalsByCurrency(active);
    const otherCodes = [...totalsByCode.keys()].filter(code => code !== currencyCode());
    const check = ico('check');
    const sheet = openSheet(`<h2>Ver lançamentos de</h2>
        <div class="list">
            <button class="row" data-acc=""><span class="avatar" style="background:var(--surface-2)">${ico('layers')}</span>
                <span class="grow"><span class="title">Todas as contas</span><span class="small muted">Disponível ${money(available)}${saved ? ` · guardado ${money(saved)}` : ''}</span></span>${state.accountFilter == null && !state.currencyFilter ? check : ''}</button>
            ${otherCodes.map(code => { const t = totalsByCode.get(code); return `<button class="row" data-cur="${code}"><span class="avatar" style="background:var(--surface-2)">${ico('layers')}</span>
                <span class="grow"><span class="title">${esc(T('Contas em {}').replace('{}', code))}</span><span class="small muted">${esc(T('Disponível'))} ${esc(money(t.available, code))}${t.hasSaved ? esc(` · ${T('guardado')} ${money(t.saved, code)}`) : ''}</span></span>${state.accountFilter == null && state.currencyFilter === code ? check : ''}</button>`; }).join('')}
            ${orderedAccounts(active).map(a => `<button class="row ${a.parentId ? 'sub-row' : ''}" data-acc="${a.id}" data-hold="account:${a.id}">${avatar(a.icon || 'bank', a.color)}
                <span class="grow"><span class="title">${esc(a.name)}</span><span class="small muted">${[accountKind(a), money(a.balance, a.currency)].filter(Boolean).map(esc).join(' · ')}</span></span>${a.id === state.accountFilter ? check : ''}</button>`).join('')}
            <button class="row" id="acc-new"><span class="avatar" style="background:var(--primary-soft)">${ico('plus')}</span><span class="grow title">Nova conta</span></button>
        </div>
        <p class="small muted" style="margin-top:10px">Segure uma conta para editar.</p>`);
    $('#acc-new', sheet).onclick = () => { closeSheet(); openAccountSheet(null); };
    $$('[data-acc]', sheet).forEach(b => b.onclick = () => {
        state.accountFilter = nextId(b.dataset.acc);
        state.currencyFilter = null;
        safeStorage.set('account', b.dataset.acc);
        safeStorage.set('currencyFilter', '');
        closeSheet();
        loadAll();
    });
    $$('[data-cur]', sheet).forEach(b => b.onclick = () => {
        state.accountFilter = null;
        state.currencyFilter = b.dataset.cur;
        safeStorage.set('account', '');
        safeStorage.set('currencyFilter', b.dataset.cur);
        closeSheet();
        loadAll();
    });
}

/* ---------- Home: what is due ---------- */
function dueSection() {
    const today = todayIso();
    const monthEnd = `${state.month}-31`; // lexicographically after every date of the month
    const inScope = id => !state.accountFilter || id === state.accountFilter;
    const items = [];
    recurringDue().forEach(o => items.push({date: o.dueDate, occ: o}));
    state.pendingAll.filter(t => t.date <= monthEnd && inScope(t.accountId))
        .forEach(t => items.push({date: t.date, tx: t}));
    if (!items.length) return '';
    items.sort((a, b) => a.date.localeCompare(b.date));
    const when = (date, income) => `${date < today ? 'Venceu' : income ? 'Previsto' : 'Vence'} em ${isoToBr(date)}`;
    const rows = items.map(it => {
        if (it.occ) {
            const o = it.occ;
            return `<button class="row" data-occ="${esc(o.key)}">
                ${avatar(o.categoryIcon || 'repeat', o.categoryColor)}
                <span class="grow"><span class="title">${esc(o.name)} <span class="tag recur">${ico('repeat')} Recorrente</span></span>
                    <span class="small ${o.dueDate < today ? 'expense' : 'muted'}">${when(o.dueDate, o.type === 'INCOME')} · ${esc(o.accountName)}</span></span>
                <span class="amount ${o.type === 'INCOME' ? 'income' : 'expense'}">${o.amount != null ? moneyOf(o.accountId, o.amount) : 'a informar'}</span></button>`;
        }
        const t = it.tx;
        return `<button class="row" data-id="${t.id}">
            ${avatar(t.categoryIcon, t.categoryColor)}
            <span class="grow"><span class="title">${esc(t.name)}</span>
                <span class="small ${t.date < today ? 'expense' : 'muted'}">${when(t.date, t.type === 'INCOME')} · ${esc(t.accountName)}</span></span>
            <span class="amount ${t.type === 'INCOME' ? 'income' : 'expense'}">${moneyOf(t.accountId, t.amount)}</span></button>`;
    });
    return `<h2 class="section-title">A pagar e a receber</h2><div class="list">${rows.join('')}</div>`;
}
function bindDueRows(root) {
    $$('[data-occ]', root).forEach(r => r.onclick = () => {
        if (state.sel.on) return toast('Pagamentos recorrentes não entram na seleção.');
        const o = recurringDue().find(x => x.key === r.dataset.occ);
        if (!o) return;
        if (o.projected) toast('Este pagamento será criado quando o mês chegar.');
        else openOccurrenceSheet(o);
    });
}

function openOccurrenceSheet(o) {
    const paid = o.status === 'PAID', skipped = o.status === 'SKIPPED';
    const sheet = openSheet(`
        <h2>${esc(o.name)}</h2>
        <p class="small muted sheet-sub">${statusLabel(o)} · ${esc(o.accountName)}${o.paymentMethodName ? ' · ' + esc(o.paymentMethodName) : ''}</p>
        ${paid ? `<div class="notice">${ico('check')} Pago em ${isoToBr(o.paidDate)} — ${moneyOf(o.accountId, o.amount)}</div>
            ${tip('occ-undo', `Para desfazer, exclua o lançamento em Lançamentos: o pagamento volta a ficar pulado e pode ser reaberto.`)}`
        : `<form id="occ-form" novalidate>
            <input class="amount-input" id="o-amount" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${fmtInput(o.amount)}" aria-label="Valor">
            ${o.variableAmount ? '<p class="small muted center">Valor variável: informe quanto veio neste mês.</p>' : ''}
            ${dateField('o-date', todayIso(), o.type === 'INCOME' ? 'Data do recebimento' : 'Data do pagamento')}
            ${tip('occ-early', `Pode ser antes do vencimento — por exemplo, pagar no dia 28 o que vence no dia 30.`)}
            <div class="grid2">
                <div class="field"><label for="o-account">Conta</label><select id="o-account">${accountOptions(o.accountId)}</select></div>
                <div class="field"><label for="o-method">Forma de pagamento</label><select id="o-method">${options(state.methods, o.paymentMethodId, {none: '—'})}</select></div>
            </div>
            <div class="form-actions">
                ${skipped ? '<button type="button" class="btn" id="o-reopen">Reabrir</button>' : '<button type="button" class="btn" id="o-skip">Pular este mês</button>'}
                <button type="submit" class="btn primary">${o.type === 'INCOME' ? 'Receber' : 'Pagar'}</button>
            </div></form>`}`);
    if (paid) return;
    const dateValue = bindDate(sheet, 'o-date');
    const skip = $('#o-skip', sheet), reopen = $('#o-reopen', sheet);
    if (skip) skip.onclick = () => run(() => api(`/recurring/occurrences/${o.id}/skip`, {method: 'POST'}), 'Pagamento pulado');
    if (reopen) reopen.onclick = () => run(() => api(`/recurring/occurrences/${o.id}/reopen`, {method: 'POST'}), 'Pagamento reaberto');
    $('#occ-form', sheet).onsubmit = e => {
        e.preventDefault();
        const typed = $('#o-amount', sheet).value.trim();
        const amount = typed ? parseAmount(typed) : null;
        if (typed && !(amount > 0)) return toast('Informe um valor maior que zero.');
        if (!typed && o.amount == null) return toast('Informe o valor deste pagamento.');
        if (!dateValue()) return toast('Informe uma data válida.');
        run(() => api(`/recurring/occurrences/${o.id}/pay`, {method: 'POST', body: {
            date: dateValue(), amount,
            accountId: Number($('#o-account', sheet).value),
            paymentMethodId: nextId($('#o-method', sheet).value)
        }}), o.type === 'INCOME' ? 'Recebimento registrado' : 'Pagamento registrado');
    };
}

/* ---------- More: menu and sub pages ---------- */
function renderMore() {
    const pages = {accounts: renderAccountsPage, methods: renderMethodsPage, recurring: renderRecurringPage,
        categories: renderCategoriesPage, trash: renderTrashPage, backup: renderBackupPage, sync: renderSyncPage, import: renderImportPage, templates: renderTemplatesPage, profiles: renderProfilesPage};
    const page = pages[state.sub];
    if (page) page(); else renderMoreMenu();
}

const CURRENCY_NAMES = {BRL: 'Real brasileiro (R$)', USD: 'Dólar americano (US$)', EUR: 'Euro (€)', GBP: 'Libra esterlina (£)',
    ARS: 'Peso argentino (AR$)', CLP: 'Peso chileno (CLP)', MXN: 'Peso mexicano (MX$)', JPY: 'Iene japonês (¥)'};

/* ---------- Security (S1–S3) ----------
   The password is optional and off by default. The card says whether the app can be reached from other devices. */
function securityCard() {
    const s = state.security || {};
    const warning = s.localOnly === false && !s.passwordSet
        ? `<div class="notice">${ico('shield')} O app aceita conexões da rede (celular). Defina uma senha.</div>` : '';
    const buttons = s.passwordSet
        ? `<button class="chip" id="pw-change">Alterar senha</button><button class="chip" id="pw-remove">Remover senha</button><button class="chip" id="pw-logout">Sair</button>`
        : `<button class="chip active" id="pw-set">Definir senha</button>`;
    return `<h2 class="section-title">Segurança</h2>
        <div class="card stack-tight">
            ${warning}
            <p><strong>${s.passwordSet ? 'Com senha' : 'Sem senha'}</strong></p>
            <p class="small muted">${window.localApp
                ? (s.passwordSet ? 'O app pede a senha ao abrir e ao voltar do segundo plano; vale para todos os perfis.'
                    : 'Por padrão o app abre direto. Defina uma senha para pedi-la ao abrir.')
                : (s.passwordSet
                    ? 'O app pede a senha ao abrir, no computador e no celular.'
                    : 'Por padrão, o app abre sem senha. Defina uma para exigi-la no computador e no celular.')}</p>
            <div class="chips">${buttons}</div>
            <p class="small muted">${window.localApp
                ? 'A senha bloqueia a abertura, mas não criptografa os dados. Se esquecê-la, “Esqueci a senha” apaga tudo; mantenha backup externo.'
                : `${s.localOnly === false ? 'Acesso pela rede local: ligado (run.bat celular).' : 'Acesso só neste computador. Para o celular, use run.bat celular.'}
                Esqueceu a senha? Apague security.properties na pasta de dados para voltar a abrir sem senha.`}</p>
        </div>`;
}

/* ---------- Home-screen widgets (Android app only) ----------
   The widgets cannot ask for the password, so with a password set they only show a notice, unless this is turned on. */
function widgetsCard() {
    const w = window.nativeWidgets;
    if (!w) return '';
    const locked = state.security && state.security.passwordSet;
    return `<h2 class="section-title">Widgets</h2>
        <div class="card stack-tight">
            <p class="small muted">Para adicionar um widget, segure a tela inicial, toque em Widgets e escolha Pocketful. Há widgets de saldo, orçamento e caixinha.</p>
            <label class="switch-row"><input type="checkbox" id="widgets-pw" ${w.withPassword() ? 'checked' : ''}>
                <span><strong>Mostrar os widgets mesmo com senha</strong>
                ${info('Desligado: widgets ocultos quando há senha. Ligado: mostra saldos sem senha; abrir pelo widget pede a senha.')}</span></label>
            ${locked ? '' : '<p class="small muted">Widgets já funcionam sem senha; esta opção só vale se você definir uma.</p>'}
        </div>`;
}

/** Sets, changes or removes the password. Changing or removing it needs the current one. */
function openPasswordSheet(mode) {
    const title = {set: 'Definir senha', change: 'Alterar senha', remove: 'Remover senha'}[mode];
    const sheet = openSheet(`<h2>${title}</h2>
        <form id="pwd-form" novalidate>
            ${mode === 'set' ? '' : '<div class="field"><label for="pwd-current">Senha atual</label><input id="pwd-current" type="password" autocomplete="current-password"></div>'}
            ${mode === 'remove' ? '<p class="small muted">Sem senha, o app volta a abrir direto, como antes.</p>' : `
            <div class="field"><label for="pwd-new">Nova senha</label><input id="pwd-new" type="password" autocomplete="new-password" maxlength="72" placeholder="Pelo menos 4 caracteres"></div>
            <div class="field"><label for="pwd-repeat">Repita a nova senha</label><input id="pwd-repeat" type="password" autocomplete="new-password" maxlength="72"></div>`}
            <div class="form-actions"><button type="submit" class="btn ${mode === 'remove' ? 'danger' : 'primary'}">${mode === 'remove' ? 'Remover' : 'Salvar'}</button></div>
        </form>`);
    $('#pwd-form', sheet).onsubmit = async e => {
        e.preventDefault();
        const current = mode === 'set' ? null : $('#pwd-current', sheet).value;
        let password = '';
        if (mode !== 'remove') {
            password = $('#pwd-new', sheet).value;
            if (password.length < 4) return toast('A senha deve ter pelo menos 4 caracteres.');
            if (password !== $('#pwd-repeat', sheet).value) return toast('As senhas não são iguais.');
        }
        try {
            state.security = await api('/api/auth/password', {method: 'PUT', body: {current, password}});
            closeSheet();
            toast(mode === 'remove' ? 'Senha removida' : 'Senha salva');
            render();
        } catch (err) {
            toast(err.message);
        }
    };
    const first = $('#pwd-current, #pwd-new', sheet);
    if (first) first.focus();
}

/** The "Sobre" card: the version, where the data is kept, and on the computer itself a button to open that folder (U14). */
async function loadAbout() {
    const box = $('#about-box');
    if (!box) return;
    try {
        const info = await api('/api/about');
        $('#about-version', box).textContent = `versão ${info.version}`;
        $('#about-folder', box).innerHTML = `<span>Dados guardados em</span> <code>${esc(info.dataFolder)}</code>`;
        const open = $('#open-data', box);
        open.hidden = window.localApp || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
        open.onclick = async () => {
            try {
                await api('/api/about/open-data-folder', {method: 'POST'});
            } catch (e) { toast(e.message); }
        };
        if (info.startupAvailable) {
            box.insertAdjacentHTML('beforeend', `<label class="switch-row"><input type="checkbox" id="startup" ${info.startupEnabled ? 'checked' : ''}>
                <span><strong>Iniciar com o Windows</strong>
                <span class="small muted" style="display:block">Abre o Pocketful com o Windows, direto na bandeja (só para este usuário).</span></span></label>`);
            $('#startup', box).onchange = async e => {
                try {
                    await api('/api/about/startup', {method: 'PUT', body: {enabled: e.target.checked}});
                    toast(e.target.checked ? 'O app vai abrir com o Windows' : 'O app não abre mais com o Windows');
                } catch (err) {
                    e.target.checked = !e.target.checked;
                    toast(err.message);
                }
            };
        }
    } catch (e) {
        $('#about-folder', box).textContent = '';
    }
}

function renderMoreMenu() {
    const activeRules = state.occurrences.length;
    $('#view').innerHTML = `<div class="stack">
        <h2 class="section-title">Cadastros</h2>
        <div class="list">
            ${menuRow('profiles', 'user', 'Perfis', state.profiles.profiles.length > 1 ? `Em uso: ${currentProfile().name} · ${state.profiles.profiles.length} perfis` : 'Separe os dados de pessoas diferentes')}
            ${menuRow('accounts', 'bank', 'Contas', `${activeAccounts().length} ativas`)}
            ${menuRow('methods', 'credit-card', 'Formas de pagamento', state.methods.map(m => m.name).slice(0, 4).join(', '))}
            ${menuRow('recurring', 'repeat', 'Pagamentos recorrentes', activeRules ? `${activeRules} neste mês` : 'Aluguel, assinaturas, salário…')}
            ${menuRow('categories', 'tag', 'Categorias', `${state.categories.length} categorias`)}
            ${menuRow('templates', 'star', 'Modelos favoritos', state.templates.length ? `${state.templates.length} modelos` : 'Lançamentos que você repete')}
            ${menuRow('trash', 'trash', 'Lixeira', 'Lançamentos e transferências excluídos')}
        </div>
        <h2 class="section-title">Configurações</h2>
        <div class="card stack-tight">
            <label class="switch-row"><input type="checkbox" id="auto-pay" ${state.settings.autoPayRecurring ? 'checked' : ''}>
                <span><strong>Descontar pagamentos recorrentes automaticamente</strong>
                ${info(`Ligado: lança automaticamente no vencimento. Desligado: exige confirmação; valores variáveis sempre exigem.`)}</span></label>
            <label class="switch-row"><input type="checkbox" id="rollover" ${state.settings.budgetRollover ? 'checked' : ''}>
                <span><strong>Levar a sobra do orçamento para o mês seguinte</strong>
                ${info(`O que sobrou (ou estourou) do limite de um mês entra no limite do próximo.${state.settings.budgetRolloverFrom ? ` Contando desde ${esc(monthLabel(state.settings.budgetRolloverFrom))}.` : ' Começa a contar a partir do mês em que for ligado.'}`)}</span></label>
            <div class="field" style="margin:0"><label for="currency">Moeda principal</label>
                <select id="currency">${Object.entries(CURRENCY_NAMES).map(([code, name]) =>
                    `<option value="${code}" ${state.settings.currency === code ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
                <span class="small muted">Usada nos totais. Cada conta, caixinha, desejo e orçamento pode ter a sua.</span></div>
            <div class="field" style="margin:0"><label for="language">Idioma</label>
                <select id="language">${[['pt', 'Português'], ['en', 'English'], ['es', 'Español']].map(([code, name]) =>
                    `<option value="${code}" ${LANG === code ? 'selected' : ''}>${name}</option>`).join('')}</select></div>
            <label class="switch-row"><input type="checkbox" id="reminders" ${state.settings.remindersEnabled ? 'checked' : ''}>
                <span><strong>Lembretes</strong>
                ${info(`${window.nativeNotifications
                    ? 'Avisa sobre contas vencidas ou próximas, orçamentos acima de 80% e fim do mês. Contas e fim do mês também notificam às 9h, mesmo com o app fechado.'
                    : `Avisa no sino do topo${window.desktop ? ' e em notificações do Windows' : ' e, se você permitir, em notificações do navegador'} sobre contas vencidas ou próximas, orçamentos acima de 80% e fim do mês. Só funciona com o app aberto.`}`)}</span></label>
            <div class="field" style="margin:0"><label for="reminder-days">Avisar contas com antecedência de</label>
                <select id="reminder-days" ${state.settings.remindersEnabled ? '' : 'disabled'}>${[1, 2, 3, 5, 7, 10, 15].map(n =>
                    `<option value="${n}" ${state.settings.reminderDays === n ? 'selected' : ''}>${n === 1 ? '1 dia' : n + ' dias'}</option>`).join('')}</select></div>
            <label class="switch-row"><input type="checkbox" id="auto-backup" ${state.settings.autoBackup ? 'checked' : ''}>
                <span><strong>Backup automático todo dia</strong>
                ${info(`Faz até um backup por dia enquanto o app está aberto e mantém os sete mais recentes.`)}</span></label>
            ${state.settings.autoBackup ? '' : tip('no-backup', 'Sem backup automático, você pode perder seus dados.')}
            <label class="switch-row"><input type="checkbox" id="tips" ${tipsOn() ? 'checked' : ''}>
                <span><strong>Mostrar dicas</strong>${info('Dicas rápidas aparecem uma vez. Toque em “Entendi” para ocultá-las neste aparelho.')}</span></label>
        </div>
        ${securityCard()}
        ${widgetsCard()}
        <h2 class="section-title">Aparência</h2>
        <div class="card"><div class="chips">
            ${[['light', 'sun', 'Claro'], ['dark', 'moon', 'Escuro']].map(([v, i, l]) =>
                `<button class="chip ${currentTheme() === v ? 'active' : ''}" data-theme="${v}">${ico(i)} ${l}</button>`).join('')}
        </div></div>
        <h2 class="section-title">Dados</h2>
        <div class="list">
            <button class="row" id="report-more"><span class="avatar" style="background:var(--surface-2)">${ico('file')}</span><span class="grow"><span class="title">Relatório em PDF ou Excel</span><span class="small muted">Extrato de um mês ou de qualquer período</span></span></button>
            ${menuRow('import', 'upload', 'Importar extrato ou planilha', 'OFX do banco, CSV de banco/cartão ou o CSV exportado daqui')}
            ${menuRow('backup', 'shield', 'Backup e restauração', 'Salvar uma cópia de tudo ou voltar a uma cópia')}
            ${state.sync && state.sync.available ? menuRow('sync', 'repeat', 'Sincronização', state.sync.configured ? `Conectado · última: ${syncWhen(state.sync.lastSyncAt)}` : 'Manter computador e celular com os mesmos dados') : ''}
            <a class="row" id="export-csv" href="/api/export.csv" download style="text-decoration:none;color:inherit"><span class="avatar" style="background:var(--surface-2)">${ico('download')}</span><span class="grow title">Exportar para planilha (CSV)</span></a>
            <button class="row" id="demo"><span class="avatar" style="background:var(--surface-2)">${ico('sparkles')}</span><span class="grow title">Carregar dados de exemplo</span></button>
            <button class="row" id="wipe"><span class="avatar" style="background:var(--surface-2)">${ico('trash')}</span><span class="grow title expense">Limpar tudo (mover para a lixeira)</span></button>
        </div>
        <h2 class="section-title">Sobre</h2>
        <div class="card about" id="about-box">
            <p><strong>Pocketful</strong> <span class="small muted" id="about-version"></span></p>
            <p class="small muted" id="about-folder"></p>
            ${window.localApp ? '' : `<p class="small muted about-keys"><span><kbd>Ctrl</kbd>+<kbd>N</kbd> novo lançamento</span> · <span><kbd>/</kbd> buscar</span> · <span><kbd>←</kbd><kbd>→</kbd> mudar o mês</span></p>`}
            <button class="btn block" id="open-data" hidden>${ico('folder')} Abrir pasta de dados</button>
        </div>
        ${window.localApp ? '' : '<p class="small muted" style="text-align:center">No celular, abra este endereço no navegador e use “Adicionar à tela inicial”.</p>'}
        <div class="list"><button class="row" id="about-project"><span class="avatar" style="background:var(--surface-2)">${ico('sparkles')}</span><span class="grow title">Sobre o Projeto</span><span class="muted">${ico('chevron-right')}</span></button></div>
    </div>`;
    $('#about-project').onclick = openAboutProject;
    $$('[data-sub]').forEach(b => b.onclick = () => { state.sub = b.dataset.sub; render(); window.scrollTo({top: 0}); });
    const saveSetting = async (body, message, input) => {
        try {
            state.settings = await api('/api/settings', {method: 'PUT', body});
            toast(message);
            await loadAll();
        } catch (err) {
            if (input && input.type === 'checkbox') input.checked = !input.checked;
            toast(err.message);
        }
    };
    $('#auto-pay').onchange = e => saveSetting({autoPayRecurring: e.target.checked},
        e.target.checked ? 'Recorrentes serão descontados automaticamente' : 'Recorrentes dependem da sua confirmação', e.target);
    $('#rollover').onchange = e => saveSetting({budgetRollover: e.target.checked},
        e.target.checked ? 'A sobra do orçamento passa para o mês seguinte' : 'Cada mês tem só o seu limite', e.target);
    $('#auto-backup').onchange = e => saveSetting({autoBackup: e.target.checked},
        e.target.checked ? 'Backup automático ligado' : 'Backup automático desligado', e.target);
    $('#currency').onchange = e => saveSetting({currency: e.target.value}, 'Moeda alterada (os valores não foram convertidos)');
    $('#language').onchange = async e => {
        try {
            await api('/app/language', {method: 'PUT', body: {language: e.target.value}});
            safeStorage.set('lang', e.target.value);
            location.reload();
        } catch (err) {
            toast(err.message);
        }
    };
    $('#tips').onchange = e => {
        safeStorage.set('tips', e.target.checked ? '1' : '0');
        if (e.target.checked) safeStorage.set('tipsSeen', '[]'); // turning them on shows each tip once again
        toast(e.target.checked ? 'Dicas ligadas' : 'Dicas desligadas');
    };
    $('#reminders').onchange = e => saveSetting({remindersEnabled: e.target.checked}, e.target.checked ? 'Lembretes ligados' : 'Lembretes desligados', e.target);
    $('#reminder-days').onchange = e => saveSetting({reminderDays: Number(e.target.value)}, 'Antecedência atualizada');
    $$('.chip[data-theme]').forEach(b => b.onclick = () => { applyTheme(b.dataset.theme); render(); });
    $('#report-more').onclick = openReportSheet;
    const setup = $('#pw-set'), change = $('#pw-change'), remove = $('#pw-remove'), logout = $('#pw-logout');
    if (setup) setup.onclick = () => openPasswordSheet('set');
    if (change) change.onclick = () => openPasswordSheet('change');
    if (remove) remove.onclick = () => openPasswordSheet('remove');
    if (logout) logout.onclick = async () => {
        try { await api('/api/auth/logout', {method: 'POST'}); location.reload(); } catch (e) { toast(e.message); }
    };
    const widgetsPw = $('#widgets-pw');
    if (widgetsPw) widgetsPw.onchange = async () => {
        if (widgetsPw.checked && state.security && state.security.passwordSet
            && !await confirmDialog('Ativar widgets com saldos? Quem acessar o celular desbloqueado poderá vê-los sem senha.', {okLabel: 'Ligar'})) {
            widgetsPw.checked = false;
            return;
        }
        await window.nativeWidgets.setWithPassword(widgetsPw.checked);
        toast(widgetsPw.checked ? 'Widgets ligados mesmo com senha' : 'Widgets desligados quando há senha');
    };
    loadAbout();
    $('#export-csv').onclick = async e => {
        if (!window.desktop && !window.nativeFiles) return; // browsers handle the download attribute themselves
        e.preventDefault();
        try {
            const res = await busy(() => fetch('/api/export.csv'), 'Preparando o arquivo…');
            if (!res.ok) throw new Error(`Erro ${res.status}`);
            saveTextFile('lancamentos.csv', await res.text());
        } catch (err) {
            toast(`Não foi possível exportar: ${err.message}`);
        }
    };
    $('#demo').onclick = async () => {
        if (!await confirmDialog('Adicionar dados de exemplo?', {okLabel: 'Adicionar', danger: false})) return;
        await run(() => api('/api/demo-data', {method: 'POST'}), 'Dados de exemplo carregados');
    };
    $('#wipe').onclick = async () => {
        if (!await confirmDialog('Mover TUDO para a lixeira?', {okLabel: 'Limpar tudo'})) return;
        await run(() => api('/api/data', {method: 'DELETE'}), 'Tudo foi para a lixeira');
    };
}

function renderCategoriesPage() {
    const kind = state.catKind || 'EXPENSE';
    const other = kind === 'EXPENSE' ? 'INCOME' : 'EXPENSE';
    const list = orderedCategories(kind);
    $('#view').innerHTML = `<div class="stack">${pageHeader('Categorias')}
        <div class="seg"><button type="button" data-kind="EXPENSE" class="exp ${kind === 'EXPENSE' ? 'active' : ''}">Despesas</button><button type="button" data-kind="INCOME" class="inc ${kind === 'INCOME' ? 'active' : ''}">Receitas</button></div>
        ${tip('categories', 'Despesas e receitas têm categorias separadas. Os totais e orçamentos da categoria principal incluem as subcategorias.')}
        <div class="list">${list.map(c => `<button class="row ${c.parentId ? 'sub-row' : ''}" data-cat="${c.id}">
            ${avatar(c.icon, c.color)}<span class="grow title">${esc(c.name)}</span><span class="muted">${ico('pencil')}</span></button>`).join('')}
            <button class="row" id="new-cat"><span class="avatar" style="background:var(--primary-soft)">${ico('plus')}</span><span class="grow title">${kind === 'INCOME' ? 'Nova categoria de receita' : 'Nova categoria de despesa'}</span></button></div>
        ${list.some(c => !c.parentId) ? `<button class="btn block" id="copy-all">${ico('copy')} ${other === 'INCOME' ? 'Copiar todas para Receitas' : 'Copiar todas para Despesas'}</button>` : ''}</div>`;
    bindBack();
    $$('[data-kind]').forEach(b => b.onclick = () => { state.catKind = b.dataset.kind; renderCategoriesPage(); });
    $$('[data-cat]').forEach(b => b.onclick = () => openCategorySheet(state.categories.find(c => c.id === Number(b.dataset.cat))));
    $('#new-cat').onclick = () => openCategorySheet(null, kind);
    const copyAll = $('#copy-all');
    if (copyAll) copyAll.onclick = () => run(async () => {
        for (const c of list.filter(x => !x.parentId)) await api(`/categories/${c.id}/copy`, {method: 'POST'});
    }, other === 'INCOME' ? 'Categorias copiadas para Receitas' : 'Categorias copiadas para Despesas');
}

/* ---------- Press and hold: opens the edit screen of an account, category or pot wherever it shows up ---------- */
const HOLD_OPENERS = {
    account: id => { const a = accountById(id); if (a) openAccountSheet(a); },
    category: id => { const c = state.categories.find(x => x.id === id); if (c) openCategorySheet(c); },
    pot: id => { const p = state.pots.find(x => x.id === id); if (p) openPotSheet(p); }
};
(() => {
    const HOLD_MS = 500;
    let timer = null, start = null, fired = 0;
    const cancel = () => {
        clearTimeout(timer);
        timer = null;
        document.querySelectorAll('.holding').forEach(el => el.classList.remove('holding'));
    };
    const open = el => {
        const [kind, id] = el.dataset.hold.split(':');
        const opener = HOLD_OPENERS[kind];
        if (!opener) return;
        fired = Date.now();
        try { if (navigator.vibrate) navigator.vibrate(15); } catch { /* no vibration here */ }
        opener(Number(id));
    };
    document.addEventListener('pointerdown', e => {
        const el = e.target.closest && e.target.closest('[data-hold]');
        if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
        cancel();
        start = {x: e.clientX, y: e.clientY};
        el.classList.add('holding');
        timer = setTimeout(() => { cancel(); open(el); }, HOLD_MS);
    });
    document.addEventListener('pointermove', e => {
        if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    });
    ['pointerup', 'pointercancel', 'scroll'].forEach(name => document.addEventListener(name, cancel, true));
    // the click that ends the press must not also run the normal tap action
    document.addEventListener('click', e => {
        if (Date.now() - fired < 700 && e.target.closest && e.target.closest('[data-hold]')) { e.preventDefault(); e.stopPropagation(); fired = 0; }
    }, true);
    // the system's own long-press menu (and the right mouse button) do the same thing
    document.addEventListener('contextmenu', e => {
        const el = e.target.closest && e.target.closest('[data-hold]');
        if (!el) return;
        e.preventDefault();
        if (Date.now() - fired > 700) { cancel(); open(el); }
    });
})();

/* ---------- Accounts ---------- */
/** Saves a new order for the accounts that share a parent; the others keep their places. */
function saveSiblingOrder(ordered, parentId, sibs) {
    const next = ordered.map(a => a.id);
    ordered.map((a, k) => (a.parentId === parentId ? k : -1)).filter(k => k >= 0).forEach((slot, k) => { next[slot] = sibs[k]; });
    safeStorage.set(orderKey(), JSON.stringify(next));
}

/** The handle of an account in manual order: drag it up or down (or use the arrow keys) to put it somewhere else. */
function bindAccountDrag(handle, ordered) {
    const id = Number(handle.dataset.drag);
    const me = ordered.find(a => a.id === id);
    const sibs = ordered.filter(a => a.parentId === me.parentId).map(a => a.id);
    const rowOf = x => document.querySelector(`.manual-row[data-id="${x}"]`);
    handle.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const i = sibs.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (j < 0 || j >= sibs.length) return;
        const next = sibs.slice();
        [next[i], next[j]] = [next[j], next[i]];
        saveSiblingOrder(ordered, me.parentId, next);
        renderAccountsPage();
        const again = document.querySelector(`[data-drag="${id}"]`);
        if (again) again.focus();
    });
    handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        const el = rowOf(id);
        const others = sibs.filter(x => x !== id);
        const startY = e.clientY;
        let target = sibs.indexOf(id);
        handle.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        const clearMarks = () => others.forEach(x => rowOf(x).classList.remove('drop-above', 'drop-below'));
        const onMove = ev => {
            el.style.transform = `translateY(${ev.clientY - startY}px)`;
            const box = el.getBoundingClientRect();
            const middle = box.top + box.height / 2;
            target = others.filter(x => { const r = rowOf(x).getBoundingClientRect(); return r.top + r.height / 2 < middle; }).length;
            clearMarks();
            if (target < others.length) rowOf(others[target]).classList.add('drop-above');
            else if (others.length) rowOf(others[others.length - 1]).classList.add('drop-below');
        };
        const end = ev => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
            if (ev.type === 'pointerup' && target !== sibs.indexOf(id)) {
                const next = others.slice();
                next.splice(target, 0, id);
                saveSiblingOrder(ordered, me.parentId, next);
            }
            renderAccountsPage();
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    });
}

function renderAccountsPage() {
    const active = activeAccounts();
    const archived = state.accounts.filter(a => a.archived);
    const totalsByCurrency = accountTotalsByCurrency(active);
    const mainTotals = totalsByCurrency.get(currencyCode()) || {available: 0, saved: 0};
    const available = mainTotals.available, saved = mainTotals.saved;
    const otherCurrencies = [...totalsByCurrency.entries()].filter(([code]) => code !== currencyCode());
    const cardInfo = a => a.type === 'CREDIT_CARD' ? (a.closingDay && a.dueDay ? ` · fecha dia ${a.closingDay}, vence dia ${a.dueDay} · ver faturas` : ' · defina o fechamento') : '';
    const row = a => `<button class="row ${a.parentId ? 'sub-row' : ''} ${a.archived ? 'is-archived' : ''}" data-account="${a.id}" data-hold="account:${a.id}">${avatar(a.icon || 'bank', a.color)}
        <span class="grow"><span class="title">${esc(a.name)}</span><span class="small muted">${[accountKind(a) + cardInfo(a), a.saved ? 'guardado' : '', a.parentName ? 'dentro de ' + esc(a.parentName) : '', a.archived ? 'arquivada' : ''].filter(Boolean).join(' · ') || '&nbsp;'}</span></span>
        <span class="amount ${Number(a.balance) < 0 ? 'expense' : ''}">${money(a.balance, a.currency)}</span></button>`;
    const mode = accountSortMode();
    // in manual mode every active account gets a handle at the edge: drag it (or use the arrow keys) to move it among its siblings
    const manualRow = a => `<div class="manual-row" data-id="${a.id}" style="display:flex;align-items:stretch;gap:6px">
            <div style="flex:1;min-width:0;display:flex">${row(a).replace('<button class="row', '<button style="flex:1" class="row')}</div>
            <button type="button" class="drag-handle" data-drag="${a.id}" aria-label="Arrastar para mover">${ico('grip')}</button></div>`;
    const ordered = orderedAccounts(active);
    $('#view').innerHTML = `<div class="stack">${pageHeader('Contas')}
        <div class="account-sort"><span class="small muted">Ordenar:</span>
            ${[['name', 'Nome'], ['value', 'Valor'], ['manual', 'Manual']].map(([k, l]) => `<button type="button" data-sort="${k}" class="${k === mode ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="card">
            <div class="small muted">Disponível nas contas</div><div style="font-size:1.5rem;font-weight:800">${money(available)}</div>
            ${otherCurrencies.map(([code, t]) => `<div class="small muted" style="margin-top:6px">${esc(code)}: <strong>${money(t.available, code)}</strong>${t.hasSaved ? ` · guardado <strong>${money(t.saved, code)}</strong>` : ''}</div>`).join('')}
            ${saved ? `<div class="small muted" style="margin-top:6px">Guardado dentro das contas (cofrinhos, investimentos): <strong>${money(saved)}</strong> · Total: <strong>${money(available + saved)}</strong></div>` : ''}
            ${tip('balance', `Saldo = saldo inicial + receitas − despesas + transferências recebidas − enviadas. Só pagamentos feitos entram.`)}</div>
        <div class="list">${ordered.map(a => mode === 'manual' ? manualRow(a) : row(a)).join('')}
            <button class="row" id="new-account"><span class="avatar" style="background:var(--primary-soft)">${ico('plus')}</span><span class="grow title">Nova conta</span></button></div>
        ${archived.length ? `<h2 class="section-title">Arquivadas</h2><div class="list">${orderedAccounts(archived).map(row).join('')}</div>` : ''}</div>`;
    bindBack();
    $$('[data-sort]').forEach(b => b.onclick = () => {
        safeStorage.set('accountSort', b.dataset.sort);
        // starting the manual order from what is on screen, so nothing jumps
        if (b.dataset.sort === 'manual' && !manualOrder().length) safeStorage.set(orderKey(), JSON.stringify(ordered.map(a => a.id)));
        renderAccountsPage();
    });
    $$('[data-drag]').forEach(h => bindAccountDrag(h, ordered));
    $$('[data-account]').forEach(b => b.onclick = () => {
        const account = accountById(Number(b.dataset.account));
        if (account.type === 'CREDIT_CARD' && account.closingDay && account.dueDay && !account.archived) openInvoices(account);
        else openAccountSheet(account);
    });
    $('#new-account').onclick = () => openAccountSheet(null);
}

function openAccountSheet(account) {
    const hasParts = !!account && state.accounts.some(a => a.parentId === account.id);
    const tops = state.accounts.filter(a => !a.parentId && !a.archived && (!account || a.id !== account.id));
    const sheet = openSheet(`
        <h2>${account ? 'Editar conta' : 'Nova conta'}</h2>
        <form id="acc-form" novalidate>
            <div class="field"><label for="a-name">Nome</label><input id="a-name" maxlength="80" placeholder="Ex.: Santander" value="${esc(account?.name)}"></div>
            <div class="field"><label>Cor</label><div class="swatches" id="a-colors"></div></div>
            <label class="switch-row"><input type="checkbox" id="a-card-toggle" ${account?.type === 'CREDIT_CARD' ? 'checked' : ''}>
                <span>É um cartão de crédito${info('Cartão tem fatura (dia de fechamento e de vencimento) e o saldo dele é o que você deve.')}</span></label>
            <div class="grid2" id="a-card" hidden>
                <div class="field"><label for="a-closing">Dia de fechamento</label><input id="a-closing" inputmode="numeric" maxlength="2" placeholder="Ex.: 10" value="${esc(account?.closingDay ?? '')}"></div>
                <div class="field"><label for="a-due">Dia de vencimento</label><input id="a-due" inputmode="numeric" maxlength="2" placeholder="Ex.: 20" value="${esc(account?.dueDay ?? '')}"></div>
            </div>
            <p class="small muted" id="a-card-hint" hidden style="margin-top:-6px">Compras até o fechamento entram na fatura do mês; depois, na próxima. O saldo negativo é o valor devido e zera ao pagar a fatura.</p>
            <div class="field"><label for="a-parent">Fica dentro de</label>
                <select id="a-parent" ${hasParts ? 'disabled' : ''}>${options(tops, account?.parentId, {none: 'Nenhuma (conta própria)'})}</select>
                <span class="small muted">${hasParts ? 'Esta conta tem partes dentro dela, então não pode ficar dentro de outra.'
                    : 'Para contas dentro de um banco (ex.: caixinha do Nubank). Para guardar dinheiro, transfira para ela.'}</span></div>
            <label class="switch-row"><input type="checkbox" id="a-saved" ${account?.saved ? 'checked' : ''}>
                <span>Dinheiro guardado${info('O saldo aparece separado, pequeno embaixo do saldo total.')}</span></label>
            <div class="field"><label for="a-currency">Moeda</label>
                <select id="a-currency">${Object.entries(CURRENCY_NAMES).map(([code, name]) => `<option value="${code}" ${(account?.currency || currencyCode()) === code ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
                ${account ? '<span class="small muted">Mudar a moeda não converte os valores.</span>' : ''}</div>
            <div class="field"><label for="a-balance" id="a-balance-label">Saldo inicial (${esc(currencySymbol(account?.currency || currencyCode()))})</label><input id="a-balance" inputmode="decimal" placeholder="0,00" value="${account ? fmtInput(account.initialBalance) : ''}">
                <span class="small muted">Quanto havia na conta antes de começar a lançar aqui. Pode ser negativo.</span></div>
            ${account && account.type !== 'CREDIT_CARD' ? `<button type="button" class="btn block" id="a-adjust">${ico('pencil')} Corrigir saldo…</button>
                <span class="small muted" style="margin-top:-6px">O saldo atual é ${money(account.balance, account.currency)}. Se não bate com o do banco, informe o certo e o app anota a diferença.</span>` : ''}
            <div class="field"><label>Ícone</label><div class="icon-picker" id="a-icons"></div></div>
            ${account ? `<label class="switch-row"><input type="checkbox" id="a-archived" ${account.archived ? 'checked' : ''}><span>Arquivada${info(`Mantém o histórico, mas não aparece ao lançar.`)}</span></label>` : ''}
            <div class="form-actions">
                ${account ? '<button type="button" class="btn danger" id="a-del">Excluir</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
        </form>`);
    const icon = iconPicker(sheet, '#a-icons', ACCOUNT_ICONS, account?.icon || 'bank');
    const colorOf = colorPicker(sheet, '#a-colors', account?.color || '#64B5F6');
    $('#a-currency', sheet).onchange = e => { $('#a-balance-label', sheet).textContent = T(`Saldo inicial (${currencySymbol(e.target.value)})`); };
    const paintCard = () => {
        const card = $('#a-card-toggle', sheet).checked;
        $('#a-card', sheet).hidden = !card;
        $('#a-card-hint', sheet).hidden = !card;
    };
    $('#a-card-toggle', sheet).onchange = paintCard;
    paintCard();
    if (account) {
        const adjust = $('#a-adjust', sheet);
        if (adjust) adjust.onclick = () => openBalanceAdjust(account);
        $('#a-del', sheet).onclick = async () => {
            if (await confirmDialog(`Excluir a conta “${account.name}”? Contas com lançamentos só podem ser arquivadas.`, {okLabel: 'Excluir'}))
                run(() => api(`/accounts/${account.id}`, {method: 'DELETE'}), 'Conta excluída');
        };
    }
    $('#acc-form', sheet).onsubmit = e => {
        e.preventDefault();
        const name = $('#a-name', sheet).value.trim();
        if (!name) return toast('Informe o nome da conta.');
        const typed = $('#a-balance', sheet).value.trim();
        const initialBalance = typed ? parseAmount(typed) : 0;
        if (Number.isNaN(initialBalance)) return toast('Saldo inicial inválido.');
        // sem o seletor de tipo: só "cartão ou não"; uma conta antiga mantém o tipo que já tinha
        const type = $('#a-card-toggle', sheet).checked ? 'CREDIT_CARD' : (account && account.type !== 'CREDIT_CARD' ? account.type : 'CHECKING');
        const closingDay = Number($('#a-closing', sheet).value), dueDay = Number($('#a-due', sheet).value);
        if (type === 'CREDIT_CARD' && !(Number.isInteger(closingDay) && closingDay >= 1 && closingDay <= 31
                && Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31)) {
            return toast('Informe o dia de fechamento e o de vencimento (de 1 a 31).');
        }
        const body = {name, type, color: colorOf(), icon: icon(), initialBalance, currency: $('#a-currency', sheet).value,
            parentId: hasParts ? null : nextId($('#a-parent', sheet).value),
            archived: account ? $('#a-archived', sheet).checked : false, saved: $('#a-saved', sheet).checked,
            closingDay: type === 'CREDIT_CARD' ? closingDay : null, dueDay: type === 'CREDIT_CARD' ? dueDay : null};
        run(() => api(account ? `/accounts/${account.id}` : '/accounts', {method: account ? 'PUT' : 'POST', body}), 'Conta salva');
    };
}

/** "Corrigir saldo": a pessoa digita o saldo real e o app registra a diferença (não conta como receita nem despesa). */
function openBalanceAdjust(account) {
    const current = Number(account.balance);
    const sheet = openSheet(`
        <h2>Corrigir saldo</h2>
        <p class="small muted sheet-sub">${esc(account.name)} · saldo no app: ${money(current, account.currency)}</p>
        <form id="adj-form" novalidate>
            <div class="field"><label for="adj-balance">Saldo atual de verdade (${esc(currencySymbol(account.currency))})</label>
                <input class="amount-input" id="adj-balance" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${fmtInput(account.balance)}"></div>
            <p class="small center" id="adj-diff" aria-live="polite"></p>
            ${tip('adjust-balance', 'O app registra a diferença como “Correção de saldo”. Se errar, exclua esse lançamento.')}
            <div class="form-actions"><button type="button" class="btn" id="adj-cancel">Voltar</button><button type="submit" class="btn primary">Corrigir</button></div>
        </form>`);
    const field = $('#adj-balance', sheet), diffBox = $('#adj-diff', sheet);
    const paint = () => {
        const typed = field.value.trim() ? parseAmount(field.value) : NaN;
        if (Number.isNaN(typed)) { diffBox.textContent = ''; return; }
        const diff = Math.round((typed - current) * 100) / 100;
        diffBox.className = 'small center ' + (diff > 0 ? 'income' : diff < 0 ? 'expense' : 'muted');
        diffBox.textContent = diff === 0 ? 'O saldo já é esse.' : diff > 0 ? `Vai somar ${money(diff, account.currency)} ao saldo.` : `Vai tirar ${money(-diff, account.currency)} do saldo.`;
    };
    field.addEventListener('input', paint);
    paint();
    field.focus();
    field.select();
    $('#adj-cancel', sheet).onclick = () => openAccountSheet(account);
    $('#adj-form', sheet).onsubmit = e => {
        e.preventDefault();
        const typed = field.value.trim() ? parseAmount(field.value) : NaN;
        if (Number.isNaN(typed)) return toast('Informe o saldo atual.');
        if (Math.round((typed - current) * 100) === 0) return toast('O saldo já é esse.');
        run(() => api(`/accounts/${account.id}/adjust-balance`, {method: 'POST', body: {balance: typed}}), 'Saldo corrigido');
    };
}

/* ---------- Payment methods ---------- */
function renderMethodsPage() {
    $('#view').innerHTML = `<div class="stack">${pageHeader('Formas de pagamento')}
        ${tip('methods', `Forma de pagamento indica como pagou (Pix, débito, crédito), independentemente da conta usada.`)}
        <div class="list">${state.methods.map(m => `<button class="row" data-method="${m.id}">
            <span class="avatar" style="background:var(--surface-2)">${ico('credit-card')}</span><span class="grow title">${esc(m.name)}</span><span class="muted">${ico('pencil')}</span></button>`).join('')}
            <button class="row" id="new-method"><span class="avatar" style="background:var(--primary-soft)">${ico('plus')}</span><span class="grow title">Nova forma de pagamento</span></button></div></div>`;
    bindBack();
    $$('[data-method]').forEach(b => b.onclick = () => openMethodSheet(state.methods.find(m => m.id === Number(b.dataset.method))));
    $('#new-method').onclick = () => openMethodSheet(null);
}

function openMethodSheet(method) {
    const sheet = openSheet(`
        <h2>${method ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}</h2>
        <form id="m-form" novalidate>
            <div class="field"><label for="m-name">Nome</label><input id="m-name" maxlength="60" placeholder="Ex.: Pix" value="${esc(method?.name)}"></div>
            <div class="form-actions">
                ${method ? '<button type="button" class="btn danger" id="m-del">Excluir</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
        </form>`);
    if (method) {
        $('#m-del', sheet).onclick = async () => {
            if (await confirmDialog(`Excluir “${method.name}”? Os lançamentos ficam sem forma de pagamento.`, {okLabel: 'Excluir'}))
                run(() => api(`/payment-methods/${method.id}`, {method: 'DELETE'}), 'Forma de pagamento excluída');
        };
    }
    $('#m-form', sheet).onsubmit = e => {
        e.preventDefault();
        const name = $('#m-name', sheet).value.trim();
        if (!name) return toast('Informe o nome.');
        run(() => api(method ? `/payment-methods/${method.id}` : '/payment-methods', {method: method ? 'PUT' : 'POST', body: {name}}), 'Forma de pagamento salva');
    };
}

/* ---------- Recurring payments ---------- */
async function renderRecurringPage() {
    $('#view').innerHTML = `<div class="stack">${pageHeader('Pagamentos recorrentes')}<div class="skeleton"></div></div>`;
    bindBack();
    let rules;
    try {
        rules = await api('/recurring');
    } catch (e) {
        return toast(e.message);
    }
    if (state.tab !== 'more' || state.sub !== 'recurring') return; // navigated away while loading
    const month = state.occurrences;
    $('#view').innerHTML = `<div class="stack">${pageHeader('Pagamentos recorrentes')}
        ${tip('recurring', `Contas e receitas que se repetem todo mês. ${state.settings.autoPayRecurring
            ? 'Hoje elas são <strong>descontadas automaticamente</strong> no vencimento.'
            : 'Hoje elas ficam <strong>“A pagar”</strong> até você confirmar (mude em Mais → Configurações).'}`)}
        <h2 class="section-title">${esc(monthLabel(state.month))}</h2>
        ${month.length ? `<div class="list">${month.map(o => `<button class="row" data-occ="${o.id}">
            ${avatar(o.categoryIcon || 'repeat', o.categoryColor)}
            <span class="grow"><span class="title">${esc(o.name)}</span><span class="small muted">${statusLabel(o)} · ${esc(o.accountName)}</span></span>
            <span class="status-tag ${o.status.toLowerCase()}">${o.status === 'PAID' ? 'Pago' : o.status === 'SKIPPED' ? 'Pulado' : 'Pendente'}</span>
            <span class="amount ${o.type === 'INCOME' ? 'income' : 'expense'}">${o.amount != null ? moneyOf(o.accountId, o.amount) : '—'}</span></button>`).join('')}</div>`
            : '<div class="card empty">Nenhum pagamento recorrente neste mês.</div>'}
        <h2 class="section-title">Regras</h2>
        <div class="list">${rules.map(r => `<button class="row ${r.active ? '' : 'is-archived'}" data-rule="${r.id}">
            ${avatar(r.categoryIcon || 'repeat', r.categoryColor)}
            <span class="grow"><span class="title">${esc(r.name)}</span>
                <span class="small muted">Todo dia ${r.dayOfMonth} · ${esc(r.accountName)}${r.paymentMethodName ? ' · ' + esc(r.paymentMethodName) : ''}${r.active ? '' : ' · pausado'}</span></span>
            <span class="amount ${r.type === 'INCOME' ? 'income' : 'expense'}">${r.variableAmount ? 'variável' : moneyOf(r.accountId, r.amount)}</span></button>`).join('')}
            <button class="row" id="new-rule"><span class="avatar" style="background:var(--primary-soft)">${ico('plus')}</span><span class="grow title">Novo pagamento recorrente</span></button></div></div>`;
    bindBack();
    bindDueRows($('#view'));
    $$('[data-rule]').forEach(b => b.onclick = () => openRecurringSheet(rules.find(r => r.id === Number(b.dataset.rule))));
    $('#new-rule').onclick = () => openRecurringSheet(null);
}

function openRecurringSheet(rule) {
    let type = rule ? rule.type : 'EXPENSE';
    const current = todayIso().slice(0, 7);
    const startMonths = [...new Set([...(rule ? [rule.startMonth] : []), ...monthRange(shiftMonth(current, -12), 19)])].sort();
    const endMonths = [...new Set([...(rule?.endMonth ? [rule.endMonth] : []), ...monthRange(current, 61)])].sort();
    const defaultAccount = state.accountFilter || mainAccountId();
    const sheet = openSheet(`
        <h2>${rule ? 'Editar pagamento recorrente' : 'Novo pagamento recorrente'}</h2>
        <div class="seg"><button type="button" data-type="EXPENSE" class="exp">Despesa</button><button type="button" data-type="INCOME" class="inc">Receita</button></div>
        <form id="r-form" novalidate>
            <div class="field"><label for="r-name">Nome</label><input id="r-name" maxlength="120" placeholder="Ex.: Aluguel" value="${esc(rule?.name)}"></div>
            <div class="grid2">
                <div class="field"><label for="r-amount">Valor (${currencySymbol()})</label><input id="r-amount" inputmode="decimal" placeholder="0,00" value="${fmtInput(rule?.amount)}" ${rule?.variableAmount ? 'disabled' : ''}></div>
                <div class="field"><label for="r-day">Dia do mês</label><input id="r-day" type="number" min="1" max="31" inputmode="numeric" value="${rule?.dayOfMonth ?? ''}" placeholder="1 a 31"></div>
            </div>
            <label class="switch-row"><input type="checkbox" id="r-variable" ${rule?.variableAmount ? 'checked' : ''}><span>Valor variável${info(`O valor muda todo mês (luz, água): você informa ao pagar.`)}</span></label>
            ${tip('recurring-day', `Em meses que não têm esse dia (ex.: 30 em fevereiro), vale o último dia do mês.`)}
            <div class="grid2">
                <div class="field"><label for="r-account">Conta</label><select id="r-account" data-create="account">${accountOptions(rule?.accountId ?? defaultAccount)}</select></div>
                <div class="field"><label for="r-method">Forma de pagamento</label><select id="r-method" data-create="method">${options(state.methods, rule?.paymentMethodId, {none: '—'})}</select></div>
            </div>
            <div class="field"><label for="r-category">Categoria</label><select id="r-category">${categoryOptions(rule ? rule.type : 'EXPENSE', rule?.categoryId)}</select></div>
            <div class="grid2">
                <div class="field"><label for="r-start">Começa em</label><select id="r-start" ${rule ? 'disabled' : ''}>${monthOptions(startMonths, rule?.startMonth || current)}</select></div>
                <div class="field"><label for="r-end">Termina em</label><select id="r-end">${monthOptions(endMonths, rule?.endMonth || '', {none: 'Sem data final'})}</select></div>
            </div>
            <label class="switch-row"><input type="checkbox" id="r-active" ${rule ? (rule.active ? 'checked' : '') : 'checked'}><span>Ativo${info(`Pausado, não gera novos pagamentos.`)}</span></label>
            <div class="form-actions">
                ${rule ? '<button type="button" class="btn danger" id="r-del">Excluir</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
        </form>`);
    const paintType = () => {
        $$('.seg button', sheet).forEach(b => b.classList.toggle('active', b.dataset.type === type));
        const picked = $('#r-category', sheet);
        const keep = picked.value && (catById(Number(picked.value)) || {}).kind === kindOf(type) ? Number(picked.value) : null;
        picked.innerHTML = categoryOptions(type, keep);
    };
    $$('.seg button', sheet).forEach(b => b.onclick = () => { type = b.dataset.type; paintType(); });
    paintType();
    $('#r-variable', sheet).onchange = e => { $('#r-amount', sheet).disabled = e.target.checked; };
    if (rule) {
        $('#r-del', sheet).onclick = async () => {
            if (await confirmDialog(`Excluir “${rule.name}”? Os lançamentos que já foram criados continuam.`, {okLabel: 'Excluir'}))
                run(() => api(`/recurring/${rule.id}`, {method: 'DELETE'}), 'Pagamento recorrente excluído');
        };
    }
    $('#r-form', sheet).onsubmit = e => {
        e.preventDefault();
        const name = $('#r-name', sheet).value.trim();
        const variableAmount = $('#r-variable', sheet).checked;
        const amount = variableAmount ? null : parseAmount($('#r-amount', sheet).value);
        const dayOfMonth = Number($('#r-day', sheet).value);
        if (!name) return toast('Informe o nome do pagamento.');
        if (!variableAmount && !(amount > 0)) return toast('Informe o valor ou marque como variável.');
        if (!(dayOfMonth >= 1 && dayOfMonth <= 31)) return toast('Informe o dia do mês (1 a 31).');
        const body = {
            name, type, amount, variableAmount, dayOfMonth,
            accountId: Number($('#r-account', sheet).value),
            paymentMethodId: nextId($('#r-method', sheet).value),
            categoryId: nextId($('#r-category', sheet).value),
            active: $('#r-active', sheet).checked,
            startMonth: rule ? rule.startMonth : $('#r-start', sheet).value,
            endMonth: $('#r-end', sheet).value || null
        };
        run(() => api(rule ? `/recurring/${rule.id}` : '/recurring', {method: rule ? 'PUT' : 'POST', body}), 'Pagamento recorrente salvo');
    };
}

/* ---------- Goals tab: pots and wish list ---------- */
function renderGoals() {
    const pots = state.pots, wishes = state.wishes;
    const tab = state.wishTab;
    const shown = wishes.filter(w => w.status === tab);
    // the estimated total adds up each currency on its own
    const wishedByCurrency = new Map();
    wishes.filter(w => w.status === 'WISHED' && w.estimatedPrice != null).forEach(w => wishedByCurrency.set(w.currency, (wishedByCurrency.get(w.currency) || 0) + Number(w.estimatedPrice)));
    const wishedTotals = [...wishedByCurrency.entries()].filter(([, value]) => value > 0);
    const potCard = p => {
        const balance = Number(p.balance), goal = p.goal == null ? null : Number(p.goal);
        const pct = goal ? Math.min(100, (balance / goal) * 100) : null;
        let hint = p.mirrored ? 'Saldo da conta' : p.mode === 'FIXED' ? `${money(p.monthlyAmount, p.currency)} por mês` : 'Aportes manuais';
        if (p.accountName) hint += ` · ${p.accountName}`;
        if (goal && balance < goal && p.mode === 'FIXED' && Number(p.monthlyAmount) > 0) {
            hint += ` · meta em ~${Math.ceil((goal - balance) / Number(p.monthlyAmount))} meses`;
        } else if (goal && balance >= goal) {
            hint += ' · meta atingida';
        }
        return `<button class="card pot-card ${p.active ? '' : 'is-archived'}" data-pot="${p.id}" data-hold="pot:${p.id}">
            <span class="pot-top">${avatar(p.icon || 'coins', p.color)}
                <span class="grow"><strong>${esc(p.name)}</strong><span class="small muted" style="display:block">${esc(hint)}</span></span>
                <strong>${money(balance, p.currency)}</strong></span>
            ${goal ? `<span class="progress"><i style="width:${pct}%"></i></span><span class="budget-meta"><span>${pct.toFixed(0)}% de ${money(goal, p.currency)}</span></span>` : ''}</button>`;
    };
    const wishRow = w => `<div class="row wish-row" data-wish="${w.id}">
        <span class="avatar" style="background:var(--surface-2)">${ico('gift')}</span>
        <span class="grow"><span class="title">${esc(w.name)}</span>
            <span class="small muted">${w.status === 'BOUGHT'
                ? `Comprado em ${isoToBr(w.purchaseDate)} por ${money(w.realPrice, w.currency)}${w.estimatedPrice != null ? ` (estimado ${money(w.estimatedPrice, w.currency)})` : ''}`
                : `${w.estimatedPrice != null ? 'Estimado ' + money(w.estimatedPrice, w.currency) : 'Sem preço estimado'}${w.potName ? ' · ' + esc(w.potName) : ''}`}</span></span>
        ${w.status === 'WISHED' ? `<button class="chip buy-chip" data-buy="${w.id}">Comprei</button>` : ''}</div>`;

    $('#view').innerHTML = `<div class="stack">
        <h2 class="section-title">Caixinhas</h2>
        ${pots.length ? pots.map(potCard).join('') : `<div class="card empty"><div class="big">${ico('coins')}</div>Separe um valor todo mês para um objetivo:<br>viagem, reserva, uma compra grande…</div>`}
        <button class="btn block" id="new-pot">${ico('plus')} Nova caixinha</button>
        <h2 class="section-title">Lista de desejos</h2>
        <div class="chips">${[['WISHED', 'Desejados'], ['BOUGHT', 'Comprados'], ['DISCARDED', 'Descartados']].map(([v, l]) =>
            `<button class="chip ${tab === v ? 'active' : ''}" data-wtab="${v}">${l}</button>`).join('')}</div>
        ${tab === 'WISHED' && wishedTotals.length ? `<div class="small muted">Total estimado: ${wishedTotals.map(([code, value]) => `<strong>${money(value, code)}</strong>`).join(' · ')}</div>` : ''}
        ${shown.length ? `<div class="list">${shown.map(wishRow).join('')}</div>`
            : `<div class="card empty"><div class="big">${ico('gift')}</div>${tab === 'WISHED' ? 'Nada na lista. Anote o que você quer comprar<br>e o preço estimado.' : 'Nada por aqui.'}</div>`}
        <button class="btn block" id="new-wish">${ico('plus')} Novo desejo</button>
    </div>`;
    $$('[data-pot]').forEach(b => b.onclick = () => openPotDetail(pots.find(p => p.id === Number(b.dataset.pot))));
    $('#new-pot').onclick = () => openPotSheet(null);
    $('#new-wish').onclick = () => openWishSheet(null);
    $$('[data-wtab]').forEach(b => b.onclick = () => { state.wishTab = b.dataset.wtab; renderGoals(); });
    $$('[data-wish]').forEach(r => r.onclick = e => {
        if (e.target.closest('[data-buy]')) return;
        openWishSheet(wishes.find(w => w.id === Number(r.dataset.wish)));
    });
    $$('[data-buy]').forEach(b => b.onclick = () => openBuySheet(wishes.find(w => w.id === Number(b.dataset.buy))));
}

function openPotSheet(pot) {
    let mode = pot ? pot.mode : 'FIXED';
    const current = todayIso().slice(0, 7);
    const sheet = openSheet(`
        <h2>${pot ? 'Editar caixinha' : 'Nova caixinha'}</h2>
        <form id="p-form" novalidate>
            <div class="field"><label for="p-name">Nome</label><input id="p-name" maxlength="80" placeholder="Ex.: Viagem" value="${esc(pot?.name)}"></div>
            <div class="field"><label>Cor</label><div class="swatches" id="p-colors"></div></div>
            <div class="field"><label>Como ela cresce?</label>
                <div class="seg" id="p-mode"><button type="button" data-mode="FIXED">Valor fixo por mês</button><button type="button" data-mode="VARIABLE">Eu aporto quando quiser</button></div></div>
            <div class="field" id="p-monthly-field"><label for="p-monthly" id="p-monthly-label">Aporte mensal (${currencySymbol(pot ? pot.currency : currencyCode())})</label><input id="p-monthly" inputmode="decimal" placeholder="0,00" value="${fmtInput(pot?.monthlyAmount)}">
                <span class="small muted">Aporte automático no dia 1, a partir do mês inicial. O dinheiro continua na conta.</span></div>
            <div class="field"><label for="p-currency">Moeda</label>
                <select id="p-currency">${currencyOptions(pot ? pot.currency : currencyCode())}</select>
                <span class="small muted" id="p-currency-note" hidden>Com uma conta ligada, vale a moeda dela.</span></div>
            <div class="field"><label for="p-account">Banco / conta</label>
                <select id="p-account"><option value="">Nenhum (sem vínculo)</option>${orderedAccounts(state.accounts.filter(a => a.type !== 'CREDIT_CARD' && (!a.archived || a.id === pot?.accountId))).map(a =>
                    `<option value="${a.id}" ${a.id === pot?.accountId ? 'selected' : ''}>${esc(accountLabel(a))}</option>`).join('')}</select>
                <span class="small muted">Onde o dinheiro está guardado. É só um vínculo; o dinheiro continua na conta.</span>
                <span class="small muted" id="p-mirror-note" hidden>Conta de dinheiro guardado: a caixinha mostra o saldo dela.</span></div>
            <div class="grid2">
                <div class="field"><label for="p-goal">Meta (opcional)</label><input id="p-goal" inputmode="decimal" placeholder="0,00" value="${fmtInput(pot?.goal)}"></div>
                <div class="field"><label for="p-start">Começa em</label><select id="p-start" ${pot ? 'disabled' : ''}>${monthOptions(monthRange(shiftMonth(current, -12), 19), pot?.startMonth || current)}</select></div>
            </div>
            <div class="field"><label>Ícone</label><div class="icon-picker" id="p-icons"></div></div>
            <label class="switch-row"><input type="checkbox" id="p-active" ${pot ? (pot.active ? 'checked' : '') : 'checked'}><span>Ativa${info(`Pausada, não recebe aportes automáticos.`)}</span></label>
            <div class="form-actions">
                ${pot ? '<button type="button" class="btn danger" id="p-del">Excluir</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
        </form>`);
    const icon = iconPicker(sheet, '#p-icons', POT_ICONS, pot?.icon || 'coins');
    const colorOf = colorPicker(sheet, '#p-colors', pot?.color || '#81C784');
    const paintMode = () => {
        $$('#p-mode button', sheet).forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        $('#p-monthly-field', sheet).hidden = mode !== 'FIXED';
    };
    $$('#p-mode button', sheet).forEach(b => b.onclick = () => { mode = b.dataset.mode; paintMode(); });
    paintMode();
    // with an account the account's currency counts; and an account of saved money lends its balance to the pot
    const paintPotCurrency = () => {
        const account = accountById(nextId($('#p-account', sheet).value));
        const select = $('#p-currency', sheet);
        if (account) select.value = account.currency;
        select.disabled = !!account;
        $('#p-currency-note', sheet).hidden = !account;
        $('#p-mirror-note', sheet).hidden = !(account && account.saved);
        $('#p-monthly-label', sheet).textContent = T(`Aporte mensal (${currencySymbol(select.value)})`);
    };
    $('#p-account', sheet).onchange = paintPotCurrency;
    $('#p-currency', sheet).onchange = paintPotCurrency;
    paintPotCurrency();
    if (pot) {
        $('#p-del', sheet).onclick = async () => {
            if (await confirmDialog(`Excluir a caixinha “${pot.name}” e seu histórico? Desejos vinculados ficarão sem caixinha.`, {okLabel: 'Excluir'}))
                run(() => api(`/pots/${pot.id}`, {method: 'DELETE'}), 'Caixinha excluída');
        };
    }
    $('#p-form', sheet).onsubmit = e => {
        e.preventDefault();
        const name = $('#p-name', sheet).value.trim();
        const monthly = mode === 'FIXED' ? parseAmount($('#p-monthly', sheet).value) : null;
        const goalText = $('#p-goal', sheet).value.trim();
        const goal = goalText ? parseAmount(goalText) : null;
        if (!name) return toast('Informe o nome da caixinha.');
        if (mode === 'FIXED' && !(monthly > 0)) return toast('Informe o aporte mensal.');
        if (goalText && !(goal > 0)) return toast('A meta deve ser maior que zero.');
        const body = {name, color: colorOf(), icon: icon(), goal, mode, monthlyAmount: monthly,
            startMonth: pot ? pot.startMonth : $('#p-start', sheet).value, active: $('#p-active', sheet).checked,
            accountId: nextId($('#p-account', sheet).value), currency: $('#p-account', sheet).value ? undefined : $('#p-currency', sheet).value};
        run(() => api(pot ? `/pots/${pot.id}` : '/pots', {method: pot ? 'PUT' : 'POST', body}), 'Caixinha salva');
    };
}

async function openPotDetail(pot) {
    let entries = [];
    try { entries = await api(`/pots/${pot.id}/entries`); } catch (e) { return toast(e.message); }
    const kindLabel = {AUTO: 'Aporte mensal', MANUAL: 'Aporte', WITHDRAWAL: 'Retirada', PURCHASE: 'Compra'};
    const sheet = openSheet(`
        <h2>${esc(pot.name)}</h2>
        <div class="pot-balance">${money(pot.balance, pot.currency)}${pot.goal != null ? `<span class="muted"> de ${money(pot.goal, pot.currency)}</span>` : ''}</div>
        ${pot.accountName ? `<p class="small muted" style="margin:-4px 0 10px">Guardado em ${esc(pot.accountName)}</p>` : ''}
        ${pot.mirrored ? `<p class="small muted" style="margin:0 0 10px">O saldo vem da conta “${esc(pot.accountName)}”. Para guardar ou tirar dinheiro, faça uma transferência.</p>
        <div class="form-actions" style="margin-bottom:12px"><button type="button" class="btn primary" id="pd-transfer">Nova transferência</button></div>` : `<div class="form-actions" style="margin-bottom:12px">
            <button type="button" class="btn" id="pd-withdraw">Retirar</button>
            <button type="button" class="btn primary" id="pd-deposit">Aportar</button>
        </div>`}
        <h3 class="section-title">Histórico</h3>
        ${entries.length ? `<div class="list">${entries.map(en => `<div class="row">
            <span class="grow"><span class="title">${kindLabel[en.kind]}${en.note ? ' · ' + esc(en.note) : ''}</span><span class="small muted">${isoToBr(en.date)}</span></span>
            <span class="amount ${Number(en.amount) < 0 ? 'expense' : 'income'}">${Number(en.amount) < 0 ? '−' : '+'} ${money(Math.abs(Number(en.amount)), pot.currency)}</span>
            ${en.kind === 'MANUAL' || en.kind === 'WITHDRAWAL' ? `<button class="icon-btn small" data-del-entry="${en.id}" aria-label="Remover">${ico('trash')}</button>` : ''}</div>`).join('')}</div>`
            : '<div class="card empty">Sem movimentos ainda.</div>'}
        <div class="form-actions" style="margin-top:12px"><button type="button" class="btn" id="pd-edit">Editar caixinha</button></div>`);
    if (pot.mirrored) {
        $('#pd-transfer', sheet).onclick = () => {
            closeSheet();
            openTransactionSheet(null);
            setTimeout(() => { // opens as a transfer to the account the pot shows
                const mode = $('[data-mode="TRANSFER"]'), to = $('#f-to');
                if (mode && to) { mode.click(); to.value = String(pot.accountId); to.dispatchEvent(new Event('change')); }
            }, 80);
        };
    } else {
        $('#pd-deposit', sheet).onclick = () => openMoveSheet(pot, 'deposit');
        $('#pd-withdraw', sheet).onclick = () => openMoveSheet(pot, 'withdraw');
    }
    $('#pd-edit', sheet).onclick = () => openPotSheet(pot);
    $$('[data-del-entry]', sheet).forEach(b => b.onclick = async () => {
        if (await confirmDialog('Remover este movimento?', {okLabel: 'Remover'}))
            run(() => api(`/pots/entries/${b.dataset.delEntry}`, {method: 'DELETE'}), 'Movimento removido');
    });
}

function openMoveSheet(pot, kind) {
    const deposit = kind === 'deposit';
    const sheet = openSheet(`
        <h2>${deposit ? 'Aportar em' : 'Retirar de'} ${esc(pot.name)}</h2>
        <form id="mv-form" novalidate>
            <input class="amount-input" id="mv-amount" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Valor">
            ${dateField('mv-date', todayIso())}
            <div class="field"><label for="mv-note">Observação</label><input id="mv-note" maxlength="255" placeholder="Opcional"></div>
            <div class="form-actions"><button type="submit" class="btn primary">${deposit ? 'Aportar' : 'Retirar'}</button></div>
        </form>`);
    const dateValue = bindDate(sheet, 'mv-date');
    setTimeout(() => $('#mv-amount', sheet).focus(), 60);
    $('#mv-form', sheet).onsubmit = e => {
        e.preventDefault();
        const amount = parseAmount($('#mv-amount', sheet).value);
        if (!(amount > 0)) return toast('Informe um valor maior que zero.');
        if (!dateValue()) return toast('Informe uma data válida.');
        run(() => api(`/pots/${pot.id}/${kind}`, {method: 'POST', body: {amount, date: dateValue(), note: $('#mv-note', sheet).value.trim() || null}}),
            deposit ? 'Aporte registrado' : 'Retirada registrada');
    };
}

function openWishSheet(item) {
    const sheet = openSheet(`
        <h2>${item ? 'Editar desejo' : 'Novo desejo'}</h2>
        <form id="w-form" novalidate>
            <div class="field"><label for="w-name">Produto</label><input id="w-name" maxlength="120" placeholder="Ex.: Fone de ouvido" value="${esc(item?.name)}"></div>
            <div class="field"><label for="w-currency">Moeda</label><select id="w-currency" ${item && item.status === 'BOUGHT' ? 'disabled' : ''}>${currencyOptions(item ? item.currency : currencyCode())}</select></div>
            <div class="grid2">
                <div class="field"><label for="w-price" id="w-price-label">Preço estimado (${currencySymbol(item ? item.currency : currencyCode())})</label><input id="w-price" inputmode="decimal" placeholder="0,00" value="${fmtInput(item?.estimatedPrice)}"></div>
                <div class="field"><label for="w-pot">Pagar com a caixinha</label><select id="w-pot"></select></div>
            </div>
            <div class="field"><label for="w-url">Link</label><input id="w-url" maxlength="500" placeholder="Opcional" value="${esc(item?.url)}"></div>
            <div class="field"><label for="w-notes">Observação</label><textarea id="w-notes" rows="2" maxlength="255">${esc(item?.notes)}</textarea></div>
            ${tip('wish-account', `Na lista, o item não pertence a uma conta. Você escolhe a conta ao marcar “Comprei”.`)}
            <div class="form-actions">
                ${item ? '<button type="button" class="btn danger" id="w-del">Excluir</button>' : ''}
                ${item && item.status === 'WISHED' ? '<button type="button" class="btn" id="w-discard">Descartar</button>' : ''}
                ${item && item.status === 'DISCARDED' ? '<button type="button" class="btn" id="w-restore">Voltar para a lista</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
        </form>`);
    // only the pots in the item's currency (and that keep a balance of their own) can pay for it
    const paintWishPots = () => {
        const code = $('#w-currency', sheet).value;
        const chosen = nextId($('#w-pot', sheet).value) ?? item?.potId;
        const pots = state.pots.filter(p => p.currency === code && !p.mirrored);
        $('#w-pot', sheet).innerHTML = options(pots, chosen, {none: 'Nenhuma'});
        $('#w-price-label', sheet).textContent = T(`Preço estimado (${currencySymbol(code)})`);
    };
    $('#w-currency', sheet).onchange = () => { $('#w-pot', sheet).value = ''; paintWishPots(); };
    paintWishPots();
    if (item) {
        $('#w-del', sheet).onclick = async () => {
            const extra = item.status === 'BOUGHT' ? ' O lançamento da compra continua.' : '';
            if (await confirmDialog(`Excluir “${item.name}” da lista?${extra}`, {okLabel: 'Excluir'}))
                run(() => api(`/wishes/${item.id}`, {method: 'DELETE'}), 'Desejo excluído');
        };
        const discard = $('#w-discard', sheet), restore = $('#w-restore', sheet);
        if (discard) discard.onclick = () => run(() => api(`/wishes/${item.id}/discard`, {method: 'POST'}), 'Desejo descartado');
        if (restore) restore.onclick = () => run(() => api(`/wishes/${item.id}/restore`, {method: 'POST'}), 'Desejo de volta na lista');
    }
    $('#w-form', sheet).onsubmit = e => {
        e.preventDefault();
        const name = $('#w-name', sheet).value.trim();
        const priceText = $('#w-price', sheet).value.trim();
        const estimatedPrice = priceText ? parseAmount(priceText) : null;
        if (!name) return toast('Informe o nome do produto.');
        if (priceText && !(estimatedPrice > 0)) return toast('O preço estimado deve ser maior que zero.');
        const body = {name, estimatedPrice, potId: nextId($('#w-pot', sheet).value), currency: $('#w-currency', sheet).value,
            url: $('#w-url', sheet).value.trim() || null, notes: $('#w-notes', sheet).value.trim() || null};
        run(() => api(item ? `/wishes/${item.id}` : '/wishes', {method: item ? 'PUT' : 'POST', body}), 'Desejo salvo');
    };
}

function openBuySheet(item) {
    const pot = item.potId ? state.pots.find(p => p.id === item.potId) : null;
    // the purchase goes on an account in the item's currency
    const accountsHere = orderedAccounts(activeAccounts().filter(a => a.currency === item.currency));
    const preferred = state.accountFilter || mainAccountId();
    const defaultAccount = (accountsHere.find(a => a.id === preferred) || accountsHere[0] || {}).id;
    const sheet = openSheet(`
        <h2>Comprei: ${esc(item.name)}</h2>
        <form id="b2-form" novalidate>
            <input class="amount-input" id="b2-price" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Preço pago" value="${fmtInput(item.estimatedPrice)}">
            <p class="small muted center">${item.estimatedPrice != null ? `Estimado: ${money(item.estimatedPrice, item.currency)}. ` : ''}Informe o preço real que você pagou.</p>
            ${dateField('b2-date', todayIso(), 'Data da compra')}
            <div class="field"><label for="b2-inst">Parcelas${info('Em quantas vezes foi paga. O preço acima é o total: a 1ª parcela entra na data da compra e as outras ficam “a pagar” nos meses seguintes (no cartão de crédito, todas já entram na fatura).')}</label>
                <input id="b2-inst" type="number" inputmode="numeric" min="1" max="60" step="1" value="1" aria-label="Número de parcelas"></div>
            <p class="small muted center" id="b2-inst-hint" hidden></p>
            <div class="grid2">
                <div class="field"><label for="b2-account">Em qual conta?</label><select id="b2-account">${accountsHere.map(a => `<option value="${a.id}" ${a.id === defaultAccount ? 'selected' : ''}>${esc(accountLabel(a))}</option>`).join('')}</select></div>
                <div class="field"><label for="b2-method">Forma de pagamento</label><select id="b2-method" data-create="method">${options(state.methods, null, {none: '—'})}</select></div>
            </div>
            <div class="field"><label for="b2-category">Categoria</label><select id="b2-category">${categoryOptions('EXPENSE', null)}</select></div>
            ${pot ? `<label class="switch-row"><input type="checkbox" id="b2-pot" ${Number(pot.balance) > 0 && (item.estimatedPrice == null || Number(pot.balance) >= Number(item.estimatedPrice)) ? 'checked' : ''}><span>Descontar da caixinha “${esc(pot.name)}”${info(`Saldo atual: ${money(pot.balance)}`)}</span></label>` : ''}
            <div class="form-actions"><button type="submit" class="btn primary">Registrar compra</button></div>
        </form>`);
    const dateValue = bindDate(sheet, 'b2-date');
    // mostra o valor de cada parcela enquanto a pessoa digita
    const paintInstallments = () => {
        const n = Number($('#b2-inst', sheet).value || 1), total = parseAmount($('#b2-price', sheet).value);
        const hint = $('#b2-inst-hint', sheet);
        hint.hidden = !(n > 1 && total > 0);
        if (!hint.hidden) hint.textContent = `${n}× de ${money(Math.floor(total * 100 / n) / 100, item.currency)} (a primeira pode ter alguns centavos a mais)`;
    };
    $('#b2-inst', sheet).addEventListener('input', paintInstallments);
    $('#b2-price', sheet).addEventListener('input', paintInstallments);
    $('#b2-form', sheet).onsubmit = e => {
        e.preventDefault();
        if (!accountsHere.length) return toast('Crie uma conta nessa moeda para registrar a compra.');
        const price = parseAmount($('#b2-price', sheet).value);
        if (!(price > 0)) return toast('Informe o preço pago.');
        if (!dateValue()) return toast('Informe uma data válida.');
        const installments = Number($('#b2-inst', sheet).value || 1);
        if (!Number.isInteger(installments) || installments < 1 || installments > 60) return toast('Informe de 1 a 60 parcelas.');
        run(() => api(`/wishes/${item.id}/buy`, {method: 'POST', body: {
            price, date: dateValue(), installments,
            accountId: Number($('#b2-account', sheet).value),
            paymentMethodId: nextId($('#b2-method', sheet).value),
            categoryId: nextId($('#b2-category', sheet).value),
            usePot: pot ? $('#b2-pot', sheet).checked : false
        }}), 'Compra registrada');
    };
}

/** "Sobre o Projeto": */
function openAboutProject() {
    const sheet = openSheet(`
        <h2>Sobre o Projeto</h2>
        <div class="stack-tight about-project">
            <p>Esse projeto é open source e completamente gratuito</p>
            <p>Se você tiver alguma ideia de melhoria, pode me mandar lá no
                <a href="https://github.com/Kaic-Furushima/expense-tracker" target="_blank" rel="noopener noreferrer">repositório do projeto</a>
                ou direto no meu e-mail: <a href="mailto:kaic.fbs@gmail.com">kaic.fbs@gmail.com</a>.</p>
        </div>
        <div class="form-actions"><button type="button" class="btn primary" id="ap-close">Fechar</button></div>`);
    $('#ap-close', sheet).onclick = closeSheet;
}

/* ---------- Trash ---------- */
async function renderTrashPage() {
    $('#view').innerHTML = `<div class="stack">${pageHeader('Lixeira')}<div class="skeleton"></div></div>`;
    bindBack();
    let items;
    try {
        items = await api('/trash');
    } catch (e) {
        return toast(e.message);
    }
    if (state.tab !== 'more' || state.sub !== 'trash') return; // navigated away while loading
    $('#view').innerHTML = `<div class="stack">${pageHeader('Lixeira')}
        ${tip('trash', `Itens excluídos ficam na lixeira por 30 dias. Restaurar mantém a data e a conta.`)}
        ${items.length ? `<div class="list">${items.map(i => i.kind === 'EVERYTHING' ? `<div class="row" data-trash="${i.kind}:${i.id}">
            <span class="avatar" style="background:var(--surface-2)">${ico('layers')}</span>
            <span class="grow"><span class="title">${esc(i.title)}</span><span class="small muted">${i.detail.split(' · ').map(part => `<span>${esc(part)}</span>`).join(' · ')}</span><span class="small muted">Limpo em ${dateTimeBr(i.deletedAt)}</span></span>
            <span class="row-actions"><button class="chip" data-restore="${i.kind}:${i.id}">Restaurar</button>
            <button class="icon-btn small" data-purge="${i.kind}:${i.id}" aria-label="Excluir de vez">${ico('trash')}</button></span></div>`
            : `<div class="row" data-trash="${i.kind}:${i.id}">
            <span class="avatar" style="background:var(--surface-2)">${ico(i.kind === 'TRANSFER' ? 'transfer' : 'receipt')}</span>
            <span class="grow"><span class="title">${esc(i.title)}</span><span class="small muted">${esc(i.detail)} · ${isoToBr(i.date)} · excluído em ${dateTimeBr(i.deletedAt)}</span></span>
            <span class="amount">${money(i.amount)}</span>
            <span class="row-actions"><button class="chip" data-restore="${i.kind}:${i.id}">Restaurar</button>
            <button class="icon-btn small" data-purge="${i.kind}:${i.id}" aria-label="Excluir de vez">${ico('trash')}</button></span></div>`).join('')}</div>
            <button class="btn danger block" id="empty-trash">Esvaziar a lixeira</button>`
            : `<div class="card empty"><div class="big">${ico('trash')}</div>A lixeira está vazia.</div>`}</div>`;
    bindBack();
    const refresh = async message => { await loadAll(); toast(message); };
    $$('[data-restore]').forEach(b => b.onclick = async () => {
        const [kind, id] = b.dataset.restore.split(':');
        if (kind === 'EVERYTHING' && !await confirmDialog('Restaurar esta cópia? Os dados atuais serão substituídos e enviados para a lixeira.', {okLabel: 'Restaurar tudo', danger: false})) return;
        try { await api(`/trash/${kind}/${id}/restore`, {method: 'POST'}); await refresh('Restaurado'); } catch (e) { toast(e.message); }
    });
    $$('[data-purge]').forEach(b => b.onclick = async () => {
        const [kind, id] = b.dataset.purge.split(':');
        if (!await confirmDialog('Excluir de vez? Isso não tem volta.', {okLabel: 'Excluir de vez'})) return;
        try { await api(`/trash/${kind}/${id}`, {method: 'DELETE'}); await refresh('Excluído de vez'); } catch (e) { toast(e.message); }
    });
    const empty = $('#empty-trash');
    if (empty) empty.onclick = async () => {
        if (!await confirmDialog(`Excluir de vez ${items.length} ${items.length === 1 ? 'item' : 'itens'}? Isso não tem volta.`, {okLabel: 'Esvaziar'})) return;
        try { await api('/trash', {method: 'DELETE'}); await refresh('Lixeira esvaziada'); } catch (e) { toast(e.message); }
    };
}

/* ---------- Short explanations ----------
   "?" next to a setting: the explanation shows only when asked for. Tips are explanations spread over the screens: off
   until turned on in Configurações, and each one shows once, with a button to dismiss it for good. */
function info(text) {
    return `<button type="button" class="info-btn" aria-label="Saiba mais" aria-expanded="false">?</button><span class="info-text small muted" hidden>${text}</span>`;
}
const tipsOn = () => safeStorage.get('tips') === '1';
const tipsSeen = () => { try { return JSON.parse(safeStorage.get('tipsSeen') || '[]'); } catch (e) { return []; } };
function tip(id, html) {
    if (!tipsOn() || tipsSeen().includes(id)) return '';
    return `<div class="tip" data-tip="${id}"><span class="small muted">${html}</span><button type="button" class="chip" data-tip-ok="${id}">Entendi</button></div>`;
}
document.addEventListener('click', e => {
    const button = e.target.closest('.info-btn');
    if (button) {
        e.preventDefault();
        const text = button.nextElementSibling;
        const show = text.hidden;
        text.hidden = !show;
        button.setAttribute('aria-expanded', String(show));
        return;
    }
    const ok = e.target.closest('[data-tip-ok]');
    if (ok) {
        safeStorage.set('tipsSeen', JSON.stringify([...tipsSeen(), ok.dataset.tipOk]));
        const box = ok.closest('.tip');
        if (box) box.remove();
    }
});

/* ---------- Create without leaving the form ----------
   Category, account and payment method can be created from the screen that needs them (a small form over it, so what
   was typed stays); it resolves with the new item, or null when cancelled. */
function quickCreate(kind, {categoryKind = 'EXPENSE'} = {}) {
    return new Promise(resolve => {
        const root = $('#confirm-root');
        const title = {category: categoryKind === 'INCOME' ? 'Nova categoria de receita' : 'Nova categoria de despesa',
            account: 'Nova conta', method: 'Nova forma de pagamento'}[kind];
        root.innerHTML = `<div class="overlay confirm-overlay"><div class="sheet quick" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <h2>${title}</h2>
            <form id="qc-form" novalidate>
                <div class="field"><label for="qc-name">Nome</label><input id="qc-name" maxlength="80" autocomplete="off"></div>
                ${kind === 'account' ? `<label class="switch-row"><input type="checkbox" id="qc-type"><span>É um cartão de crédito</span></label>
                    <div class="grid2" id="qc-card" hidden>
                        <div class="field"><label for="qc-closing">Dia de fechamento</label><input id="qc-closing" inputmode="numeric" maxlength="2" placeholder="Ex.: 10"></div>
                        <div class="field"><label for="qc-due">Dia de vencimento</label><input id="qc-due" inputmode="numeric" maxlength="2" placeholder="Ex.: 20"></div></div>` : ''}
                ${kind !== 'method' ? '<div class="field"><label>Cor</label><div class="swatches" id="qc-colors"></div></div>' : ''}
                ${kind === 'category' ? `<div class="field"><label>Ícone</label><div class="icon-picker" id="qc-icons"></div>
                    ${nativeDatePicker ? '<input id="qc-emoji" class="emoji-input" maxlength="16" placeholder="ou um emoji, ex.: 🐶" autocomplete="off" aria-label="Emoji">' : ''}</div>` : ''}
                <div class="form-actions"><button type="button" class="btn" id="qc-cancel">Cancelar</button><button type="submit" class="btn primary">Criar</button></div>
            </form></div></div>`;
        const colorOf = kind !== 'method' ? colorPicker(root, '#qc-colors', kind === 'account' ? '#64B5F6' : '#6750A4') : null;
        let icon = 'tag';
        if (kind === 'category') {
            const paintIcons = () => {
                const choices = PICKABLE_ICONS.includes(icon) ? PICKABLE_ICONS : [icon, ...PICKABLE_ICONS];
                $('#qc-icons', root).innerHTML = choices.map(k =>
                    `<button type="button" class="icon-opt ${k === icon ? 'active' : ''}" data-icon="${esc(k)}" aria-label="${esc(k)}">${ico(k)}</button>`).join('');
                $$('.icon-opt', root).forEach(b => b.onclick = () => { icon = b.dataset.icon; paintIcons(); });
            };
            paintIcons();
            const emoji = $('#qc-emoji', root);
            if (emoji) emoji.oninput = () => {
                const typed = emoji.value.trim();
                if (typed) { icon = typed; paintIcons(); }
            };
        }
        const done = value => { layerClose('confirm'); root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(value); };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
        document.addEventListener('keydown', onKey, true);
        layerOpen('confirm', () => done(null));
        $('#qc-cancel', root).onclick = () => done(null);
        $('.overlay', root).addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) done(null); });
        const type = $('#qc-type', root);
        if (type) type.onchange = () => { $('#qc-card', root).hidden = !type.checked; };
        $('#qc-form', root).onsubmit = async e => {
            e.preventDefault();
            const name = $('#qc-name', root).value.trim();
            if (!name) return toast('Informe o nome.');
            try {
                let created;
                if (kind === 'category') {
                    created = await api('/categories', {method: 'POST', body: {name, icon, color: colorOf(), kind: categoryKind}});
                    state.categories = await api('/categories');
                } else if (kind === 'account') {
                    const card = type.checked;
                    const closingDay = Number($('#qc-closing', root).value), dueDay = Number($('#qc-due', root).value);
                    if (card && !(closingDay >= 1 && closingDay <= 31 && dueDay >= 1 && dueDay <= 31)) return toast('Informe o dia de fechamento e o de vencimento (de 1 a 31).');
                    created = await api('/accounts', {method: 'POST', body: {name, type: card ? 'CREDIT_CARD' : 'CHECKING', color: colorOf(), icon: 'bank', initialBalance: 0,
                        parentId: null, archived: false, closingDay: card ? closingDay : null, dueDay: card ? dueDay : null}});
                    state.accounts = await api('/accounts');
                } else {
                    created = await api('/payment-methods', {method: 'POST', body: {name}});
                    state.methods = await api('/payment-methods');
                }
                toast(kind === 'category' ? 'Categoria criada' : kind === 'account' ? 'Conta criada' : 'Forma de pagamento criada');
                done(created);
            } catch (err) {
                toast(err.message);
            }
        };
        $('#qc-name', root).focus();
    });
}

/** Called by the dropdowns marked data-create: creates the item and selects it (the other dropdowns of the kind get it too). */
async function quickCreateFor(select) {
    const kind = select.dataset.create;
    const created = await quickCreate(kind);
    if (!created) return;
    $$(`select[data-create="${kind}"]`).forEach(s => {
        const keepNone = s.options.length && s.options[0].value === '' ? s.options[0].outerHTML : '';
        const current = s === select ? created.id : Number(s.value) || null;
        s.innerHTML = kind === 'account' ? accountOptions(current)
            : keepNone + state.methods.map(m => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
        s.value = current == null ? '' : String(current);
        if (s === select) s.dispatchEvent(new Event('change', {bubbles: true}));
    });
}
window.quickCreateFor = quickCreateFor;
