'use strict';

/* Selection and batch actions, custom charts, statements (PDF/Excel), receipts, favorites, autocomplete,
   "Por vir" and reminders. Loaded after tools.js; it reuses the helpers of the other scripts. */

/* ---------- Binary files (attachments, reports) ---------- */
function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/** Saves bytes as a file: "save as" dialog in the desktop app, a download elsewhere. */
function saveBinary(name, buffer, type) {
    if (window.desktop && window.desktop.saveBytes) {
        if (window.desktop.saveBytes(name, bytesToBase64(buffer))) toast('Arquivo salvo');
        return;
    }
    if (window.nativeFiles) { // Android: abre o menu Compartilhar do sistema
        window.nativeFiles.saveBytes(name, bytesToBase64(buffer)).catch(e => toast(`Não foi possível salvar: ${e.message}`));
        return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([buffer], {type: type || 'application/octet-stream'}));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
}

/** Large photos are shrunk (JPEG, at most 1600 px) before they are stored; PDFs and small files go as they are. */
function shrinkImage(name, base64, type) {
    if (!/^image\/(jpeg|png|webp)$/.test(type) || base64.length < 1.2 * 1024 * 1024) return Promise.resolve({name, data: base64});
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve({name: name.replace(/\.\w+$/, '') + '.jpg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1]});
            } catch (e) { resolve({name, data: base64}); }
        };
        img.onerror = () => resolve({name, data: base64});
        img.src = `data:${type};base64,${base64}`;
    });
}

const guessType = name => /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp'
    : /\.gif$/i.test(name) ? 'image/gif' : /\.pdf$/i.test(name) ? 'application/pdf' : 'image/jpeg';

/** Asks for a photo or PDF; resolves with {name, data (base64)} or null. */
function pickAttachment() {
    if (window.desktop && window.desktop.openAttachment) {
        return new Promise(resolve => {
            const json = window.desktop.openAttachment();
            if (!json) return resolve(null);
            const file = JSON.parse(json);
            shrinkImage(file.name, file.data, guessType(file.name)).then(resolve);
        });
    }
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,application/pdf';
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => shrinkImage(file.name, bytesToBase64(reader.result), file.type || guessType(file.name)).then(resolve);
            reader.onerror = () => resolve(null);
            reader.readAsArrayBuffer(file);
        };
        input.click();
    });
}

/* ---------- Selection and batch actions ---------- */
function toggleSelect(tx) {
    const items = state.sel.items;
    if (items.has(tx.id)) items.delete(tx.id); else items.set(tx.id, tx);
    paintTransactions();
    paintSelBar();
}

function setSelecting(on) {
    state.sel.on = on;
    if (!on) state.sel.items.clear();
    render();
}

/** The transactions currently listed (after search and filters), which "select all" refers to. */
function visibleTransactions() {
    return $$('#tx-list .row[data-id]').map(r => findTx(r.dataset.id)).filter(Boolean);
}

function paintSelBar() {
    const bar = $('#sel-bar');
    if (!bar) return;
    const n = state.sel.items.size;
    bar.innerHTML = `<span class="sel-count">${n === 1 ? '1 selecionado' : n + ' selecionados'}</span>
        <button class="chip" id="sel-all">Todos da lista</button>
        <button class="chip" data-batch="chart" ${n ? '' : 'disabled'}>${ico('trending')} Gráfico</button>
        <button class="chip" data-batch="category" ${n ? '' : 'disabled'}>Categoria</button>
        <button class="chip" data-batch="account" ${n ? '' : 'disabled'}>Conta</button>
        <button class="chip" data-batch="tag" ${n ? '' : 'disabled'}>Tag</button>
        <button class="chip" data-batch="paid" ${n ? '' : 'disabled'}>Marcar como pago</button>
        <button class="chip danger" data-batch="delete" ${n ? '' : 'disabled'}>${ico('trash')} Excluir</button>
        <button class="chip" id="sel-cancel">Sair da seleção</button>`;
    $('#sel-all', bar).onclick = () => { visibleTransactions().forEach(t => state.sel.items.set(t.id, t)); paintTransactions(); paintSelBar(); };
    $('#sel-cancel', bar).onclick = () => setSelecting(false);
    $$('[data-batch]', bar).forEach(b => b.onclick = () => runBatch(b.dataset.batch));
}

