import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {parseAmount, parseCsv, parseDate} from '../src/local-api/import.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;
let api;
let main;

const newApi = () => createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `m-${++n}`});
const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const preview = (content, extra = {}) => call('POST', '/import/preview', {content, accountId: main.id, ...extra});
const okPreview = (content, extra) => {
    const res = preview(content, extra);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
};
const spend = (name, amount, date, extra = {}) => ok('POST', '/expenses', {name, amount, date, ...extra});

beforeEach(() => {
    api = newApi();
    main = ok('GET', '/accounts')[0];
});

describe('valores', () => {
    it('numeros em varios formatos', () => {
        const cases = {'1.234,56': 1234.56, '1234,56': 1234.56, '-45.90': -45.9, 'R$ 12,00': 12, 'R$ -7,50': -7.5, '(12,00)': -12, '12,00-': -12,
            '1.234.567': 1234567, '1,234.56': 1234.56, '0,005': 0.01, '+5': 5, '  7  ': 7, '1 234,50': 1234.5};
        for (const [text, value] of Object.entries(cases)) assert.equal(parseAmount(text), value, text);
        for (const text of ['abc', '', '  ', null, '12a', '1.2.3,4,5', '--5']) assert.equal(parseAmount(text), null, String(text));
    });

    it('datas em varios formatos', () => {
        for (const text of ['15/05/2026', '2026-05-15', '15-05-2026', '15/05/26', '2026/05/15', '15.05.2026', '5/5/2026', '15/05/2026 10:30', '2026-05-15T10:00:00']) {
            assert.equal(parseDate(text), text === '5/5/2026' ? '2026-05-05' : '2026-05-15', text);
        }
        for (const text of ['31/02/2026', '32/01/2026', 'maio', '', null, '2026']) assert.equal(parseDate(text), null, String(text));
    });

    it('CSV com aspas, separador dentro da celula e quebra de linha', () => {
        const table = parseCsv('a;b;c\n"x;y";"diz ""oi""";"linha1\nlinha2"\r\n1;2;3');
        assert.deepEqual(table, [['a', 'b', 'c'], ['x;y', 'diz "oi"', 'linha1\nlinha2'], ['1', '2', '3']]);
        assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
        assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
    });
});

