'use strict';

/* ---------- Back button (Android) and browser back ----------
   Every "layer" the person can go back out of (a form or calendar over the page, a page inside "Mais", a tab other than
   Início) adds one history entry, so the system back button (and the browser's) closes the top layer instead of leaving
   the app. Closing a layer with the on-screen button removes its entry again. */
const backNav = {ignore: 0, layers: []};
const layerHas = kind => backNav.layers.some(l => l.kind === kind);
function layerOpen(kind, close) {
    backNav.layers.push({kind, close});
    history.pushState({layer: backNav.layers.length}, '');
}
function layerClose(kind) {
    const i = backNav.layers.map(l => l.kind).lastIndexOf(kind);
    if (i < 0) return;
    if (i === backNav.layers.length - 1) {
        backNav.layers.pop();
        backNav.ignore++;
        history.back();
    } else {
        backNav.layers[i] = {kind: 'spent', close: () => {}}; // not on top: its entry stays until back is pressed
    }
}
window.addEventListener('popstate', () => {
    if (backNav.ignore > 0) { backNav.ignore--; return; }
    const top = backNav.layers.pop();
    if (top) top.close();
});
/** Keeps the layers for "a page inside Mais" and "a tab other than Início" in step with what is on the screen. */
function syncBackLayers() {
    const want = {
        tab: state.tab !== 'home',
        sub: state.tab === 'more' && !!state.sub
    };
    const close = {sub: () => { state.sub = null; render(); window.scrollTo({top: 0}); }, tab: () => goTo('home')};
    // the page inside Mais sits on top of its tab: leave in the reverse order, enter in this one
    for (const kind of ['sub', 'tab']) if (!want[kind] && layerHas(kind)) layerClose(kind);
    for (const kind of ['tab', 'sub']) if (want[kind] && !layerHas(kind)) layerOpen(kind, close[kind]);
}

/* ---------- Helpers ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** Display currency chosen in the settings (values are never converted, only formatted). */
const currencyFormats = {};
const currencyCode = () => (typeof state !== 'undefined' && state.settings && state.settings.currency) || 'BRL';
function currencyFormat() {
    const code = currencyCode();
    if (!currencyFormats[code]) currencyFormats[code] = new Intl.NumberFormat(LOCALE, {style: 'currency', currency: code});
    return currencyFormats[code];
}
const money = v => currencyFormat().format(Number(v || 0));
const currencySymbol = () => (currencyFormat().formatToParts(0).find(p => p.type === 'currency') || {value: ''}).value;

