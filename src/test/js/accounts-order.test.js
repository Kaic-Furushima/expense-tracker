// Order of the accounts when sorting by value (features.js, a browser script: each helper is read from its source and run
// in its own context, as in helpers.test.js). Run with: node --test src/test/js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js', 'features.js'), 'utf8');

function snippet(name) {
    const oneLine = new RegExp(`^const ${name} = .*$`, 'm').exec(source);
    if (oneLine) return oneLine[0];
    const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `${name} not found in features.js`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

function comparator(mode) {
    const context = vm.createContext({LOCALE: 'pt-BR', currencyCode: () => 'BRL', safeStorage: {get: key => (key === 'accountSort' ? mode : null)}, exports: {}});
    vm.runInContext(['byName', 'accountSortMode', 'manualOrder', 'accountComparator'].map(snippet).join('\n') + '\nexports.cmp = accountComparator();', context);
    return context.exports.cmp;
}

const account = (name, balance, currency) => ({name, balance, currency});

test('sorting by value: the main currency first, then each other currency in its own group, biggest balance first', () => {
    const list = [account('Wise', 500, 'USD'), account('Banco', 100, 'BRL'), account('Cofre', 900, 'BRL'),
        account('Euro', 50, 'EUR'), account('Carteira', 100, 'USD'), account('Poupanca', 300, 'BRL')];
    const names = list.sort(comparator('value')).map(a => a.name);
    assert.deepEqual(names.slice(0, 3), ['Cofre', 'Poupanca', 'Banco'], 'reais first, by value');
    // the other currencies come after, each one together (the order between groups does not matter)
    const rest = names.slice(3);
    assert.equal(rest.length, 3);
    const usd = rest.filter(n => ['Wise', 'Carteira'].includes(n));
    assert.deepEqual(usd, ['Wise', 'Carteira'], 'dollars by value');
    assert.ok(Math.abs(rest.indexOf('Wise') - rest.indexOf('Carteira')) === 1, 'dollar accounts stay together');
});

test('sorting by name does not care about the currency', () => {
    const list = [account('Wise', 500, 'USD'), account('Banco', 100, 'BRL')];
    assert.deepEqual(list.sort(comparator('name')).map(a => a.name), ['Banco', 'Wise']);
});