const OFX = `OFXHEADER:100
DATA:OFXSGML

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260502120000[-3:BRT]<TRNAMT>-45,90<MEMO>UBER *TRIP 1234</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260505<TRNAMT>3000.00<NAME>EMPRESA LTDA<MEMO>Pagamento de salario</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT><DTPOSTED>20260506<TRNAMT>-12.00<NAME>PADARIA CENTRAL
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>invalida<TRNAMT>-1.00<MEMO>sem data
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260507<TRNAMT>0.00<MEMO>zerada
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('extrato OFX', () => {
    it('le data, valor, sinal e descricao (memo antes do nome)', () => {
        const p = okPreview(OFX);
        assert.equal(p.format, 'OFX');
        assert.deepEqual(p.rows.map(r => [r.line, r.date, r.type, r.name, r.amount, r.kind, r.status]), [
            [1, '2026-05-02', 'EXPENSE', 'UBER *TRIP 1234', 45.9, 'TRANSACTION', 'PAID'],
            [2, '2026-05-05', 'INCOME', 'Pagamento de salario', 3000, 'TRANSACTION', 'PAID'],
            [3, '2026-05-06', 'EXPENSE', 'PADARIA CENTRAL', 12, 'TRANSACTION', 'PAID']]);
        assert.equal(p.duplicates, 0);
    });

    it('inverter troca entradas e saidas', () => {
        assert.deepEqual(okPreview(OFX, {invertSigns: true}).rows.map(r => r.type), ['INCOME', 'EXPENSE', 'INCOME']);
    });

    it('exige conta de destino valida; arquivo vazio e sem lancamentos sao recusados', () => {
        assert.equal(call('POST', '/import/preview', {content: OFX}).body.detail, 'Escolha a conta que vai receber os lançamentos.');
        assert.equal(call('POST', '/import/preview', {content: OFX, accountId: 99}).status, 404);
        assert.equal(preview('   ').body.detail, 'O arquivo está vazio.');
        assert.equal(preview('<OFX></OFX>').body.detail, 'Não encontrei nenhum lançamento neste arquivo.');
    });
});

describe('CSV de banco ou cartao', () => {
    it('extrato com titulo, separador ; e valores brasileiros', () => {
        const csv = `Extrato da conta;;\nPeriodo: maio;;\n\nData;Histórico;Valor\n02/05/2026;Mercado Extra;-1.234,56\n05/05/2026;Salário;5.000,00\nTotal;;3.765,44\n`;
        const p = okPreview(csv);
        assert.equal(p.format, 'BANK_CSV');
        assert.deepEqual(p.rows.map(r => [r.line, r.date, r.type, r.name, r.amount]), [
            [5, '2026-05-02', 'EXPENSE', 'Mercado Extra', 1234.56], [6, '2026-05-05', 'INCOME', 'Salário', 5000]]);
    });

    it('fatura de cartao so com valores positivos: tudo e compra', () => {
        const p = okPreview('date,title,amount\n2026-05-01,Netflix,39.90\n2026-05-02,Uber,12.50\n');
        assert.deepEqual(p.rows.map(r => [r.type, r.amount]), [['EXPENSE', 39.9], ['EXPENSE', 12.5]]);
        assert.deepEqual(okPreview('date,title,amount\n2026-05-01,Netflix,39.90\n', {invertSigns: true}).rows.map(r => r.type), ['INCOME']);
    });

    it('colunas separadas de credito e debito', () => {
        const p = okPreview('Data;Descrição;Crédito;Débito\n01/05/2026;Salário;3.000,00;\n02/05/2026;Aluguel;;1.000,00\n03/05/2026;Nada;;\n');
        assert.deepEqual(p.rows.map(r => [r.name, r.type, r.amount]), [['Salário', 'INCOME', 3000], ['Aluguel', 'EXPENSE', 1000]]);
    });

    it('sem colunas de data e valor, explica o que falta', () => {
        assert.match(preview('nome;idade\nAna;30').body.detail, /^Não reconheci as colunas deste arquivo/);
        assert.equal(preview('data;valor\nnada;aqui').body.detail, 'Não encontrei nenhum lançamento neste arquivo.');
    });

    it('descricao em branco vira "Sem descricao"', () => {
        assert.equal(okPreview('data;valor\n01/05/2026;-5,00').rows[0].name, 'Sem descrição');
    });
});

describe('duplicados', () => {
    const csv = 'data;descricao;valor\n02/05/2026;Mercado;-50,00\n02/05/2026;Mercado;-50,00\n03/05/2026;Outro;-9,00\n';

    it('cada lancamento existente explica uma linha so', () => {
        spend('Compra antiga', 50, '2026-05-02');
        const p = okPreview(csv);
        assert.deepEqual(p.rows.map(r => r.duplicate), [true, false, false]);
        assert.equal(p.duplicates, 1);
    });

    it('conta, tipo e valor diferentes nao contam; lixeira nao conta', () => {
        const other = ok('POST', '/accounts', {name: 'Outra', type: 'WALLET'});
        spend('Mesmo valor outra conta', 50, '2026-05-02', {accountId: other.id});
        spend('Receita', 50, '2026-05-02', {type: 'INCOME'});
        const gone = spend('Na lixeira', 50, '2026-05-02');
        ok('DELETE', `/expenses/${gone.id}`);
        assert.equal(okPreview(csv).duplicates, 0);
    });
});

describe('sugestao de categoria', () => {
    const cat = name => ok('GET', '/categories').find(c => c.name === name).id;

    it('pelo que a pessoa ja fez: mesma descricao e mesma primeira palavra', () => {
        const mercado = cat('Mercado');
        spend('Padaria do Zé 123', 10, '2026-04-01', {categoryId: mercado});
        const p = okPreview('data;descricao;valor\n01/05/2026;PADARIA DO ZE;-8,00\n02/05/2026;Padaria Nova;-7,00\n03/05/2026;Loja qualquer;-3,00\n');
        assert.deepEqual(p.rows.map(r => r.categoryId), [mercado, mercado, null]);
    });

    it('por lojas e palavras conhecidas; salario so para entrada', () => {
        const p = okPreview('data;descricao;valor\n01/05/2026;UBER *TRIP;-20,00\n02/05/2026;Netflix.com;-40,00\n03/05/2026;Farmácia Popular;-15,00\n04/05/2026;Salário maio;4.000,00\n05/05/2026;Salário maio;-4.000,00\n');
        assert.deepEqual(p.rows.map(r => r.categoryId), [cat('Transporte'), cat('Assinaturas'), cat('Saúde'), cat('Salário'), null]);
    });
});

describe('gravar', () => {
    it('grava as linhas escolhidas na conta escolhida', () => {
        const other = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET'});
        const rows = okPreview(OFX, {accountId: other.id}).rows;
        const res = ok('POST', '/import/commit', {rows: rows.slice(0, 2), accountId: other.id});
        assert.deepEqual(res, {transactions: 2, transfers: 0, categoriesCreated: 0});
        const list = ok('GET', '/expenses?sort=date,asc');
        assert.deepEqual(list.map(e => [e.name, e.amount, e.type, e.accountName, e.status]), [
            ['UBER *TRIP 1234', 45.9, 'EXPENSE', 'Carteira', 'PAID'], ['Pagamento de salario', 3000, 'INCOME', 'Carteira', 'PAID']]);
        assert.equal(ok('GET', '/accounts').find(a => a.name === 'Carteira').balance, 2954.1);
    });

    it('usa a categoria escolhida na revisao e cria a nova uma vez so', () => {
        const food = ok('GET', '/categories').find(c => c.name === 'Alimentação');
        const rows = okPreview('data;descricao;valor\n01/05/2026;A;-1,00\n02/05/2026;B;-2,00\n03/05/2026;C;-3,00\n').rows;
        rows[0].categoryId = food.id;
        rows[1].categoryId = null; rows[1].categoryName = 'Viagens';
        rows[2].categoryId = null; rows[2].categoryName = 'viagens';
        const res = ok('POST', '/import/commit', {rows, accountId: main.id});
        assert.equal(res.categoriesCreated, 1);
        assert.deepEqual(ok('GET', '/expenses?sort=date,asc').map(e => e.categoryName), ['Alimentação', 'Viagens', 'Viagens']);
    });

    it('tudo ou nada: uma linha ruim desfaz as outras e diz qual', () => {
        const rows = okPreview('data;descricao;valor\n01/05/2026;A;-1,00\n02/05/2026;B;-2,00\n').rows;
        rows[1].date = '1990-01-01';
        const res = call('POST', '/import/commit', {rows, accountId: main.id});
        assert.deepEqual([res.status, res.body.detail], [400, 'Linha 3: a data deve estar entre os anos 2000 e 2100.']);
        assert.equal(ok('GET', '/expenses').length, 0);
        rows[1].date = '2026-05-02'; rows[1].amount = 0;
        assert.match(call('POST', '/import/commit', {rows, accountId: main.id}).body.detail, /^Linha 3: o valor deve estar entre/);
        assert.equal(call('POST', '/import/commit', {rows: [], accountId: main.id}).status, 400);
        assert.equal(call('POST', '/import/commit', {rows, accountId: 99}).body.detail, 'Linha 2: Conta não encontrada: 99');
    });

    it('conta de destino de uma linha ruim em categoria inexistente e recusada', () => {
        const rows = okPreview('data;descricao;valor\n01/05/2026;A;-1,00\n').rows;
        rows[0].categoryId = 999;
        assert.equal(call('POST', '/import/commit', {rows, accountId: main.id}).body.detail, 'Linha 2: Categoria não encontrada: 999');
    });
});

describe('CSV exportado pelo proprio app', () => {
    function seedSource() {
        const cat = ok('GET', '/categories').find(c => c.name === 'Mercado');
        const wallet = ok('POST', '/accounts', {name: 'Carteira', type: 'WALLET'});
        const pix = ok('GET', '/payment-methods').find(m => m.name === 'Pix');
        spend('Feira', 80.5, '2026-05-02', {categoryId: cat.id, tags: ['casa', 'semana'], paymentMethodId: pix.id, description: 'verduras'});
        spend('=SOMA(A1)', 10, '2026-05-03', {accountId: wallet.id});
        spend('Luz', 120, '2026-05-20', {status: 'PENDING'});
        spend('Salário', 3000, '2026-05-05', {type: 'INCOME'});
        ok('POST', '/transfers', {fromAccountId: main.id, toAccountId: wallet.id, amount: 100, date: '2026-05-06', description: 'Para a carteira'});
    }

    it('ida e volta num app vazio: contas, categorias, transferencias, situacao, tags e formulas', () => {
        seedSource();
        const csv = call('GET', '/api/export.csv').text;
        api = newApi();
        // categoria nova e conta que ainda nao existe aqui
        const customCsv = csv.replace('"Mercado"', '"Padaria"');
        const p = okPreview(customCsv, {accountId: undefined});
        assert.equal(p.format, 'APP_CSV');
        assert.equal(p.rows.length, 5);
        assert.deepEqual(p.rows.map(r => r.kind), ['TRANSACTION', 'TRANSACTION', 'TRANSACTION', 'TRANSFER', 'TRANSACTION']);
        const luz = p.rows.find(r => r.name === 'Luz');
        assert.equal(luz.status, 'PENDING');
        assert.equal(p.rows.find(r => r.name === '=SOMA(A1)').accountName, 'Carteira'); // o apostrofo de protecao saiu

        const res = ok('POST', '/import/commit', {rows: p.rows, accountId: null});
        assert.deepEqual(res, {transactions: 4, transfers: 1, categoriesCreated: 1});
        const feira = ok('GET', '/expenses?q=feira')[0];
        assert.deepEqual([feira.amount, feira.categoryName, feira.paymentMethodName, feira.tags, feira.accountName], [80.5, 'Padaria', 'Pix', ['casa', 'semana'], 'Conta principal']);
        assert.equal(ok('GET', '/expenses?status=PENDING')[0].name, 'Luz');
        assert.deepEqual(ok('GET', '/accounts').map(a => a.name).sort(), ['Carteira', 'Conta principal']);
        assert.equal(ok('GET', '/transfers?month=2026-05')[0].description, 'Para a carteira');
        assert.equal(ok('GET', '/accounts').find(a => a.name === 'Carteira').balance, 90);
    });

    it('importar de novo no mesmo app marca tudo como duplicado (inclusive a transferencia)', () => {
        seedSource();
        const csv = call('GET', '/api/export.csv').text;
        const p = okPreview(csv);
        assert.equal(p.duplicates, 5);
        assert.ok(p.rows.every(r => r.duplicate));
    });

    it('linha invalida aponta o numero da linha', () => {
        const res = preview('data;tipo;nome;categoria;valor;conta\n2026-05-01;EXPENSE;A;;1,00;\n2026-05-01;COISA;B;;1,00;\n');
        assert.equal(res.body.detail, 'Linha 3: data, tipo ou valor inválidos.');
    });
});
