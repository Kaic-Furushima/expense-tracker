'use strict';

/* Credit-card invoices, backup/restore and file import. Loaded after features.js; it reuses its helpers. */

/* ---------- Files ---------- */
/** Decodes bytes as UTF-8, or as Windows-1252 when they are not valid UTF-8 (older bank files). */
function decodeText(buffer) {
    try { return new TextDecoder('utf-8', {fatal: true}).decode(buffer); }
    catch (e) { return new TextDecoder('windows-1252').decode(buffer); }
}

/** Asks for a text file and resolves with its content, or null if the person cancels. */
function pickTextFile(accept) {
    if (window.desktop && window.desktop.openFile) {
        return Promise.resolve(window.desktop.openFile() || null);
    }
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        if (accept) input.accept = accept;
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => resolve(decodeText(reader.result));
            reader.onerror = () => resolve(null);
            reader.readAsArrayBuffer(file);
        };
        input.click();
    });
}

/** Saves text as a file: a "save as" dialog in the desktop app, a download in a browser. */
function saveTextFile(name, text) {
    if (window.desktop && window.desktop.saveFile) {
        if (window.desktop.saveFile(name, text)) toast('Arquivo salvo');
        return;
    }
    if (window.nativeFiles) { // Android: abre o menu Compartilhar do sistema
        window.nativeFiles.saveText(name, text).catch(e => toast(`Não foi possível salvar: ${e.message}`));
        return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
}

/* ---------- Credit-card invoices ---------- */
const INVOICE_STATUS = {OPEN: 'Aberta', CLOSED: 'Fechada', PAID: 'Paga'};

/** Opens the invoice sheet of a credit card, on the invoice that most needs attention. */
async function openInvoices(account) {
    try {
        const list = await api(`/accounts/${account.id}/invoices`);
        const today = todayIso();
        const unpaid = [...list].reverse().find(i => i.status === 'CLOSED');
        const current = list.find(i => i.startDate <= today && today <= i.closingDate);
        showInvoice(account, list, list.indexOf(unpaid || current || list[0]));
    } catch (e) {
        toast(e.message);
    }
}

async function showInvoice(account, list, index) {
    try {
        const invoice = await api(`/accounts/${account.id}/invoices/${list[index].month}`);
        const older = list[index + 1], newer = list[index - 1];
        const items = invoice.items.map(t => {
            const income = t.type === 'INCOME';
            const parcel = t.installmentTotal ? ` · ${t.installmentNumber}/${t.installmentTotal}` : '';
            return `<div class="row static">${avatar(t.categoryIcon, t.categoryColor)}
                <span class="grow"><span class="title">${esc(t.name)}</span><span class="small muted">${isoToBr(t.date)} · ${esc(txCategoryLabel(t))}${parcel}</span></span>
                <span class="amount ${income ? 'income' : 'expense'}">${income ? '−' : ''}${money(t.amount)}</span></div>`;
        }).join('');
        const payments = invoice.payments.map(p => `<div class="row static"><span class="avatar" style="background:var(--surface-2)">${ico('transfer')}</span>
            <span class="grow"><span class="title">Pagamento</span><span class="small muted">${isoToBr(p.date)} · de ${esc(p.fromAccountName)}</span></span>
            <span class="amount income">${money(p.amount)}</span></div>`).join('');
        const remaining = Number(invoice.remaining);
        const sheet = openSheet(`
            <h2>${esc(account.name)}</h2>
            <div class="invoice-nav">
                <button type="button" class="back-btn" id="inv-older" aria-label="Fatura anterior" ${older ? '' : 'disabled'}>${ico('chevron-left')}</button>
                <div class="center"><strong>Fatura de ${esc(monthLabel(invoice.month))}</strong>
                    <span class="tag ${invoice.status === 'PAID' ? '' : invoice.status === 'CLOSED' ? 'late' : 'wait'}">${INVOICE_STATUS[invoice.status]}</span></div>
                <button type="button" class="back-btn" id="inv-newer" aria-label="Próxima fatura" ${newer ? '' : 'disabled'}>${ico('chevron-right')}</button>
            </div>
            <div class="card">
                <div style="font-size:1.6rem;font-weight:800">${money(invoice.total)}</div>
                <div class="small muted">Compras de ${isoToBr(invoice.startDate)} a ${isoToBr(invoice.closingDate)} · vence em ${isoToBr(invoice.dueDate)}</div>
                ${Number(invoice.paid) > 0 ? `<div class="small" style="margin-top:6px">Pago: <strong>${money(invoice.paid)}</strong>${remaining > 0 ? ` · falta <strong class="expense">${money(remaining)}</strong>` : ''}</div>` : ''}
            </div>
            ${remaining > 0 ? '<button type="button" class="btn primary block" id="inv-pay">Pagar fatura</button>' : ''}
            ${items ? `<h3 class="section-title">Compras</h3><div class="list">${items}</div>` : '<div class="card empty">Nenhuma compra nesta fatura.</div>'}
            ${payments ? `<h3 class="section-title">Pagamentos</h3><div class="list">${payments}</div>` : ''}
            <div class="form-actions"><button type="button" class="btn" id="inv-edit">Editar cartão</button></div>`);
        const go = i => () => showInvoice(account, list, i);
        if (older) $('#inv-older', sheet).onclick = go(index + 1);
        if (newer) $('#inv-newer', sheet).onclick = go(index - 1);
        $('#inv-edit', sheet).onclick = () => openAccountSheet(account);
        const pay = $('#inv-pay', sheet);
        if (pay) pay.onclick = () => openInvoicePayment(account, list, index, invoice);
    } catch (e) {
        toast(e.message);
    }
}

function openInvoicePayment(account, list, index, invoice) {
    const sources = activeAccounts().filter(a => a.id !== account.id && a.type !== 'CREDIT_CARD');
    const sheet = openSheet(`
        <h2>Pagar fatura</h2>
        <p class="small muted sheet-sub">${esc(account.name)} · ${esc(monthLabel(invoice.month))} · vence em ${isoToBr(invoice.dueDate)}</p>
        <form id="pay-form" novalidate>
            <input class="amount-input" id="p-amount" inputmode="decimal" autocomplete="off" value="${fmtInput(invoice.remaining)}" aria-label="Valor">
            <div class="field"><label for="p-from">Pagar com a conta</label><select id="p-from">${orderedAccounts(sources).map(a => `<option value="${a.id}" ${a.id === defaultFromAccount(sources) ? 'selected' : ''}>${esc(accountLabel(a))}</option>`).join('')}</select></div>
            ${dateField('p-date', todayIso(), 'Data do pagamento')}
            <p class="small muted">O pagamento é uma transferência da conta para o cartão: não conta como despesa de novo (as compras já foram contadas). Pode pagar só uma parte.</p>
            <div class="form-actions"><button type="button" class="btn" id="p-back">Voltar</button><button type="submit" class="btn primary">Pagar</button></div>
        </form>`);
    const dateValue = bindDate(sheet, 'p-date');
    $('#p-back', sheet).onclick = () => showInvoice(account, list, index);
    $('#pay-form', sheet).onsubmit = e => {
        e.preventDefault();
        const amount = parseAmount($('#p-amount', sheet).value);
        if (!(amount > 0)) return toast('Informe um valor maior que zero.');
        if (!dateValue()) return toast('Informe uma data válida.');
        const from = Number($('#p-from', sheet).value);
        if (!from) return toast('Escolha a conta que vai pagar.');
        run(() => api(`/accounts/${account.id}/invoices/${invoice.month}/pay`, {method: 'POST',
            body: {fromAccountId: from, amount, date: dateValue()}}), 'Fatura paga');
    };
}

const defaultFromAccount = sources => (sources.find(a => a.id === defaultAccountId()) || sources[0] || {}).id;

/* ---------- Backup and restore ---------- */
function backupLabel(b) {
    const m = /^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(b.name);
    const when = m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : b.name;
    return {when, safety: b.name.includes('antes-de-restaurar'), auto: /-auto\.(sql|json)$/.test(b.name)};
}
const sizeLabel = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function renderBackupPage() {
    $('#view').innerHTML = `<div class="stack">${pageHeader('Backup e restauração')}<div class="skeleton"></div></div>`;
    bindBack();
    let backups;
    try { backups = await api('/backups'); } catch (e) { toast(e.message); return; }
    $('#view').innerHTML = `<div class="stack">${pageHeader('Backup e restauração')}
        <p class="small muted">Um backup é uma cópia de <strong>tudo</strong>: lançamentos, contas, categorias, orçamentos, metas e configurações. Fica guardado ${window.localApp ? 'dentro do aplicativo' : 'na pasta de dados do aplicativo'}; guarde também uma cópia ${window.localApp ? 'fora do celular' : 'fora do computador'} (nuvem ou pen drive).</p>
        <button class="btn primary block" id="make-backup">${ico('shield')} Fazer backup agora</button>
        <h2 class="section-title">Backups guardados</h2>
        ${backups.length ? `<div class="list">${backups.map((b, i) => {
            const l = backupLabel(b);
            return `<button class="row" data-backup="${i}"><span class="avatar" style="background:var(--surface-2)">${ico('shield')}</span>
                <span class="grow"><span class="title">${esc(l.when)}</span><span class="small muted">${sizeLabel(b.sizeBytes)}${l.safety ? ' · cópia automática antes de uma restauração' : l.auto ? ' · cópia automática diária' : ''}</span></span>
                <span class="muted">${ico('chevron-right')}</span></button>`;
        }).join('')}</div>` : '<div class="card empty">Nenhum backup ainda.</div>'}
        <button class="btn block" id="restore-file">${ico('upload')} Restaurar de um arquivo…</button>
        <p class="small muted center">Restaurar substitui tudo o que está no aplicativo pelo conteúdo do backup. Antes disso, o aplicativo guarda uma cópia do que existe agora.</p>
    </div>`;
    bindBack();
    $('#make-backup').onclick = async () => {
        try { await api('/backups', {method: 'POST'}); toast('Backup criado'); renderBackupPage(); } catch (e) { toast(e.message); }
    };
    $$('[data-backup]').forEach(b => b.onclick = () => openBackupSheet(backups[Number(b.dataset.backup)]));
    $('#restore-file').onclick = async () => {
        const content = await pickTextFile('.sql,.json,.txt');
        if (!content) return;
        if (!await confirmDialog('Substituir TUDO o que está no aplicativo pelo conteúdo deste arquivo? Uma cópia do que existe agora será guardada antes.', {okLabel: 'Restaurar'})) return;
        restoreWith(() => api('/backups/restore', {method: 'POST', body: {content}}));
    };
}

async function restoreWith(action) {
    try {
        await action();
        state.sub = null;
        await loadAll();
        toast('Backup restaurado');
    } catch (e) {
        toast(e.message);
    }
}

function openBackupSheet(backup) {
    const l = backupLabel(backup);
    const sheet = openSheet(`
        <h2>Backup de ${esc(l.when)}</h2>
        <p class="small muted sheet-sub">${sizeLabel(backup.sizeBytes)}${l.safety ? ' · feito automaticamente antes de uma restauração' : l.auto ? ' · feito automaticamente todo dia' : ''}</p>
        <div class="list">
            <button class="row" id="b-restore"><span class="avatar" style="background:var(--surface-2)">${ico('upload')}</span><span class="grow title">Restaurar este backup</span></button>
            <button class="row" id="b-save"><span class="avatar" style="background:var(--surface-2)">${ico('download')}</span><span class="grow title">${window.localApp ? 'Salvar ou enviar uma cópia…' : 'Salvar uma cópia no computador…'}</span></button>
            <button class="row" id="b-del"><span class="avatar" style="background:var(--surface-2)">${ico('trash')}</span><span class="grow title expense">Excluir este backup</span></button>
        </div>`);
    $('#b-restore', sheet).onclick = async () => {
        if (!await confirmDialog(`Substituir TUDO o que está no aplicativo pelo backup de ${l.when}? Uma cópia do que existe agora será guardada antes.`, {okLabel: 'Restaurar'})) return;
        closeSheet();
        restoreWith(() => api(`/backups/${backup.name}/restore`, {method: 'POST'}));
    };
    $('#b-save', sheet).onclick = async () => {
        try {
            const res = await busy(() => fetch(`/backups/${backup.name}`), 'Preparando o arquivo…');
            if (!res.ok) throw new Error(`Erro ${res.status}`);
            saveTextFile(backup.name, await res.text());
        } catch (e) { toast(`Não foi possível salvar: ${e.message}`); }
    };
    $('#b-del', sheet).onclick = async () => {
        if (!await confirmDialog('Excluir este backup? Isso não afeta seus dados atuais.', {okLabel: 'Excluir'})) return;
        run(() => api(`/backups/${backup.name}`, {method: 'DELETE'}), 'Backup excluído').then(() => renderBackupPage());
    };
}

/* ---------- Import ---------- */
const importState = {content: null, fileName: '', accountId: null, invert: false, preview: null, keep: [], rows: []};
const IMPORT_FORMATS = {OFX: 'extrato OFX', BANK_CSV: 'planilha de banco/cartão', APP_CSV: 'CSV exportado deste aplicativo'};

function renderImportPage() {
    const s = importState;
    if (s.accountId == null || !accountById(s.accountId)) s.accountId = defaultAccountId();
    const accounts = activeAccounts();
    $('#view').innerHTML = `<div class="stack">${pageHeader('Importar lançamentos')}
        <p class="small muted">Aceita o extrato do banco (<strong>OFX</strong>), uma planilha <strong>CSV</strong> com data, descrição e valor (banco ou cartão) e o CSV que este aplicativo exporta. Você confere tudo antes de salvar; nada é gravado até confirmar.</p>
        <div class="card stack-tight">
            <div class="field" style="margin:0"><label for="imp-account">Conta que recebe os lançamentos</label>
                <select id="imp-account">${accountOptions(s.accountId)}</select>
                <span class="small muted">Vale para extratos e planilhas de banco. O CSV deste aplicativo já diz a conta de cada linha.</span></div>
            <label class="switch-row"><input type="checkbox" id="imp-invert" ${s.invert ? 'checked' : ''}>
                <span><strong>Inverter entradas e saídas</strong><span class="small muted" style="display:block">Use se o arquivo mostrar compras como números positivos e o app as tratar como receitas (ou o contrário).</span></span></label>
            <button class="btn primary block" id="imp-pick">${ico('upload')} Escolher arquivo…</button>
        </div>
        <div id="imp-review"></div>
    </div>`;
    bindBack();
    $('#imp-account').onchange = e => { s.accountId = Number(e.target.value); if (s.content) runImportPreview(); };
    $('#imp-invert').onchange = e => { s.invert = e.target.checked; if (s.content) runImportPreview(); };
    $('#imp-pick').onclick = async () => {
        const content = await pickTextFile('.ofx,.qfx,.csv,.txt');
        if (!content) return;
        s.content = content;
        runImportPreview();
    };
    if (s.preview) paintImportReview();
}

async function runImportPreview() {
    const s = importState;
    const box = $('#imp-review');
    if (box) box.innerHTML = '<div class="skeleton"></div>';
    try {
        s.preview = await api('/import/preview', {method: 'POST', body: {content: s.content, accountId: s.accountId, invertSigns: s.invert}});
        s.rows = s.preview.rows.map(r => ({...r, categorySel: r.categoryId != null ? String(r.categoryId) : (r.categoryName ? 'new' : '')}));
        s.keep = s.rows.map(r => !r.duplicate);
        paintImportReview();
    } catch (e) {
        s.preview = null;
        if (box) box.innerHTML = `<div class="card empty">${ico('search')}<br>${esc(e.message)}</div>`;
    }
}

function paintImportReview() {
    const s = importState;
    const box = $('#imp-review');
    if (!box || !s.preview) return;
    const transferRows = s.rows.filter(r => r.kind === 'TRANSFER').length;
    const catOptions = (row) => `<option value="">Sem categoria</option>`
        + (row.categoryName && row.categoryId == null ? `<option value="new" ${row.categorySel === 'new' ? 'selected' : ''}>Nova: ${esc(row.categoryName)}</option>` : '')
        + orderedCategories().map(c => `<option value="${c.id}" ${String(c.id) === row.categorySel ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('');
    const rowHtml = (r, i) => {
        const transfer = r.kind === 'TRANSFER';
        const income = r.type === 'INCOME';
        return `<div class="imp-row ${s.keep[i] ? '' : 'off'}" data-i="${i}">
            <input type="checkbox" class="imp-keep" ${s.keep[i] ? 'checked' : ''} aria-label="Importar esta linha">
            <div class="imp-main"><span class="title">${esc(r.name || 'Sem descrição')}</span>
                <span class="small muted">${isoToBr(r.date)}${transfer ? ` · ${esc(r.accountName || '')} → ${esc(r.toAccountName || '')}` : r.accountName ? ` · ${esc(r.accountName)}` : ''}${r.duplicate ? ' · <span class="tag wait">Possível duplicado</span>' : ''}${r.status === 'PENDING' ? ' · <span class="tag wait">A pagar</span>' : ''}</span>
                ${transfer ? '<span class="small muted">Transferência</span>' : `<select class="imp-cat" aria-label="Categoria">${catOptions(r)}</select>`}</div>
            <span class="amount ${transfer ? 'transfer' : income ? 'income' : 'expense'}">${transfer ? '' : income ? '+ ' : '− '}${money(r.amount)}</span></div>`;
    };
    box.innerHTML = `<div class="card">
            <strong>${s.rows.length} linhas encontradas</strong> <span class="muted">(${IMPORT_FORMATS[s.preview.format]})</span>
            <div class="small muted" id="imp-count"></div>
            ${s.preview.duplicates ? `<div class="small muted">${s.preview.duplicates} já parecem existir (mesma conta, dia, valor e tipo) e vieram desmarcadas.</div>` : ''}
            ${transferRows ? `<div class="small muted">${transferRows} transferências entre contas.</div>` : ''}
        </div>
        <div class="chips"><button class="chip" id="imp-all">Marcar todas</button><button class="chip" id="imp-none">Desmarcar todas</button></div>
        <div class="list imp-list">${s.rows.map(rowHtml).join('')}</div>
        <button class="btn primary block" id="imp-commit"></button>`;
    const repaintCount = () => {
        const n = s.keep.filter(Boolean).length;
        $('#imp-count').textContent = `${n} marcadas para importar`;
        const commit = $('#imp-commit');
        commit.textContent = n ? `Importar ${n === 1 ? '1 lançamento' : n + ' lançamentos'}` : 'Nada marcado';
        commit.disabled = !n;
    };
    repaintCount();
    $$('.imp-row', box).forEach(el => {
        const i = Number(el.dataset.i);
        $('.imp-keep', el).onchange = e => { s.keep[i] = e.target.checked; el.classList.toggle('off', !s.keep[i]); repaintCount(); };
        const sel = $('.imp-cat', el);
        if (sel) sel.onchange = e => { s.rows[i].categorySel = e.target.value; };
    });
    $('#imp-all').onclick = () => { s.keep = s.keep.map(() => true); paintImportReview(); };
    $('#imp-none').onclick = () => { s.keep = s.keep.map(() => false); paintImportReview(); };
    $('#imp-commit').onclick = async () => {
        const rows = s.rows.filter((r, i) => s.keep[i]).map(r => {
            const {categorySel, ...row} = r;
            if (categorySel === 'new') { row.categoryId = null; }
            else { row.categoryId = categorySel ? Number(categorySel) : null; row.categoryName = null; }
            return row;
        });
        try {
            const result = await api('/import/commit', {method: 'POST', body: {rows, accountId: s.accountId}});
            Object.assign(s, {content: null, preview: null, rows: [], keep: []});
            state.sub = null;
            state.tab = 'transactions';
            safeStorage.set('tab', 'transactions');
            await loadAll();
            const extra = result.categoriesCreated ? ` (${result.categoriesCreated} categoria${result.categoriesCreated === 1 ? ' nova' : 's novas'})` : '';
            toast(`${result.transactions + result.transfers} lançamentos importados${extra}`);
        } catch (e) {
            toast(e.message);
        }
    };
}
