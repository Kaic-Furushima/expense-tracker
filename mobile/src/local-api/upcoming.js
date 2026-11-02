import {badRequest} from './http.js';
import {hasInvoices} from './invoices.js';
import {addMonthsToDate, fromCents, isIsoDate, isoDate} from './util.js';

const MAX_MONTHS = 36;

/**
 * "Por vir": o que ainda entra e sai das contas num periodo e o que sobra depois. Soma os lancamentos marcados
 * "a pagar / receber", os pagamentos recorrentes pendentes (e os dos proximos meses) e as faturas de cartao ainda a pagar.
 */
export class Upcoming {
    constructor(db, catalog, invoices, recurring) {
        this.db = db;
        this.catalog = catalog;
        this.invoices = invoices;
        this.recurring = recurring;
    }

    compute(from, to, accountId) {
        const today = isoDate(this.db.clock());
        for (const [value, label] of [[from, 'inicial'], [to, 'final']]) {
            if (value && !isIsoDate(value)) throw badRequest(`Data ${label} inválida.`);
        }
        const start = from || today;
        const end = to || addMonthsToDate(start, 1);
        if (end < start) throw badRequest('A data final deve ser depois da inicial.');
        if (end > addMonthsToDate(today, MAX_MONTHS)) throw badRequest(`O período pode ir até ${MAX_MONTHS} meses à frente.`);

        // lancamentos a pagar/receber (os de cartao com fatura ja estao dentro da fatura)
        const all = this.db.all(`select e.id, e.date, e.name, e.type, e.amount_cents, e.account_id, a.name account_name,
                                        a.type account_type, a.closing_day, a.due_day
                                 from expenses e join accounts a on a.id = e.account_id
                                 where e.deleted_at is null and e.status = 'PENDING' and e.date <= ?
                                 order by e.date, e.id`, [end])
            .filter(e => (accountId == null || e.account_id === accountId)
                && !hasInvoices({type: e.account_type, closing_day: e.closing_day, due_day: e.due_day}))
            .map(e => ({kind: 'EXPENSE', id: e.id, date: e.date, name: e.name, type: e.type, cents: e.amount_cents,
                accountName: e.account_name, overdue: e.date < today}));
        all.push(...this.recurring.upcoming(end, accountId, today)); // recorrentes pendentes e dos proximos meses
        all.push(...this.invoices.unpaid(end, accountId, today)); // faturas de cartao ainda a pagar

        let startBalance = this.currentBalance(accountId);
        const items = [];
        for (const item of all) {
            if (start > today && item.date < start) startBalance += (item.type === 'INCOME' ? 1 : -1) * (item.cents ?? 0); // valor variavel: ainda sem valor
            else items.push(item);
        }
        items.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
        let incoming = 0;
        let outgoing = 0;
        let unknown = 0;
        for (const item of items) {
            if (item.cents == null) unknown++;
            else if (item.type === 'INCOME') incoming += item.cents;
            else outgoing += item.cents;
        }
        return {
            from: start, to: end,
            startBalance: fromCents(startBalance), incoming: fromCents(incoming), outgoing: fromCents(outgoing),
            endBalance: fromCents(startBalance + incoming - outgoing), unknownAmounts: unknown,
            items: items.map(i => ({kind: i.kind, id: i.id, date: i.date, name: i.name, type: i.type, amount: fromCents(i.cents),
                accountName: i.accountName, overdue: i.overdue}))
        };
    }

    /** Dinheiro disponivel hoje: toda conta propria ativa, menos cartoes de credito (a divida aparece nas faturas). */
    currentBalance(accountId) {
        const balances = this.catalog.balances();
        let total = 0;
        for (const a of this.db.all('select id, type, archived, parent_id, initial_cents from accounts')) {
            const counts = accountId != null ? a.id === accountId : !a.archived && a.parent_id == null && a.type !== 'CREDIT_CARD';
            if (counts) total += balances.get(a.id) ?? a.initial_cents;
        }
        return total;
    }
}
