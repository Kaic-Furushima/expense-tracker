import {HttpError, badRequest} from './http.js';
import {toCents} from './util.js';
import {CURRENCIES} from './settings.js';

export const MAX_ROWS = 5000;
const MAX_AMOUNT = 999999999.99;

const bad = message => badRequest(message);

/** Minusculas e sem acentos. */
export const normalize = text => (text == null ? '' : String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim());

const lower = text => (text == null ? '' : String(text).toLowerCase());
const blankToNull = text => (text == null || !String(text).trim() ? null : String(text).trim());
const truncate = (text, max) => (text.length <= max ? text : text.slice(0, max));
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cents = value => Math.round(Number(value) * 100);

/* ------------------------------------------------------------------ valores */

const DATE_PATTERNS = [
    [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (a, b, c) => [c, b, a]], // d/M/aaaa
    [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (a, b, c) => [a, b, c]], // aaaa-M-d
    [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (a, b, c) => [c, b, a]], // d-M-aaaa
    [/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, (a, b, c) => [2000 + Number(c), b, a]], // d/M/aa
    [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (a, b, c) => [a, b, c]], // aaaa/M/d
    [/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, (a, b, c) => [c, b, a]] // d.M.aaaa
];

/** "dd/MM/aaaa", "aaaa-MM-dd" e outras formas comuns; devolve "aaaa-MM-dd" ou null. */
export function parseDate(text) {
    if (text == null || !String(text).trim()) return null;
    let t = String(text).trim();
    if (t.length > 10 && /^\d/.test(t)) t = t.split(/[ T]/)[0];
    for (const [regex, pick] of DATE_PATTERNS) {
        const m = regex.exec(t);
        if (!m) continue;
        const [y, mo, d] = pick(m[1], m[2], m[3]).map(Number);
        const date = new Date(Date.UTC(y, mo - 1, d));
        if (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) {
            return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }
    return null;
}

/** Aceita "1.234,56", "1234,56", "-45.90", "R$ 12,00", "(12,00)". Devolve o numero (2 casas) ou null se nao for numero. */
export function parseAmount(text) {
    if (text == null) return null;
    let t = String(text).trim().replace('R$', '').replace(/[\s ]/g, '');
    const negative = (t.startsWith('(') && t.endsWith(')')) || (t.endsWith('-') && t.length > 1);
    t = t.replace(/[()]/g, '');
    if (t.endsWith('-')) t = t.slice(0, -1);
    if (!t || !/^[+-]?[\d.,]+$/.test(t)) return null;
    const comma = t.lastIndexOf(',');
    const dot = t.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) t = comma > dot ? t.replaceAll('.', '').replace(',', '.') : t.replaceAll(',', '');
    else if (comma >= 0) t = t.replaceAll('.', '').replace(',', '.');
    else if (/^[+-]?\d{1,3}(\.\d{3}){2,}$/.test(t)) t = t.replaceAll('.', ''); // 1.234.567 so pode ser milhar
    const number = Number(t);
    if (Number.isNaN(number)) return null;
    const value = Math.sign(number) * (Math.round(Math.abs(number) * 100) / 100);
    return negative ? -value : value;
}

/* ------------------------------------------------------------------ CSV */

/** Quebra o texto em linhas de celulas (celulas entre aspas podem ter o separador, aspas e quebras de linha). */
export function parseCsv(text) {
    // O separador e o mais usado nas primeiras linhas (extratos costumam comecar com uma linha de titulo)
    const sample = text.split(/\r\n|\r|\n/).slice(0, 15).join(' ');
    const count = ch => [...sample].filter(c => c === ch).length;
    const semicolons = count(';');
    const commas = count(',');
    const tabs = count('\t');
    const delimiter = semicolons >= commas && semicolons >= tabs && semicolons > 0 ? ';' : tabs > commas ? '\t' : ',';
    const table = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
            } else cell += c;
        } else if (c === '"') {
            quoted = true;
        } else if (c === delimiter) {
            row.push(cell);
            cell = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell);
            cell = '';
            table.push(row);
            row = [];
        } else {
            cell += c;
        }
    }
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        table.push(row);
    }
    return table;
}

