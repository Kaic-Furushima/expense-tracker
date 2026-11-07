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
                <span class="amount ${income ? 'income' : 'expense'}">${income ? '−' : ''}${money(t.amount, account.currency)}</span></div>`;
        }).join('');
        const payments = invoice.payments.map(p => `<div class="row static"><span class="avatar" style="background:var(--surface-2)">${ico('transfer')}</span>
            <span class="grow"><span class="title">Pagamento</span><span class="small muted">${isoToBr(p.date)} · de ${esc(p.fromAccountName)}</span></span>
            <span class="amount income">${money(p.toAmount != null ? p.toAmount : p.amount, account.currency)}</span></div>`).join('');
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
                <div style="font-size:1.6rem;font-weight:800">${money(invoice.total, account.currency)}</div>
                <div class="small muted">Compras de ${isoToBr(invoice.startDate)} a ${isoToBr(invoice.closingDate)} · vence em ${isoToBr(invoice.dueDate)}</div>
                ${Number(invoice.paid) > 0 ? `<div class="small" style="margin-top:6px">Pago: <strong>${money(invoice.paid, account.currency)}</strong>${remaining > 0 ? ` · falta <strong class="expense">${money(remaining)}</strong>` : ''}</div>` : ''}
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
            <div class="field" id="p-fromamount-field" hidden><label for="p-fromamount" id="p-fromamount-label">Valor que saiu</label>
                <input id="p-fromamount" inputmode="numeric" placeholder="0,00" autocomplete="off"></div>
            ${dateField('p-date', todayIso(), 'Data do pagamento')}
            ${tip('invoice-pay', `Pagar a fatura transfere dinheiro da conta para o cartão, sem duplicar despesas. Você pode pagar parcialmente.`)}
            <div class="form-actions"><button type="button" class="btn" id="p-back">Voltar</button><button type="submit" class="btn primary">Pagar</button></div>
        </form>`);
    const dateValue = bindDate(sheet, 'p-date');
    bindAmountInput($('#p-fromamount', sheet));
    // paying from an account in another currency: the invoice value reaches the card, the person says how much left the account
    const paintFromAmount = () => {
        const source = accountById(Number($('#p-from', sheet).value));
        const different = !!source && (source.currency || currencyCode()) !== (account.currency || currencyCode());
        $('#p-fromamount-field', sheet).hidden = !different;
        if (different) $('#p-fromamount-label', sheet).textContent = T(`Valor que saiu (${currencySymbol(source.currency)})`);
    };
    $('#p-from', sheet).addEventListener('change', paintFromAmount);
    paintFromAmount();
    $('#p-back', sheet).onclick = () => showInvoice(account, list, index);
    $('#pay-form', sheet).onsubmit = e => {
        e.preventDefault();
        const amount = parseAmount($('#p-amount', sheet).value);
        if (!(amount > 0)) return toast('Informe um valor maior que zero.');
        if (!dateValue()) return toast('Informe uma data válida.');
        const from = Number($('#p-from', sheet).value);
        if (!from) return toast('Escolha a conta que vai pagar.');
        const fromAmount = $('#p-fromamount-field', sheet).hidden ? 0 : parseAmount($('#p-fromamount', sheet).value);
        if (!$('#p-fromamount-field', sheet).hidden && !(fromAmount > 0)) return toast('Informe quanto saiu da conta de origem.');
        run(() => api(`/accounts/${account.id}/invoices/${invoice.month}/pay`, {method: 'POST',
            body: {fromAccountId: from, amount, date: dateValue(), ...(fromAmount ? {fromAmount} : {})}}), 'Fatura paga');
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
    // celular: pasta de backups escolhida pela pessoa (fora do app); no computador/navegador essa rota nao existe
    let folder = null;
    if (window.localApp) { try { folder = await api('/backups/folder'); } catch (e) { folder = null; } }
    const folderBox = !folder ? '' : `<div class="card stack-tight">
            <strong>Pasta dos backups</strong>
            <span class="small muted">${folder.configured
                ? `Cada backup (inclusive o automático) também é gravado em <strong>${esc(folder.name)}</strong>, fora do aplicativo.`
                : 'Backups ficam no app e se perdem se ele for desinstalado. Escolha uma pasta do celular para guardar outra cópia.'}</span>
            ${folder.error ? `<span class="small" style="color:var(--warn)">Não foi possível gravar na pasta: ${esc(folder.error)}</span>` : ''}
            <div class="form-actions"><button type="button" class="btn" id="folder-pick">${folder.configured ? 'Trocar pasta…' : 'Escolher pasta…'}</button>
                ${folder.configured ? '<button type="button" class="btn" id="folder-clear">Parar de usar</button>' : ''}</div>
        </div>`;
    $('#view').innerHTML = `<div class="stack">${pageHeader('Backup e restauração')}
        ${tip('backup', window.localApp ? 'Inclui lançamentos, contas, categorias, orçamentos, metas e configurações. Guarde outra cópia fora do celular.' : 'Inclui lançamentos, contas, categorias, orçamentos, metas e configurações. Guarde outra cópia fora do computador.')}
        <button class="btn primary block" id="make-backup">${ico('shield')} Fazer backup agora</button>
        ${folderBox}
        <h2 class="section-title">Backups guardados</h2>
        ${backups.length ? `<div class="list">${backups.map((b, i) => {
            const l = backupLabel(b);
            return `<button class="row" data-backup="${i}"><span class="avatar" style="background:var(--surface-2)">${ico('shield')}</span>
                <span class="grow"><span class="title">${esc(l.when)}</span><span class="small muted">${sizeLabel(b.sizeBytes)}${l.safety ? ' · cópia automática antes de uma restauração' : l.auto ? ' · cópia automática diária' : ''}</span></span>
                <span class="muted">${ico('chevron-right')}</span></button>`;
        }).join('')}</div>` : '<div class="card empty">Nenhum backup ainda.</div>'}
        <button class="btn block" id="restore-file">${ico('upload')} Restaurar de um arquivo…</button>
        <p class="small muted center">Restaurar substitui os dados atuais pelo backup; uma cópia dos dados atuais é salva antes.</p>
    </div>`;
    bindBack();
    $('#make-backup').onclick = async () => {
        try {
            const made = await api('/backups', {method: 'POST'});
            toast(made.folderError ? `Backup criado, mas não foi possível gravar na pasta: ${made.folderError}` : made.folder ? `Backup criado e gravado em ${made.folder}` : 'Backup criado');
            renderBackupPage();
        } catch (e) { toast(e.message); }
    };
    if (folder) {
        $('#folder-pick').onclick = async () => {
            try {
                const res = await api('/backups/folder', {method: 'POST'});
                if (!res.changed) return;
                // faz um backup já, para a pessoa ver o arquivo aparecer na pasta e saber que funcionou
                const made = await api('/backups', {method: 'POST'});
                toast(made.folderError ? `Pasta escolhida, mas não foi possível gravar: ${made.folderError}` : `Pasta escolhida: ${res.name}. Um backup já foi gravado lá.`);
                renderBackupPage();
            } catch (e) { toast(e.message); }
        };
        const clear = $('#folder-clear');
        if (clear) clear.onclick = async () => {
            if (!await confirmDialog('Parar de salvar backups nesta pasta? Os arquivos existentes serão mantidos.', {okLabel: 'Parar'})) return;
            try { await api('/backups/folder', {method: 'DELETE'}); renderBackupPage(); } catch (e) { toast(e.message); }
        };
    }
    $$('[data-backup]').forEach(b => b.onclick = () => openBackupSheet(backups[Number(b.dataset.backup)]));
    $('#restore-file').onclick = async () => {
        const content = await pickTextFile('.sql,.json,.txt');
        if (!content) return;
        openRestoreSheet({content}, 'Conteúdo do arquivo escolhido');
    };
}

