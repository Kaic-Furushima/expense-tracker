'use strict';

/* Dropdown próprio no lugar da lista padrão do <select> (no Android ela é desenhada pelo sistema).
   Cada <select> continua na página, escondido, como fonte do valor: o resto do código lê `.value`, escuta `change` e
   troca as opções como sempre. Aqui só se desenha o botão e a folha com as opções, e os dois são mantidos em sincronia.
   Carregado depois de icons.js (usa ico) e antes dos demais: os selects criados depois são pegos pelo observer. */
(() => {
    const SEARCH_FROM = 8; // a partir de quantas opções aparece o campo de busca
    const CHEVRON = '<svg class="i pick-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const plain = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const CREATE_LABELS = {account: 'Nova conta', method: 'Nova forma de pagamento'};
    let open = null; // {root, select, opener}

    const buttonOf = select => select.nextElementSibling && select.nextElementSibling.classList.contains('pick') ? select.nextElementSibling : null;
    const titleOf = select => {
        const label = select.id && document.querySelector(`label[for="${select.id}"]`);
        return (label && label.textContent.trim()) || select.getAttribute('aria-label') || '';
    };

    function sync(select) {
        const button = buttonOf(select);
        if (!button) return;
        const option = select.options[select.selectedIndex];
        const text = option ? option.textContent.trim() : '';
        const span = button.querySelector('.pick-text');
        span.textContent = text || ' ';
        button.classList.toggle('pick-empty', !option || option.value === '');
        button.disabled = select.disabled;
    }

    function enhance(select) {
        if (select.dataset.pick || select.multiple || select.size > 1) return;
        select.dataset.pick = '1';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pick';
        button.setAttribute('aria-haspopup', 'listbox');
        button.innerHTML = `<span class="pick-text"></span>${CHEVRON}`;
        const title = titleOf(select);
        if (title) button.setAttribute('aria-label', title);
        button.addEventListener('click', () => openPicker(select, button));
        select.insertAdjacentElement('afterend', button);
        select.classList.add('pick-native');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        sync(select);
    }

    function scan(node) {
        if (node.nodeType !== 1) return;
        if (node.matches('select')) enhance(node);
        node.querySelectorAll('select').forEach(enhance);
    }

    function closePicker(focusBack = true) {
        if (!open) return;
        const {root, opener} = open;
        open = null;
        root.remove();
        if (focusBack && opener && document.body.contains(opener)) opener.focus();
    }

    function choose(select, value) {
        closePicker();
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event('input', {bubbles: true}));
        select.dispatchEvent(new Event('change', {bubbles: true}));
    }

    function openPicker(select, opener) {
        if (open || select.disabled) return;
        const options = [...select.options];
        const title = titleOf(select);
        const root = document.createElement('div');
        root.className = 'overlay pick-overlay';
        root.innerHTML = `<div class="sheet pick-sheet" role="dialog" aria-modal="true"${title ? ` aria-label="${esc(title)}"` : ''}>
            <div class="grab"></div>
            ${title ? `<h2>${esc(title)}</h2>` : ''}
            ${options.length >= SEARCH_FROM ? `<input type="search" class="pick-search" placeholder="Buscar" aria-label="Buscar" autocomplete="off">` : ''}
            <div class="pick-list" role="listbox">${options.map((o, i) => `<button type="button" class="pick-item${o.selected ? ' on' : ''}" role="option"
                aria-selected="${o.selected}" data-i="${i}"${o.disabled ? ' disabled' : ''}><span>${esc(o.textContent.trim() || ' ')}</span>${o.selected ? ico('check') : ''}</button>`).join('')}</div>
            <p class="pick-none small muted" hidden>Nada encontrado</p>
            ${select.dataset.create && window.quickCreateFor ? `<button type="button" class="pick-create">${ico('plus')}<span>${esc(CREATE_LABELS[select.dataset.create] || 'Novo')}</span></button>` : ''}
        </div>`;
        document.body.appendChild(root);
        open = {root, select, opener};

        const items = () => [...root.querySelectorAll('.pick-item:not([hidden])')].filter(b => !b.disabled);
        const search = root.querySelector('.pick-search');
        root.addEventListener('mousedown', e => { if (e.target === root) closePicker(); });
        root.querySelector('.pick-list').addEventListener('click', e => {
            const item = e.target.closest('.pick-item');
            if (item) choose(select, options[Number(item.dataset.i)].value);
        });
        const create = root.querySelector('.pick-create');
        if (create) create.addEventListener('click', () => { closePicker(false); window.quickCreateFor(select); });
        if (search) {
            search.addEventListener('input', () => {
                const term = plain(search.value.trim());
                let shown = 0;
                root.querySelectorAll('.pick-item').forEach(b => {
                    const hit = !term || plain(b.textContent).includes(term);
                    b.hidden = !hit;
                    if (hit) shown++;
                });
                root.querySelector('.pick-none').hidden = shown > 0;
            });
        }
        const current = root.querySelector('.pick-item.on');
        if (current) current.scrollIntoView({block: 'center'});
        // em tela de toque o teclado não deve pular na frente da lista
        if (search && window.matchMedia('(pointer: fine)').matches) search.focus();
        else (current || items()[0] || root.querySelector('.sheet')).focus?.();
    }

    /* Enquanto a lista está aberta, o teclado é só dela: Esc fecha só ela, Tab fica dentro, setas andam pelas opções,
       e nenhum atalho da tela de trás (Ctrl+N, Esc que fecha o formulário) dispara. */
    document.addEventListener('keydown', e => {
        if (!open) return;
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('pick-search')) {
            e.preventDefault();
            const first = open.root.querySelector('.pick-item:not([hidden]):not(:disabled)');
            if (first) first.click();
            return;
        }
        const items = [...open.root.querySelectorAll('.pick-item:not([hidden])')].filter(b => !b.disabled);
        const focusable = [...open.root.querySelectorAll('.pick-search, .pick-item:not([hidden])')].filter(el => !el.disabled);
        const at = focusable.indexOf(document.activeElement);
        if (e.key === 'Tab' && focusable.length) {
            e.preventDefault();
            focusable[(at + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
            e.preventDefault();
            const i = items.indexOf(document.activeElement);
            const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
            items[next].focus();
        }
    }, true);

    // `select.value = x` não dispara evento: o botão precisa acompanhar também as trocas feitas pelo código.
    for (const prop of ['value', 'selectedIndex']) {
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
        if (!desc || !desc.set) continue;
        Object.defineProperty(HTMLSelectElement.prototype, prop, {
            configurable: true,
            enumerable: desc.enumerable,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, v); sync(this); }
        });
    }

    new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'attributes') { if (m.target.tagName === 'SELECT') sync(m.target); continue; }
            const target = m.target.nodeType === 1 ? m.target.closest('select') : null;
            if (target) sync(target); // opções trocadas
            m.addedNodes.forEach(scan);
        }
    }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['disabled']});

    scan(document.body);
})();
