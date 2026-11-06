// Tests of the colour helpers used by the colour picker and the home card (features.js, a browser script: each helper
// is read from its source and run in its own context, as in helpers.test.js). Run with: node --test src/test/js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js', 'features.js'), 'utf8');

function snippet(name) {
    const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} not found in features.js`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

const context = vm.createContext({exports: {}});
vm.runInContext(['const HEX_RE = /^#[0-9a-f]{6}$/i;', snippet('normalizeHex'), snippet('readableOn'),
    'exports.normalizeHex = normalizeHex; exports.readableOn = readableOn;'].join('\n'), context);
const {normalizeHex, readableOn} = context.exports;

test('normalizeHex accepts the usual ways of typing a colour', () => {
    assert.equal(normalizeHex('#2f7d6d'), '#2F7D6D');
    assert.equal(normalizeHex('2F7D6D'), '#2F7D6D');
    assert.equal(normalizeHex(' abc '), '#AABBCC');
    assert.equal(normalizeHex('#abc'), '#AABBCC');
});

test('normalizeHex rejects what is not a colour', () => {
    for (const bad of ['', null, undefined, '#12', '#12345', 'xyz', '#GGGGGG', 'red']) assert.equal(normalizeHex(bad), '');
});

test('readableOn picks dark text on light colours and white on dark ones', () => {
    assert.equal(readableOn('#FFFFFF'), '#10231e');
    assert.equal(readableOn('#FFB74D'), '#10231e');
    assert.equal(readableOn('#000000'), '#fff');
    assert.equal(readableOn('#212121'), '#fff');
    assert.equal(readableOn('not a colour'), '#fff');
});