function batchAction(body, success) {
    const ids = [...state.sel.items.keys()];
    return run(async () => { await api('/expenses/batch', {method: 'POST', body: {ids, ...body}}); state.sel.on = false; state.sel.items.clear(); }, success);
}

function runBatch(kind) {
    const n = state.sel.items.size;
    if (!n) return;
    const ids = [...state.sel.items.keys()];
    if (kind === 'chart') return openChartSheet([...state.sel.items.values()]);
    if (kind === 'paid') {
        return confirmDialog(`Marcar como pagos os lançamentos “a pagar” dos ${n} selecionados? A data vira hoje.`, {okLabel: 'Marcar como pago', danger: false})
            .then(ok => ok && batchAction({action: 'MARK_PAID'}, 'Lançamentos marcados como pagos'));
    }
    if (kind === 'delete') {
        return confirmDialog(`Mover ${n === 1 ? '1 lançamento' : n + ' lançamentos'} para a lixeira?`, {okLabel: 'Mover para a lixeira'}).then(ok => {
            if (!ok) return;
            let deleted = ids;
            run(async () => {
                deleted = ((await api('/expenses/batch', {method: 'POST', body: {ids, action: 'DELETE'}})) || {}).ids || ids;
                state.sel.on = false; state.sel.items.clear();
            }, {text: `${n === 1 ? '1 lançamento' : n + ' lançamentos'} na lixeira`,
                undo: async () => { for (const id of deleted) await api(`/trash/EXPENSE/${id}/restore`, {method: 'POST'}); }});
        });
    }
    const sheet = openSheet(`<h2>${kind === 'category' ? 'Mudar a categoria' : kind === 'account' ? 'Mudar a conta' : 'Adicionar uma tag'}</h2>
        <p class="small muted sheet-sub">Vale para os ${n} lançamentos selecionados.</p>
        <form id="batch-form" novalidate>
            ${kind === 'category' ? `<div class="field"><label for="b-value">Nova categoria</label><select id="b-value"><option value="">Sem categoria</option>${orderedCategories().map(c =>
                `<option value="${c.id}">${esc(catOptionLabel(c))}</option>`).join('')}</select></div>` : ''}
            ${kind === 'account' ? `<div class="field"><label for="b-value">Nova conta</label><select id="b-value">${accountOptions(defaultAccountId())}</select></div>` : ''}
            ${kind === 'tag' ? '<div class="field"><label for="b-value">Tag</label><input id="b-value" maxlength="40" placeholder="#reembolso" autocomplete="off"></div>' : ''}
            <div class="form-actions"><button type="button" class="btn" id="b-cancel">Cancelar</button><button type="submit" class="btn primary">Aplicar</button></div>
        </form>`);
    $('#b-cancel', sheet).onclick = closeSheet;
    $('#batch-form', sheet).onsubmit = e => {
        e.preventDefault();
        const value = $('#b-value', sheet).value.trim();
        if (kind === 'tag' && !value) return toast('Informe a tag.');
        const body = kind === 'category' ? {action: 'SET_CATEGORY', categoryId: value ? Number(value) : null}
            : kind === 'account' ? {action: 'SET_ACCOUNT', accountId: Number(value)} : {action: 'ADD_TAG', tag: value};
        batchAction(body, 'Lançamentos atualizados');
    };
}

/* ---------- Custom chart of the selected transactions ---------- */
const CHART_GROUPS = [['root', 'Categoria principal'], ['category', 'Categoria (com subcategorias)'], ['month', 'Mês'],
    ['account', 'Conta'], ['method', 'Forma de pagamento'], ['tag', 'Tag']];