const pad = n => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthOf = (iso) => iso.slice(0, 7);
const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
/** The given day of the month "yyyy-mm" as yyyy-mm-dd (a day the month does not have becomes its last day). */
const dayInMonth = (ym, day) => `${ym}-${pad(Math.min(Math.max(1, day), daysInMonth(ym)))}`;
/** Adds months to a date, keeping the day (or the last day of a shorter month). */
const addMonthsIso = (iso, n) => dayInMonth(shiftMonth(iso.slice(0, 7), n), Number(iso.slice(8, 10)));
/** The nth business day (Monday to Friday) of a month; past the last one it is the last one. */
function nthBusinessDay(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    let count = 0, last = 1;
    for (let d = 1; d <= daysInMonth(ym); d++) {
        const weekday = new Date(y, m - 1, d).getDay();
        if (weekday > 0 && weekday < 6) { count++; last = d; if (count === n) return d; }
    }
    return last;
}
/** The first, second, third, fourth (1-4) or last (5) given weekday (0 = Sunday) of a month. */
function nthWeekday(ym, weekday, ordinal) {
    const [y, m] = ym.split('-').map(Number);
    const days = [];
    for (let d = 1; d <= daysInMonth(ym); d++) if (new Date(y, m - 1, d).getDay() === weekday) days.push(d);
    return ordinal >= 5 ? days[days.length - 1] : (days[ordinal - 1] ?? days[days.length - 1]);
}
/** The JavaFX WebView renders <input type="date"> as a plain text box, so it gets its own dd/mm/aaaa field. */
const nativeDatePicker = !/JavaFX/i.test(navigator.userAgent);
const isoToBr = iso => iso.split('-').reverse().join('/');
function brToIso(text) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
    if (!m) return '';
    const [, d, mo, y] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    return date.getFullYear() === Number(y) && date.getMonth() === Number(mo) - 1 && date.getDate() === Number(d) ? `${y}-${mo}-${d}` : '';
}
function shiftIso(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
/** "2026-11-01T10:25:03.12" -> "01/11/2026 10:25" */
function dateTimeBr(iso) {
    if (!iso) return '';
    return `${isoToBr(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
}
/** The tab being viewed lives only as long as the app is open: closing the app completely brings back the home screen. */
const SESSION_KEYS = ['tab'];
const storeFor = k => (SESSION_KEYS.includes(k) ? sessionStorage : localStorage);
const safeStorage = {
    get: k => { try { return storeFor(k).getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { storeFor(k).setItem(k, v); } catch (e) { /* storage unavailable */ } }
};

/* ---------- Money typing (U3) ----------
   The amount is typed by digits, as on a calculator: "1234" shows "12,34" and "123456" shows "1.234,56" (in the
   language's own separators). parseAmount() reads the same text back. */
const amountFormat = () => new Intl.NumberFormat(LOCALE, {minimumFractionDigits: 2, maximumFractionDigits: 2});
function bindAmountInput(input) {
    input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '').slice(0, 12);
        input.value = digits ? amountFormat().format(Number(digits) / 100) : '';
    });
}

/* ---------- Chart colours (U11) ----------
   A category colour that is too faint on the card (WCAG 3:1 for graphics) is darkened in the light theme and
   lightened in the dark one, so pale yellows and greens stay visible. The stored colour is not changed. */
function accentFor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return hex;
    const dark = currentTheme() === 'dark';
    const background = dark ? [24, 28, 32] : [255, 255, 255];
    const channel = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const luminance = rgb => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    let out = rgb;
    for (let step = 1; step <= 6 && contrast(out, background) < 3; step++) {
        const target = dark ? 255 : 0;
        out = rgb.map(c => Math.round(c + (target - c) * step * 0.1));
    }
    return `rgb(${out.join(',')})`;
}

/* ---------- Busy indicator (U12) ----------
   Shows a thin bar while a change or a file is being prepared, and keeps the open form from being sent twice. */
let busyCount = 0;
async function busy(work, label = 'Aguarde…') {
    const bar = $('#busy');
    const submits = () => $$('#sheet-root button[type="submit"], #confirm-root button[type="submit"]');
    busyCount++;
    if (bar) { bar.querySelector('span').textContent = label; bar.hidden = false; }
    submits().forEach(b => { b.disabled = true; });
    try {
        return await work();
    } finally {
        busyCount--;
        if (bar && busyCount === 0) bar.hidden = true;
        submits().forEach(b => { b.disabled = busyCount > 0; });
    }
}

function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return cap(new Date(y, m - 1, 1).toLocaleDateString(LOCALE, {month: 'long', year: 'numeric'}).replace(' de ', ' '));
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function shortMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return cap(new Date(y, m - 1, 1).toLocaleDateString(LOCALE, {month: 'short'}).replace('.', ''));
}
function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function dayLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return cap(new Date(y, m - 1, d).toLocaleDateString(LOCALE, {weekday: 'short', day: '2-digit', month: 'short'}).replace(/\./g, ''));
}
/** Accepts "1.234,56", "1234,56" or "1234.56". */
function parseAmount(text) {
    let t = String(text).trim().replace(/[^\d.,-]/g, '');
    const comma = t.lastIndexOf(','), dot = t.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
        // both present: whichever comes last is the decimal separator ("1.234,56" or "1,234.56")
        t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (comma >= 0) {
        // only commas: a decimal comma, except English thousands such as "1,234" or "1,234,567"
        t = LANG === 'en' && /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
}

/* ---------- Offline copy (F24) ----------
   Every successful GET is also kept in IndexedDB, per profile. When the computer cannot be reached (the phone is away
   from its network, or the computer is off), the screens show that copy and say when it was saved. Changes still need
   the computer: they are not queued. */
const offlineCopy = (() => {
    const NAME = 'expense-tracker-offline';
    let database = null;
    const open = () => {
        if (!database) {
            database = new Promise((resolve, reject) => {
                const req = indexedDB.open(NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore('responses');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return database;
    };
    const run = async (mode, action) => {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('responses', mode);
            const req = action(tx.objectStore('responses'));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = () => reject(tx.error);
        });
    };
    return {
        save: (key, value) => run('readwrite', s => s.put({value, savedAt: Date.now()}, key)).catch(() => { /* storage unavailable */ }),
        load: key => run('readonly', s => s.get(key)).catch(() => null)
    };
})();
const profileOf = () => (document.cookie.match(/(?:^|;\s*)profile=([^;]+)/) || [])[1] || 'main';
const OFFLINE_MESSAGE = 'Sem conexão com o computador. Alterações só funcionam com o computador ligado e na mesma rede.';

/** Shows (or hides, with null) the notice that the screens are using the saved copy. */
function setOfflineNotice(savedAt) {
    const bar = $('#offline-bar');
    if (!bar) return;
    bar.hidden = savedAt == null;
    if (savedAt != null) {
        const when = new Date(savedAt).toLocaleString(LOCALE, {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'});
        bar.textContent = `Sem conexão com o computador. Mostrando os dados salvos em ${when}. Alterações só funcionam com o computador ligado.`;
    }
}

async function request(path, options) {
    const res = await fetch(path, {
        headers: options.body ? {'Content-Type': 'application/json'} : {},
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
        // the password is needed (it was set, or the session ended): show the sign-in form instead of the data
        showLogin();
        const err = new Error('Entre com a senha.');
        err.locked = true;
        throw err;
    }
    if (res.status === 204) return null;
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const data = isJson ? await res.json() : null;
    if (!res.ok) {
        const fields = data && data.errors ? Object.entries(data.errors).map(([f, m]) => `${f}: ${m}`).join(' · ') : '';
        throw new Error(fields || (data && (data.detail || data.title)) || `Erro ${res.status}`);
    }
    return data;
}

async function api(path, options = {}) {
    if (!options.method || options.method === 'GET') {
        const key = `${profileOf()}|${path}`;
        try {
            const data = await request(path, options);
            offlineCopy.save(key, data);
            setOfflineNotice(null);
            return data;
        } catch (e) {
            if (!(e instanceof TypeError)) throw e; // the server answered with an error: not a missing connection
            const copy = await offlineCopy.load(key);
            if (!copy) throw new Error(OFFLINE_MESSAGE);
            setOfflineNotice(copy.savedAt);
            return copy.value;
        }
    }
    try {
        return await busy(() => request(path, options));
    } catch (e) {
        if (e instanceof TypeError) throw new Error(OFFLINE_MESSAGE);
        throw e;
    }
}

let toastTimer;
/** Shows a message; with {@code undo} it also offers a "Desfazer" button for a few seconds. */
function toast(message, undo) {
    const el = $('#toast');
    el.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    el.classList.toggle('has-action', !!undo);
    if (undo) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toast-action';
        button.textContent = 'Desfazer';
        button.onclick = () => { el.classList.remove('show'); undo(); };
        el.appendChild(button);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 7000 : 2800);
}

/* ---------- State ---------- */
const state = {
    tab: safeStorage.get('tab') || 'home',
    month: todayIso().slice(0, 7),
    categories: [],
    summary: null,
    summaryAll: null,
    transactions: [],
    transfers: [],
    pendingAll: [],
    tags: [],
    filter: {q: '', type: '', categoryId: '', methodId: '', min: '', max: '', from: '', to: '', sort: 'date,desc', open: false, all: false},
    rangeTx: null,
    rangePage: 0,
    rangeMore: false,
    sel: {on: false, items: new Map()},
    attachCounts: {},
    templates: [],
    profiles: null,
    upcoming: null,
    upcomingError: null,
    upcomingOpen: false,
    upcomingRange: {mode: safeStorage.get('upcomingMode') || '1m', from: '', to: ''},
    reminders: [],
    accounts: [],
    methods: [],
    settings: {autoPayRecurring: false, budgetRollover: false, budgetRolloverFrom: null, currency: 'BRL', remindersEnabled: true, reminderDays: 3, autoBackup: false},
    occurrences: [],
    pots: [],
    wishes: [],
    accountFilter: Number(safeStorage.get('account')) || null,
    sub: null,
    wishTab: 'WISHED'
};

const catById = id => state.categories.find(c => c.id === id);

/** "Alimentação › Restaurante" for a subcategory, just the name otherwise. */
function catLabel(category) {
    if (!category) return 'Sem categoria';
    const parent = category.parentId ? catById(category.parentId) : null;
    return parent ? `${parent.name} › ${category.name}` : category.name;
}
function txCategoryLabel(t) {
    if (!t.categoryId) return 'Sem categoria';
    return catLabel(catById(t.categoryId) || {name: t.categoryName, parentId: t.categoryParentId});
}
/**
 * Categories in display order: each top-level one followed by its subcategories. With a {@code kind} (EXPENSE or
 * INCOME) only the categories of that kind; expense and income categories are separate lists.
 */
function orderedCategories(kind = null) {
    const all = kind ? state.categories.filter(c => c.kind === kind) : state.categories;
    const roots = all.filter(c => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, LOCALE));
    const result = [];
    roots.forEach(r => {
        result.push(r);
        all.filter(c => c.parentId === r.id).sort((a, b) => a.name.localeCompare(b.name, LOCALE)).forEach(c => result.push(c));
    });
    // a subcategory whose parent is missing should never disappear
    all.filter(c => c.parentId && !all.some(p => p.id === c.parentId)).forEach(c => result.push(c));
    return result;
}
/** The kind of category a transaction type takes. */
const kindOf = type => (type === 'INCOME' ? 'INCOME' : 'EXPENSE');
/** In lists that mix both kinds, income categories are marked (the same name may exist in both). */
const catOptionLabel = c => catLabel(c) + (c.kind === 'INCOME' ? ` (${T('receita')})` : '');
/** {@code <option>}s with the categories of one kind (the one a type of transaction takes). */
function categoryOptions(type, selected, none = 'Sem categoria') {
    return `<option value="">${esc(none)}</option>` + orderedCategories(kindOf(type)).map(c =>
        `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('');
}

/* ---------- Theme ---------- */
function currentTheme() {
    const saved = document.documentElement.dataset.theme;
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    safeStorage.set('theme', theme);
    $('#theme-btn').innerHTML = ico(theme === 'dark' ? 'sun' : 'moon');
    $('meta[name="theme-color"]').content = theme === 'dark' ? '#0e1113' : '#2f7d6d';
    // In the Windows window the title bar is drawn by the system: the program darkens it too.
    if (window.desktop && window.desktop.setDarkTitleBar) window.desktop.setDarkTitleBar(theme === 'dark');
}

/* ---------- Data loading ---------- */
/** Reloads the month's data and redraws. Saving keeps the scroll position (U15); moving to another month starts at the top. */
async function loadAll({keepScroll = true} = {}) {
    const scrollY = window.scrollY;
    $('#month-label').textContent = monthLabel(state.month);
    try {
        // Occurrences first: loading them creates (and, when enabled, pays) what is due, which the lists below must show.
        state.occurrences = await api(`/recurring/occurrences?month=${state.month}`);
        const accountParam = state.accountFilter ? `&accountId=${state.accountFilter}` : '';
        const [categories, accounts, methods, settings, pots, wishes, tags, pending, summary, transactions, transfers, attachCounts, templates, profiles, syncStatus] = await Promise.all([
            api('/categories'),
            api('/accounts'),
            api('/payment-methods'),
            api('/api/settings'),
            api('/pots'),
            api('/wishes'),
            api('/tags'),
            api('/expenses?status=PENDING'),
            api(`/api/summary?month=${state.month}${accountParam}`),
            api(`/expenses?month=${state.month}${accountParam}`),
            api(`/transfers?month=${state.month}${accountParam}`),
            api('/attachments/counts'),
            api('/templates'),
            api('/profiles'),
            api('/api/sync').catch(() => ({available: false}))
        ]);
        state.sync = syncStatus;
        state.categories = categories;
        state.accounts = accounts;
        state.methods = methods;
        state.settings = settings;
        state.pots = pots;
        state.wishes = wishes;
        state.tags = tags;
        state.attachCounts = attachCounts;
        state.templates = templates;
        state.profiles = profiles;
        if (profiles.language !== LANG) { // the language is chosen for the whole app (also on the other devices)
            safeStorage.set('lang', profiles.language);
            location.reload();
            return;
        }
        state.pendingAll = pending;
        if (state.accountFilter && !accounts.some(a => a.id === state.accountFilter)) {
            state.accountFilter = null; // the saved account no longer exists
            safeStorage.set('account', '');
            return loadAll();
        }
        state.summary = summary;
        state.rangeTx = null; // reloaded on demand: it may be stale after a change
        state.transactions = transactions;
        state.transfers = transfers;
        // Budgets are per category, across every account, so they keep using the unfiltered summary.
        state.summaryAll = state.accountFilter ? await api(`/api/summary?month=${state.month}`) : summary;
        render();
        window.scrollTo({top: keepScroll ? scrollY : 0});
        loadReminders();
        consumeWidgetAction();
    } catch (e) {
        if (e.locked) return; // the sign-in form is on the screen
        $('#view').innerHTML = `<div class="card empty"><div class="big">${ico('wifi-off')}</div>Não foi possível carregar os dados.<br><span class="small">${esc(e.message)}</span><br><br><button class="btn primary" id="retry">Tentar de novo</button></div>`;
        $('#retry').onclick = loadAll;
    }
}

/** Android: the "+" button of a home-screen widget asks for a new entry; it runs once the app is open (after the password, if any). */
function consumeWidgetAction() {
    if (!window.nativeWidgets || document.body.classList.contains('locked') || !state.categories.length) return;
    if (window.nativeWidgets.takeAction() === 'new') openTransactionSheet(null);
}
window.consumeWidgetAction = consumeWidgetAction;

/* ---------- Views ---------- */
function render() {
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (state.tab !== 'transactions' && state.sel.on) setSelecting0();
    $('#fab').hidden = state.tab === 'more' || state.tab === 'goals' || state.sel.on;
    paintBell();
    paintProfileButton();
    paintAccountButton();
    // The month only matters where data is grouped by month; the account filter only where lists and totals use it.
    const monthScreen = ['home', 'transactions', 'budgets'].includes(state.tab) || (state.tab === 'more' && state.sub === 'recurring');
    const accountScreen = state.tab === 'home' || state.tab === 'transactions';
    $('.month-switch').hidden = !monthScreen;
    $('#account-btn').hidden = !accountScreen;
    ({home: renderHome, transactions: renderTransactions, budgets: renderBudgets, goals: renderGoals, more: renderMore})[state.tab]();
    syncBackLayers();
}

function avatar(icon, color, extra = '') {
    return `<span class="avatar" style="background:${esc(color || '#9E9E9E')}33;${extra}">${ico(icon || 'package')}</span>`;
}

function txRow(t) {
    const income = t.type === 'INCOME';
    const pending = t.status === 'PENDING';
    const late = pending && t.date < todayIso();
    const flag = pending ? `<span class="tag ${late ? 'late' : 'wait'}">${late ? 'Vencida' : income ? 'A receber' : 'A pagar'}</span>` : '';
    const parcel = t.installmentTotal ? `<span class="tag">${t.installmentNumber}/${t.installmentTotal}</span>` : '';
    const clip = state.attachCounts[t.id] ? `<span class="tag" title="Tem comprovante">${ico('paperclip')}</span>` : '';
    const tags = parcel + clip + (t.tags || []).map(x => `<span class="tag">#${esc(x)}</span>`).join('');
    const picked = state.sel.on && state.sel.items.has(t.id);
    return `<button class="row ${pending ? 'is-pending' : ''} ${picked ? 'picked' : ''}" data-id="${t.id}">
        ${state.sel.on ? `<span class="sel-box ${picked ? 'on' : ''}">${picked ? ico('check') : ''}</span>` : ''}
        ${avatar(t.categoryIcon, t.categoryColor)}
        <span class="grow"><span class="title">${esc(t.name)}</span>
        <span class="small muted">${esc(t.adjustment ? 'Correção de saldo' : txCategoryLabel(t))} · ${esc(t.accountName || '')}${t.paymentMethodName ? ' · ' + esc(t.paymentMethodName) : ''}<span class="tags">${flag}${tags}</span></span></span>
        <span class="amount ${income ? 'income' : 'expense'}">${income ? '+' : '−'} ${money(t.amount)}</span>
    </button>`;
}

function transferRow(t) {
    return `<button class="row" data-transfer="${t.id}">
        <span class="avatar" style="background:var(--surface-2)">${ico('transfer')}</span>
        <span class="grow"><span class="title">${esc(t.description || 'Transferência')}</span>
        <span class="small muted">${esc(t.fromAccountName)} → ${esc(t.toAccountName)}</span></span>
        <span class="amount transfer">${money(t.amount)}</span>
    </button>`;
}

const findTx = id => state.transactions.find(t => String(t.id) === String(id))
    || state.pendingAll.find(t => String(t.id) === String(id))
    || (state.rangeTx || []).find(t => String(t.id) === String(id));

function bindTxRows(root) {
    $$('.row[data-id]', root).forEach(r => r.onclick = () => {
        const tx = findTx(r.dataset.id);
        if (!tx) return;
        if (state.sel.on) toggleSelect(tx); else openTransactionSheet(tx);
    });
    $$('.row[data-transfer]', root).forEach(r => r.onclick = () => {
        if (state.sel.on) return toast('Transferências não entram na seleção.');
        const transfer = state.transfers.find(t => String(t.id) === r.dataset.transfer);
        if (transfer) openTransactionSheet(transfer);
    });
}

/** Groups the per-category totals by top-level category (subcategories are folded into their parent). */
function rootGroups(categories, total) {
    const groups = new Map();
    categories.filter(c => Number(c.total) > 0).forEach(c => {
        const cat = c.categoryId ? catById(c.categoryId) : null;
        const root = cat && cat.parentId ? catById(cat.parentId) : cat;
        const key = root ? root.id : 'none';
        if (!groups.has(key)) {
            groups.set(key, {id: root ? root.id : null, name: root ? root.name : 'Sem categoria', icon: root ? root.icon : 'package',
                color: root ? root.color : '#9E9E9E', total: 0, children: []});
        }
        const group = groups.get(key);
        group.total += Number(c.total);
        if (cat && cat.parentId) group.children.push({name: cat.name, total: Number(c.total)});
    });
    return [...groups.values()].sort((a, b) => b.total - a.total)
        .map(g => ({...g, percent: total > 0 ? (g.total / total) * 100 : 0}));
}

function donut(groups, total) {
    let offset = 25;
    const slices = groups.map(c => {
        const pct = total > 0 ? (c.total / total) * 100 : 0;
        const el = `<circle cx="21" cy="21" r="15.9155" stroke="${esc(accentFor(c.color))}" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>`;
        offset -= pct;
        return el;
    }).join('');
    return `<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Gastos por categoria">
        <circle class="track" cx="21" cy="21" r="15.9155"/>${slices}
        <text x="21" y="20" font-size="2.6" opacity=".6">Gastos</text>
        <text x="21" y="24.6" font-size="3.4" font-weight="800">${esc(money(total))}</text>
    </svg>`;
}

/** The big number on the home screen: what is in the accounts right now (or in the chosen account), not the month's result. */
function homeTotal() {
    const picked = state.accountFilter ? accountById(state.accountFilter) : null;
    if (picked) return {label: `Saldo de ${esc(picked.name)}`, value: Number(picked.balance), sub: ''};
    const value = activeAccounts().reduce((sum, a) => sum + Number(a.balance), 0);
    return {label: 'Saldo total', value, sub: ''};
}

function renderHome() {
    const s = state.summary;
    const total = homeTotal();
    const spent = Number(s.expense);
    const groups = rootGroups(s.categories, spent);
    const maxTrend = Math.max(1, ...s.trend.flatMap(t => [Number(t.income), Number(t.expense)]));
    const hasForecast = Number(s.pendingExpense) > 0 || Number(s.pendingIncome) > 0;
    // What is still to pay / to receive this month: it gives the profit expected for the month and, for the current month,
    // the total that will be left in the accounts once it is all settled.
    const pending = `<span>(${Number(s.pendingExpense) > 0 ? `a pagar ${money(s.pendingExpense)}` : ''}${Number(s.pendingExpense) > 0 && Number(s.pendingIncome) > 0 ? ' · ' : ''}${Number(s.pendingIncome) > 0 ? `a receber ${money(s.pendingIncome)}` : ''})</span>`;
    const thisMonth = state.month === todayIso().slice(0, 7);
    const leftTotal = total.value + Number(s.pendingIncome) - Number(s.pendingExpense);
    const forecast = hasForecast
        ? `${thisMonth ? `<div class="hero-note forecast">Previsto no fim do mês: <strong>${money(leftTotal)}</strong> ${pending}</div>` : ''}
        <div class="hero-note forecast">Lucro previsto do mês: <strong>${money(s.projectedBalance)}</strong> ${thisMonth ? '' : pending}</div>`
        : '';
    const latest = [...state.transactions].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);

    $('#view').innerHTML = `<div class="home-grid"><div class="stack home-main">
        ${welcomeCard()}
        <div class="card hero">
            <div class="label">${total.label}</div>
            <div class="balance ${total.sub ? 'has-sub' : ''}">${money(total.value)}</div>
            ${total.sub ? `<div class="hero-sub">${total.sub}</div>` : ''}
            <div class="hero-row">
                <div class="hero-pill"><div class="label">${ico('arrow-up')} Receitas</div><div class="v">${money(s.income)}</div></div>
                <div class="hero-pill"><div class="label">${ico('arrow-down')} Despesas</div><div class="v">${money(s.expense)}</div></div>
                <div class="hero-pill wide" title="Receitas pagas menos despesas pagas deste mês (mais as correções de saldo). Não inclui o que já estava nas contas antes."><div class="label">Resultado do mês</div><div class="v">${Number(s.balance) > 0 ? '+ ' : Number(s.balance) < 0 ? '− ' : ''}${money(Math.abs(Number(s.balance)))}</div></div>
                ${Number(s.adjustment) ? `<div class="hero-pill wide" title="Correção de saldo: a diferença entre o saldo do app e o saldo real, anotada à parte (não é receita nem despesa)"><div class="label">${ico('pencil')} Correções</div><div class="v">${Number(s.adjustment) > 0 ? '+ ' : '− '}${money(Math.abs(Number(s.adjustment)))}</div></div>` : ''}
            </div>
            ${forecast}
        </div>
        <div id="upcoming-box"></div>
        ${dueSection()}
        <h2 class="section-title">Por categoria</h2>
        <div class="card">${groups.length ? `<div class="donut-wrap">${donut(groups, spent)}
            <div class="legend">${categoryLegend(groups)}</div></div>`
            : `<div class="empty"><div class="big">${ico('leaf')}</div>Nenhuma despesa neste mês.</div>`}</div>
    </div>
        <div class="stack home-side">
        <h2 class="section-title">Últimos 6 meses</h2>
        <div class="card"><div class="trend">${s.trend.map(t => `<div class="trend-col ${t.month === state.month ? 'current' : ''}">
            <div class="trend-bars" title="${esc(monthLabel(t.month))}: receitas ${esc(money(t.income))}, despesas ${esc(money(t.expense))}">
                <i class="inc" style="height:${(Number(t.income) / maxTrend) * 100}%"></i>
                <i class="exp" style="height:${(Number(t.expense) / maxTrend) * 100}%"></i></div>
            <span class="m">${esc(shortMonth(t.month))}</span></div>`).join('')}</div>
            <div class="small muted" style="margin-top:8px"><span class="income">●</span> Receitas &nbsp; <span class="expense">●</span> Despesas</div></div>
        <h2 class="section-title">Últimos adicionados</h2>
        ${latest.length ? `<div class="list" id="recent">${latest.map(txRow).join('')}</div>`
            : `<div class="card empty"><div class="big">${ico('receipt')}</div>Nenhum lançamento ainda.<br>Toque em ${ico('plus')} para começar.</div>`}
    </div></div>`;
    bindTxRows($('#view'));
    bindDueRows($('#view'));
    bindCategoryLinks($('#view'));
    bindWelcome($('#view'));
    paintUpcoming();
    loadUpcoming();
}

