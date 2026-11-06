// Conferencia (nao faz parte do app): importacao de extratos no PC (Java) e no celular com os mesmos arquivos.
import {readFileSync} from 'node:fs';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';

const PC = process.argv[2] ?? 'http://127.0.0.1:18080';
const SQL = await initSqlJs();
const mobile = createApi(new SQL.Database(), {clock: () => new Date(), newId: () => crypto.randomUUID()});
const src = readFileSync(new URL('../test/import.test.js', import.meta.url), 'utf8');
const start = src.indexOf("const OFX = `") + 13;
const ofx = src.slice(start, src.indexOf("`;", start));
const inputs = {
    OFX: ofx,
    'CSV banco': 'Extrato da conta;;\nPeriodo: maio;;\n\nData;Histórico;Valor\n02/05/2026;Mercado Extra;-1.234,56\n05/05/2026;Salário;5.000,00\nTotal;;3.765,44\n',
    'CSV cartão': 'data,descricao,valor\n2026-05-03,Netflix,39.90\n2026-05-04,Uber,22.10\n',
    'CSV do app': 'data;tipo;nome;categoria;valor;conta;conta_destino;forma_pagamento;situacao;tags;descricao\n2026-05-01;EXPENSE;"Luz";"Casa";100.00;"Conta principal";;;PAGO;"a b";"obs"\n2026-05-02;INCOME;"Pix";"";50.00;"Conta principal";;;A_RECEBER;"";\n'
};
const post = async (side, url, body) => {
    if (side === 'pc') {
        const r = await fetch(PC + url, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: PC}, body: JSON.stringify(body)});
        const t = await r.text();
        return {status: r.status, body: t ? JSON.parse(t) : null};
    }
    try { const r = mobile.handle('POST', url, body); return {status: r.status, body: r.body}; } catch (e) { return {status: 'ERRO ' + e.message}; }
};
const accPc = (await (await fetch(PC + '/accounts')).json())[0].id;
const accMob = mobile.handle('GET', '/accounts').body[0].id;
const strip = v => JSON.stringify(v, (k, x) => (['accountId'].includes(k) ? undefined : x));
let bad = 0;
for (const [name, content] of Object.entries(inputs)) {
    const a = await post('pc', '/import/preview', {content, accountId: accPc});
    const b = await post('mob', '/import/preview', {content, accountId: accMob});
    const same = a.status === b.status && strip(a.body) === strip(b.body);
    if (!same) {
        bad++;
        console.log(`\n## ${name}: status pc=${a.status} celular=${b.status}`);
        console.log('PC     :', strip(a.body)?.slice(0, 700));
        console.log('CELULAR:', strip(b.body)?.slice(0, 700));
    }
}
console.log(bad ? `\n${bad} entrada(s) diferente(s)` : 'Importação: previews idênticos nos dois lados.');
