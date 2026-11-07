import {badRequest, invalid} from './http.js';
import {addMonths, fromCents, isYearMonth, toCents} from './util.js';

const MAX_AMOUNT = 999999999.99;

/** Todas as linhas de orcamento em memoria, para responder "qual limite valia no mes X?" sem ir ao banco toda hora. */
export class Book {
    /** view: a moeda que se esta olhando (so os limites dela valem); nulo = qualquer uma. main: a moeda principal. */
    constructor(rows, view = null, main = 'BRL') {
        this.view = view;
        this.main = main;
        this.byCategory = new Map();
        this.total = [];
        [...rows].sort((a, b) => (a.from_month < b.from_month ? -1 : a.from_month > b.from_month ? 1 : 0)).forEach(row => {
            if (row.category_id == null) this.total.push(row);
            else {
                if (!this.byCategory.has(row.category_id)) this.byCategory.set(row.category_id, []);
                this.byCategory.get(row.category_id).push(row);
            }
        });
    }

    /** Limite em vigor para uma categoria (null = limite geral) num mes: {categoryId, amountCents, fromMonth} ou null. */
    effective(categoryId, month) {
        const rows = categoryId == null ? this.total : this.byCategory.get(categoryId) ?? [];
        let current = null;
        for (const row of rows) {
            if (row.from_month > month) break;
            current = row;
        }
        if (!current || current.amount_cents == null) return null;
        // a linha em vigor decide tambem a moeda: um limite em dolar substitui o antigo em real, e nao aparece na visao em real
        const currency = current.currency ?? this.main;
        if (this.view != null && currency !== this.view) return null;
        return {categoryId, amountCents: current.amount_cents, fromMonth: current.from_month, currency};
    }

    base(categoryId, month) {
        return this.effective(categoryId, month)?.amountCents ?? null;
    }

    categoryIds() {
        return [...this.byCategory.keys()];
    }
}

/**
 * Limites de gasto com vigencia: cada linha vale a partir de um mes ate a proxima linha da mesma categoria, entao
 * mudar o limite de dezembro nunca reescreve o de outubro. Categoria nula = limite geral; valor nulo = "sem limite
 * a partir deste mes".
 */
export class Budgets {
    constructor(db, catalog) {
        this.db = db;
        this.catalog = catalog;
    }

    /** Os limites da moeda olhada (a principal, se nao disser); com "*", os de todas as moedas. */
    book(currency = null) {
        const view = currency === '*' ? null : this.catalog.storedCurrency(currency) ?? this.catalog.mainCurrency();
        return new Book(this.db.all('select * from budgets'), view, this.catalog.mainCurrency());
    }

    effectiveInMonth(month, currency = null) {
        const book = this.book(currency);
        return book.categoryIds().map(id => book.effective(id, month)).filter(Boolean)
            .map(e => ({categoryId: e.categoryId, amount: fromCents(e.amountCents), fromMonth: e.fromMonth, currency: e.currency}));
    }

    total(month, currency = null) {
        const e = this.book(currency).effective(null, month);
        return {amount: e ? fromCents(e.amountCents) : null, fromMonth: e ? e.fromMonth : null, currency: e ? e.currency : null};
    }

    /** currency: a moeda do limite (nao enviada = continua a do limite em vigor, ou a principal). */
    set(categoryId, month, amount, scope, currency) {
        const cents = this.normalize(amount);
        if (categoryId != null) this.catalog.category(categoryId);
        this.db.tx(() => {
            const before = this.book('*').effective(categoryId, month);
            const stored = currency === undefined ? this.catalog.storedCurrency(before?.currency) : this.catalog.storedCurrency(currency);
            this.upsertRow(categoryId, month, cents, stored);
            if (scope === 'ONLY_MONTH') {
                const next = addMonths(month, 1);
                if (!this.findRow(categoryId, next)) this.upsertRow(categoryId, next, before ? before.amountCents : null, this.catalog.storedCurrency(before?.currency));
            }
        });
    }

    /** A partir deste mes nao ha limite (os meses anteriores mantem o deles). */
    remove(categoryId, month) {
        if (categoryId != null) this.catalog.category(categoryId);
        this.upsertRow(categoryId, month, null, null);
    }

    /** Valida o pedido de um limite ({amount, scope}) e devolve o escopo. */
    parseRequest(body) {
        const amount = body?.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount == null || Number.isNaN(amount)) throw invalid({amount: 'Informe o limite.'});
        if (amount < 0.01) throw invalid({amount: 'O limite deve ser de pelo menos 0,01.'});
        if (amount > MAX_AMOUNT) throw invalid({amount: 'O limite é alto demais.'});
        return body.scope === 'ONLY_MONTH' ? 'ONLY_MONTH' : 'FROM_MONTH';
    }

    monthParam(text, fallback) {
        if (text == null || text === '') return fallback;
        if (!isYearMonth(text)) throw badRequest(`Mês inválido: ${text}`);
        return text;
    }

    findRow(categoryId, month) {
        return this.db.get('select * from budgets where category_id is ? and from_month = ?', [categoryId, month]);
    }

    upsertRow(categoryId, month, cents, currency = null) {
        const row = this.findRow(categoryId, month);
        if (row) this.db.run('update budgets set amount_cents = ?, currency = ?, updated_at = ? where id = ?', [cents, currency, this.db.now(), row.id]);
        else this.db.run('insert into budgets (uuid, category_id, from_month, amount_cents, currency, updated_at) values (?, ?, ?, ?, ?, ?)',
            [this.db.newId(), categoryId, month, cents, currency, this.db.now()]);
    }

    normalize(amount) {
        if (amount == null) return null;
        const n = Number(amount);
        if (!(n > 0) || n > MAX_AMOUNT) throw badRequest('Informe um limite entre 0,01 e 999.999.999,99.');
        return toCents(n);
    }
}
