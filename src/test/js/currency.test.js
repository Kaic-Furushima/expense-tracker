// Tests of the money helpers that know about accounts in different currencies (app.js, a browser script: each helper is
// read from its source and run in its own context, as in helpers.test.js). Run with: node --test src/test/js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js', 'app.js'), 'utf8');

function snippet(name) {
    const oneLine = new RegExp(`^const ${name} = .*$`, 'm').exec(source);
    if (oneLine) return oneLine[0];
    const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} not found in app.js`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

function load(state) {
    const context = vm.createContext({LOCALE: 'pt-BR', Intl, state, exports: {}});
    const names = ['currencyCode', 'currencyFormat', 'viewCurrency', 'money', 'currencySymbol', 'currencyOfAccount'];
    vm.runInContext(['const currencyFormats = {};', ...names.map(snippet), `exports.api = {${names.join(', ')}};`].join('\n'), context);
    return context.exports.api;
}

const accounts = [{id: 1, name: 'Banco', currency: 'BRL'}, {id: 2, name: 'Wise', currency: 'USD'}];
const clean = text => text.replace(/\s/g, ' ');

test('money formats in the given currency, or in the main one', () => {
    const {money} = load({settings: {currency: 'BRL'}, accounts, tab: 'home', sub: null, accountFilter: null});
    assert.equal(clean(money(1234.5)), 'R$ 1.234,50');
    assert.equal(clean(money(50, 'USD')), 'US$ 50,00');
});

test('the view takes the currency of the account being filtered, only on the home and entries screens', () => {
    const state = {settings: {currency: 'BRL'}, accounts, tab: 'home', sub: null, accountFilter: 2};
    const api = load(state);
    assert.equal(api.viewCurrency(), 'USD');
    assert.equal(clean(api.money(10)), 'US$ 10,00');
    state.tab = 'budgets'; // budgets always look at the main currency
    assert.equal(api.viewCurrency(), 'BRL');
    state.tab = 'transactions'; state.sub = 'accounts';
    assert.equal(api.viewCurrency(), 'BRL');
});

test('an account the app does not know falls back to the main currency', () => {
    const api = load({settings: {currency: 'EUR'}, accounts, tab: 'home', sub: null, accountFilter: null});
    assert.equal(api.currencyOfAccount(999), 'EUR');
    assert.equal(api.currencyOfAccount(2), 'USD');
});
