import {badRequest} from './http.js';
import {firstDay, isIsoDate, isYearMonth, isoDate, lastDay} from './util.js';
import {addDays, daysBetween} from './reminders.js';

const MAX_DAYS = 366 * 5;

/** Dados de um extrato. So o que esta pago entra nos totais; os pendentes sao listados a parte. */
export class Reports {
    constructor(db, catalog, settings, messages) {
        this.db = db;
        this.catalog = catalog;
        this.settings = settings;
        this.m = messages;
    }

    /** Periodo pedido: `month` (aaaa-mm) ou `from` e `to`; sem nada, o mes atual. Devolve {from, to}. */
    period({month, from, to}) {
        for (const [value, label] of [[from, 'inicial'], [to, 'final']]) {
            if (value && !isIsoDate(value)) throw badRequest(`Data ${label} inválida.`);
        }
        if (month && !isYearMonth(month)) throw badRequest(`Mês inválido: ${month}`);
        const base = month || isoDate(this.db.clock()).slice(0, 7);
        const start = from || firstDay(base);
        const end = to || (from ? addDays(this.addMonth(from), -1) : lastDay(base));
        return {from: start, to: end};
    }

    addMonth(isoDay) {
        const d = new Date(Date.UTC(Number(isoDay.slice(0, 4)), Number(isoDay.slice(5, 7)), 1));
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        const day = Math.min(Number(isoDay.slice(8, 10)), last);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    categoryLabel(row) {
        if (row.category_id == null) return this.m.t('Sem categoria');
        return row.parent_name ? `${row.parent_name} › ${row.cat_name}` : row.cat_name;
    }

    collect(from, to, accountId = null) {
        if (!from || !to || to < from) throw badRequest('Informe o período (a data final não pode ser antes da inicial).');
        if (daysBetween(from, to) > MAX_DAYS) throw badRequest('O relatório pode cobrir no máximo 5 anos.');
        const accountName = accountId == null ? null : this.catalog.account(accountId).name;

        const tags = new Map();
        for (const r of this.db.all('select et.expense_id, t.name from expense_tags et join tags t on t.id = et.tag_id order by t.name')) {
            tags.set(r.expense_id, [...(tags.get(r.expense_id) ?? []), r.name]);
        }
        const expenses = this.db.all(`select e.*, c.name cat_name, p.name parent_name, a.name acc_name, m.name pm_name from expenses e
                                      left join categories c on c.id = e.category_id left join categories p on p.id = c.parent_id
                                      join accounts a on a.id = e.account_id left join payment_methods m on m.id = e.payment_method_id
                                      where e.deleted_at is null and e.date between ? and ? order by e.date, e.id`, [from, to])
            .filter(e => accountId == null || e.account_id === accountId)
            .map(e => ({date: e.date, name: e.name, income: e.type === 'INCOME', paid: e.status !== 'PENDING', cents: e.amount_cents,
                category: this.categoryLabel(e), account: e.acc_name, method: e.pm_name ?? '', tags: tags.get(e.id) ?? []}));
        const transfers = this.db.all(`select t.*, f.name from_name, d.name to_name from transfers t join accounts f on f.id = t.from_account_id
                                       join accounts d on d.id = t.to_account_id where t.deleted_at is null and t.date between ? and ? order by t.date, t.id`, [from, to])
            .filter(t => accountId == null || t.from_account_id === accountId || t.to_account_id === accountId)
            .map(t => ({date: t.date, description: t.description, from: t.from_name, to: t.to_name, cents: t.amount_cents}));

        const sum = (income, paid) => expenses.filter(e => e.income === income && e.paid === paid).reduce((s, e) => s + e.cents, 0);
        const byCategory = new Map();
        for (const e of expenses) if (!e.income && e.paid) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.cents);
        return {
            from, to, accountName, expenses, transfers,
            income: sum(true, true), expense: sum(false, true), pendingIncome: sum(true, false), pendingExpense: sum(false, false),
            byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1])
        };
    }

    // ---- textos comuns ao PDF e a planilha ----

    title(d) { return this.m.t('Extrato') + (d.accountName == null ? '' : ` — ${d.accountName}`); }
    br(isoDay) { return `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}/${isoDay.slice(0, 4)}`; }
    period2(d) { return this.m.t('{0} a {1}', this.br(d.from), this.br(d.to)); }
    money(cents) { return this.m.money(cents / 100).replace(/[  ]/g, ' '); }
    tagsOf(e) { return e.tags.map(t => `#${t}`).join(' '); }
}
