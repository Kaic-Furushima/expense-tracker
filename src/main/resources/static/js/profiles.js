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
            ? 'Cada perfil tem os seus próprios lançamentos, contas, categorias, orçamentos e backups, separados dos outros. A senha, se houver, vale para todos os perfis e quem abrir o app pode trocar de perfil.'
            : 'Cada perfil tem os seus próprios lançamentos, contas, categorias, orçamentos e backups, separados dos outros. Não há senha: quem abrir o app pode trocar de perfil.'}</p>
        <div class="list">${p.profiles.map(x => `<button class="row" data-profile="${x.id}">${profileAvatar(x)}
            <span class="grow"><span class="title">${esc(x.name)}</span>${x.id === p.current ? '<span class="small muted">Em uso agora</span>' : ''}</span>
            <span class="muted">${ico('pencil')}</span></button>`).join('')}
            ${p.canCreate ? `<button class="row" id="new-profile"><span class="avatar" style="background:var(--primary-soft)">${ico('plus')}</span><span class="grow title">Novo perfil</span></button>` : ''}
        </div>
        ${p.canCreate ? '' : '<p class="small muted">Vários perfis só funcionam com o banco embutido (H2).</p>'}</div>`;
    bindBack();
    $$('[data-profile]').forEach(b => b.onclick = () => openProfileSheet(p.profiles.find(x => x.id === b.dataset.profile)));
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
            ${profile ? '' : '<p class="small muted">O perfil novo começa vazio, com as categorias e formas de pagamento padrão, e você passa a usá-lo na hora.</p>'}
            <div class="form-actions">
                ${profile && !isMain ? '<button type="button" class="btn danger" id="pf-del">Remover</button>' : ''}
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
        const warning = window.localApp
            ? `Remover o perfil “${profile.name}”? Os lançamentos, contas e backups dele serão apagados deste aparelho. Faça um backup antes se quiser guardá-los.`
            : `Remover o perfil “${profile.name}”? Ele some do app, mas os dados ficam guardados numa pasta “.removido” dentro de profiles, na pasta de dados, e podem ser recuperados à mão.`;
        if (!await confirmDialog(warning, {okLabel: 'Remover'})) return;
        try {
            await api(`/profiles/${profile.id}`, {method: 'DELETE'});
            safeStorage.set('account', '');
            location.reload();
        } catch (err) {
            toast(err.message);
        }
    };
}
