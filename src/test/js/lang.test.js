// Checks of the translation table (lang.js): every entry is well formed, and the fixed messages that the code shows
// (toast, confirmDialog, tip) have an entry, so they are not left in Portuguese in English or Spanish.
// Run with: node --test src/test/js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const jsDir = path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js');
const sandbox = {};
new vm.Script(fs.readFileSync(path.join(jsDir, 'lang.js'), 'utf8').replace('const I18N_ENTRIES', 'globalThis.__E')).runInNewContext(sandbox);
const entries = sandbox.__E;
const texts = entries.filter(e => typeof e[0] === 'string');
const placeholders = s => (String(s).match(/\{\d*\}/g) || []).length;

test('every entry has Portuguese, English and Spanish text', () => {
    for (const [pt, en, es] of texts) {
        assert.ok(pt && en && es, `incomplete entry: ${pt}`);
    }
});

test('the three languages have the same number of changing parts', () => {
    for (const [pt, en, es] of texts) {
        assert.equal(placeholders(en), placeholders(pt), `English: ${pt}`);
        assert.equal(placeholders(es), placeholders(pt), `Spanish: ${pt}`);
    }
});

test('the same Portuguese text is not translated in two different ways', () => {
    const seen = new Map();
    for (const [pt, en, es] of texts) {
        const value = `${en}|${es}`;
        assert.ok(!seen.has(pt) || seen.get(pt) === value, `translated twice: ${pt}`);
        seen.set(pt, value);
    }
});

test('fixed messages shown by toast, confirmDialog and tip have a translation', () => {
    const known = new Set(texts.map(e => e[0]));
    const patterns = texts.filter(e => e[0].includes('{}')).map(e => new RegExp('^' + e[0].split('{}').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?') + '$', 's'));
    const covered = text => known.has(text) || patterns.some(p => p.test(text));
    const missing = [];
    for (const file of ['app.js', 'features.js', 'extras.js', 'tools.js', 'profiles.js']) {
        const code = fs.readFileSync(path.join(jsDir, file), 'utf8');
        // a plain quoted text right after the call, e.g. toast('Conta salva') or tip('id', 'Texto…'); templates with ${} are skipped
        const re = /\b(?:toast|confirmDialog|tip)\((?:'[a-z-]+',\s*)?'((?:[^'\\\n]|\\.)+)'/g;
        for (let m; (m = re.exec(code));) {
            const text = m[1].replace(/\\'/g, "'");
            if (!/^[a-z-]+$/.test(text) && /\p{L}{3}/u.test(text) && !covered(text)) missing.push(`${file}: ${text}`);
        }
    }
    assert.deepEqual(missing, []);
});
