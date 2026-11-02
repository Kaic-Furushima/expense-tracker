import {badRequest, conflict, invalid} from './http.js';
import {addMonths, fromCents, isIsoDate, isYearMonth, isoDate, lastDay} from './util.js';

const MAX_AMOUNT = 999999999.99;
const pad = n => String(n).padStart(2, '0');

/** Dia do mes limitado ao tamanho dele (fechamento no dia 31 vale 30 em abril, 28 em fevereiro...). */
const clamp = (month, day) => `${month}-${pad(Math.min(day, Number(lastDay(month).slice(8, 10))))}`;

export const closingDate = (card, month) => clamp(month, card.closing_day);

/** O vencimento fica no mesmo mes do fechamento quando o dia e depois dele; senao, no mes seguinte. */
export const dueDate = (card, month) => clamp(card.due_day > card.closing_day ? month : addMonths(month, 1), card.due_day);

/** Mes da fatura em que cai uma compra feita em `date`: a do fechamento logo depois dela. */
export function invoiceMonthOf(card, date) {
    const month = date.slice(0, 7);
    return date > closingDate(card, month) ? addMonths(month, 1) : month;
}

export const hasInvoices = card => card.type === 'CREDIT_CARD' && card.closing_day != null && card.due_day != null;

/**
 * Faturas de cartao de credito. O cartao e uma conta cujo saldo fica negativo com as compras; cada compra pertence a
 * fatura que fecha logo depois dela, e pagar uma fatura e uma transferencia de outra conta para o cartao (marcada com
 * o mes da fatura), o que traz o saldo de volta.
 */
export class Invoices {
    constructor(db, catalog, expenses, transfers) {
        this.db = db;
        this.catalog = catalog;
        this.expenses = expenses;
        this.transfers = transfers;
    }

    requireCard(accountId) {
        const card = this.catalog.account(accountId);
        if (card.type !== 'CREDIT_CARD') throw badRequest('Esta conta não é um cartão de crédito.');
        if (card.closing_day == null || card.due_day == null) {
            throw conflict('Informe o dia de fechamento e o de vencimento do cartão para ver as faturas.');
        }
        return card;
    }

    groups(card) {
        const byMonth = new Map();
        for (const e of this.expenses.byAccount(card.id)) {
            const month = invoiceMonthOf(card, e.date);
            if (!byMonth.has(month)) byMonth.set(month, []);
            byMonth.get(month).push(e);
        }
        const payments = new Map();
        for (const t of this.transfers.invoicePayments(card.id)) {
            if (!payments.has(t.invoice_month)) payments.set(t.invoice_month, []);
            payments.get(t.invoice_month).push(t);
        }
        return {byMonth, payments};
    }

    build(card, month, rows = [], payments = [], withItems = false) {
        const total = rows.reduce((sum, e) => sum + (e.type === 'INCOME' ? -e.amount_cents : e.amount_cents), 0);
        const paid = payments.reduce((sum, t) => sum + t.amount_cents, 0);
        const remaining = Math.max(total - paid, 0);
        const closing = closingDate(card, month);
        const today = isoDate(this.db.clock());
        const status = total > 0 && remaining === 0 ? 'PAID'
            : total <= 0 && payments.length > 0 ? 'PAID'
            : today > closing ? 'CLOSED' : 'OPEN';
        const tags = withItems ? this.expenses.tagsByExpense() : null;
        const previousClosing = closingDate(card, addMonths(month, -1));
        const start = new Date(`${previousClosing}T12:00:00`);
        start.setDate(start.getDate() + 1);
        return {
            month, startDate: isoDate(start), closingDate: closing, dueDate: dueDate(card, month),
            total: fromCents(total), paid: fromCents(paid), remaining: fromCents(remaining), status,
            items: withItems ? rows.map(r => this.expenses.response(r, tags)) : [],
            payments: withItems ? payments.map(t => this.transfers.response(t)) : [],
            remainingCents: remaining
        };
    }

    /** Toda fatura com compras ou pagamentos, mais a atual, da mais nova para a mais antiga (sem os itens). */
    list(accountId) {
        const card = this.requireCard(accountId);
        const {byMonth, payments} = this.groups(card);
        const months = new Set([...byMonth.keys(), ...payments.keys(), invoiceMonthOf(card, isoDate(this.db.clock()))]);
        return [...months].sort().reverse().map(m => this.build(card, m, byMonth.get(m), payments.get(m)));
    }

    get(accountId, month) {
        if (!isYearMonth(month)) throw badRequest(`Mês inválido: ${month}`);
        const card = this.requireCard(accountId);
        const {byMonth, payments} = this.groups(card);
        return this.build(card, month, byMonth.get(month), payments.get(month), true);
    }

    /** Paga a fatura (tudo o que falta, ou o valor informado) com dinheiro de outra conta. */
    pay(cardId, month, body) {
        if (!isYearMonth(month)) throw badRequest(`Mês inválido: ${month}`);
        const errors = {};
        if (body.fromAccountId == null) errors.fromAccountId = 'Informe de qual conta sai o pagamento.';
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount != null && (Number.isNaN(amount) || amount < 0.01)) errors.amount = 'O valor deve ser de pelo menos 0,01.';
        else if (amount != null && amount > MAX_AMOUNT) errors.amount = 'O valor é alto demais.';
        if (body.date != null && !isIsoDate(body.date)) errors.date = 'Data inválida.';
        if (Object.keys(errors).length) throw invalid(errors);

        return this.db.tx(() => {
            const card = this.requireCard(cardId);
            const {byMonth, payments} = this.groups(card);
            const invoice = this.build(card, month, byMonth.get(month), payments.get(month));
            const value = amount ?? fromCents(invoice.remainingCents);
            if (!(value > 0)) throw conflict('Esta fatura não tem nada a pagar.');
            const [y, m] = month.split('-');
            this.transfers.create({
                fromAccountId: body.fromAccountId, toAccountId: cardId, amount: value, date: body.date,
                description: `Fatura ${card.name} ${m}/${y}`
            }, month);
            const {byMonth: b2, payments: p2} = this.groups(card);
            return this.build(card, month, b2.get(month), p2.get(month), true);
        });
    }

    /** Faturas ainda a pagar com vencimento ate `end`, de cartoes ativos, para o "Por vir". */
    unpaid(end, accountId, today) {
        const items = [];
        for (const card of this.db.all('select * from accounts where archived = 0')) {
            if (!hasInvoices(card) || (accountId != null && accountId !== card.id)) continue;
            for (const inv of this.list(card.id)) {
                if (inv.remainingCents > 0 && inv.dueDate <= end) {
                    const [y, m] = inv.month.split('-');
                    items.push({kind: 'INVOICE', id: card.id, date: inv.dueDate, name: `Fatura ${card.name} ${m}/${y}`, type: 'EXPENSE',
                        cents: inv.remainingCents, accountName: card.name, overdue: inv.dueDate < today});
                }
            }
        }
        return items;
    }
}