const headerKey = header => normalize(header ?? '').replace(/[^a-z0-9_() $]/g, '').trim();

const DATE_HEADERS = ['data', 'date', 'data lancamento', 'data da compra', 'data de lancamento', 'dt'];
const NAME_HEADERS = ['descricao', 'title', 'titulo', 'estabelecimento', 'historico', 'lancamento', 'memo', 'detalhes', 'description', 'nome', 'name'];
const AMOUNT_HEADERS = ['valor', 'amount', 'valor (r$)', 'quantia', 'value'];
const CREDIT_HEADERS = ['credito', 'credit', 'entrada', 'entradas'];
const DEBIT_HEADERS = ['debito', 'debit', 'saida', 'saidas'];

const find = (keys, wanted) => {
    for (const w of wanted) {
        const i = keys.indexOf(w);
        if (i >= 0) return i;
    }
    return -1;
};
const get = (row, index) => (index < 0 || index >= row.length ? '' : row[index].trim());

function columns(header) {
    const result = new Map();
    header.forEach((h, i) => { const key = headerKey(h); if (!result.has(key)) result.set(key, i); });
    return result;
}

/** Celula do CSV do app: a exportacao poe um apostrofo antes de celulas que comecam com = + - @ ou tab (protecao contra formulas). */
function cell(row, col, name) {
    const i = col.get(name);
    if (i === undefined || i >= row.length) return '';
    const value = row[i].trim();
    return value.length > 1 && value[0] === "'" && '=+-@\t'.includes(value[1]) ? value.slice(1) : value;
}

function isAppCsv(table) {
    if (!table.length) return false;
    const head = table[0].map(headerKey);
    return head.length >= 5 && head[0] === 'data' && head[1] === 'tipo' && head[2] === 'nome' && head.includes('valor');
}

function row(fields) {
    return {
        line: 0, kind: 'TRANSACTION', date: null, type: 'EXPENSE', name: null, amount: 0, categoryId: null, categoryName: null,
        accountName: null, toAccountName: null, methodName: null, status: 'PAID', tags: [], description: null, duplicate: false,
        currency: null, toAmount: null, toCurrency: null, ...fields
    };
}

function bankRow(line, date, type, name, amount) {
    return row({line, date, type, name: !name || !String(name).trim() ? 'Sem descrição' : String(name).trim(), amount: Math.round(amount * 100) / 100});
}

function parseAppCsv(table) {
    const col = columns(table[0]);
    const rows = [];
    for (let i = 1; i < table.length; i++) {
        const r = table[i];
        if (r.every(c => !c.trim())) continue;
        const date = parseDate(cell(r, col, 'data'));
        const amount = parseAmount(cell(r, col, 'valor'));
        const kind = cell(r, col, 'tipo').toUpperCase();
        if (date == null || amount == null || !['EXPENSE', 'INCOME', 'TRANSFER'].includes(kind)) throw bad(`Linha ${i + 1}: data, tipo ou valor inválidos.`);
        const transfer = kind === 'TRANSFER';
        const tags = cell(r, col, 'tags');
        rows.push(row({
            line: i + 1, kind: transfer ? 'TRANSFER' : 'TRANSACTION', date, type: kind === 'INCOME' ? 'INCOME' : 'EXPENSE',
            name: cell(r, col, 'nome'), amount: Math.abs(amount), categoryName: blankToNull(cell(r, col, 'categoria')),
            accountName: blankToNull(cell(r, col, 'conta')), toAccountName: transfer ? blankToNull(cell(r, col, 'conta_destino')) : null,
            methodName: blankToNull(cell(r, col, 'forma_pagamento')),
            status: cell(r, col, 'situacao').toUpperCase() === 'A_PAGAR' ? 'PENDING' : 'PAID',
            tags: tags.trim() ? tags.trim().split(/\s+/) : [], description: blankToNull(cell(r, col, 'descricao')),
            // colunas opcionais (arquivos antigos nao as tem): a moeda da conta e, numa transferencia entre moedas, o valor que chegou
            currency: blankToNull(cell(r, col, 'moeda')), toCurrency: transfer ? blankToNull(cell(r, col, 'moeda_destino')) : null,
            toAmount: transfer ? (v => (v == null ? null : Math.abs(v)))(parseAmount(cell(r, col, 'valor_destino'))) : null
        }));
    }
    return rows;
}

