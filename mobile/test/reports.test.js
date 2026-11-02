import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import {strFromU8, unzipSync, unzlibSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {createReportsHttp} from '../src/reports-http.js';

const SQL = await initSqlJs();
let n = 0;
let api;
let main;
let http;

const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const spend = (name, amount, date, extra = {}) => ok('POST', '/expenses', {name, amount, date, ...extra});
const get = (path, query = {}) => http.handle('GET', path, query);

/** Todo o texto desenhado num PDF do pdf-lib (descomprime os fluxos e le as cadeias hexadecimais dos comandos Tj). */
function pdfText(bytes) {
    const raw = Buffer.from(bytes).toString('latin1');
    const out = [];
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
        let content;
        try { content = Buffer.from(unzlibSync(Buffer.from(m[1], 'latin1'))).toString('latin1'); } catch { continue; }
        for (const t of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
            out.push(new TextDecoder('windows-1252').decode(Buffer.from(t[1], 'hex')));
        }
    }
    return out;
}

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `r-${++n}`});
    main = ok('GET', '/accounts')[0];
    http = createReportsHttp({reports: api.services.reports});
});

function populate() {
    const cats = ok('GET', '/categories');
    const food = cats.find(c => c.name === 'Alimentação');
    const market = cats.find(c => c.name === 'Mercado');
    const sub = ok('POST', '/categories', {name: 'Padaria', parentId: food.id});
    const wallet = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET'});
    spend('Salário', 3000, '2026-05-05', {type: 'INCOME'});
    spend('Mercado Extra', 300.5, '2026-05-06', {categoryId: market.id, tags: ['casa']});
    spend('Pão & café <manhã>', 20, '2026-05-07', {categoryId: sub.id, accountId: wallet.id});
    spend('Luz', 120, '2026-05-20', {status: 'PENDING'});
    spend('Freela', 400, '2026-05-25', {type: 'INCOME', status: 'PENDING'});
    spend('Abril', 99, '2026-04-30');
    const gone = spend('Apagada', 77, '2026-05-08');
    ok('DELETE', `/expenses/${gone.id}`);
    ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: wallet.id, amount: 50, date: '2026-05-09', description: 'Para a carteira'});
    return {wallet};
}

describe('dados do extrato', () => {
    it('totais so com o que esta pago; pendentes a parte; categorias do maior para o menor', () => {
        populate();
        const r = api.services.reports;
        const d = r.collect('2026-05-01', '2026-05-31');
        assert.deepEqual([d.income, d.expense, d.pendingIncome, d.pendingExpense], [300000, 32050, 40000, 12000]);
        assert.deepEqual(d.byCategory, [['Mercado', 30050], ['Alimentação › Padaria', 2000]]);
        assert.deepEqual(d.expenses.map(e => e.name), ['Salário', 'Mercado Extra', 'Pão & café <manhã>', 'Luz', 'Freela']);
        assert.equal(d.transfers.length, 1);
        assert.deepEqual([d.expenses[1].tags, d.expenses[2].account, d.expenses[3].category], [['casa'], 'Carteira', 'Sem categoria']);
    });

    it('filtra por conta (transferencias que entram ou saem dela)', () => {
        const {wallet} = populate();
        const r = api.services.reports;
        const d = r.collect('2026-05-01', '2026-05-31', wallet.id);
        assert.deepEqual(d.expenses.map(e => e.name), ['Pão & café <manhã>']);
        assert.equal(d.accountName, 'Carteira');
        assert.equal(d.transfers.length, 1);
        assert.equal(r.title(d), 'Extrato — Carteira');
        assert.throws(() => r.collect('2026-05-01', '2026-05-31', 999), e => e.status === 404);
    });

    it('periodo: mes, mes atual por padrao, so inicio = um mes, e limites', () => {
        const r = api.services.reports;
        assert.deepEqual(r.period({month: '2026-02'}), {from: '2026-02-01', to: '2026-02-28'});
        assert.deepEqual(r.period({}), {from: '2026-05-01', to: '2026-05-31'});
        assert.deepEqual(r.period({from: '2026-01-31'}), {from: '2026-01-31', to: '2026-02-27'});
        assert.deepEqual(r.period({from: '2026-03-10', to: '2026-03-20'}), {from: '2026-03-10', to: '2026-03-20'});
        assert.throws(() => r.period({month: 'maio'}), e => e.status === 400);
        assert.throws(() => r.period({from: '10/05/2026'}), e => e.status === 400);
        assert.throws(() => r.collect('2026-05-10', '2026-05-01'), e => e.status === 400);
        assert.throws(() => r.collect('2020-01-01', '2026-05-01'), e => e.message === 'O relatório pode cobrir no máximo 5 anos.');
    });
});