/** Asks where to restore (over an existing profile or into a new one) and how, then restores. source: {name} or {content}. */
function openRestoreSheet(source, label) {
    const profiles = state.profiles.profiles;
    const current = state.profiles.current;
    const syncOn = !!(state.sync && state.sync.configured);
    const sheet = openSheet(`<h2>Restaurar backup</h2>
        <p class="small muted sheet-sub">${esc(label)}</p>
        <div class="list" role="radiogroup" aria-label="Onde restaurar">
            ${profiles.map(p => `<label class="row"><input type="radio" name="rs-target" value="${esc(p.id)}" ${p.id === current ? 'checked' : ''}>
                <span class="grow title">Sobrescrever “${esc(p.name)}”${p.id === current ? ' (em uso)' : ''}</span></label>`).join('')}
            <label class="row"><input type="radio" name="rs-target" value="__new">
                <span class="grow title">Criar um perfil novo com este backup</span></label>
        </div>
        <div class="field" id="rs-new-box" hidden><label for="rs-new">Nome do perfil novo</label>
            <input id="rs-new" maxlength="40" autocomplete="off" placeholder="Ex.: Recuperado"></div>
        <div id="rs-over" class="stack-tight">
            <p class="small" style="color:var(--warn);margin:0">Não dá para desfazer: o perfil será substituído pelo backup.</p>
            ${syncOn ? '<p class="small" style="color:var(--warn);margin:0">Com o sync ligado, o backup também substitui nuvem e outros aparelhos; itens ausentes nele serão apagados.</p>' : ''}
            <label class="switch-row"><input type="checkbox" id="rs-backup" checked>
                <span><strong>Fazer um backup deste perfil antes de sobrescrever</strong>${info(`Fica guardado em Backup e restauração, para você poder voltar.`)}</span></label>
        </div>
        <div class="form-actions"><button type="button" class="btn" id="rs-cancel">Cancelar</button>
            <button type="button" class="btn danger-fill" id="rs-go">Restaurar</button></div>`);
    const choice = () => $('input[name="rs-target"]:checked', sheet).value;
    const paint = () => {
        const isNew = choice() === '__new';
        $('#rs-new-box', sheet).hidden = !isNew;
        $('#rs-over', sheet).hidden = isNew;
        $('#rs-go', sheet).textContent = isNew ? 'Criar perfil e restaurar' : 'Sobrescrever e restaurar';
        $('#rs-go', sheet).className = isNew ? 'btn primary' : 'btn danger-fill';
        if (isNew) $('#rs-new', sheet).focus();
    };
    $$('input[name="rs-target"]', sheet).forEach(r => r.onchange = paint);
    paint();
    $('#rs-cancel', sheet).onclick = closeSheet;
    $('#rs-go', sheet).onclick = async () => {
        const isNew = choice() === '__new';
        const name = $('#rs-new', sheet).value.trim();
        if (isNew && !name) return toast('Dê um nome ao perfil novo.');
        const body = isNew ? {newProfileName: name} : {profileId: choice(), backupFirst: $('#rs-backup', sheet).checked};
        if (source.content != null) body.content = source.content;
        closeSheet();
        try {
            const result = await busy(() => api(source.name ? `/backups/${source.name}/restore` : '/backups/restore', {method: 'POST', body}), 'Restaurando…');
            state.profiles = await api('/profiles');
            const target = state.profiles.profiles.find(p => p.id === result.profileId);
            state.sub = null;
            if (result.created) toast(`Perfil “${target ? target.name : name}” criado com o backup`);
            else if (result.profileId === state.profiles.current) toast('Backup restaurado');
            else toast(`Backup restaurado em “${target ? target.name : ''}”`);
            if (result.syncError) toast(`Restaurado, mas a nuvem não foi atualizada agora: ${result.syncError}`);
            await loadAll();
        } catch (e) {
            toast(e.message);
        }
    };
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
    $('#b-restore', sheet).onclick = () => {
        closeSheet();
        openRestoreSheet({name: backup.name}, `Backup de ${l.when}`);
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

/* ---------- Sync (PC <-> phone, through the user's own Supabase project) ---------- */
function syncWhen(ms) {
    if (!ms) return 'ainda não sincronizou';
    const d = new Date(ms);
    return `${d.toLocaleDateString()} às ${d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
}

/** Copies the SQL that prepares a Supabase project (served with the app, so it works offline and on the phone too). */
async function copySyncScript() {
    let text;
    try {
        const res = await fetch('/sync/supabase-hub.sql');
        if (!res.ok) throw new Error(String(res.status));
        text = await res.text();
    } catch (e) { toast('Não foi possível ler o script.'); return; }
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        const box = document.createElement('textarea');
        box.value = text;
        box.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(box);
        box.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { /* sem permissão */ }
        box.remove();
        if (!ok) { toast('Não foi possível copiar. Abra /sync/supabase-hub.sql e copie o texto.'); return; }
    }
    toast('Script copiado. Cole no SQL Editor do Supabase.');
}

function syncTutorial(central, open) {
    const own = `<ol class="small tutorial">
        <li>Crie uma conta grátis e um projeto no supabase.com.</li>
        <li>No Supabase, abra SQL Editor › New query, cole o script e clique Run para criar tabelas protegidas por usuário.
            <div><button type="button" class="btn small" data-copy-sql>Copiar o script</button></div></li>
        <li>Desative “Confirm email” em Authentication › Sign In / Providers › Email para liberar o primeiro acesso.</li>
        <li>Em Project Settings › API, copie Project URL e anon public key para os campos acima.</li>
        <li>Informe e-mail e senha, marque “Criar a conta agora” e defina a senha de sincronização.</li>
        <li>No outro aparelho, use a mesma URL, chave, e-mail e senhas; não marque “Criar a conta agora”.</li>
        <li>Após criar a conta, desative “Allow new users to sign up” em Authentication › Sign In / Providers para impedir novos cadastros.</li>
    </ol>
    <p class="small muted">No plano grátis, projetos sem atividade por cerca de 7 dias são pausados. Os dados permanecem; reative em “Restore”. Enquanto isso, o sync fica sem conexão.</p>`;
    const std = `<ol class="small tutorial">
        <li>No primeiro aparelho, escolha Servidor padrão, informe e-mail e senha e marque “Criar a conta agora”.</li>
        <li>Defina uma senha de sincronização (8+ caracteres). Ela cifra os dados e não pode ser recuperada; guarde-a em segurança.</li>
        <li>Toque em Conectar e sincronizar.</li>
        <li>No outro aparelho, escolha Servidor padrão, use o mesmo e-mail e senhas e não marque “Criar a conta agora”.</li>
        <li>Sincroniza ao abrir o app, após salvar e periodicamente.</li>
    </ol>`;
    return `<details class="card" ${open ? 'open' : ''}><summary><strong>Como configurar</strong></summary>
        ${central ? `<h3 class="small" style="margin:.8rem 0 .2rem">Com o servidor padrão</h3>${std}` : ''}
        <h3 class="small" style="margin:.8rem 0 .2rem">${central ? 'Com o seu próprio projeto Supabase' : 'Com o seu projeto Supabase'}</h3>${own}
    </details>`;
}

async function renderSyncPage() {
    $('#view').innerHTML = `<div class="stack">${pageHeader('Sincronização')}<div class="skeleton"></div></div>`;
    bindBack();
    let st;
    try { st = await api('/api/sync'); state.sync = st; } catch (e) { toast(e.message); return; }
    const head = pageHeader('Sincronização');
    if (!st.configured) {
        const central = !!st.central;
        $('#view').innerHTML = `<div class="stack">${head}
            <p class="small muted">Sincronize os dados entre computador e celular. Eles são cifrados antes do envio; o app funciona sem sync.</p>
            <form class="card stack-tight" id="sync-form" autocomplete="off">
                ${central ? `<div class="chips" role="radiogroup" aria-label="Servidor">
                    <button type="button" class="chip active" data-mode="central" role="radio" aria-checked="true">Servidor padrão</button>
                    <button type="button" class="chip" data-mode="own" role="radio" aria-checked="false">Meu próprio projeto</button></div>
                    <p class="small muted" id="sy-mode-help" style="margin:0">Servidor do app: entre com e-mail e senha; seus dados ficam cifrados.</p>` : ''}
                <div id="sy-own" class="stack-tight" ${central ? 'hidden' : ''}>
                    <div class="field" style="margin:0"><label for="sy-url">Endereço do projeto Supabase</label>
                        <input id="sy-url" type="url" placeholder="https://xxxx.supabase.co" value="${esc(st.url || '')}"></div>
                    <div class="field" style="margin:0"><label for="sy-key">Chave pública (anon)</label>
                        <input id="sy-key" type="text" spellcheck="false"></div>
                </div>
                <div class="field" style="margin:0"><label for="sy-email">E-mail da conta</label>
                    <input id="sy-email" type="email" required value="${esc(st.email || '')}"></div>
                <div class="field" style="margin:0"><label for="sy-pass">Senha da conta</label>
                    <input id="sy-pass" type="password" required minlength="6"></div>
                <label class="switch-row"><input type="checkbox" id="sy-create">
                    <span><strong>Criar a conta agora</strong>${info(`Marque só no primeiro aparelho; nos outros, entre com a mesma conta.`)}</span></label>
                <div class="field" style="margin:0"><label for="sy-secret">Senha de sincronização</label>
                    <input id="sy-secret" type="password" required minlength="8">
                    <span class="small muted">Use a mesma senha de sincronização nos dois aparelhos. Sem ela, não é possível recuperar os dados da nuvem.</span></div>
                <button class="btn primary block" type="submit">${ico('repeat')} Conectar e sincronizar</button>
            </form>
            ${syncTutorial(central, false)}
        </div>`;
        bindBack();
        let mode = central ? 'central' : 'own';
        const own = () => { $('#sy-url').required = $('#sy-key').required = mode === 'own'; };
        own();
        $$('[data-mode]').forEach(b => b.onclick = () => {
            mode = b.dataset.mode;
            $$('[data-mode]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
            $('#sy-own').hidden = mode !== 'own';
            $('#sy-mode-help').textContent = mode === 'own'
                ? 'Supabase: os dados ficam no seu projeto. Veja “Como configurar”.'
                : 'Servidor do app: entre com e-mail e senha; seus dados ficam cifrados.';
            own();
        });
        $$('[data-copy-sql]').forEach(b => b.onclick = copySyncScript);
        $('#sync-form').onsubmit = async ev => {
            ev.preventDefault();
            const body = {email: $('#sy-email').value.trim(), password: $('#sy-pass').value, syncPassword: $('#sy-secret').value,
                createAccount: $('#sy-create').checked, useCentral: mode === 'central'};
            if (mode === 'own') { body.url = $('#sy-url').value.trim(); body.anonKey = $('#sy-key').value.trim(); }
            try {
                state.sync = await busy(() => api('/api/sync', {method: 'PUT', body}), 'Conectando…');
                if (state.sync.lastError) toast(state.sync.lastError); else { toast('Sincronizado'); await loadAll(); }
                renderSyncPage();
            } catch (e) { toast(e.message); }
        };
        return;
    }
    $('#view').innerHTML = `<div class="stack">${head}
        <div class="card stack-tight">
            <div><strong>${esc(st.email)}</strong><div class="small muted">${st.mode === 'central' ? 'Servidor padrão' : esc(st.url)}</div></div>
            <div class="small">Última sincronização: ${syncWhen(st.lastSyncAt)}</div>
            ${st.unsent ? `<div class="small muted">${st.unsent} alterações aguardando envio</div>` : ''}
            ${st.pending ? `<div class="small muted">${st.pending} alterações recebidas esperando outra para poderem entrar</div>` : ''}
            ${st.skippedAttachments ? `<div class="small muted">${st.skippedAttachments} anexos maiores que 3 MB ficam só neste aparelho</div>` : ''}
            ${st.lastError ? `<div class="small" style="color:var(--warn)">${esc(st.lastError)}</div>` : ''}
            <button class="btn primary block" id="sync-now">${ico('repeat')} Sincronizar agora</button>
        </div>
        <div class="card stack-tight">
            <label class="switch-row"><input type="checkbox" id="sync-auto" ${st.autoSync ? 'checked' : ''}>
                <span><strong>Sincronizar automaticamente</strong>${info(`Sincroniza ao abrir, salvar e periodicamente; offline, envia alterações quando a internet voltar.`)}</span></label>
        </div>
        <details class="card"><summary><strong>Conectar outro aparelho</strong></summary>
            <p class="small">${st.mode === 'central' ? 'No outro aparelho, abra Mais › Sincronização, escolha Servidor padrão e use a mesma conta e senhas. Não marque “Criar a conta agora”.' : `No outro aparelho, use o mesmo projeto Supabase (${esc(st.url)}), e-mail e senhas; não marque “Criar a conta agora”.`}</p>
        </details>
        <button class="btn block" id="sync-off">Desconectar este aparelho</button>
        <p class="small muted center">Desconectar não apaga nenhum dado, nem deste aparelho nem da nuvem.</p>
    </div>`;
    bindBack();
    $('#sync-now').onclick = async () => {
        try {
            state.sync = await busy(() => api('/api/sync/now', {method: 'POST'}), 'Sincronizando…');
            if (state.sync.lastError) toast(state.sync.lastError); else { toast('Sincronizado'); await loadAll(); }
            renderSyncPage();
        } catch (e) { toast(e.message); }
    };
    $('#sync-auto').onchange = async e => {
        try { state.sync = await api('/api/sync/auto', {method: 'PUT', body: {enabled: e.target.checked}}); } catch (err) { toast(err.message); }
    };
    $('#sync-off').onclick = async () => {
        if (!await confirmDialog('Desconectar este aparelho do sync? Os dados permanecem aqui e na nuvem.', {okLabel: 'Desconectar'})) return;
        try { state.sync = await api('/api/sync', {method: 'DELETE'}); renderSyncPage(); } catch (err) { toast(err.message); }
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
        ${tip('import', 'Aceita OFX ou CSV com data, descrição e valor. Confira antes de salvar; nada é gravado sem confirmação.')}
        <div class="card stack-tight">
            <div class="field" style="margin:0"><label for="imp-account">Conta que recebe os lançamentos</label>
                <select id="imp-account">${accountOptions(s.accountId)}</select>
                <span class="small muted">Vale para extratos e planilhas de banco. O CSV do app já informa a conta de cada linha.</span></div>
            <label class="switch-row"><input type="checkbox" id="imp-invert" ${s.invert ? 'checked' : ''}>
                <span><strong>Inverter entradas e saídas</strong>${info(`Use quando compras positivas forem tratadas como receitas (ou o contrário).`)}</span></label>
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
        + orderedCategories(kindOf(row.type)).map(c => `<option value="${c.id}" ${String(c.id) === row.categorySel ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('');
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