function parseBankCsv(table, invert) {
    let headerRow = -1;
    for (let i = 0; i < Math.min(table.length, 30); i++) {
        const keys = table[i].map(headerKey);
        if (find(keys, DATE_HEADERS) >= 0 && (find(keys, AMOUNT_HEADERS) >= 0 || find(keys, CREDIT_HEADERS) >= 0 || find(keys, DEBIT_HEADERS) >= 0)) {
            headerRow = i;
            break;
        }
    }
    if (headerRow < 0) {
        throw bad('Não reconheci as colunas deste arquivo. Ele precisa ter, no mínimo, colunas de data e de valor '
            + '(e de preferência a descrição). Se for um extrato OFX, use o arquivo .ofx.');
    }
    const keys = table[headerRow].map(headerKey);
    const dateCol = find(keys, DATE_HEADERS);
    const nameCol = find(keys, NAME_HEADERS);
    const amountCol = find(keys, AMOUNT_HEADERS);
    const creditCol = find(keys, CREDIT_HEADERS);
    const debitCol = find(keys, DEBIT_HEADERS);

    const parsed = [];
    for (let i = headerRow + 1; i < table.length; i++) {
        const r = table[i];
        const date = parseDate(get(r, dateCol));
        if (date == null) continue; // linhas em branco, totais, notas
        let signed;
        if (amountCol >= 0 && parseAmount(get(r, amountCol)) != null) {
            signed = parseAmount(get(r, amountCol));
        } else {
            const credit = creditCol >= 0 ? parseAmount(get(r, creditCol)) : null;
            const debit = debitCol >= 0 ? parseAmount(get(r, debitCol)) : null;
            signed = credit != null && credit !== 0 ? Math.abs(credit) : debit != null ? -Math.abs(debit) : null;
        }
        if (signed == null || signed === 0) continue;
        parsed.push({line: i + 1, date, signed, name: get(r, nameCol)});
    }
    // Extratos usam negativo para saida; exportacoes de cartao costumam listar compras como positivo.
    const anyNegative = parsed.some(p => p.signed < 0);
    const separateColumns = amountCol < 0;
    return parsed.map(p => {
        const expense = separateColumns || anyNegative ? p.signed < 0 : true;
        return bankRow(p.line, p.date, expense !== invert ? 'EXPENSE' : 'INCOME', p.name, Math.abs(p.signed));
    });
}

/* ------------------------------------------------------------------ OFX */

const OFX_BLOCK = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTTRNRS>|$)/gi;

function ofxValue(block, tag) {
    const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
    return m ? m[1].trim() : null;
}

