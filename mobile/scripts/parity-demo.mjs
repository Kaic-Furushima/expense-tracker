// Conferencia (nao faz parte do app): os "dados de exemplo" do PC e do celular, lado a lado (bancos novos).
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
const PC = process.argv[2] ?? 'http://127.0.0.1:18080';
const SQL = await initSqlJs();
const mobile = createApi(new SQL.Database(), {clock: () => new Date(), newId: () => crypto.randomUUID()});
await fetch(PC + '/api/demo-data', {method: 'POST', headers: {Origin: PC}});
mobile.handle('POST', '/api/demo-data');
const pc = async url => (await fetch(PC + url, {headers: {Origin: PC}})).json();
const m = url => mobile.handle('GET', url).body;
const month = new Date().toISOString().slice(0, 7);
const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (['id', 'createdAt', 'updatedAt', 'accountId', 'categoryId', 'potId', 'paymentMethodId', 'recurringId', 'expenseId', 'categoryParentId', 'parentId'].includes(k) ? undefined : x)));
// a ordem das chaves do JSON e a ordem de listas sem ordenacao propria nao importam
const canon = v => (Array.isArray(v) ? v.map(canon).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
let bad = 0;
for (const url of ['/accounts', '/categories', '/payment-methods', '/tags', '/budgets', '/budgets/total', '/recurring', '/pots', '/wishes', '/templates', '/transfers',
    `/expenses?size=500`, `/api/summary?month=${month}`, `/recurring/occurrences?month=${month}`, '/api/settings']) {
    const a = canon(strip(await pc(url))), b = canon(strip(m(url)));
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) {
        bad++;
        const list = x => (Array.isArray(x) ? x : [x]);
        console.log(`\n## ${url}: pc=${list(a).length} itens, celular=${list(b).length} itens`);
        const names = x => list(x).map(i => i.name ?? i.date ?? JSON.stringify(i).slice(0, 40));
        const onlyPc = names(a).filter(n => !names(b).includes(n)), onlyMob = names(b).filter(n => !names(a).includes(n));
        if (onlyPc.length) console.log('  só no PC:', onlyPc.slice(0, 12).join(' | '));
        if (onlyMob.length) console.log('  só no celular:', onlyMob.slice(0, 12).join(' | '));
        if (!onlyPc.length && !onlyMob.length) console.log('  PC     :', sa.slice(0, 300), '\n  CELULAR:', sb.slice(0, 300));
    }
}
console.log(bad ? `\n${bad} listas diferentes` : 'Dados de exemplo idênticos.');
