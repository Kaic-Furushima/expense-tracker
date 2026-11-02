// Unit tests for the pure helpers of the front end (T6). app.js is a browser script, so each helper is read from its
// source and run in its own context. Run with: node --test src/test/js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js', 'app.js'), 'utf8');

/** The source of a top-level helper: a one-line function or const, or a function up to its closing brace. */
function snippet(name) {
    const oneLine = new RegExp(`^const ${name} = .*$`, 'm').exec(source);
    if (oneLine) return oneLine[0];
    const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} not found in app.js`);
    const lineEnd = source.indexOf('\n', start);
    if (source.slice(start, lineEnd).trimEnd().endsWith('}')) return source.slice(start, lineEnd);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

/** Runs the named helpers in a fresh context and returns them (const helpers are only visible through an export). */
function load(names, globals = {}) {
    const context = vm.createContext({LANG: 'pt', LOCALE: 'pt-BR', catById: () => null, exports: {}, ...globals});
    const exported = names.map(name => `exports.${name} = ${name};`);
    vm.runInContext([...names.map(snippet), ...exported].join('\n'), context);
    return context.exports;
}

const helpers = load(['esc', 'cap', 'parseAmount', 'monthLabel', 'dayLabel', 'catLabel']);

test('parseAmount reads Brazilian, plain and negative numbers', () => {
    assert.equal(helpers.parseAmount('1.234,56'), 1234.56);
    assert.equal(helpers.parseAmount('1234,5'), 1234.5);
    assert.equal(helpers.parseAmount('1234.56'), 1234.56);
    assert.equal(helpers.parseAmount('R$ -10'), -10);
    assert.equal(helpers.parseAmount('abc'), 0, 'letras são ignoradas');
});

test('parseAmount reads English thousands when the app is in English', () => {
    const english = load(['parseAmount'], {LANG: 'en'});
    assert.equal(english.parseAmount('1,234'), 1234);
    assert.equal(english.parseAmount('1,234.5'), 1234.5);
});

test('esc escapes the characters that would break out of HTML', () => {
    assert.equal(helpers.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(helpers.esc(null), '');
});

test('monthLabel shows the month name capitalised, with the year', () => {
    assert.equal(helpers.monthLabel('2026-11'), 'Novembro 2026');
});

test('dayLabel shows the weekday, day and month without dots', () => {
    const label = helpers.dayLabel('2026-11-01');
    assert.match(label, /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/);
    assert.match(label, /01/);
    assert.doesNotMatch(label, /\./);
});

test('catLabel shows the parent before a subcategory', () => {
    const withParents = load(['catLabel'], {catById: id => (id === 1 ? {name: 'Pai'} : null)});
    assert.equal(withParents.catLabel({name: 'Filho', parentId: 1}), 'Pai › Filho');
    assert.equal(withParents.catLabel({name: 'Solta', parentId: null}), 'Solta');
    assert.equal(withParents.catLabel(null), 'Sem categoria');
});