function parseOfx(text, invert) {
    const rows = [];
    let line = 0;
    for (const m of text.matchAll(OFX_BLOCK)) {
        line++;
        const block = m[1];
        const posted = ofxValue(block, 'DTPOSTED');
        const amountText = ofxValue(block, 'TRNAMT');
        if (posted == null || amountText == null) continue;
        const digits = posted.replace(/\D/g, '');
        if (digits.length < 8) continue;
        const date = parseDate(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`);
        if (date == null) continue;
        const signed = parseAmount(amountText);
        if (signed == null || signed === 0) continue;
        const memo = ofxValue(block, 'MEMO');
        const name = memo && memo.trim() ? memo : ofxValue(block, 'NAME');
        rows.push(bankRow(line, date, (signed < 0) !== invert ? 'EXPENSE' : 'INCOME', name, Math.abs(signed)));
    }
    return rows;
}

/* ------------------------------------------------------------------ sugestao de categoria */

const KEYWORDS = [
    ['transporte', ['uber', '99', 'taxi', 'posto', 'ipiranga', 'shell', 'combustivel', 'estacionamento', 'pedagio', 'onibus', 'metro']],
    ['mercado', ['mercado', 'supermercado', 'atacad', 'carrefour', 'assai', 'hortifruti', 'sacolao']],
    ['alimentacao', ['ifood', 'restaurante', 'lanchonete', 'pizza', 'burger', 'padaria', 'cafe', 'sorvete', 'acai', 'rappi']],
    ['saude', ['farmacia', 'drogaria', 'drogasil', 'raia', 'hospital', 'clinica', 'dentista', 'laboratorio']],
    ['assinaturas', ['netflix', 'spotify', 'prime', 'disney', 'hbo', 'youtube', 'apple', 'icloud', 'deezer']],
    ['lazer', ['cinema', 'steam', 'playstation', 'xbox', 'ingresso', 'show', 'teatro']],
    ['educacao', ['escola', 'faculdade', 'curso', 'udemy', 'livraria', 'mensalidade']],
    ['moradia', ['aluguel', 'condominio', 'energia', 'enel', 'cemig', 'sabesp', 'internet', 'vivo', 'claro', 'gas']],
    ['salario', ['salario', 'pagamento de salario', 'folha']]
];

/** "UBER *TRIP 1234" e "Uber trip" ficam parecidos: minusculas, sem acento, numeros nem pontuacao. */
const simplify = text => normalize(text).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const firstWord = key => (key.includes(' ') ? key.slice(0, key.indexOf(' ')) : key);

function most(counts) {
    if (!counts) return null;
    let best = null;
    let bestCount = -1;
    for (const [id, count] of counts) if (count > bestCount) { best = id; bestCount = count; }
    return best;
}

/** Sugere a categoria pelo que a pessoa ja fez (mesma descricao, depois mesma primeira palavra) e, por fim, por lojas e palavras conhecidas. */
class CategorySuggester {
    constructor(history, categories) {
        this.kinds = new Map(categories.map(c => [c.id, c.kind]));
        this.byName = new Map();
        this.byFirstWord = new Map();
        this.byNormalizedName = new Map(categories.map(c => [`${c.kind}:${normalize(c.name)}`, c.id]));
        const bump = (map, key, id) => {
            if (!map.has(key)) map.set(key, new Map());
            map.get(key).set(id, (map.get(key).get(id) ?? 0) + 1);
        };
        for (const e of history) {
            if (e.category_id == null || this.kinds.get(e.category_id) !== e.type) continue;
            const key = simplify(e.name);
            if (!key) continue;
            bump(this.byName, key, e.category_id);
            const first = firstWord(key);
            if (first.length >= 4) bump(this.byFirstWord, first, e.category_id);
        }
    }

    suggest(name, type) {
        const key = simplify(name);
        if (!key) return null;
        const known = most(this.byName.get(key)) ?? most(this.byFirstWord.get(firstWord(key)));
        if (known != null) return known;
        for (const [categoryName, words] of KEYWORDS) {
            const category = this.byNormalizedName.get(`${type === 'INCOME' ? 'INCOME' : 'EXPENSE'}:${categoryName}`);
            if (category == null || (type === 'INCOME') !== (categoryName === 'salario')) continue;
            if (words.some(w => new RegExp(`\\b${escapeRegex(w)}`).test(key))) return category;
        }
        return null;
    }
}

/* ------------------------------------------------------------------ servico */

/**
 * Importa lancamentos de um arquivo: extrato OFX, CSV de banco/cartao com data, descricao e valor, ou o CSV que este app
 * exporta. Dois passos: `preview` le o arquivo e sugere categoria e duplicados em cada linha; `commit` grava o que a
 * pessoa manteve.
 */
export class Importer {
    constructor(db, catalog, expenses, transfers) {
        this.db = db;
        this.catalog = catalog;
        this.expenses = expenses;
        this.transfers = transfers;
    }

    preview(content, accountId, invertSigns) {
        const text = content == null ? '' : String(content).replace(/﻿/g, '').trim();
        if (!text) throw bad('O arquivo está vazio.');
        const upper = text.toUpperCase();
        let format;
        let rows;
        if (upper.startsWith('OFXHEADER') || upper.includes('<OFX>') || upper.includes('<STMTTRN>')) {
            format = 'OFX';
            rows = parseOfx(text, invertSigns === true);
        } else {
            const table = parseCsv(text);
            if (isAppCsv(table)) {
                format = 'APP_CSV';
                rows = parseAppCsv(table);
            } else {
                format = 'BANK_CSV';
                rows = parseBankCsv(table, invertSigns === true);
            }
        }
        if (!rows.length) throw bad('Não encontrei nenhum lançamento neste arquivo.');
        if (rows.length > MAX_ROWS) throw bad(`O arquivo tem lançamentos demais (máximo de ${MAX_ROWS} por vez).`);
        if (format !== 'APP_CSV') {
            if (accountId == null) throw bad('Escolha a conta que vai receber os lançamentos.');
            this.catalog.account(accountId);
        }
        const enriched = this.markDuplicates(this.suggest(rows), format === 'APP_CSV' ? null : accountId, format);
        return {format, rows: enriched, duplicates: enriched.filter(r => r.duplicate).length};
    }

    suggest(rows) {
        const categories = this.db.all('select id, name, kind from categories');
        const suggester = new CategorySuggester(this.db.all('select name, category_id, type from expenses where deleted_at is null'), categories);
        return rows.map(r => {
            if (r.kind === 'TRANSFER') return r;
            const existing = r.categoryName == null ? null : categories.find(c => c.kind === (r.type === 'INCOME' ? 'INCOME' : 'EXPENSE') && c.name.toLowerCase() === r.categoryName.toLowerCase());
            if (existing) return {...r, categoryId: existing.id, categoryName: existing.name};
            if (r.categoryName && r.categoryName.trim()) return r; // o CSV do app cita uma categoria que ainda nao existe: sera criada
            return {...r, categoryId: suggester.suggest(r.name, r.type)};
        });
    }

    /** Linha provavelmente duplicada: ja existe lancamento igual (mesma conta, dia, valor e tipo); cada existente explica uma linha so. */
    markDuplicates(rows, fixedAccountId, format) {
        const app = format === 'APP_CSV';
        const key = (accountId, date, amount, type, name) => `${accountId}|${date}|${(cents(amount) / 100).toFixed(2)}|${type}|${name}`;
        const transferKey = (from, to, date, amount) => `T|${lower(from)}|${lower(to)}|${date}|${(cents(amount) / 100).toFixed(2)}`;
        const existing = new Map();
        const add = (k) => existing.set(k, (existing.get(k) ?? 0) + 1);
        for (const e of this.db.all('select account_id, date, amount_cents, type, name from expenses where deleted_at is null')) {
            add(key(e.account_id, e.date, e.amount_cents / 100, e.type, app ? normalize(e.name) : ''));
        }
        for (const t of this.db.all(`select t.date, t.amount_cents, f.name from_name, d.name to_name from transfers t
                                     join accounts f on f.id = t.from_account_id join accounts d on d.id = t.to_account_id where t.deleted_at is null`)) {
            add(transferKey(t.from_name, t.to_name, t.date, t.amount_cents / 100));
        }
        const accounts = new Map(this.db.all('select id, name from accounts').map(a => [a.name.toLowerCase(), a.id]));
        return rows.map(r => {
            const k = r.kind === 'TRANSFER' ? transferKey(r.accountName, r.toAccountName, r.date, r.amount)
                : (() => {
                    const account = fixedAccountId ?? accounts.get(lower(r.accountName));
                    return account == null ? null : key(account, r.date, r.amount, r.type, app ? normalize(r.name) : '');
                })();
            const left = k == null ? undefined : existing.get(k);
            if (left > 0) {
                existing.set(k, left - 1);
                return {...r, duplicate: true};
            }
            return r;
        });
    }

    /** Grava as linhas dadas (tudo ou nada). As de extrato vao para `accountId`. */
    commit(rows, accountId) {
        if (!Array.isArray(rows) || !rows.length) throw bad('Nenhum lançamento foi selecionado.');
        if (rows.length > MAX_ROWS) throw bad(`São lançamentos demais de uma vez (máximo de ${MAX_ROWS}).`);
        return this.db.tx(() => {
            let transactions = 0;
            let transfers = 0;
            const categoriesBefore = this.db.value('select count(*) from categories');
            const created = new Map();
            for (const r of rows) {
                try {
                    if (r.kind === 'TRANSFER') { this.saveTransfer(r); transfers++; }
                    else { this.saveTransaction(r, accountId, created); transactions++; }
                } catch (e) {
                    if (e instanceof HttpError) throw bad(`Linha ${r.line}: ${e.message}`);
                    throw e;
                }
            }
            return {transactions, transfers, categoriesCreated: this.db.value('select count(*) from categories') - categoriesBefore};
        });
    }

    validate(r) {
        if (!r.date || Number(String(r.date).slice(0, 4)) < 2000 || Number(String(r.date).slice(0, 4)) > 2100) throw bad('a data deve estar entre os anos 2000 e 2100.');
        if (r.amount == null || !(Number(r.amount) >= 0.01 && Number(r.amount) <= MAX_AMOUNT)) throw bad('o valor deve estar entre 0,01 e 999.999.999,99.');
    }

    /** A conta com esse nome (sem diferenciar maiusculas) ou uma nova, de conta corrente. */
    accountByName(name, currency = null) {
        const found = this.db.get('select * from accounts where name = ?', [name.trim()]);
        if (found) return found;
        // uma conta nova nasce na moeda do arquivo (se for uma que o app conhece)
        const code = currency ? String(currency).trim().toUpperCase() : null;
        return this.catalog.createAccount({name, type: 'CHECKING', ...(code && CURRENCIES.includes(code) ? {currency: code} : {})});
    }

    saveTransaction(r, accountId, created) {
        this.validate(r);
        const account = r.accountName && r.accountName.trim() ? this.accountByName(r.accountName, r.currency)
            : accountId == null ? this.catalog.defaultAccount() : this.catalog.account(accountId);
        let categoryId = null;
        if (r.categoryId != null) {
            categoryId = this.catalog.category(r.categoryId).id;
        } else if (r.categoryName && r.categoryName.trim()) {
            const kind = r.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
            const key = `${kind}:${r.categoryName.toLowerCase()}`;
            if (!created.has(key)) created.set(key, this.catalog.findOrCreateCategory(r.categoryName, kind).id);
            categoryId = created.get(key);
        }
        let methodId = null;
        if (r.methodName && r.methodName.trim()) {
            const found = this.db.get('select id from payment_methods where name = ?', [r.methodName.trim()]);
            methodId = found ? found.id : this.catalog.createMethod({name: r.methodName}).id;
        }
        this.expenses.insert({
            name: truncate(!r.name || !String(r.name).trim() ? 'Sem descrição' : String(r.name).trim(), 120),
            description: r.description && String(r.description).trim() ? truncate(String(r.description).trim(), 255) : null,
            amountCents: toCents(r.amount), date: r.date, type: r.type ?? 'EXPENSE', status: r.status ?? 'PAID',
            categoryId, accountId: account.id, paymentMethodId: methodId, tagIds: this.catalog.resolveTags(r.tags)
        });
    }

    saveTransfer(r) {
        this.validate(r);
        if (!r.accountName || !r.toAccountName || !r.accountName.trim() || !r.toAccountName.trim()) {
            throw bad('a transferência precisa da conta de origem e da de destino.');
        }
        const from = this.accountByName(r.accountName, r.currency);
        const to = this.accountByName(r.toAccountName, r.toCurrency);
        this.transfers.create({fromAccountId: from.id, toAccountId: to.id, amount: r.amount, toAmount: r.toAmount, date: r.date, description: r.description ?? r.name});
    }
}