/** The "Por categoria" legend. A category with a name opens its entries when tapped (U6). */
function categoryLegend(groups) {
    return groups.map(c => {
        const row = `<span class="dot" style="background:${esc(accentFor(c.color))}"></span>
                <span class="grow">${ico(c.icon)} ${esc(c.name)}</span>
                <span class="small muted">${c.percent.toFixed(0)}%</span>
                <strong>${money(c.total)}</strong>`;
        const head = c.id
            ? `<button type="button" class="legend-row legend-link" data-root="${c.id}" title="Ver os lançamentos desta categoria">${row}</button>`
            : `<div class="legend-row">${row}</div>`;
        return head + c.children.map(k => `<div class="legend-row sub"><span class="grow">↳ ${esc(k.name)}</span><span class="small muted">${money(k.total)}</span></div>`).join('');
    }).join('');
}

function bindCategoryLinks(root) {
    $$('[data-root]', root).forEach(b => b.onclick = () => {
        Object.assign(state.filter, {categoryId: b.dataset.root, type: '', from: '', to: '', all: false, open: false});
        state.rangeTx = null;
        goTo('transactions');
    });
}

/* ---------- First run (U9) ---------- */
/** An app with no entries yet (and not dismissed) shows the steps to get started. */
function isFirstRun() {
    return !safeStorage.get('welcomeDone') && !state.transactions.length && !state.pendingAll.length
        && state.summary.trend.every(t => Number(t.income) === 0 && Number(t.expense) === 0);
}
function welcomeCard() {
    if (!isFirstRun()) return '';
    const step = (key, icon, title, detail) => `<button class="row" data-welcome="${key}"><span class="avatar" style="background:var(--surface-2)">${ico(icon)}</span>
        <span class="grow"><span class="title">${esc(title)}</span><span class="small muted">${esc(detail)}</span></span><span class="muted">${ico('chevron-right')}</span></button>`;
    return `<div class="card welcome">
        <h2>Bem-vindo ao Expense Tracker</h2>
        <p class="small muted">Em quatro passos você organiza tudo. Pode fazer na ordem que quiser.</p>
        <div class="list">
            ${step('categories', 'tag', 'Revise as categorias', 'Já vêm algumas prontas; ajuste como quiser.')}
            ${step('accounts', 'bank', 'Crie suas contas', 'Banco, carteira ou cartão. O saldo de cada uma é calculado.')}
            ${step('budgets', 'target', 'Defina um orçamento', 'Quanto pode gastar por categoria em cada mês.')}
            ${step('add', 'plus', 'Adicione um lançamento', 'Ou importe um extrato ou planilha em Mais → Importar.')}
        </div>
        <div class="form-actions"><button class="btn" id="welcome-hide">Entendi, esconder</button></div>
    </div>`;
}
function bindWelcome(root) {
    $$('[data-welcome]', root).forEach(b => b.onclick = () => {
        const step = b.dataset.welcome;
        if (step === 'add') openTransactionSheet(null);
        else if (step === 'budgets') goTo('budgets');
        else goTo('more', step);
    });
    const hide = $('#welcome-hide', root);
    if (hide) hide.onclick = () => { safeStorage.set('welcomeDone', '1'); render(); };
}

/** Opens a main tab (or a page inside "Mais") and starts it at the top. */
function goTo(tab, sub = null) {
    state.tab = tab;
    state.sub = sub;
    safeStorage.set('tab', tab);
    render();
    window.scrollTo({top: 0});
}

const FILTERS = [['', 'Todos'], ['EXPENSE', 'Despesas'], ['INCOME', 'Receitas'], ['TRANSFER', 'Transferências'], ['PENDING', 'A pagar']];
const SORTS = [['date,desc', 'Data: mais recentes'], ['date,asc', 'Data: mais antigas'], ['amount,desc', 'Maior valor'],
    ['amount,asc', 'Menor valor'], ['name,asc', 'Nome (A–Z)']];

const rangeActive = () => !!(state.filter.from || state.filter.to || state.filter.all);
/** How many of the extra filters (category, payment method, values, period, order) are in use. */
function extraFilterCount() {
    const f = state.filter;
    return [f.categoryId, f.methodId, f.min, f.max, f.from || f.to, f.sort !== 'date,desc'].filter(Boolean).length;
}

/** Rows per page of the period and all-months list; "Carregar mais" asks for the next page. */
const RANGE_PAGE = 50;
let rangeRequest = 0;

/**
 * The period and all-months list is filtered by the server, a page at a time, so it never loads every transaction.
 * The client still applies the same filters to what came back, which keeps the list right while the filters change.
 */
async function loadRange(more = false) {
    const f = state.filter;
    if (f.type === 'TRANSFER') { // transfers are not part of the period list
        state.rangeTx = [];
        state.rangeMore = false;
        return;
    }
    const request = ++rangeRequest;
    const page = more ? state.rangePage + 1 : 0;
    const params = new URLSearchParams({page, size: RANGE_PAGE, sort: f.sort});
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    if (state.accountFilter) params.set('accountId', state.accountFilter);
    if (f.type === 'PENDING') params.set('status', 'PENDING');
    else if (f.type) params.set('type', f.type);
    if (f.q.trim()) params.set('q', f.q.trim());
    if (f.categoryId) params.set('categoryId', f.categoryId);
    if (f.methodId) params.set('paymentMethodId', f.methodId);
    const min = f.min ? parseAmount(f.min) : NaN, max = f.max ? parseAmount(f.max) : NaN;
    if (Number.isFinite(min)) params.set('minAmount', min.toFixed(2));
    if (Number.isFinite(max)) params.set('maxAmount', max.toFixed(2));
    const rows = await api(`/expenses?${params}`);
    if (request !== rangeRequest) return; // a newer filter is already on its way
    state.rangeTx = more ? [...(state.rangeTx || []), ...rows] : rows;
    state.rangePage = page;
    state.rangeMore = rows.length === RANGE_PAGE;
}

let listTimer = null;
/**
 * A filter the server applies (search, values, category, order…) reloads the period list. While typing, it waits a
 * moment first, so each pause makes one request instead of one per letter.
 */
function soonRefresh() {
    clearTimeout(listTimer);
    listTimer = setTimeout(() => { state.rangeTx = null; paintTransactions(); }, rangeActive() ? 300 : 0);
}

