import {addMonths, firstDay, fromCents, lastDay} from './util.js';

const TREND_MONTHS = 6;
/** Quantos meses para tras a "sobra acumulada" olha, no maximo. */
const ROLLOVER_MAX_MONTHS = 24;

/**
 * Numeros do painel de um mes, calculados direto dos lancamentos. So o que esta pago entra nos totais; o que falta
 * pagar e informado a parte e alimenta a previsao. Os orcamentos olham sempre todas as contas.
 */
export class Summary {
    constructor(db, catalog, budgets, settings) {
        this.db = db;
        this.catalog = catalog;
        this.budgets = budgets;
        this.settings = settings;
    }

    /** Totais agrupados por mes, tipo, situacao, categoria e conta entre dois meses (inclusive). */
    totalsBetween(from, to) {
        return this.db.all(`select substr(date, 1, 7) month, type, status, category_id, account_id, coalesce(adjustment, 0) adjustment,
                                   sum(amount_cents) cents, count(*) n
                            from expenses where deleted_at is null and date between ? and ?
                            group by 1, 2, 3, 4, 5, 6`, [firstDay(from), lastDay(to)])
            .map(r => ({month: r.month, income: r.type === 'INCOME', paid: r.status !== 'PENDING', adjustment: !!r.adjustment,
                categoryId: r.category_id, accountId: r.account_id, cents: r.cents, count: r.n}));
    }

    /** currency: a moeda olhada (a principal, se nao disser); com uma conta, vale a moeda dela. So conta o que e dessa moeda. */
    summarize(month, accountId = null, currency = null) {
        const currencies = this.catalog.accountCurrencies();
        const view = accountId != null ? (currencies.get(accountId) ?? this.catalog.mainCurrency()) : (currency || this.catalog.mainCurrency());
        const inView = id => currencies.get(id) === view;
        const totals = this.totalsBetween(addMonths(month, -ROLLOVER_MAX_MONTHS), month).filter(b => inView(b.accountId));
        const spend = spendByMonth(totals);
        const inAccount = b => accountId == null || accountId === b.accountId;
        // "correcao de saldo": nao e receita nem despesa; aparece a parte e entra no saldo do mes
        const sum = (rows, income, paid) => rows.filter(b => !b.adjustment && b.income === income && b.paid === paid).reduce((s, b) => s + b.cents, 0);

        const scoped = totals.filter(b => b.month === month && inAccount(b));
        const income = sum(scoped, true, true);
        const spent = sum(scoped, false, true);
        const adjustment = scoped.filter(b => b.adjustment && b.paid).reduce((s, b) => s + (b.income ? b.cents : -b.cents), 0);
        const balance = income - spent + adjustment;

        let pendingIncome = sum(scoped, true, false);
        let pendingExpense = sum(scoped, false, false);
        for (const o of this.db.all(`select o.amount_cents, o.status, r.type, r.account_id from recurring_occurrences o
                                     join recurring_payments r on r.id = o.recurring_id where o.occurrence_month = ?`, [month])) {
            if (o.status !== 'PENDING' || o.amount_cents == null || !(accountId == null ? inView(o.account_id) : accountId === o.account_id)) continue;
            if (o.type === 'INCOME') pendingIncome += o.amount_cents;
            else pendingExpense += o.amount_cents;
        }
        const projected = balance + pendingIncome - pendingExpense;

        const allCategories = this.db.all('select * from categories');
        const byId = new Map(allCategories.map(c => [c.id, c]));
        const book = this.budgets.book(view);
        const rollover = this.settings.budgetRolloverFrom() != null;
        const rolloverFrom = this.settings.budgetRolloverFrom() ?? month;
        const childrenOf = new Map();
        allCategories.filter(c => c.parent_id != null).forEach(c => {
            if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, []);
            childrenOf.get(c.parent_id).push(c.id);
        });
        const monthSpend = spendOf(month, spend);

        const byCategory = new Map();
        scoped.filter(b => !b.income && b.paid && !b.adjustment).forEach(b => {
            const t = byCategory.get(b.categoryId) ?? {total: 0, count: 0};
            byCategory.set(b.categoryId, {total: t.total + b.cents, count: t.count + b.count});
        });
        book.categoryIds().filter(id => book.effective(id, month) && byId.has(id))
            .forEach(id => { if (!byCategory.has(id)) byCategory.set(id, {total: 0, count: 0}); });