describe('planilha (.xlsx)', () => {
    async function book(query) {
        const res = await get('/reports/statement.xlsx', query);
        assert.equal(res.status, 200);
        assert.equal(res.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return Object.fromEntries(Object.entries(unzipSync(res.bytes)).map(([name, data]) => [name, strFromU8(data)]));
    }

    it('abas, valores, datas, formula e escape de XML', async () => {
        populate();
        const files = await book({month: '2026-05'});
        assert.deepEqual(Object.keys(files).slice(0, 1), ['[Content_Types].xml']);
        assert.match(files['xl/workbook.xml'], /<sheet name="Resumo" sheetId="1"[\s\S]*name="Lançamentos" sheetId="2"[\s\S]*name="Transferências" sheetId="3"/);
        const summary = files['xl/worksheets/sheet1.xml'];
        assert.match(summary, /Extrato/);
        assert.match(summary, /<c r="B4" s="3"><v>3000<\/v><\/c>/); // receitas pagas
        assert.match(summary, /<c r="B5" s="3"><v>320.5<\/v><\/c>/); // despesas pagas
        assert.match(summary, /Alimentação › Padaria/);
        const list = files['xl/worksheets/sheet2.xml'];
        assert.match(list, /Pão &amp; café &lt;manhã&gt;/);
        assert.match(list, /<c r="A2" s="2"><v>46147<\/v><\/c>/); // 05/05/2026 como serie do Excel
        assert.match(list, /<c r="G3" s="3"><v>-300.5<\/v><\/c>/); // despesa negativa
        assert.match(list, /<f>SUMIF\(H2:H6,&quot;Pago&quot;,G2:G6\)<\/f><v>2679.5<\/v>/);
        assert.match(files['xl/worksheets/sheet3.xml'], /Para a carteira/);
        assert.ok(files['xl/styles.xml'].includes('<cellXfs count="8">'));
    });

    it('periodo vazio gera as abas sem formula', async () => {
        const files = await book({month: '2025-01'});
        assert.ok(!files['xl/worksheets/sheet2.xml'].includes('<f>'));
    });
});

describe('PDF', () => {
    async function pdf(query) {
        const res = await get('/reports/statement.pdf', query);
        assert.equal(res.status, 200);
        assert.equal(res.contentType, 'application/pdf');
        assert.equal(Buffer.from(res.bytes.slice(0, 5)).toString(), '%PDF-');
        return res.bytes;
    }

    it('abre, tem titulo e traz resumo, categorias, lancamentos e transferencias', async () => {
        populate();
        const bytes = await pdf({month: '2026-05'});
        const doc = await PDFDocument.load(bytes);
        assert.equal(doc.getPageCount(), 1);
        assert.equal(doc.getTitle(), 'Extrato');
        assert.equal(doc.getCreator(), 'Expense Tracker');
        const text = pdfText(bytes).join('\n').replace(/ /g, ' ');
        for (const piece of ['Extrato', 'Período: 01/05/2026 a 31/05/2026 · gerado em 15/05/2026', 'Receitas', 'R$ 3.000,00', 'R$ 320,50',
            'Saldo do período', 'R$ 2.679,50', 'Ainda a pagar: R$ 120,00 · ainda a receber: R$ 400,00 (não entram nos totais acima)',
            'Despesas por categoria', 'Mercado', 'Alimentação › Padaria', '94%', '6%', 'Lançamentos (5)', 'Luz (a pagar)', 'Freela (a receber)',
            'Mercado Extra #casa', '+ R$ 3.000,00', '- R$ 300,50', 'Transferências entre contas (não entram nos totais)',
            'Conta principal -> Carteira', 'Expense Tracker · página 1']) {
            assert.ok(text.includes(piece), `faltou "${piece}" em:\n${text}`);
        }
        assert.ok(!text.includes('Apagada') && !text.includes('Abril'));
    });

    it('titulo com a conta; periodo sem lancamentos', async () => {
        const {wallet} = populate();
        assert.ok(pdfText(await pdf({month: '2026-05', accountId: String(wallet.id)})).join('\n').includes('Extrato — Carteira'));
        const empty = pdfText(await pdf({month: '2025-01'})).join('\n');
        assert.ok(empty.includes('Nenhum lançamento neste período.') && empty.includes('Lançamentos (0)'));
        assert.ok(!empty.includes('Ainda a pagar'));
    });

    it('muitas linhas: varias paginas, cabecalho repetido e rodape numerado', async () => {
        for (let i = 0; i < 120; i++) spend(`Compra número ${i}`, 10 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')}`, {description: 'x'});
        const bytes = await pdf({month: '2026-05'});
        const pages = (await PDFDocument.load(bytes)).getPageCount();
        assert.ok(pages >= 3, `esperava varias paginas, veio ${pages}`);
        const text = pdfText(bytes);
        const headers = text.filter(t => t === 'Descrição').length;
        assert.equal(headers, pages); // um cabecalho de tabela em cada pagina
        assert.ok(text.includes(`Expense Tracker · página ${pages}`));
        assert.equal(text.filter(t => /^Compra número \d+$/.test(t)).length, 120);
    });

    it('nome muito longo quebra em linhas; caracteres fora do Windows-1252 viram "?"', async () => {
        spend('Palavra' + 'x'.repeat(100) + ' fim', 5, '2026-05-02');
        spend('日本語 ✓ → ok', 6, '2026-05-03');
        const text = pdfText(await pdf({month: '2026-05'})).join('\n');
        assert.ok(text.includes('fim'));
        assert.ok(text.includes('??? ? -> ok'));
    });

    it('segue o idioma do app', async () => {
        populate();
        ok('PUT', '/app/language', {language: 'en'});
        const text = pdfText(await pdf({month: '2026-05'})).join('\n');
        for (const piece of ['Statement', 'Period: 01/05/2026 to 31/05/2026', 'Income', 'Balance for the period', 'Entries (5)', 'Luz (to pay)', 'Expense Tracker · page 1']) {
            assert.ok(text.includes(piece), `faltou "${piece}"`);
        }
    });
});

describe('rota', () => {
    it('so atende /reports/statement.pdf|xlsx; outros caminhos passam adiante', async () => {
        assert.equal(await get('/expenses'), null);
        assert.equal(await get('/reports/other'), null);
        await assert.rejects(get('/reports/statement.doc'), e => e.status === 404);
        await assert.rejects(http.handle('POST', '/reports/statement.pdf', {}), e => e.status === 405);
        await assert.rejects(get('/reports/statement.pdf', {from: '2026-05-10', to: '2026-05-01'}), e => e.status === 400);
        await assert.rejects(get('/reports/statement.xlsx', {accountId: '999'}), e => e.status === 404);
    });

    it('de ate: o proprio dia e aceito; sem parametros, o mes atual', async () => {
        spend('Hoje', 1, '2026-05-15');
        assert.equal((await get('/reports/statement.xlsx', {from: '2026-05-15', to: '2026-05-15'})).status, 200);
        assert.equal((await get('/reports/statement.pdf')).status, 200);
    });
});