const CHART_COLORS = ['#2F7D6D', '#E57373', '#64B5F6', '#FFB74D', '#BA68C8', '#81C784', '#F06292', '#7986CB', '#4DB6AC', '#A1887F', '#AED581', '#FFD54F'];

/** Groups transactions: [{key, name, color, total, count}] sorted by value (months in time order). */
function groupForChart(list, by) {
    const groups = new Map();
    const add = (key, name, color, t) => {
        if (!groups.has(key)) groups.set(key, {key, name, color, total: 0, count: 0});
        const g = groups.get(key);
        g.total += Number(t.amount);
        g.count++;
    };
    list.forEach(t => {
        const cat = t.categoryId ? catById(t.categoryId) : null;
        if (by === 'root') {
            const root = cat && cat.parentId ? catById(cat.parentId) : cat;
            add(root ? root.id : 'none', root ? root.name : 'Sem categoria', root ? root.color : '#9E9E9E', t);
        } else if (by === 'category') {
            add(cat ? cat.id : 'none', cat ? catLabel(cat) : 'Sem categoria', cat ? cat.color : '#9E9E9E', t);
        } else if (by === 'month') add(monthOf(t.date), monthLabel(monthOf(t.date)), null, t);
        else if (by === 'account') add(t.accountId, t.accountName, t.accountColor, t);
        else if (by === 'method') add(t.paymentMethodId || 'none', t.paymentMethodName || 'Sem forma de pagamento', null, t);
        else if ((t.tags || []).length) t.tags.forEach(tag => add(tag, '#' + tag, null, t));
        else add('none', 'Sem tag', '#9E9E9E', t);
    });
    const result = [...groups.values()];
    if (by === 'month') result.sort((a, b) => a.key.localeCompare(b.key));
    else result.sort((a, b) => b.total - a.total);
    result.forEach((g, i) => { if (!g.color) g.color = CHART_COLORS[i % CHART_COLORS.length]; });
    return result;
}