        const categories = [...byCategory.entries()]
            .map(([id, tally]) => this.categoryTotal(id, tally, byId, book, month, spent, rollover, rolloverFrom, spend, childrenOf, monthSpend))
            .sort((a, b) => b.total - a.total);

        const totalBase = book.base(null, month);
        let totalCarry = null;
        let totalBudget = null;
        if (totalBase != null) {
            totalCarry = rollover ? carryInto(null, month, rolloverFrom, book, spend, childrenOf) : 0;
            totalBudget = totalBase + totalCarry;
        }

        const trend = [];
        for (let i = TREND_MONTHS - 1; i >= 0; i--) {
            const m = addMonths(month, -i);
            const rows = totals.filter(b => b.month === m && inAccount(b));
            trend.push({month: m, income: sum(rows, true, true), expense: sum(rows, false, true)});
        }
        const previousSpent = trend[trend.length - 2].expense;

        const c = fromCents;
        return {
            month, currency: view, income: c(income), expense: c(spent), balance: c(balance), adjustment: c(adjustment), previousExpense: c(previousSpent),
            pendingIncome: c(pendingIncome), pendingExpense: c(pendingExpense), projectedBalance: c(projected),
            totalBudget: c(totalBudget), totalBudgetBase: c(totalBase), totalCarry: c(totalCarry), totalSpent: c(monthSpend.total),
            budgetRollover: rollover,
            categories: categories.map(t => ({...t, total: c(t.total), budget: c(t.budget), budgetBase: c(t.budgetBase),
                carry: c(t.carry), budgetSpent: c(t.budgetSpent)})),
            trend: trend.map(t => ({month: t.month, income: c(t.income), expense: c(t.expense)}))
        };
    }

    categoryTotal(categoryId, tally, byId, book, month, totalSpent, rollover, rolloverFrom, spend, childrenOf, monthSpend) {
        const category = categoryId == null ? null : byId.get(categoryId);
        const total = tally.total;
        const percent = totalSpent === 0 ? 0 : Math.round((total * 1000) / totalSpent) / 10;
        let budget = null;
        let budgetBase = null;
        let carry = null;
        let budgetSpent = null;
        if (categoryId != null) {
            const base = book.base(categoryId, month);
            if (base != null) {
                budgetBase = base;
                carry = rollover ? carryInto(categoryId, month, rolloverFrom, book, spend, childrenOf) : 0;
                budget = budgetBase + carry;
                budgetSpent = spentWithChildren(categoryId, monthSpend, childrenOf);
            }
        }
        return {
            categoryId,
            parentId: category?.parent_id ?? null,
            name: category ? category.name : 'Sem categoria',
            icon: category ? category.icon : 'package',
            color: category ? category.color : '#9E9E9E',
            total, percent, budget, budgetBase, carry, budgetSpent, count: tally.count
        };
    }
}

/**
 * O que sobrou (positivo) ou estourou (negativo) de um limite nos meses entre o inicio da sobra acumulada e o mes
 * dado. Um mes sem limite zera o acumulado.
 */
function carryInto(categoryId, month, from, book, spend, childrenOf) {
    const earliest = addMonths(month, -ROLLOVER_MAX_MONTHS);
    let m = from > earliest ? from : earliest;
    let carry = 0;
    while (m < month) {
        const base = book.base(categoryId, m);
        if (base == null) carry = 0;
        else {
            const spent = categoryId == null ? spendOf(m, spend).total : spentWithChildren(categoryId, spendOf(m, spend), childrenOf);
            carry = base + carry - spent;
        }
        m = addMonths(m, 1);
    }
    return carry;
}

function spentWithChildren(categoryId, monthSpend, childrenOf) {
    let result = monthSpend.own.get(categoryId) ?? 0;
    for (const child of childrenOf.get(categoryId) ?? []) result += monthSpend.own.get(child) ?? 0;
    return result;
}

const NO_SPEND = {own: new Map(), total: 0};
const spendOf = (month, spend) => spend.get(month) ?? NO_SPEND;

/** Despesas pagas de cada mes, todas as contas: por categoria (so a propria, sem subcategorias) e no total. */
function spendByMonth(totals) {
    const result = new Map();
    for (const b of totals) {
        if (b.income || !b.paid || b.adjustment) continue;
        if (!result.has(b.month)) result.set(b.month, {own: new Map(), total: 0});
        const entry = result.get(b.month);
        entry.total += b.cents;
        if (b.categoryId != null) entry.own.set(b.categoryId, (entry.own.get(b.categoryId) ?? 0) + b.cents);
    }
    return result;
}
