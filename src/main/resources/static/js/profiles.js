'use strict';

/* Profiles: separate data sets (for example one per person) in the same app, without login.
   Loaded after extras.js; it reuses its helpers ($, api, openSheet, confirmDialog, state, ...). */

const PROFILE_COLORS = ['#2f7d6d', '#5c6bc0', '#e07a3f', '#c2557a', '#6a9f3c', '#3d8fc4', '#9a6bb5', '#b08d2a'];
const profileColor = id => {
    const index = (state.profiles ? state.profiles.profiles : []).findIndex(p => p.id === id);
    return PROFILE_COLORS[(index < 0 ? 0 : index) % PROFILE_COLORS.length];
};
const currentProfile = () => state.profiles && state.profiles.profiles.find(p => p.id === state.profiles.current);
const hasSeveralProfiles = () => !!state.profiles && state.profiles.profiles.length > 1;

function profileAvatar(profile) {
    return `<span class="avatar profile-avatar" style="background:${profileColor(profile.id)}">${esc(profile.name.trim().charAt(0).toUpperCase() || '?')}</span>`;
}

/** The chip in the top bar: only shown once there is more than one profile. */
function paintProfileButton() {
    const btn = $('#profile-btn');
    if (!btn) return;
    const profile = currentProfile();
    btn.hidden = !hasSeveralProfiles() || !profile;
    if (btn.hidden) return;
    btn.innerHTML = `<span class="dot" style="background:${profileColor(profile.id)}"></span><span>${esc(profile.name)}</span>`;
    btn.onclick = openProfilePicker;
}

async function switchProfile(id) {
    try {
        await api(`/profiles/${id}/switch`, {method: 'POST'});
        safeStorage.set('account', ''); // account ids belong to a profile
        location.reload();
    } catch (e) {
        toast(e.message);
    }
}

function openProfilePicker() {
    const check = ico('check');
    const sheet = openSheet(`<h2>Trocar de perfil</h2>
        <div class="list">${state.profiles.profiles.map(p => `<button class="row" data-profile="${p.id}">${profileAvatar(p)}
            <span class="grow title">${esc(p.name)}</span>${p.id === state.profiles.current ? check : ''}</button>`).join('')}</div>
        <div class="form-actions"><button type="button" class="btn" id="pp-manage">Gerenciar perfis</button></div>`);
    $$('[data-profile]', sheet).forEach(b => b.onclick = () => {
        if (b.dataset.profile === state.profiles.current) return closeSheet();
        switchProfile(b.dataset.profile);
    });
    $('#pp-manage', sheet).onclick = () => { closeSheet(); state.tab = 'more'; state.sub = 'profiles'; safeStorage.set('tab', 'more'); render(); };
}

function renderProfilesPage() {
    const p = state.profiles;
    $('#view').innerHTML = `<div class="stack">${pageHeader('Perfis')}
        <p class="small muted">${window.localApp
            ? 'Os perfis têm dados separados. A senha vale para todos, mas qualquer pessoa pode trocar de perfil.'
            : 'Cada perfil tem dados próprios. Não há senha; qualquer pessoa pode trocar de perfil.'}</p>
        <div class="list">${p.profiles.map(x => `<button class="row" data-profile="${x.id}">${profileAvatar(x)}
            <span class="grow"><span class="title">${esc(x.name)}</span>${x.id === p.current ? '<span class="small muted">Em uso agora</span>' : ''}</span>
            <span class="muted">${ico('pencil')}</span></button>`).join('')}
            <button class="row" id="new-profile"><span class="avatar" style="background:var(--primary-soft)">${ico('plus')}</span><span class="grow title">Novo perfil</span></button>
        </div>
        ${(p.trashed || []).length ? `<h2 class="section-title">Lixeira de perfis</h2>
            <p class="small muted">Perfis removidos ficam aqui até restaurar ou excluir. Nada é apagado antes disso.</p>
            <div class="list">${p.trashed.map(x => `<button class="row" data-trashed="${x.id}">${profileAvatar(x)}
                <span class="grow"><span class="title">${esc(x.name)}</span><span class="small muted">Removido em ${new Date(x.trashedAt).toLocaleDateString()}</span></span>
                <span class="muted">${ico('trash')}</span></button>`).join('')}</div>` : ''}</div>`;
    bindBack();
    $$('[data-profile]').forEach(b => b.onclick = () => openProfileSheet(p.profiles.find(x => x.id === b.dataset.profile)));
    $$('[data-trashed]').forEach(b => b.onclick = () => openTrashedProfileSheet(p.trashed.find(x => x.id === b.dataset.trashed)));
    const add = $('#new-profile');
    if (add) add.onclick = () => openProfileSheet(null);
}