function openChartSheet(items) {
    const view = {by: 'root', kind: 'EXPENSE', shape: 'donut'};
    if (!items.some(t => t.type === 'EXPENSE')) view.kind = 'INCOME';
    const sheet = openSheet('<div id="chart-body"></div>');
    const paint = () => {
        const list = items.filter(t => t.type === view.kind);
        const groups = groupForChart(list, view.by);
        const total = groups.reduce((a, g) => a + g.total, 0);
        const max = Math.max(1, ...groups.map(g => g.total));
        const withPct = groups.map(g => ({...g, percent: total ? (g.total / total) * 100 : 0, icon: 'tag', children: []}));
        const mixed = items.some(t => t.type !== view.kind);
        $('#chart-body', sheet).innerHTML = `<h2>Gráfico dos selecionados</h2>
            <p class="small muted sheet-sub">${items.length} lançamentos selecionados${mixed ? ` · o gráfico mostra só as ${view.kind === 'EXPENSE' ? 'despesas' : 'receitas'}` : ''}</p>
            <div class="chips" style="margin-bottom:10px">
                ${items.some(t => t.type === 'EXPENSE') ? `<button class="chip ${view.kind === 'EXPENSE' ? 'active' : ''}" data-kind="EXPENSE">Despesas</button>` : ''}
                ${items.some(t => t.type === 'INCOME') ? `<button class="chip ${view.kind === 'INCOME' ? 'active' : ''}" data-kind="INCOME">Receitas</button>` : ''}
                <button class="chip ${view.shape === 'donut' ? 'active' : ''}" data-shape="donut">Rosca</button>
                <button class="chip ${view.shape === 'bars' ? 'active' : ''}" data-shape="bars">Barras</button>
            </div>
            <div class="field"><label for="chart-by">Agrupar por</label><select id="chart-by">${CHART_GROUPS.map(([v, l]) =>
                `<option value="${v}" ${v === view.by ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            ${!groups.length ? '<div class="card empty">Nada para mostrar.</div>' : `
                <div class="card">
                    ${view.shape === 'donut' ? `<div class="donut-wrap">${donut(withPct, total)}<div class="legend">${withPct.map(g => `<div class="legend-row">
                        <span class="dot" style="background:${esc(accentFor(g.color))}"></span><span class="grow">${esc(g.name)}</span>
                        <span class="small muted">${g.percent.toFixed(0)}%</span><strong>${money(g.total)}</strong></div>`).join('')}</div></div>`
                    : `<div class="hbars">${groups.map(g => `<div class="hbar"><div class="hbar-head"><span>${esc(g.name)}</span><strong>${money(g.total)}</strong></div>
                        <div class="progress"><i style="width:${(g.total / max) * 100}%;background:${esc(accentFor(g.color))}"></i></div></div>`).join('')}</div>`}
                </div>
                <div class="chart-stats"><div><span class="small muted">Total</span><strong>${money(total)}</strong></div>
                    <div><span class="small muted">Lançamentos</span><strong>${list.length}</strong></div>
                    <div><span class="small muted">Média</span><strong>${money(list.length ? total / list.length : 0)}</strong></div>
                    <div><span class="small muted">Maior</span><strong>${money(Math.max(0, ...list.map(t => Number(t.amount))))}</strong></div></div>`}
            <div class="form-actions"><button type="button" class="btn" id="chart-close">Fechar</button></div>`;
        $('#chart-by', sheet).onchange = e => { view.by = e.target.value; paint(); };
        $$('[data-kind]', sheet).forEach(b => b.onclick = () => { view.kind = b.dataset.kind; paint(); });
        $$('[data-shape]', sheet).forEach(b => b.onclick = () => { view.shape = b.dataset.shape; paint(); });
        $('#chart-close', sheet).onclick = closeSheet;
    };
    paint();
}

/* ---------- Statements (PDF / Excel) ---------- */
function openReportSheet() {
    const f = state.filter;
    const from = f.from || `${state.month}-01`;
    const lastDay = new Date(Number(state.month.slice(0, 4)), Number(state.month.slice(5, 7)), 0).getDate();
    const to = f.to || `${state.month}-${pad(lastDay)}`;
    const sheet = openSheet(`<h2>Relatório</h2>
        <p class="small muted sheet-sub">Relatório do período: resumo, despesas por categoria, lançamentos e transferências.</p>
        <div class="grid2">${dateField('r-from', from, 'De')}${dateField('r-to', to, 'Até')}</div>
        <div class="field"><label for="r-account">Conta</label><select id="r-account"><option value="">Todas as contas</option>${[...new Set(activeAccounts().map(a => a.currency))].filter(code => code !== currencyCode()).map(code =>
            `<option value="cur:${code}" ${!state.accountFilter && state.currencyFilter === code ? 'selected' : ''}>${esc(T('Contas em {}').replace('{}', code))}</option>`).join('')}${orderedAccounts(activeAccounts()).map(a =>
            `<option value="${a.id}" ${a.id === state.accountFilter ? 'selected' : ''}>${esc(accountLabel(a))}</option>`).join('')}</select></div>
        <div class="form-actions"><button type="button" class="btn primary" id="r-pdf">${ico('download')} Baixar PDF</button><button type="button" class="btn" id="r-xlsx">${ico('download')} Baixar Excel</button></div>`);
    const readFrom = bindDate(sheet, 'r-from'), readTo = bindDate(sheet, 'r-to');
    const download = async format => {
        if (!readFrom() || !readTo()) return toast('Informe as duas datas.');
        const params = new URLSearchParams({from: readFrom(), to: readTo()});
        const account = $('#r-account', sheet).value;
        if (account.startsWith('cur:')) params.set('currency', account.slice(4));
        else if (account) params.set('accountId', account);
        try {
            const res = await busy(() => fetch(`/reports/statement.${format}?${params}`), 'Preparando o arquivo…');
            if (!res.ok) {
                const problem = await res.json().catch(() => null);
                throw new Error((problem && (problem.detail || problem.title)) || `Erro ${res.status}`);
            }
            saveBinary(`extrato-${readFrom()}_a_${readTo()}.${format}`, await res.arrayBuffer(),
                format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } catch (e) { toast(`Não foi possível gerar o relatório: ${e.message}`); }
    };
    $('#r-pdf', sheet).onclick = () => download('pdf');
    $('#r-xlsx', sheet).onclick = () => download('xlsx');
}

/* ---------- Receipts (attachments) ---------- */
function openAttachmentViewer(a) {
    const sheet = openSheet(`<h2>${esc(a.fileName)}</h2>
        ${a.contentType.startsWith('image/') ? `<img class="attach-full" src="/attachments/${a.id}" alt="${esc(a.fileName)}">` : `<div class="notice">${ico('file')} Arquivo PDF · ${sizeLabel(a.sizeBytes)}</div>`}
        <div class="form-actions"><button type="button" class="btn" id="a-save">${ico('download')} Salvar cópia</button><button type="button" class="btn" id="a-close">Fechar</button></div>`);
    $('#a-close', sheet).onclick = closeSheet;
    $('#a-save', sheet).onclick = async () => {
        try {
            const res = await busy(() => fetch(`/attachments/${a.id}`), 'Preparando o arquivo…');
            if (!res.ok) throw new Error(`Erro ${res.status}`);
            saveBinary(a.fileName, await res.arrayBuffer(), a.contentType);
        } catch (e) { toast(`Não foi possível salvar: ${e.message}`); }
    };
}

/** The "Comprovantes" block of the edit form: thumbnails, add and remove. */
async function mountAttachments(sheet, expenseId) {
    const box = $('#f-attachments', sheet);
    if (!box) return;
    const paint = async () => {
        let list = [];
        try { list = await api(`/expenses/${expenseId}/attachments`); } catch (e) { /* shown empty */ }
        box.innerHTML = `<div class="attach-grid">${list.map(a => `<div class="attach" data-aid="${a.id}">
            <button type="button" class="attach-open" data-open="${a.id}" aria-label="Abrir ${esc(a.fileName)}">${a.contentType.startsWith('image/')
                ? `<img src="/attachments/${a.id}" alt="">` : `<span class="attach-file">${ico('file')}<small>PDF</small></span>`}</button>
            <button type="button" class="attach-del" data-del="${a.id}" aria-label="Excluir anexo">${ico('trash')}</button></div>`).join('')}
            ${list.length < 5 ? `<button type="button" class="attach add" id="f-attach-add">${ico('plus')}<small>Foto ou PDF</small></button>` : ''}</div>
            ${list.length ? '' : '<span class="small muted">Anexe foto da nota ou comprovante (imagem/PDF até 5 MB; máximo 5 por lançamento).</span>'}`;
        $$('[data-open]', box).forEach(b => b.onclick = () => openAttachmentViewer(list.find(a => String(a.id) === b.dataset.open)));
        $$('[data-del]', box).forEach(b => b.onclick = async () => {
            if (!await confirmDialog('Excluir este anexo?', {okLabel: 'Excluir'})) return;
            try { await api(`/attachments/${b.dataset.del}`, {method: 'DELETE'}); await paint(); } catch (e) { toast(e.message); }
        });
        const add = $('#f-attach-add', box);
        if (add) add.onclick = async () => {
            const file = await pickAttachment();
            if (!file) return;
            try {
                await api(`/expenses/${expenseId}/attachments`, {method: 'POST', body: {fileName: file.name, data: file.data}});
                await paint();
            } catch (e) { toast(e.message); }
        };
    };
    await paint();
}

/* ---------- Favorites (templates) and autocomplete ---------- */
async function saveAsTemplate(body) {
    try {
        await api('/templates', {method: 'POST', body});
        state.templates = await api('/templates');
        toast(`Modelo “${body.name}” salvo`);
    } catch (e) { toast(e.message); }
}

function renderTemplatesPage() {
    $('#view').innerHTML = `<div class="stack">${pageHeader('Modelos favoritos')}
        <div class="list">${state.templates.length ? state.templates.map(t => `<div class="row static"><span class="avatar" style="background:var(--surface-2)">${ico('star')}</span>
            <span class="grow"><span class="title">${esc(t.name)}</span><span class="small muted">${t.type === 'INCOME' ? 'Receita' : 'Despesa'}${t.amount != null ? ' · ' + money(t.amount) : ''}${t.categoryName ? ' · ' + esc(t.categoryName) : ''}${t.accountName ? ' · ' + esc(t.accountName) : ''}</span></span>
            <button class="btn danger" data-del="${t.id}">Excluir</button></div>`).join('')
            : '<div class="card empty"><div class="big">' + ico('star') + '</div>Nenhum modelo ainda.</div>'}</div></div>`;
    bindBack();
    $$('[data-del]').forEach(b => b.onclick = async () => {
        if (!await confirmDialog('Excluir este modelo? Os lançamentos já feitos não mudam.', {okLabel: 'Excluir'})) return;
        try { await api(`/templates/${b.dataset.del}`, {method: 'DELETE'}); state.templates = await api('/templates'); renderTemplatesPage(); } catch (e) { toast(e.message); }
    });
}

/* ---------- Por vir ---------- */
const UPCOMING_RANGES = [['7d', '7 dias'], ['1m', '1 mês'], ['3m', '3 meses'], ['6m', '6 meses'], ['custom', 'Período…']];

function upcomingDates() {
    const r = state.upcomingRange, today = todayIso();
    const d = new Date();
    const plus = (days, months) => { const x = new Date(d.getFullYear(), d.getMonth() + months, d.getDate() + days); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    if (r.mode === '7d') return {from: today, to: plus(7, 0)};
    if (r.mode === '3m') return {from: today, to: plus(0, 3)};
    if (r.mode === '6m') return {from: today, to: plus(0, 6)};
    if (r.mode === 'custom' && r.from && r.to) return {from: r.from, to: r.to};
    return {from: today, to: plus(0, 1)};
}

async function loadUpcoming() {
    const {from, to} = upcomingDates();
    const params = new URLSearchParams({from, to});
    if (state.accountFilter) params.set('accountId', state.accountFilter);
    else if (state.currencyFilter) params.set('currency', state.currencyFilter);
    try { state.upcoming = await api(`/api/upcoming?${params}`); state.upcomingError = null; }
    catch (e) { state.upcoming = null; state.upcomingError = e.message; }
    paintUpcoming();
}

function paintUpcoming() {
    const box = $('#upcoming-box');
    if (!box) return;
    const r = state.upcomingRange, u = state.upcoming;
    const open = state.upcomingOpen;
    box.innerHTML = `<h2 class="section-title">Por vir</h2><div class="card upcoming">
        <div class="chips">${UPCOMING_RANGES.map(([v, l]) => `<button class="chip ${r.mode === v ? 'active' : ''}" data-range="${v}">${l}</button>`).join('')}</div>
        ${r.mode === 'custom' ? `<div class="grid2" style="margin-top:10px">${dateField('up-from', r.from || todayIso(), 'De')}${dateField('up-to', r.to || '', 'Até')}</div>` : ''}
        ${state.upcomingError ? `<div class="small expense" style="margin-top:8px">${esc(state.upcomingError)}</div>` : !u ? '<div class="skeleton" style="height:70px;margin-top:10px"></div>' : `
        <div class="small muted" style="margin-top:8px">${isoToBr(u.from)} a ${isoToBr(u.to)}${state.accountFilter ? '' : ' · todas as contas (sem cartões e dinheiro guardado)'}</div>
        <div class="up-grid">
            <div><span class="small muted">Vai entrar</span><strong class="income">+ ${money(u.incoming, u.currency)}</strong></div>
            <div><span class="small muted">Vai sair</span><strong class="expense">− ${money(u.outgoing, u.currency)}</strong></div>
            <div><span class="small muted">Vai ficar</span><strong class="${Number(u.endBalance) < 0 ? 'expense' : ''}">${money(u.endBalance, u.currency)}</strong></div>
        </div>
        <div class="small muted">${Number(u.startBalance) === 0 && !u.items.length ? '' : `Saldo ${isoToBr(u.from) === isoToBr(todayIso()) ? 'hoje' : 'no início do período'}: ${money(u.startBalance, u.currency)}`}${u.unknownAmounts ? ` · ${u.unknownAmounts} pagamento${u.unknownAmounts === 1 ? '' : 's'} de valor variável não ${u.unknownAmounts === 1 ? 'entrou' : 'entraram'} na conta` : ''}</div>
        ${u.items.length ? `<button class="btn block" id="up-toggle" style="margin-top:10px">${open ? 'Esconder' : 'Ver'} ${u.items.length === 1 ? '1 item' : u.items.length + ' itens'}</button>` : '<div class="small muted" style="margin-top:8px">Nada a pagar ou receber neste período.</div>'}
        ${open ? `<div class="list" style="margin-top:10px">${u.items.map((it, i) => `<button class="row ${it.kind === 'OCCURRENCE' ? 'static' : ''}" data-up="${i}">
            <span class="avatar" style="background:var(--surface-2)">${ico(it.kind === 'INVOICE' ? 'credit-card' : it.kind === 'OCCURRENCE' ? 'repeat' : 'receipt')}</span>
            <span class="grow"><span class="title">${esc(it.name)}</span><span class="small ${it.overdue ? 'expense' : 'muted'}">${it.overdue ? 'Venceu em ' : ''}${isoToBr(it.date)} · ${esc(it.accountName)}</span></span>
            <span class="amount ${it.type === 'INCOME' ? 'income' : 'expense'}">${it.amount == null ? 'a informar' : (it.type === 'INCOME' ? '+ ' : '− ') + money(it.amount, u.currency)}</span></button>`).join('')}</div>` : ''}`}
    </div>`;
    $$('[data-range]', box).forEach(b => b.onclick = () => {
        state.upcomingRange.mode = b.dataset.range;
        safeStorage.set('upcomingMode', b.dataset.range);
        if (b.dataset.range === 'custom') { state.upcoming = null; paintUpcoming(); } else loadUpcoming();
    });
    if (r.mode === 'custom') {
        const readFrom = bindDate(box, 'up-from'), readTo = bindDate(box, 'up-to');
        const apply = () => {
            const from = readFrom(), to = readTo();
            if (!from || !to) return;
            Object.assign(state.upcomingRange, {from, to});
            loadUpcoming();
        };
        ['up-from', 'up-to'].forEach(id => {
            $('#' + id, box).addEventListener('input', apply);
            const quick = $(`.date-quick[data-for="${id}"]`, box);
            if (quick) quick.addEventListener('click', apply);
        });
        if (r.from && r.to && !u) loadUpcoming();
    }
    const toggle = $('#up-toggle', box);
    if (toggle) toggle.onclick = () => { state.upcomingOpen = !state.upcomingOpen; paintUpcoming(); };
    $$('[data-up]', box).forEach(b => b.onclick = () => {
        const it = u.items[Number(b.dataset.up)];
        if (it.kind === 'EXPENSE') { const tx = findTx(it.id); if (tx) openTransactionSheet(tx); }
        else if (it.kind === 'INVOICE') { const acc = accountById(it.id); if (acc) openInvoices(acc); }
    });
}

/* ---------- Reminders ---------- */
function paintBell() {
    const bell = $('#bell-btn');
    if (!bell) return;
    bell.hidden = !state.settings.remindersEnabled;
    const n = state.reminders.length;
    bell.innerHTML = `${ico('bell')}${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}`;
    bell.onclick = openRemindersSheet;
}

async function loadReminders() {
    if (!state.settings.remindersEnabled) { state.reminders = []; paintBell(); return; }
    try { state.reminders = await api('/api/reminders'); } catch (e) { state.reminders = []; }
    paintBell();
    browserNotify();
}

/** Shows each new reminder once as a browser notification (only while the page is open, only if allowed). */
function browserNotify() {
    if (window.desktop || window.nativeNotifications || !('Notification' in window) || Notification.permission !== 'granted') return; // Android: the app schedules its own
    let shown = [];
    try { shown = JSON.parse(safeStorage.get('notified') || '[]'); } catch (e) { shown = []; }
    const fresh = state.reminders.filter(r => r.level !== 'INFO' && !shown.includes(r.key));
    fresh.slice(0, 3).forEach(r => { try { new Notification(r.title, {body: r.detail}); } catch (e) { /* not allowed here */ } });
    if (fresh.length) safeStorage.set('notified', JSON.stringify([...shown, ...fresh.map(r => r.key)].slice(-200)));
}

function openRemindersSheet() {
    const canNotify = !window.desktop && !window.nativeNotifications && 'Notification' in window;
    const sheet = openSheet(`<h2>Lembretes</h2>
        ${state.reminders.length ? `<div class="list">${state.reminders.map(r => `<div class="row static reminder ${r.level.toLowerCase()}">
            <span class="avatar" style="background:var(--surface-2)">${ico(r.kind === 'BUDGET' ? 'target' : r.kind === 'MONTH_END' ? 'clock' : 'receipt')}</span>
            <span class="grow"><span class="title">${esc(r.title)}</span><span class="small muted">${esc(r.detail)}</span></span></div>`).join('')}</div>`
            : '<div class="card empty"><div class="big">' + ico('check') + '</div>Nada pedindo atenção agora.</div>'}
        ${canNotify && Notification.permission === 'default' ? '<button class="btn block" id="allow-notify">Ativar notificações do navegador</button>' : ''}
        ${canNotify && Notification.permission === 'denied' ? '<p class="small muted">Notificações bloqueadas. Libere nas configurações do site.</p>' : ''}
        <div id="native-notify"></div>
        <div class="form-actions"><button type="button" class="btn" id="rem-close">Fechar</button></div>`);
    $('#rem-close', sheet).onclick = closeSheet;
    if (window.nativeNotifications) paintNativeNotify(sheet);
    const allow = $('#allow-notify', sheet);
    if (allow) allow.onclick = async () => { await Notification.requestPermission(); closeSheet(); browserNotify(); toast('Notificações do navegador ativadas'); };
}

/** Android: shows whether the phone's notifications are on, or offers to turn them on. */
async function paintNativeNotify(sheet) {
    const box = $('#native-notify', sheet);
    let status = 'denied';
    try { status = await window.nativeNotifications.status(); } catch (e) { /* treated as off */ }
    if (status === 'granted') {
        box.innerHTML = '';
        return;
    }
    box.innerHTML = '<button class="btn block" id="allow-native">Ativar notificações</button>';
    $('#allow-native', box).onclick = async () => {
        try { status = await window.nativeNotifications.requestPermission(); } catch (e) { status = 'denied'; }
        if (status === 'granted') { toast('Notificações ativadas'); paintNativeNotify(sheet); }
        else box.innerHTML = '<p class="small muted">Notificações bloqueadas. Libere nas configurações do celular.</p>';
    };
}

setInterval(() => { if (state.summary) loadReminders(); }, 15 * 60 * 1000);