function renderTransactions() {
    const f = state.filter;
    const count = extraFilterCount();
    $('#view').innerHTML = `<div class="stack">
        <input class="search" id="q" type="search" placeholder="Buscar por nome, categoria, conta, forma de pagamento ou #tag" value="${esc(f.q)}">
        <div class="chips">
            ${FILTERS.map(([v, l]) => `<button class="chip ${f.type === v ? 'active' : ''}" data-type="${v}">${l}</button>`).join('')}
            <button class="chip ${f.open || count ? 'active' : ''}" id="more-filters">${ico('sliders')} Filtros${count ? ` (${count})` : ''}</button>
        </div>
        <div class="chips">
            <button class="chip ${f.all ? 'active' : ''}" id="all-months" title="Buscar em todos os meses">${ico('search')} Todos os meses</button>
            <button class="chip ${state.sel.on ? 'active' : ''}" id="select-mode">${ico('check')} Selecionar</button>
            <button class="chip" id="report-btn">${ico('download')} Relatório</button>
        </div>
        ${f.open ? `<div class="card filters">
            <div class="grid2">
                <div class="field"><label for="fl-cat">Categoria</label><select id="fl-cat"><option value="">Todas</option>${orderedCategories().map(c =>
                    `<option value="${c.id}" ${String(c.id) === String(f.categoryId) ? 'selected' : ''}>${esc(catOptionLabel(c))}</option>`).join('')}</select></div>
                <div class="field"><label for="fl-method">Forma de pagamento</label><select id="fl-method"><option value="">Todas</option>${state.methods.map(m =>
                    `<option value="${m.id}" ${String(m.id) === String(f.methodId) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
            </div>
            <div class="grid2">
                <div class="field"><label for="fl-min">Valor mínimo</label><input id="fl-min" inputmode="decimal" placeholder="0,00" value="${esc(f.min)}"></div>
                <div class="field"><label for="fl-max">Valor máximo</label><input id="fl-max" inputmode="decimal" placeholder="sem limite" value="${esc(f.max)}"></div>
            </div>
            <div class="grid2">${dateField('fl-from', f.from, 'Período: de', true)}${dateField('fl-to', f.to, 'até', true)}</div>
            <div class="field"><label for="fl-sort">Ordenar por</label><select id="fl-sort">${SORTS.map(([v, l]) =>
                `<option value="${v}" ${v === f.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <p class="small muted" id="range-note">${rangeActive() ? 'Com um período definido, a lista ignora o mês escolhido no alto da tela (e não mostra transferências).' : 'Sem período, a lista mostra o mês escolhido no alto da tela.'}</p>
            <button class="btn block" id="clear-filters" ${count ? '' : 'hidden'}>Limpar filtros</button>
        </div>` : ''}
        <div id="tx-list"></div>
        ${state.sel.on ? '<div id="sel-bar" class="sel-bar"></div>' : ''}
    </div>`;
    $('#q').oninput = e => { f.q = e.target.value; soonRefresh(); };
    $$('.chip[data-type]').forEach(c => c.onclick = () => { f.type = c.dataset.type; state.rangeTx = null; renderTransactions(); });
    $('#more-filters').onclick = () => { f.open = !f.open; renderTransactions(); };
    $('#all-months').onclick = () => { f.all = !f.all; state.rangeTx = null; renderTransactions(); };
    $('#select-mode').onclick = () => setSelecting(!state.sel.on);
    $('#report-btn').onclick = openReportSheet;
    paintSelBar();
    if (f.open) {
        const refresh = () => soonRefresh();
        $('#fl-cat').onchange = e => { f.categoryId = e.target.value; refresh(); };
        $('#fl-method').onchange = e => { f.methodId = e.target.value; refresh(); };
        $('#fl-min').oninput = e => { f.min = e.target.value; refresh(); };
        $('#fl-max').oninput = e => { f.max = e.target.value; refresh(); };
        $('#fl-sort').onchange = e => { f.sort = e.target.value; refresh(); };
        const view = $('#view');
        ['from', 'to'].forEach(key => {
            const read = bindDate(view, `fl-${key}`);
            const input = $(`#fl-${key}`);
            const apply = async () => {
                const typed = input.value.trim();
                if (typed && !read()) return; // still typing
                f[key] = typed ? read() : '';
                state.rangeTx = null;
                await paintTransactions();
            };
            input.addEventListener('input', apply);
            const quick = $(`.date-quick[data-for="fl-${key}"]`, view);
            if (quick) quick.addEventListener('click', apply);
        });
        const clear = $('#clear-filters');
        if (clear) clear.onclick = () => {
            Object.assign(f, {categoryId: '', methodId: '', min: '', max: '', from: '', to: '', sort: 'date,desc'});
            state.rangeTx = null;
            renderTransactions();
        };
    }
    paintTransactions();
}

/** Keeps the filter button label, the explanation and the "clear" button in step with the filters in use. */
function refreshFilterChrome() {
    const count = extraFilterCount();
    const button = $('#more-filters');
    if (button) button.innerHTML = `${ico('sliders')} Filtros${count ? ` (${count})` : ''}`;
    if (button) button.classList.toggle('active', state.filter.open || count > 0);
    const clear = $('#clear-filters');
    if (clear) clear.hidden = count === 0;
    const note = $('#range-note');
    if (note) note.textContent = rangeActive() ? 'Com um período definido (ou buscando em todos os meses), a lista ignora o mês escolhido no alto da tela e não mostra transferências.' : 'Sem período, a lista mostra o mês escolhido no alto da tela.';
}

/** Income, expenses and balance of the entries on screen (U5). Only paid entries count: pending ones and transfers do not. */
function totalsStrip(items) {
    if (!items.some(it => it.tx)) return '';
    let income = 0, expense = 0;
    items.forEach(it => {
        if (!it.tx || it.tx.status === 'PENDING') return;
        if (it.tx.type === 'INCOME') income += Number(it.tx.amount);
        else expense += Number(it.tx.amount);
    });
    return `<div class="chart-stats tx-totals">
        <div><span class="small muted">Receitas</span><strong class="income">${money(income)}</strong></div>
        <div><span class="small muted">Despesas</span><strong class="expense">${money(expense)}</strong></div>
        <div><span class="small muted">Saldo</span><strong>${money(income - expense)}</strong></div></div>
        <p class="small muted tx-totals-note">Só lançamentos pagos entram nestes totais; os que estão a pagar ou a receber ficam de fora.</p>`;
}

async function paintTransactions() {
    const f = state.filter;
    const box = $('#tx-list');
    if (!box) return;
    refreshFilterChrome();
    if (rangeActive() && state.rangeTx === null) {
        try { await loadRange(); } catch (e) { box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
    }
    const q = f.q.trim().toLowerCase();
    const type = f.type;
    const tagQuery = q.replace(/^#/, '');
    const min = f.min ? parseAmount(f.min) : NaN, max = f.max ? parseAmount(f.max) : NaN;
    const categoryId = f.categoryId ? Number(f.categoryId) : null, methodId = f.methodId ? Number(f.methodId) : null;
    const byDate = f.sort.startsWith('date');
    const items = [];
    if (type !== 'TRANSFER') {
        (rangeActive() ? state.rangeTx : state.transactions).filter(t =>
            (!type || (type === 'PENDING' ? t.status === 'PENDING' : t.type === type)) &&
            (!q || [t.name, t.description, t.accountName, t.paymentMethodName, txCategoryLabel(t)].some(v => (v || '').toLowerCase().includes(q))
                || (t.tags || []).some(x => x.includes(tagQuery))) &&
            (categoryId == null || t.categoryId === categoryId || t.categoryParentId === categoryId) &&
            (methodId == null || t.paymentMethodId === methodId) &&
            (Number.isNaN(min) || Number(t.amount) >= min) &&
            (Number.isNaN(max) || Number(t.amount) <= max)
        ).forEach(t => items.push({date: t.date, tx: t}));
    }
    const transfersAllowed = !rangeActive() && categoryId == null && methodId == null && Number.isNaN(min) && Number.isNaN(max);
    if ((!type || type === 'TRANSFER') && transfersAllowed) {
        state.transfers.filter(t => !q || [t.description, t.fromAccountName, t.toAccountName, 'transferência']
            .some(v => (v || '').toLowerCase().includes(q))).forEach(t => items.push({date: t.date, transfer: t}));
    }
    if (!items.length) {
        box.innerHTML = `<div class="card empty"><div class="big">${ico('search')}</div>Nada encontrado ${f.all && !f.from && !f.to ? 'em nenhum mês' : rangeActive() ? 'neste período' : `em ${esc(monthLabel(state.month))}`}.</div>`;
        return;
    }
    if (!byDate) {
        // sorted by value or name: one flat list, no day headings
        const dir = f.sort.endsWith('asc') ? 1 : -1;
        const key = it => f.sort.startsWith('amount') ? Number((it.tx || it.transfer).amount) : (it.tx ? it.tx.name : (it.transfer.description || 'Transferência')).toLowerCase();
        items.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (f.sort.startsWith('name') ? 1 : dir); });
        box.innerHTML = `${totalsStrip(items)}<div class="list">${items.map(it => it.tx ? txRow(it.tx) : transferRow(it.transfer)).join('')}</div>`;
        finishList(box);
        return;
    }
    const asc = f.sort === 'date,asc';
    items.sort((a, b) => asc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    const groups = new Map();
    items.forEach(it => groups.set(it.date, [...(groups.get(it.date) || []), it]));
    box.innerHTML = totalsStrip(items) + [...groups].map(([date, list]) => {
        // the day total only counts what was paid; transfers just move money between accounts
        const net = list.reduce((a, it) => it.tx && it.tx.status !== 'PENDING' ? a + (it.tx.type === 'INCOME' ? 1 : -1) * Number(it.tx.amount) : a, 0);
        return `<div class="day-head"><span>${esc(dayLabel(date))}</span><span>${money(net)}</span></div>
                <div class="list">${list.map(it => it.tx ? txRow(it.tx) : transferRow(it.transfer)).join('')}</div>`;
    }).join('');
    finishList(box);
}

/** Binds the rows and, on the period list, adds "Carregar mais" while the server has more rows for the filters. */
function finishList(box) {
    bindTxRows(box);
    if (!state.rangeMore || !rangeActive()) return;
    box.insertAdjacentHTML('beforeend', `<p class="small muted center">Mostrando ${state.rangeTx.length} lançamentos; os totais valem só para eles.</p>
        <button class="btn block" id="load-more">Carregar mais</button>`);
    $('#load-more', box).onclick = async () => {
        $('#load-more', box).disabled = true;
        try { await loadRange(true); } catch (e) { toast(e.message); }
        paintTransactions();
    };
}

function renderBudgets() {
    const s = state.summaryAll;
    const withBudget = s.categories.filter(c => c.budget != null);
    const budgetedIds = new Set(withBudget.map(c => c.categoryId));
    const free = orderedCategories('EXPENSE').filter(c => !budgetedIds.has(c.id));
    const carryText = c => {
        const carry = Number(c.carry || 0);
        if (!s.budgetRollover || carry === 0) return '';
        return carry > 0 ? `Sobra de meses anteriores: +${money(carry)}` : `Estouro de meses anteriores: −${money(-carry)}`;
    };
    const card = (c) => {
        const spent = Number(c.budgetSpent ?? c.total);
        const pct = Number(c.budget) > 0 ? (spent / Number(c.budget)) * 100 : (spent > 0 ? 100 : 0);
        const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
        const left = Number(c.budget) - spent;
        const extra = carryText(c);
        return `<button class="card row" style="display:block;width:100%;text-align:left" data-cat="${c.categoryId}">
            <span style="display:flex;gap:12px;align-items:center">${avatar(c.icon, c.color)}
            <span class="grow"><strong>${esc(c.parentId ? catLabel(catById(c.categoryId)) : c.name)}</strong><span class="small muted" style="display:block">${money(spent)} de ${money(c.budget)}</span></span>
            <strong class="${left < 0 ? 'expense' : ''}">${pct.toFixed(0)}%</strong></span>
            <span class="progress ${cls}"><i style="width:${Math.min(100, pct)}%"></i></span>
            <span class="budget-meta"><span>${left >= 0 ? `Restam ${money(left)}` : `Estourou em ${money(-left)}`}</span>${extra ? `<span>${esc(extra)}</span>` : ''}</span></button>`;
    };
    let totalCard;
    if (s.totalBudget != null) {
        const spent = Number(s.totalSpent), limit = Number(s.totalBudget);
        const pct = limit > 0 ? (spent / limit) * 100 : 0;
        const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
        const left = limit - spent;
        const extra = carryText({carry: s.totalCarry});
        totalCard = `<button class="card row" style="display:block;width:100%;text-align:left" id="total-budget">
            <span class="small muted">Limite geral de ${esc(monthLabel(state.month))}</span>
            <span style="display:block;font-size:1.5rem;font-weight:800">${money(spent)} <span class="muted" style="font-size:1rem;font-weight:600">de ${money(limit)}</span></span>
            <span class="progress ${cls}"><i style="width:${Math.min(100, pct)}%"></i></span>
            <span class="budget-meta"><span>${left >= 0 ? `Restam ${money(left)}` : `Estourou em ${money(-left)}`}</span>${extra ? `<span>${esc(extra)}</span>` : ''}</span></button>`;
    } else {
        totalCard = `<button class="card row" style="display:block;width:100%;text-align:left" id="total-budget">
            <span class="small muted">Limite geral do mês</span>
            <span style="display:block;font-weight:700">Defina quanto pode gastar no total</span>
            <span class="small muted">Somando todas as categorias. Toque para definir.</span></button>`;
    }

    $('#view').innerHTML = `<div class="stack">
        ${state.accountFilter ? '<div class="small muted">Os orçamentos consideram os gastos de todas as contas.</div>' : ''}
        ${totalCard}
        ${withBudget.length ? withBudget.map(card).join('') : `<div class="card empty"><div class="big">${ico('target')}</div>Defina limites mensais por categoria<br>e acompanhe quanto ainda pode gastar.</div>`}
        ${free.length ? `<button class="btn block" id="add-budget">${ico('plus')} Novo orçamento</button>` : ''}
        <p class="small muted center">Um limite vale a partir do mês em que foi definido, até você mudá-lo — mudar o de um mês não altera os anteriores.${s.budgetRollover ? ' A sobra (ou o estouro) de cada mês passa para o seguinte.' : ''}</p>
    </div>`;
    $$('[data-cat]').forEach(b => b.onclick = () => openBudgetSheet(Number(b.dataset.cat)));
    $('#total-budget').onclick = () => openBudgetSheet('total');
    const add = $('#add-budget');
    if (add) add.onclick = () => openBudgetSheet(null);
}

/* ---------- Confirmation dialog ---------- */
/** Resolves true when the user confirms. Replaces window.confirm(), which embedded WebViews ignore. */
function confirmDialog(message, {okLabel = 'Confirmar', danger = true} = {}) {
    return new Promise(resolve => {
        const root = $('#confirm-root');
        root.innerHTML = `<div class="overlay confirm-overlay"><div class="sheet confirm" role="alertdialog" aria-modal="true">
            <p class="confirm-text">${esc(message)}</p>
            <div class="form-actions">
                <button type="button" class="btn" id="confirm-no">Cancelar</button>
                <button type="button" class="btn ${danger ? 'danger-fill' : 'primary'}" id="confirm-yes">${esc(okLabel)}</button>
            </div></div></div>`;
        const done = value => { layerClose('confirm'); root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(value); };
        const onKey = e => {
            if (e.key === 'Escape') { e.stopPropagation(); done(false); }
            if (e.key === 'Enter') { e.preventDefault(); done(true); }
        };
        document.addEventListener('keydown', onKey, true);
        layerOpen('confirm', () => done(false));
        $('#confirm-no', root).onclick = () => done(false);
        $('#confirm-yes', root).onclick = () => done(true);
        $('.overlay', root).addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) done(false); });
        $('#confirm-no', root).focus();
    });
}

/* ---------- Sheets ---------- */
/* The element that had the focus before the sheet opened (kept while one sheet replaces another). */
let sheetOpener = null;
/** The sheet on top: a confirmation or calendar over a form, else the form itself. */
const topSheet = () => $('#confirm-root .sheet') || $('#sheet-root .sheet');
function openSheet(html) {
    const opener = sheetOpener || document.activeElement;
    const root = $('#sheet-root');
    root.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    sheetOpener = opener;
    if (!layerHas('sheet')) layerOpen('sheet', closeSheet);
    $('.overlay', root).addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) closeSheet(); });
    return $('.sheet', root);
}
function closeSheet() {
    layerClose('sheet');
    $('#sheet-root').innerHTML = '';
    const opener = sheetOpener;
    sheetOpener = null;
    // back to where the user was, when that element is still on the screen (a re-drawn list is not)
    if (opener && document.body.contains(opener) && !topSheet() && opener.focus) opener.focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
/* Keeps Tab inside the sheet on top, so keyboard and screen-reader users do not reach the page behind it (U11). */
document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const sheet = topSheet();
    if (!sheet) return;
    const items = [...sheet.querySelectorAll('button, input, select, textarea, a[href]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || !sheet.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !sheet.contains(active))) { e.preventDefault(); first.focus(); }
});

/* ---------- Keyboard shortcuts (U10) ----------
   Ctrl+N new entry, / search, ← → previous and next month. None of them fire while typing or while a sheet is open. */
function showSearch() {
    if (state.tab !== 'transactions' || state.sub) {
        state.tab = 'transactions';
        state.sub = null;
        safeStorage.set('tab', 'transactions');
        render();
    }
    const search = $('#q');
    if (search) search.focus();
}
document.addEventListener('keydown', e => {
    if (!state.summary) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'n' && !topSheet()) {
        e.preventDefault();
        openTransactionSheet(null);
        return;
    }
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]');
    if (topSheet() || typing || mod || e.altKey) return;
    if (e.key === '/') {
        e.preventDefault();
        showSearch();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ['home', 'transactions', 'budgets'].includes(state.tab)) {
        state.month = shiftMonth(state.month, e.key === 'ArrowLeft' ? -1 : 1);
        loadAll({keepScroll: false});
    }
});

