'use strict';

/* Language of the screens (Portuguese, English or Spanish).
   The code writes its texts in Portuguese; for the other languages everything that reaches the page (text, placeholders,
   titles) is translated by looking the Portuguese text up in lang.js. Texts with changing parts are written there with
   "{}" for each changing part, e.g. ['Vence em {}', 'Due {}', 'Vence el {}']. What is not in the table stays as it is.
   Loaded first: app.js and the others use LANG, LOCALE and T(). */

const LANGS = ['pt', 'en', 'es'];
const LANG = (() => {
    try {
        const saved = localStorage.getItem('lang');
        return LANGS.includes(saved) ? saved : 'pt';
    } catch (e) {
        return 'pt';
    }
})();
const LOCALE = {pt: 'pt-BR', en: 'en-US', es: 'es-ES'}[LANG];
document.documentElement.lang = {pt: 'pt-BR', en: 'en', es: 'es'}[LANG];

/** Texts the table does not know yet (only filled for English and Spanish; used to find what is left to translate). */
const I18N_MISSING = new Set();

const T = (() => {
    if (LANG === 'pt' || typeof I18N_ENTRIES === 'undefined') return text => text;
    const column = LANG === 'en' ? 1 : 2;
    const exact = new Map();
    const patterns = [];
    for (const entry of I18N_ENTRIES) {
        const key = entry[0];
        const value = entry[column] == null ? entry[0] : entry[column];
        if (key instanceof RegExp) {
            patterns.push({regex: key, value, size: key.source.length + 1000});
        } else if (key.includes('{}')) {
            const source = key.split('{}').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)');
            patterns.push({regex: new RegExp(`^${source}$`, 's'), value, size: key.length});
        } else {
            exact.set(key, value);
        }
    }
    patterns.sort((a, b) => b.size - a.size);

    const translate = (text, depth) => {
        if (exact.has(text)) return exact.get(text);
        for (const p of patterns) {
            const m = p.regex.exec(text);
            if (!m) continue;
            let next = 0;
            return p.value.replace(/\{(\d*)\}/g, (all, n) => {
                const piece = m[n ? Number(n) : ++next];
                if (piece == null) return '';
                const inner = piece.trim();
                return depth < 3 && inner ? piece.replace(inner, () => translate(inner, depth + 1)) : piece;
            });
        }
        if (text.includes(' · ')) {
            const parts = text.split(' · ');
            const done = parts.map(part => translate(part, depth + 1));
            if (done.some((d, i) => d !== parts[i])) return done.join(' · ');
        }
        return text;
    };

    return text => {
        if (typeof text !== 'string') return text;
        const trimmed = text.trim();
        if (!trimmed) return text;
        const out = translate(trimmed, 0);
        if (out === trimmed && /\p{L}{2}/u.test(trimmed)) I18N_MISSING.add(trimmed);
        return out === trimmed ? text : text.replace(trimmed, () => out);
    };
})();

if (LANG !== 'pt') {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
    const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
    const lastOutput = new WeakMap();

    const textNode = node => {
        if (!node.parentNode || SKIP.has(node.parentNode.nodeName)) return;
        if (lastOutput.get(node) === node.data) return;
        const out = T(node.data);
        if (out !== node.data) {
            node.data = out;
            lastOutput.set(node, out);
        }
    };
    const attrOutput = new WeakMap();
    const attributes = el => {
        for (const name of ATTRS) {
            if (!el.hasAttribute || !el.hasAttribute(name)) continue;
            const value = el.getAttribute(name);
            const done = attrOutput.get(el) || {};
            if (done[name] === value) continue;
            const out = T(value);
            if (out !== value) {
                el.setAttribute(name, out);
                done[name] = out;
                attrOutput.set(el, done);
            }
        }
    };
    const tree = root => {
        if (root.nodeType === Node.TEXT_NODE) return textNode(root);
        if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.nodeName)) return;
        attributes(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === Node.TEXT_NODE) textNode(node);
            else attributes(node);
        }
    };

    new MutationObserver(records => {
        for (const r of records) {
            if (r.type === 'childList') r.addedNodes.forEach(tree);
            else if (r.type === 'characterData') textNode(r.target);
            else if (r.type === 'attributes') attributes(r.target);
        }
    }).observe(document.documentElement, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS
    });
    document.title = T(document.title);
    // the page is parsed before this runs only up to this script; the rest is picked up by the observer
    document.addEventListener('DOMContentLoaded', () => tree(document.body));

    const nativeConfirm = window.confirm.bind(window);
    const nativeAlert = window.alert.bind(window);
    window.confirm = message => nativeConfirm(T(message));
    window.alert = message => nativeAlert(T(message));
}