function openProfileSheet(profile) {
    const isMain = profile && profile.id === 'main';
    const isCurrent = profile && profile.id === state.profiles.current;
    const sheet = openSheet(`<h2>${profile ? 'Perfil' : 'Novo perfil'}</h2>
        <form id="pf-form">
            <div class="field"><label for="pf-name">Nome</label>
                <input id="pf-name" maxlength="40" autocomplete="off" required value="${esc(profile ? profile.name : '')}" placeholder="Ex.: Maria"></div>
            ${profile ? '' : '<p class="small muted">O perfil começa vazio, com categorias e formas de pagamento padrão.</p>'}
            <div class="form-actions">
                ${profile && !isMain ? '<button type="button" class="btn danger" id="pf-del">Mover para a lixeira</button>' : ''}
                ${profile && !isCurrent ? '<button type="button" class="btn" id="pf-use">Usar este perfil</button>' : ''}
                <button type="submit" class="btn primary">${profile ? 'Salvar nome' : 'Criar e usar'}</button>
            </div>
        </form>`);
    $('#pf-name', sheet).focus();
    $('#pf-form', sheet).onsubmit = async e => {
        e.preventDefault();
        const name = $('#pf-name', sheet).value.trim();
        if (!name) return toast('Dê um nome ao perfil.');
        try {
            if (profile) {
                state.profiles = await api(`/profiles/${profile.id}`, {method: 'PUT', body: {name}});
                closeSheet();
                renderProfilesPage();
                paintProfileButton();
                toast('Nome salvo');
            } else {
                await api('/profiles', {method: 'POST', body: {name}});
                safeStorage.set('account', '');
                location.reload();
            }
        } catch (err) {
            toast(err.message);
        }
    };
    const use = $('#pf-use', sheet);
    if (use) use.onclick = () => switchProfile(profile.id);
    const del = $('#pf-del', sheet);
    if (del) del.onclick = async () => {
        const sync = state.sync && state.sync.configured ? ' Com o sync ligado, ele também vai para a lixeira nos seus outros aparelhos.' : '';
        if (!await confirmDialog(`Mover o perfil “${profile.name}” para a lixeira? Você pode restaurá-lo ou excluí-lo em Perfis › Lixeira.${sync}`, {okLabel: 'Mover para a lixeira', danger: false})) return;
        try {
            await api(`/profiles/${profile.id}`, {method: 'DELETE'});
            safeStorage.set('account', '');
            location.reload();
        } catch (err) {
            toast(err.message);
        }
    };
}

function openTrashedProfileSheet(profile) {
    const sheet = openSheet(`<h2>${esc(profile.name)}</h2>
        <p class="small muted sheet-sub">Está na lixeira de perfis desde ${new Date(profile.trashedAt).toLocaleDateString()}.</p>
        <div class="list">
            <button class="row" id="pt-restore"><span class="avatar" style="background:var(--surface-2)">${ico('upload')}</span><span class="grow title">Restaurar este perfil</span></button>
            <button class="row" id="pt-purge"><span class="avatar" style="background:var(--surface-2)">${ico('trash')}</span><span class="grow title expense">Excluir de vez</span></button>
        </div>`);
    $('#pt-restore', sheet).onclick = async () => {
        try {
            state.profiles = await api(`/profiles/${profile.id}/restore`, {method: 'POST'});
            closeSheet();
            renderProfilesPage();
            paintProfileButton();
            toast('Perfil restaurado');
        } catch (err) { toast(err.message); }
    };
    $('#pt-purge', sheet).onclick = async () => {
        const sync = state.sync && state.sync.configured ? ' Com o sync ligado, o perfil também será excluído dos outros aparelhos e da nuvem.' : '';
        if (!await confirmDialog(`Excluir permanentemente o perfil “${profile.name}”? Lançamentos, contas e backups serão apagados.${sync}`, {okLabel: 'Excluir de vez'})) return;
        try {
            state.profiles = await api(`/profiles/${profile.id}/purge`, {method: 'DELETE'});
            closeSheet();
            renderProfilesPage();
            toast('Perfil excluído');
        } catch (err) { toast(err.message); }
    };
}