/**
 * Runs an action, closes the sheet, reloads the data and reports the result. {@code success} is a message, or
 * {@code {text, undo}} to offer an "undo" button (used when something was sent to the trash).
 */
async function run(action, success) {
    try {
        await action();
        closeSheet();
        await loadAll();
        if (success) {
            if (typeof success === 'string') toast(success);
            else toast(success.text, async () => {
                try { await success.undo(); await loadAll(); toast('Desfeito'); } catch (err) { toast(err.message); }
            });
        }
    } catch (e) {
        toast(e.message);
    }
}

/** Account preselected in a new transaction: the one being viewed, else the last one used, else the first. */
function defaultAccountId() {
    const active = state.accounts.filter(a => !a.archived);
    const last = Number(safeStorage.get('lastAccount'));
    if (state.accountFilter) return state.accountFilter;
    if (active.some(a => a.id === last)) return last;
    return mainAccountId();
}

/** Parses "#viagem, trabalho  reembolso" into a list of tag names. */
const parseTags = text => text.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);

/**
 * New or edit form for an expense, an income or a transfer. {@code item} is null (new), a transaction, or a transfer
 * (recognised by {@code fromAccountId}).
 */
function openTransactionSheet(item, prefill) {
    const editing = !!item;
    const src = item || prefill || null; // what the fields start with: the item itself, or what a copy / template gives
    const isTransfer = !!item && item.fromAccountId !== undefined;
    let mode = isTransfer ? 'TRANSFER' : (src ? src.type : 'EXPENSE');
    let status = item && !isTransfer ? item.status : 'PAID';
    let categoryId = src && !isTransfer ? src.categoryId : null;
    let repeat = false; // "Repetir todo mês": the entry becomes a recurring payment instead of a one-off
    const date = item ? item.date : (monthOf(todayIso()) === state.month ? todayIso() : `${state.month}-01`);
    const fromDefault = isTransfer ? item.fromAccountId : defaultAccountId();
    const toDefault = isTransfer ? item.toAccountId : (() => {
        const children = state.accounts.filter(a => a.parentId === fromDefault && !a.archived);
        const other = activeAccounts().find(a => a.id !== fromDefault);
        return (children[0] || other || {}).id;
    })();
    const showModes = !editing ? ['EXPENSE', 'INCOME', 'TRANSFER'] : (isTransfer ? [] : ['EXPENSE', 'INCOME']);
    const modeLabels = {EXPENSE: 'Despesa', INCOME: 'Receita', TRANSFER: 'Transferência'};
    const suggestions = state.tags.slice(0, 12);

    const sheet = openSheet(`
        <h2 id="f-title"></h2>
        ${showModes.length ? `<div class="seg ${showModes.length === 3 ? 'three' : ''}">${showModes.map(m =>
            `<button type="button" data-mode="${m}" class="${m === 'EXPENSE' ? 'exp' : m === 'INCOME' ? 'inc' : ''}">${modeLabels[m]}</button>`).join('')}</div>` : ''}
        ${!editing && state.templates.length ? `<div class="tpl-row" data-for="tx"><span class="small muted">Modelos</span>${state.templates.slice(0, 8).map(t =>
            `<button type="button" class="chip" data-tpl="${t.id}">${ico('star')} ${esc(t.name)}</button>`).join('')}</div>` : ''}
        <form id="tx-form" novalidate>
            <input class="amount-input" id="f-amount" inputmode="numeric" placeholder="0,00" autocomplete="off"
                   value="${src && src.amount != null ? esc(amountFormat().format(Number(src.amount))) : ''}" aria-label="Valor">
            <div class="field suggest-host"><label for="f-name" id="f-name-label">Descrição</label><input id="f-name" maxlength="120" autocomplete="off" value="${esc(isTransfer ? item.description : src?.name)}">
                <div class="suggest-list" id="f-suggest" hidden></div></div>
            <div class="field" data-for="tx"><label>Categoria</label><div class="cat-picker" id="f-cats"></div></div>
            <div class="field" data-for="tx"><label for="f-account">Conta</label><select id="f-account" data-create="account">${accountOptions(!isTransfer && src && src.accountId ? src.accountId : fromDefault)}</select></div>
            <div class="grid2" data-for="transfer">
                <div class="field"><label for="f-from">De</label><select id="f-from" data-create="account">${accountOptions(fromDefault)}</select></div>
                <div class="field"><label for="f-to">Para</label><select id="f-to" data-create="account">${accountOptions(toDefault)}</select></div>
            </div>
            <div data-for="transfer">${tip('transfer', `Mover dinheiro entre contas não é receita nem despesa. Para registrar um investimento, transfira para a conta (ou parte dela) onde ele fica guardado.`)}</div>
            ${dateField('f-date', date, 'Data')}
            <div data-for="repeat" hidden>
                <label class="switch-row"><input type="checkbox" id="f-repeat"><span>Repetir todo mês${info('Cria um pagamento recorrente: ele se repete sozinho todo mês, no mesmo dia, sem você lançar de novo. Depois dá para ver, pausar ou editar em Mais → Pagamentos recorrentes. Se o desconto automático estiver ligado nas configurações, ele é pago no dia do vencimento; senão fica em “A pagar” até você confirmar.')}</span></label>
                <div id="f-repeat-opts" hidden>
                    <div class="field"><label for="f-repeat-end">Termina em</label><select id="f-repeat-end"></select></div>
                    <span class="small muted" id="f-repeat-hint"></span>
                </div>
            </div>
            <div class="field" data-for="tx" data-once><label>Situação</label>
                <div class="chips" id="f-status"><button type="button" class="chip" data-status="PAID" id="f-paid-chip">Pago</button><button type="button" class="chip" data-status="PENDING" id="f-pending-chip">A pagar</button></div></div>
            <div class="field" data-for="installments"><label for="f-inst">Parcelas</label>
                <input id="f-inst" inputmode="numeric" maxlength="2" value="1" autocomplete="off">
                <span class="small muted" id="f-inst-hint">À vista</span>
                <div id="f-plan" class="plan" hidden>
                    <div class="chips" id="f-plan-mode"></div>
                    <div id="f-plan-opts"></div>
                    <div id="f-plan-rows" class="plan-rows"></div>
                    <span class="small muted" id="f-plan-sum"></span>
                </div></div>
            ${editing && !isTransfer && item.installmentTotal ? `<p class="small muted audit">Parcela ${item.installmentNumber} de ${item.installmentTotal} desta compra. Alterar aqui muda só esta parcela.</p>` : ''}
            <div class="field" data-for="tx"><label for="f-method">Forma de pagamento</label><select id="f-method" data-create="method">${options(state.methods, src?.paymentMethodId, {none: '—'})}</select></div>
            <div class="field" data-for="tx" data-once><label for="f-tags">Tags</label><input id="f-tags" maxlength="200" placeholder="#viagem, trabalho" autocomplete="off" value="${esc((src?.tags || []).map(t => '#' + t).join(' '))}">
                ${suggestions.length ? `<span class="tag-suggest">${suggestions.map(t => `<button type="button" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</span>` : ''}</div>
            <div class="field" data-for="tx" data-once><label for="f-desc">Observação</label><textarea id="f-desc" rows="2" maxlength="255">${esc(src?.description && !isTransfer ? src.description : '')}</textarea></div>
            ${editing && !isTransfer ? '<div class="field" data-for="tx"><label>Comprovantes</label><div id="f-attachments"></div></div>' : ''}
            ${editing ? `<p class="small muted audit">Adicionado em ${esc(dateTimeBr(item.createdAt))}${item.updatedAt && item.updatedAt.slice(0, 16) !== (item.createdAt || '').slice(0, 16) ? ` · alterado em ${esc(dateTimeBr(item.updatedAt))}` : ''}</p>` : ''}
            <div class="form-actions sub-actions" data-for="tx">
                ${editing && !isTransfer ? `<button type="button" class="btn" id="f-dup">${ico('copy')} Duplicar</button>` : ''}
                <button type="button" class="btn" id="f-tpl">${ico('star')} Salvar como modelo</button>
            </div>
            <div class="form-actions">
                ${editing ? '<button type="button" class="btn danger" id="f-del">Excluir</button>' : ''}
                ${editing && !isTransfer && item.status === 'PENDING' ? `<button type="button" class="btn" id="f-pay">${item.type === 'INCOME' ? 'Receber hoje' : 'Pagar hoje'}</button>` : ''}
                ${editing && !isTransfer && item.installmentTotal && item.installmentNumber < item.installmentTotal ? '<button type="button" class="btn danger" id="f-del-following">Excluir esta e as próximas</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
        </form>`);

    const dateValue = bindDate(sheet, 'f-date');
    const paintMode = () => {
        $$('.seg button', sheet).forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        const transfer = mode === 'TRANSFER';
        $$('[data-for="tx"]', sheet).forEach(el => { el.hidden = transfer; });
        $$('[data-for="transfer"]', sheet).forEach(el => { el.hidden = !transfer; });
        $$('[data-for="installments"]', sheet).forEach(el => { el.hidden = editing || mode !== 'EXPENSE' || repeat; });
        $$('[data-for="repeat"]', sheet).forEach(el => { el.hidden = editing || transfer; });
        $$('[data-once]', sheet).forEach(el => { el.hidden = transfer || repeat; }); // a recurring payment has no status, tags or note of its own
        $('#f-repeat-opts', sheet).hidden = !repeat;
        $('#f-title', sheet).textContent = editing ? (transfer ? 'Editar transferência' : 'Editar lançamento') : (transfer ? 'Nova transferência' : 'Novo lançamento');
        $('#f-name-label', sheet).textContent = transfer ? 'Descrição (opcional)' : 'Descrição';
        $('#f-name', sheet).placeholder = transfer ? 'Ex.: Aporte na caixinha' : 'Ex.: Almoço';
        // paid / to pay read differently for income: received / to receive
        $('#f-paid-chip', sheet).textContent = T(mode === 'INCOME' ? 'Recebido' : 'Pago');
        $('#f-pending-chip', sheet).textContent = T(mode === 'INCOME' ? 'A receber' : 'A pagar');
        const kind = kindOf(mode);
        const chosen = catById(categoryId);
        if (chosen && chosen.kind !== kind) categoryId = null; // an expense category does not fit an income, and vice versa
        if ($('#f-cats', sheet).dataset.kind !== kind) paintCats();
    };
    const paintStatus = () => {
        $$('#f-status .chip', sheet).forEach(b => b.classList.toggle('active', b.dataset.status === status));
        const label = $('label[for="f-date"]', sheet);
        if (label) label.textContent = repeat ? 'Começa em' : status === 'PENDING' && mode !== 'TRANSFER' ? 'Vencimento' : 'Data';
    };
    const paintCats = () => {
        const kind = kindOf(mode);
        const options = [{id: null, name: 'Nenhuma', icon: 'minus', color: '#9E9E9E'}, ...orderedCategories(kind)];
        $('#f-cats', sheet).dataset.kind = kind;
        $('#f-cats', sheet).innerHTML = options.map(c =>
            `<button type="button" class="cat-opt ${c.id === categoryId ? 'active' : ''}" data-id="${c.id ?? ''}" title="${esc(catLabel(c))}">${avatar(c.icon, c.color)}<span>${c.parentId ? '↳ ' : ''}${esc(c.name)}</span></button>`).join('')
            + `<button type="button" class="cat-opt cat-new" id="f-cat-new">${avatar('plus', '#9E9E9E')}<span>Nova</span></button>`;
        const chosenCat = catById(categoryId);
        if (chosenCat) {
            const del = document.createElement('button');
            del.type = 'button'; del.className = 'btn danger'; del.style.gridColumn = '1 / -1';
            del.textContent = T('Excluir categoria “{}”').replace('{}', chosenCat.name);
            del.onclick = async () => {
                if (!await confirmDialog(`Excluir a categoria “${chosenCat.name}”? Os lançamentos ficam sem categoria.`, {okLabel: 'Excluir'})) return;
                try {
                    await api(`/categories/${chosenCat.id}`, {method: 'DELETE'});
                    state.categories = await api('/categories');
                    categoryId = null;
                    paintCats();
                    toast('Categoria excluída');
                } catch (err) { toast(err.message); }
            };
            $('#f-cats', sheet).appendChild(del);
        }
        $$('.cat-opt[data-id]', sheet).forEach(b => b.onclick = () => { categoryId = b.dataset.id ? Number(b.dataset.id) : null; paintCats(); });
        $('#f-cat-new', sheet).onclick = async () => {
            const created = await quickCreate('category', {categoryKind: kind});
            if (created) { categoryId = created.id; paintCats(); }
        };
    };
    $$('.seg button', sheet).forEach(b => b.onclick = () => { mode = b.dataset.mode; paintMode(); paintStatus(); });
    /** "Repetir todo mês": the date gives the day of the month and the first month; the end month list starts there. */
    function paintRepeat() {
        const first = (dateValue() || date).slice(0, 7);
        const end = $('#f-repeat-end', sheet);
        const keep = end.value;
        end.innerHTML = monthOptions(monthRange(first, 61), keep && keep >= first ? keep : '', {none: 'Sem data final'});
        $('#f-repeat-hint', sheet).textContent = T('Repete todo dia {} de cada mês, a partir de {}.')
            .replace('{}', Number((dateValue() || date).slice(8))).replace('{}', monthLabel(first));
    }
    $('#f-repeat', sheet).onchange = e => {
        repeat = e.target.checked;
        if (repeat) {
            $('#f-inst', sheet).value = '1'; // installments and repeating do not mix
            if (typeof refreshPlan === 'function') refreshPlan();
            paintRepeat();
        }
        paintMode();
        paintStatus();
    };
    $('#f-date', sheet).addEventListener('input', () => { if (repeat) paintRepeat(); });
    $('#f-date', sheet).addEventListener('change', () => { if (repeat) paintRepeat(); });
    $$('#f-status .chip', sheet).forEach(b => b.onclick = () => { status = b.dataset.status; paintStatus(); if (installments() > 1) refreshPlan(); });
    $$('[data-tag]', sheet).forEach(b => b.onclick = () => {
        const input = $('#f-tags', sheet);
        if (!parseTags(input.value).includes(b.dataset.tag)) input.value = `${input.value.trim()} #${b.dataset.tag}`.trim();
    });
    const installments = () => {
        const n = Number($('#f-inst', sheet).value);
        return Number.isInteger(n) && n >= 1 ? Math.min(n, 60) : 1;
    };

    /* Installment plan: each installment has its own date, amount and situation. The rule picked (same day every month,
       a cycle of days, "5th business day" / "last Saturday", or one by one) only fills the dates; every row stays editable. */
    let planMode = 'same';
    let plan = [];
    const planOpts = {days: '', rule: 'business', nth: 5, ordinal: 1, weekday: 6};
    const PLAN_MODES = [['same', 'Mesmo dia todo mês'], ['cycle', 'Ciclo de dias'], ['rule', 'Dia do mês'], ['manual', 'Uma por uma']];
    const isCard = () => (state.accounts.find(x => x.id === Number($('#f-account', sheet).value)) || {}).type === 'CREDIT_CARD';
    const defaultPlanStatus = i => (i === 0 || isCard() ? status : 'PENDING');
    const firstDate = () => dateValue() || date;
    const planDate = (i, first) => {
        const ym = shiftMonth(first.slice(0, 7), i);
        if (planMode === 'cycle') {
            const days = planOpts.days.split(/[^0-9]+/).map(Number).filter(d => d >= 1 && d <= 31);
            return dayInMonth(ym, days.length ? days[i % days.length] : Number(first.slice(8)));
        }
        if (planMode === 'rule') {
            return planOpts.rule === 'business' ? dayInMonth(ym, nthBusinessDay(ym, planOpts.nth))
                : dayInMonth(ym, nthWeekday(ym, planOpts.weekday, planOpts.ordinal));
        }
        return addMonthsIso(first, i);
    };
    const rebuildPlan = () => {
        const n = installments();
        if (n < 2) { plan = []; return; }
        const first = firstDate();
        const next = [];
        for (let i = 0; i < n; i++) {
            const old = plan[i];
            let when;
            if (planMode === 'manual') {
                const last = next.length ? brToIso(next[next.length - 1].date) : first;
                when = old ? old.date : isoToBr(addMonthsIso(last || first, next.length ? 1 : 0));
            } else {
                when = isoToBr(planDate(i, first));
            }
            next.push({date: when, amount: old ? old.amount : '', touched: !!(old && old.touched),
                status: old && old.touched ? old.status : defaultPlanStatus(i)});
        }
        plan = next;
    };
    const planCents = text => (text && text.trim() ? Math.round(parseAmount(text) * 100) : null);
    /** Cents each row gets: its own amount, or an equal share of what is left (the odd cents go to the first one). */
    const planShares = () => {
        const total = Math.round(parseAmount($('#f-amount', sheet).value) * 100) || 0;
        const given = plan.map(p => planCents(p.amount));
        const blank = given.filter(g => g == null).length;
        const rest = total - given.reduce((sum, g) => sum + (g || 0), 0);
        const each = blank ? Math.floor(rest / blank) : 0;
        let first = true;
        return {total, given, shares: given.map(g => {
            if (g != null) return g;
            const v = each + (first ? rest - each * blank : 0);
            first = false;
            return v;
        }), blank};
    };
    const paintPlanHints = () => {
        const n = installments();
        const hint = $('#f-inst-hint', sheet), sum = $('#f-plan-sum', sheet);
        if (n < 2) { hint.textContent = T('À vista'); return; }
        const {total, shares, blank} = planShares();
        hint.textContent = total > 0 ? T('{}× — o valor acima é o total da compra.').replace('{}', n) : T('Informe o valor acima: é o total da compra.');
        $$('.plan-amount', sheet).forEach((input, i) => { input.placeholder = money((shares[i] || 0) / 100); });
        const planned = shares.reduce((s, v) => s + v, 0);
        sum.textContent = T('Soma das parcelas: {} · Compra: {}').replace('{}', money(planned / 100)).replace('{}', money(total / 100));
        sum.classList.toggle('plan-bad', !blank && planned !== total);
    };
    const paintPlanRows = () => {
        const box = $('#f-plan-rows', sheet);
        box.innerHTML = plan.map((p, i) => `<div class="plan-row" data-i="${i}">
            <span class="plan-n">${i + 1}/${plan.length}</span>
            <input class="plan-date" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" autocomplete="off" value="${esc(p.date)}" aria-label="${esc(T('Vencimento da parcela'))} ${i + 1}">
            <input class="plan-amount" inputmode="numeric" autocomplete="off" value="${esc(p.amount)}" aria-label="${esc(T('Valor da parcela'))} ${i + 1}">
            <button type="button" class="chip plan-status ${p.status === 'PAID' ? 'active' : ''}">${T(p.status === 'PAID' ? (mode === 'INCOME' ? 'Recebido' : 'Pago') : 'A pagar')}</button></div>`).join('');
        $$('.plan-row', box).forEach(row => {
            const i = Number(row.dataset.i);
            const dateInput = $('.plan-date', row), amountInput = $('.plan-amount', row);
            bindAmountInput(amountInput);
            dateInput.addEventListener('input', () => {
                const digits = dateInput.value.replace(/\D/g, '').slice(0, 8);
                dateInput.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
                plan[i].date = dateInput.value;
                if (planMode !== 'manual') { planMode = 'manual'; paintPlanMode(); } // changing a date by hand means "one by one"
            });
            amountInput.addEventListener('input', () => { plan[i].amount = amountInput.value; paintPlanHints(); });
            $('.plan-status', row).onclick = () => {
                plan[i].status = plan[i].status === 'PAID' ? 'PENDING' : 'PAID';
                plan[i].touched = true;
                paintPlanRows();
            };
        });
        paintPlanHints();
    };
    const paintPlanOptions = () => {
        const box = $('#f-plan-opts', sheet);
        if (planMode === 'cycle') {
            box.innerHTML = `<div class="field"><label for="f-cycle">Dias do vencimento, em ciclo</label>
                <input id="f-cycle" inputmode="numeric" maxlength="40" placeholder="Ex.: 2, 3" autocomplete="off" value="${esc(planOpts.days)}">
                <span class="small muted">Cada parcela usa o próximo dia da lista; no fim, volta ao primeiro (2, 3 → 2, 3, 2, 3…).</span></div>`;
            $('#f-cycle', sheet).oninput = e => { planOpts.days = e.target.value; rebuildPlan(); paintPlanRows(); };
        } else if (planMode === 'rule') {
            const weekdays = Array.from({length: 7}, (_, d) => new Date(2024, 0, 7 + d).toLocaleDateString(LOCALE, {weekday: 'long'}));
            box.innerHTML = `<div class="field"><label for="f-rule">O vencimento cai no</label>
                <select id="f-rule"><option value="business" ${planOpts.rule === 'business' ? 'selected' : ''}>N-ésimo dia útil do mês</option>
                    <option value="weekday" ${planOpts.rule === 'weekday' ? 'selected' : ''}>Certo dia da semana do mês</option></select></div>
                ${planOpts.rule === 'business'
                    ? `<div class="field"><label for="f-nth">Qual dia útil (segunda a sexta)</label><input id="f-nth" type="number" min="1" max="23" inputmode="numeric" value="${planOpts.nth}"></div>`
                    : `<div class="grid2">
                        <div class="field"><label for="f-ordinal">Qual</label><select id="f-ordinal">${[[1, 'Primeiro'], [2, 'Segundo'], [3, 'Terceiro'], [4, 'Quarto'], [5, 'Último']].map(([v, l]) =>
                            `<option value="${v}" ${planOpts.ordinal === v ? 'selected' : ''}>${T(l)}</option>`).join('')}</select></div>
                        <div class="field"><label for="f-weekday">Dia da semana</label><select id="f-weekday">${weekdays.map((w, d) =>
                            `<option value="${d}" ${planOpts.weekday === d ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></div></div>`}`;
            $('#f-rule', sheet).onchange = e => { planOpts.rule = e.target.value; paintPlanOptions(); rebuildPlan(); paintPlanRows(); };
            const nth = $('#f-nth', sheet);
            if (nth) nth.oninput = () => { planOpts.nth = Math.min(23, Math.max(1, Number(nth.value) || 1)); rebuildPlan(); paintPlanRows(); };
            const ordinal = $('#f-ordinal', sheet), weekday = $('#f-weekday', sheet);
            if (ordinal) ordinal.onchange = () => { planOpts.ordinal = Number(ordinal.value); rebuildPlan(); paintPlanRows(); };
            if (weekday) weekday.onchange = () => { planOpts.weekday = Number(weekday.value); rebuildPlan(); paintPlanRows(); };
        } else {
            box.innerHTML = planMode === 'same' ? '' : `<span class="small muted">${T('Ajuste a data, o valor e a situação de cada parcela.')}</span>`;
        }
    };
    const paintPlanMode = () => {
        $('#f-plan-mode', sheet).innerHTML = PLAN_MODES.map(([k, l]) => `<button type="button" class="chip ${k === planMode ? 'active' : ''}" data-plan="${k}">${T(l)}</button>`).join('');
        $$('[data-plan]', sheet).forEach(b => b.onclick = () => { planMode = b.dataset.plan; paintPlanMode(); rebuildPlan(); paintPlanRows(); });
        paintPlanOptions();
    };
    /** Shows or hides the plan when the number of installments, the date, the status or the account changes. */
    const refreshPlan = () => {
        const many = installments() > 1;
        $('#f-plan', sheet).hidden = !many;
        rebuildPlan();
        if (many) { paintPlanRows(); if (!$('#f-plan-mode', sheet).children.length) paintPlanMode(); } else paintPlanHints();
    };
    const paintInstallments = paintPlanHints;
    $('#f-inst', sheet).oninput = refreshPlan;
    $('#f-date', sheet).addEventListener('input', () => { if (installments() > 1) refreshPlan(); });
    $('#f-account', sheet).addEventListener('change', () => { if (installments() > 1) refreshPlan(); });
    bindAmountInput($('#f-amount', sheet));
    $('#f-amount', sheet).addEventListener('input', paintPlanHints);
    paintMode();
    paintStatus();
    paintCats();
    if (!editing) setTimeout(() => $('#f-amount', sheet).focus(), 60);

    /** Fills the form from an earlier transaction, a copy or a template. */
    const fillFrom = (p, {overwriteAmount = true} = {}) => {
        if (p.type === 'EXPENSE' || p.type === 'INCOME') mode = p.type;
        categoryId = p.categoryId ?? null;
        const accountSelect = $('#f-account', sheet);
        if (p.accountId && [...accountSelect.options].some(o => o.value === String(p.accountId))) accountSelect.value = String(p.accountId);
        $('#f-method', sheet).value = p.paymentMethodId ? String(p.paymentMethodId) : '';
        $('#f-tags', sheet).value = (p.tags || []).map(t => '#' + t).join(' ');
        $('#f-desc', sheet).value = p.description || '';
        if (p.name) $('#f-name', sheet).value = p.name;
        const amountInput = $('#f-amount', sheet);
        if (p.amount != null && (overwriteAmount || !amountInput.value.trim())) amountInput.value = amountFormat().format(Number(p.amount));
        paintMode(); paintStatus(); paintCats(); paintInstallments();
    };
    $$('[data-tpl]', sheet).forEach(b => b.onclick = () => fillFrom(state.templates.find(t => String(t.id) === b.dataset.tpl)));
    if (!editing) {
        const nameInput = $('#f-name', sheet), suggestBox = $('#f-suggest', sheet);
        let timer;
        nameInput.addEventListener('input', () => {
            clearTimeout(timer);
            const q = nameInput.value.trim();
            if (mode === 'TRANSFER' || q.length < 2) { suggestBox.hidden = true; return; }
            timer = setTimeout(async () => {
                try {
                    const found = await api(`/expenses/suggestions?q=${encodeURIComponent(q)}`);
                    if (nameInput.value.trim() !== q) return;
                    suggestBox.innerHTML = found.map((s, i) => `<button type="button" data-s="${i}"><strong>${esc(s.name)}</strong>
                        <span class="small muted">${esc(txCategoryLabel(s))} · ${money(s.amount)}</span></button>`).join('');
                    suggestBox.hidden = !found.length;
                    $$('[data-s]', suggestBox).forEach(b => b.onclick = () => { fillFrom(found[Number(b.dataset.s)], {overwriteAmount: false}); suggestBox.hidden = true; });
                } catch (e) { suggestBox.hidden = true; }
            }, 200);
        });
        nameInput.addEventListener('blur', () => setTimeout(() => { suggestBox.hidden = true; }, 250));
    }
    const dup = $('#f-dup', sheet);
    if (dup) dup.onclick = () => { closeSheet(); openTransactionSheet(null, item); };
    $('#f-tpl', sheet).onclick = () => {
        const name = $('#f-name', sheet).value.trim();
        if (!name) return toast('Preencha a descrição: ela vira o nome do modelo.');
        const amount = parseAmount($('#f-amount', sheet).value);
        saveAsTemplate({name, type: mode === 'INCOME' ? 'INCOME' : 'EXPENSE', amount: amount > 0 ? amount : null, categoryId,
            accountId: Number($('#f-account', sheet).value), paymentMethodId: nextId($('#f-method', sheet).value),
            description: $('#f-desc', sheet).value.trim() || null, tags: parseTags($('#f-tags', sheet).value)});
    };
    if (editing && !isTransfer) mountAttachments(sheet, item.id);

    if (editing) {
        $('#f-del', sheet).onclick = async () => {
            const what = isTransfer ? 'esta transferência' : `“${item.name}”`;
            if (!await confirmDialog(`Mover ${what} para a lixeira? Dá para restaurar em Mais → Lixeira.`, {okLabel: 'Mover para a lixeira'})) return;
            const kind = isTransfer ? 'TRANSFER' : 'EXPENSE';
            run(() => api(isTransfer ? `/transfers/${item.id}` : `/expenses/${item.id}`, {method: 'DELETE'}),
                {text: 'Movido para a lixeira', undo: () => api(`/trash/${kind}/${item.id}/restore`, {method: 'POST'})});
        };
        const following = $('#f-del-following', sheet);
        if (following) following.onclick = async () => {
            const left = item.installmentTotal - item.installmentNumber + 1;
            if (!await confirmDialog(`Mover esta parcela e as próximas (${left} no total) para a lixeira?`, {okLabel: 'Mover para a lixeira'})) return;
            let ids = [];
            run(async () => { ids = ((await api(`/expenses/${item.id}?scope=FOLLOWING`, {method: 'DELETE'})) || {}).ids || []; },
                {text: `${left} parcelas foram para a lixeira`,
                 undo: async () => { for (const id of ids) await api(`/trash/EXPENSE/${id}/restore`, {method: 'POST'}); }});
        };
        const pay = $('#f-pay', sheet);
        if (pay) pay.onclick = () => run(() => api(`/expenses/${item.id}/pay`, {method: 'POST', body: {date: todayIso()}}), 'Marcado como pago hoje');
    }

    $('#tx-form', sheet).onsubmit = e => {
        e.preventDefault();
        const amount = parseAmount($('#f-amount', sheet).value);
        const name = $('#f-name', sheet).value.trim();
        if (!(amount > 0)) return toast('Informe um valor maior que zero.');
        if (!dateValue()) return toast('Informe uma data válida.');
        if (mode === 'TRANSFER') {
            const fromAccountId = Number($('#f-from', sheet).value), toAccountId = Number($('#f-to', sheet).value);
            if (fromAccountId === toAccountId) return toast('Escolha contas diferentes para a origem e o destino.');
            const body = {fromAccountId, toAccountId, amount, date: dateValue(), description: name || null};
            return run(() => api(isTransfer ? `/transfers/${item.id}` : '/transfers', {method: isTransfer ? 'PUT' : 'POST', body}),
                editing ? 'Transferência atualizada' : 'Transferência salva');
        }
        if (!name) return toast('Informe uma descrição.');
        if (repeat && !editing) {
            const first = dateValue();
            const rule = {name, type: mode, amount, variableAmount: false, dayOfMonth: Number(first.slice(8)),
                accountId: Number($('#f-account', sheet).value), paymentMethodId: nextId($('#f-method', sheet).value), categoryId,
                active: true, startMonth: first.slice(0, 7), endMonth: $('#f-repeat-end', sheet).value || null};
            safeStorage.set('lastAccount', String(rule.accountId));
            return run(() => api('/recurring', {method: 'POST', body: rule}), 'Pagamento recorrente criado');
        }
        const body = {
            name, amount, type: mode, categoryId, status,
            date: dateValue(),
            accountId: Number($('#f-account', sheet).value),
            paymentMethodId: nextId($('#f-method', sheet).value),
            description: $('#f-desc', sheet).value.trim() || null,
            tags: parseTags($('#f-tags', sheet).value)
        };
        if (!editing && mode === 'EXPENSE' && installments() > 1) {
            const slots = [];
            for (let i = 0; i < plan.length; i++) {
                const when = brToIso(plan[i].date);
                if (!when) return toast(T('Parcela {}: informe uma data válida.').replace('{}', i + 1));
                const cents = planCents(plan[i].amount);
                if (cents != null && !(cents > 0)) return toast(T('Parcela {}: o valor deve ser maior que zero.').replace('{}', i + 1));
                slots.push({date: when, status: plan[i].status, amount: cents == null ? null : cents / 100});
            }
            const {total, blank, shares} = planShares();
            if (!blank && shares.reduce((s, v) => s + v, 0) !== total) return toast(T('A soma das parcelas é diferente do total da compra.'));
            if (blank && shares.some(v => v <= 0)) return toast(T('O valor é pequeno demais para tantas parcelas.'));
            body.installmentPlan = slots;
        }
        safeStorage.set('lastAccount', String(body.accountId));
        run(() => api(editing ? `/expenses/${item.id}` : '/expenses', {method: editing ? 'PUT' : 'POST', body}),
            editing ? 'Lançamento atualizado' : 'Lançamento salvo');
    };
}

function openCategorySheet(cat, newKind = null) {
    const kind = cat ? cat.kind : (newKind || state.catKind || 'EXPENSE');
    const hasChildren = !!cat && state.categories.some(c => c.parentId === cat.id);
    const parents = state.categories.filter(c => c.kind === kind && !c.parentId && (!cat || c.id !== cat.id));
    const otherName = kind === 'EXPENSE' ? 'Receitas' : 'Despesas';
    const sheet = openSheet(`
        <h2>${cat ? (kind === 'INCOME' ? 'Editar categoria de receita' : 'Editar categoria de despesa') : (kind === 'INCOME' ? 'Nova categoria de receita' : 'Nova categoria de despesa')}</h2>
        <form id="cat-form" novalidate>
            <div class="field"><label for="c-name">Nome</label><input id="c-name" maxlength="60" value="${esc(cat?.name)}"></div>
            <div class="field"><label>Cor</label><div class="swatches" id="c-colors"></div></div>
            <div class="field"><label for="c-parent">Subcategoria de</label>
                <select id="c-parent" ${hasChildren ? 'disabled' : ''}>${options(parents, cat?.parentId, {none: 'Nenhuma (categoria principal)'})}</select>
                ${hasChildren ? '<span class="small muted">Esta categoria tem subcategorias, então não pode ficar dentro de outra.</span>' : ''}</div>
            <div class="field"><label>Ícone</label><div class="icon-picker" id="c-icons"></div>
                ${nativeDatePicker ? '<input id="c-emoji" class="emoji-input" maxlength="16" placeholder="ou um emoji, ex.: 🐶" autocomplete="off" aria-label="Emoji">' : ''}</div>
            <div class="form-actions">
                ${cat ? '<button type="button" class="btn danger" id="c-del">Excluir</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
            ${cat ? `<div class="form-actions sub-actions"><button type="button" class="btn" id="c-copy">${ico('copy')} ${kind === 'EXPENSE' ? 'Copiar para Receitas' : 'Copiar para Despesas'}</button></div>` : ''}
        </form>`);
    const colorOf = colorPicker(sheet, '#c-colors', cat?.color || '#6750A4');
    let icon = iconKey(cat?.icon) || cat?.icon || 'tag';
    const paintIcons = () => {
        // a stored or typed emoji is shown first; the picker's own icons follow
        const choices = PICKABLE_ICONS.includes(icon) ? PICKABLE_ICONS : [icon, ...PICKABLE_ICONS];
        $('#c-icons', sheet).innerHTML = choices.map(k =>
            `<button type="button" class="icon-opt ${k === icon ? 'active' : ''}" data-icon="${esc(k)}" aria-label="${esc(k)}">${ico(k)}</button>`).join('');
        $$('.icon-opt', sheet).forEach(b => b.onclick = () => { icon = b.dataset.icon; paintIcons(); });
    };
    paintIcons();
    const emoji = $('#c-emoji', sheet);
    if (emoji) emoji.oninput = () => {
        const typed = emoji.value.trim();
        if (typed) { icon = typed; paintIcons(); }
    };
    if (cat) {
        $('#c-copy', sheet).onclick = () => run(() => api(`/categories/${cat.id}/copy`, {method: 'POST'}), `Copiada para ${otherName}`);
        $('#c-del', sheet).onclick = async () => {
            const extra = hasChildren ? ' As subcategorias viram categorias principais.' : '';
            if (await confirmDialog(`Excluir a categoria “${cat.name}”? Os lançamentos ficam sem categoria.${extra}`, {okLabel: 'Excluir'}))
                run(() => api(`/categories/${cat.id}`, {method: 'DELETE'}), 'Categoria excluída');
        };
    }
    $('#cat-form', sheet).onsubmit = e => {
        e.preventDefault();
        const name = $('#c-name', sheet).value.trim();
        if (!name) return toast('Informe o nome da categoria.');
        const body = {name, icon, color: colorOf(), kind, parentId: hasChildren ? null : nextId($('#c-parent', sheet).value)};
        run(() => api(cat ? `/categories/${cat.id}` : '/categories', {method: cat ? 'PUT' : 'POST', body}), 'Categoria salva');
    };
}

/**
 * Budget form. {@code target} is a category id (edit), null (new, pick a category) or 'total' (the overall monthly
 * limit). A limit applies from the viewed month on, or only to that month.
 */
function openBudgetSheet(target) {
    const isTotal = target === 'total';
    const s = state.summaryAll;
    const budgeted = new Map(s.categories.filter(c => c.budget != null).map(c => [c.categoryId, c]));
    const choices = target && !isTotal ? state.categories.filter(c => c.id === target) : orderedCategories('EXPENSE').filter(c => !budgeted.has(c.id));
    const currentBase = isTotal ? s.totalBudgetBase : (target ? budgeted.get(target)?.budgetBase : null);
    const exists = currentBase != null;
    const monthName = monthLabel(state.month);
    const sheet = openSheet(`
        <h2>${isTotal ? 'Limite geral do mês' : exists ? 'Editar orçamento' : 'Novo orçamento'}</h2>
        <form id="b-form" novalidate>
            ${isTotal ? '' : `<div class="field"><label for="b-cat">Categoria</label>
                <select id="b-cat" ${target ? 'disabled' : ''}>${choices.map(c => `<option value="${c.id}">${esc(catLabel(c))}</option>`).join('')}</select></div>`}
            <div class="field"><label for="b-amount">Limite mensal (${esc(currencySymbol())})</label>
                <input id="b-amount" inputmode="numeric" placeholder="0,00" value="${exists ? esc(amountFormat().format(Number(currentBase))) : ''}"></div>
            <div class="field"><label for="b-scope">Vale para</label>
                <select id="b-scope"><option value="FROM_MONTH">${esc(monthName)} e os meses seguintes</option><option value="ONLY_MONTH">Só ${esc(monthName)}</option></select>
                <span class="small muted">Os meses anteriores não mudam.</span></div>
            <div class="form-actions">
                ${exists ? '<button type="button" class="btn danger" id="b-del">Remover</button>' : ''}
                <button type="submit" class="btn primary">Salvar</button>
            </div>
        </form>`);
    bindAmountInput($('#b-amount', sheet));
    const base = () => isTotal ? '/budgets/total' : `/budgets/${target || Number($('#b-cat', sheet).value)}`;
    if (exists) {
        $('#b-del', sheet).onclick = async () => {
            if (await confirmDialog(`Remover o limite a partir de ${monthName}? Os meses anteriores continuam com o limite que tinham.`, {okLabel: 'Remover'}))
                run(() => api(`${base()}?month=${state.month}`, {method: 'DELETE'}), 'Limite removido');
        };
    }
    $('#b-form', sheet).onsubmit = e => {
        e.preventDefault();
        const amount = parseAmount($('#b-amount', sheet).value);
        if (!(amount > 0)) return toast('Informe um limite maior que zero.');
        run(() => api(`${base()}?month=${state.month}`, {method: 'PUT', body: {amount, scope: $('#b-scope', sheet).value}}), 'Orçamento salvo');
    };
}

/* ---------- Wiring ---------- */
$$('.nav-item').forEach(b => b.onclick = () => {
    state.tab = b.dataset.tab;
    state.sub = null;
    safeStorage.set('tab', state.tab);
    if (state.summary) render();
    window.scrollTo({top: 0});
});
$('#prev-month').onclick = () => { state.month = shiftMonth(state.month, -1); loadAll({keepScroll: false}); };
$('#next-month').onclick = () => { state.month = shiftMonth(state.month, 1); loadAll({keepScroll: false}); };
$('#month-label').onclick = () => { state.month = todayIso().slice(0, 7); loadAll({keepScroll: false}); };
$('#fab').onclick = () => openTransactionSheet(null);
$('#theme-btn').onclick = () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    if (state.summary) render(); // the chart colours depend on the theme
};

$$('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico); });
applyTheme(currentTheme());
$('#view').innerHTML = '<div class="stack"><div class="skeleton"></div><div class="skeleton"></div></div>';
startApp();

/* ---------- Password (S2, S3) ----------
   Off by default. When a password is set, the app shows the sign-in form until the password is typed; the session
   cookie keeps the user signed in for 30 days (or until the app restarts or the password changes). */
/** Opens the app: asks for the password first when one is set. The server being unreachable is left to the offline copy. */
async function startApp() {
    try {
        state.security = await (await fetch('/api/auth/status')).json();
    } catch (e) {
        state.security = null;
    }
    if (state.security && state.security.passwordSet && !state.security.unlocked) return showLogin();
    loadAll();
}

function showLogin() {
    document.body.classList.add('locked');
    $('#view').innerHTML = `<div class="card login">
        <div class="login-mark">${ico('wallet')}</div>
        <h2>Expense Tracker</h2>
        <p class="small muted">Digite a senha para abrir.</p>
        <form id="login-form" novalidate>
            <div class="field"><label for="login-pass">Senha</label><input id="login-pass" type="password" autocomplete="current-password"></div>
            <div class="form-actions"><button type="submit" class="btn primary">Entrar</button></div>
            ${window.localApp ? '<div class="form-actions"><button type="button" class="btn" id="forgot-pass">Esqueci a senha</button></div>' : ''}
        </form></div>`;
    const forgot = $('#forgot-pass');
    if (forgot) forgot.onclick = async () => { // Android app: there is no file to delete, so forgetting means starting over
        if (!await confirmDialog('Apagar TODOS os dados deste aparelho (lançamentos, contas, perfis e backups guardados no app) e remover a senha? Não dá para desfazer: só um backup guardado fora do app recupera os dados.', {okLabel: 'Apagar tudo'})) return;
        try {
            await api('/api/auth/reset', {method: 'POST', body: {confirm: true}});
            safeStorage.set('account', '');
            location.reload();
        } catch (err) {
            toast(err.message);
        }
    };
    $('#login-form').onsubmit = async e => {
        e.preventDefault();
        try {
            state.security = await api('/api/auth/login', {method: 'POST', body: {password: $('#login-pass').value}});
            document.body.classList.remove('locked');
            loadAll();
        } catch (err) {
            toast(err.message);
        }
    };
    $('#login-pass').focus();
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA is optional */ });
}

/** Leaves the selection mode without re-rendering (used while another screen is being drawn). */
function setSelecting0() { state.sel.on = false; state.sel.items.clear(); }
