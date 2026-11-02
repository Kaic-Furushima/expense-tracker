import {badRequest, conflict, invalid, notFound} from './http.js';
import {addMonths, fromCents, isIsoDate, isYearMonth, isoDate, lastDay, toCents} from './util.js';

const MAX_AMOUNT = 999999999.99;
/** O pagamento automatico so recupera o mes atual e o anterior; os mais antigos pedem confirmacao. */
const AUTO_PAY_LOOKBACK_MONTHS = 1;

const pad = n => String(n).padStart(2, '0');

/** Dia 30 ou 31 num mes mais curto cai no ultimo dia do mes. */
export const dueDate = (month, day) => `${month}-${pad(Math.min(day, Number(lastDay(month).slice(8, 10))))}`;

const RULE_SELECT = `select r.*, a.name acc_name, m.name pm_name, c.name cat_name, c.icon cat_icon, c.color cat_color
    from recurring_payments r join accounts a on a.id = r.account_id
    left join payment_methods m on m.id = r.payment_method_id left join categories c on c.id = r.category_id`;

const OCCURRENCE_SELECT = `select o.*, r.name, r.type, r.variable_amount, r.account_id, r.payment_method_id, a.name acc_name,
    m.name pm_name, c.icon cat_icon, c.color cat_color, r.amount_cents rule_cents, r.active
    from recurring_occurrences o join recurring_payments r on r.id = o.recurring_id join accounts a on a.id = r.account_id
    left join payment_methods m on m.id = r.payment_method_id left join categories c on c.id = r.category_id`;

/**
 * Pagamentos recorrentes: uma regra (nome, valor, dia do mes) e uma ocorrencia por mes. A ocorrencia fica pendente ate
 * ser paga, pela pessoa ("pagar agora", ate antes do vencimento) ou sozinha quando o "pagamento automatico" esta ligado.
 */
export class Recurring {
    constructor(db, catalog, expenses, settings) {
        this.db = db;
        this.catalog = catalog;
        this.expenses = expenses;
        this.settings = settings;
    }

    today() { return isoDate(this.db.clock()); }
    currentMonth() { return this.today().slice(0, 7); }

    // ---- regras ----

    ruleResponse(r) {
        return {
            id: r.id, name: r.name, type: r.type, amount: fromCents(r.amount_cents), variableAmount: !!r.variable_amount,
            dayOfMonth: r.day_of_month, accountId: r.account_id, accountName: r.acc_name,
            paymentMethodId: r.payment_method_id, paymentMethodName: r.pm_name ?? null,
            categoryId: r.category_id, categoryName: r.cat_name ?? null, categoryIcon: r.cat_icon ?? null, categoryColor: r.cat_color ?? null,
            active: !!r.active, startMonth: r.start_month, endMonth: r.end_month
        };
    }

    rule(id) {
        const row = this.db.get(`${RULE_SELECT} where r.id = ?`, [id]);
        if (!row) throw notFound(`Pagamento recorrente não encontrado: ${id}`);
        return row;
    }

    rules() {
        return this.db.all(`${RULE_SELECT} order by r.name collate nocase`).map(r => this.ruleResponse(r));
    }

    create(body) {
        return this.db.tx(() => {
            const f = this.validate(body);
            const {lastId} = this.db.run(`insert into recurring_payments (uuid, name, type, amount_cents, variable_amount, day_of_month, account_id,
                payment_method_id, category_id, active, start_month, end_month, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [this.db.newId(), f.name, f.type, f.cents, f.variable, f.day, f.accountId, f.methodId, f.categoryId, f.active, f.start, f.end, this.db.now()]);
            this.sync();
            return this.ruleResponse(this.rule(lastId));
        });
    }

    update(id, body) {
        return this.db.tx(() => {
            this.rule(id);
            const f = this.validate(body);
            this.db.run(`update recurring_payments set name = ?, type = ?, amount_cents = ?, variable_amount = ?, day_of_month = ?, account_id = ?,
                payment_method_id = ?, category_id = ?, active = ?, start_month = ?, end_month = ?, updated_at = ? where id = ?`,
                [f.name, f.type, f.cents, f.variable, f.day, f.accountId, f.methodId, f.categoryId, f.active, f.start, f.end, this.db.now(), id]);
            // Um valor novo vale daqui para a frente: as pendentes seguem a regra, as pagas mantem o que foram.
            for (const o of this.db.all("select id, occurrence_month from recurring_occurrences where recurring_id = ? and status = 'PENDING'", [id])) {
                this.db.run('update recurring_occurrences set amount_cents = ?, due_date = ?, updated_at = ? where id = ?',
                    [f.cents, dueDate(o.occurrence_month, f.day), this.db.now(), o.id]);
            }
            this.sync();
            return this.ruleResponse(this.rule(id));
        });
    }

    /** Excluir a regra apaga as ocorrencias; os lancamentos ja criados por elas ficam. */
    delete(id) {
        this.rule(id);
        this.db.tx(() => {
            this.db.run('delete from recurring_occurrences where recurring_id = ?', [id]);
            this.db.run('delete from recurring_payments where id = ?', [id]);
        });
    }

    validate(body) {
        const errors = {};
        const name = body.name == null ? '' : String(body.name).trim();
        if (!name) errors.name = 'Informe o nome do pagamento.';
        else if (name.length > 120) errors.name = 'O nome pode ter até 120 caracteres.';
        const day = Number(body.dayOfMonth ?? 0);
        if (!Number.isInteger(day) || day < 1 || day > 31) errors.dayOfMonth = 'O dia deve estar entre 1 e 31.';
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount != null && amount > MAX_AMOUNT) errors.amount = 'O valor é alto demais.';
        if (Object.keys(errors).length) throw invalid(errors);

        const variable = body.variableAmount === true;
        if (!variable && (amount == null || !(amount > 0))) throw badRequest('Informe o valor ou marque como variável.');
        const type = body.type ?? 'EXPENSE';
        if (!['EXPENSE', 'INCOME'].includes(type)) throw badRequest(`Tipo inválido: ${type}`);
        const start = body.startMonth ? this.month(body.startMonth) : this.currentMonth();
        const end = body.endMonth ? this.month(body.endMonth) : null;
        if (end && end < start) throw badRequest('O mês final não pode ser anterior ao inicial.');

        const account = body.accountId == null ? this.catalog.defaultAccount() : this.catalog.account(body.accountId);
        if (body.paymentMethodId != null) this.catalog.method(body.paymentMethodId);
        if (body.categoryId != null) this.catalog.category(body.categoryId);
        return {
            name, type, variable: variable ? 1 : 0, cents: variable ? null : toCents(amount), day, accountId: account.id,
            methodId: body.paymentMethodId ?? null, categoryId: body.categoryId ?? null,
            active: body.active === false ? 0 : 1, start, end
        };
    }

    month(text) {
        if (!isYearMonth(text)) throw badRequest(`Mês inválido: ${text} (use aaaa-mm).`);
        return text;
    }

    // ---- ocorrencias ----

    occurrenceResponse(o) {
        return {
            id: o.id, recurringId: o.recurring_id, name: o.name, type: o.type, month: o.occurrence_month, dueDate: o.due_date,
            status: o.status, paidDate: o.paid_date, amount: fromCents(o.amount_cents), variableAmount: !!o.variable_amount,
            expenseId: o.expense_id, accountId: o.account_id, accountName: o.acc_name,
            paymentMethodId: o.payment_method_id, paymentMethodName: o.pm_name ?? null,
            categoryIcon: o.cat_icon ?? null, categoryColor: o.cat_color ?? null
        };
    }

    occurrence(id) {
        const row = this.db.get(`${OCCURRENCE_SELECT} where o.id = ?`, [id]);
        if (!row) throw notFound(`Ocorrência não encontrada: ${id}`);
        return row;
    }

    /** O que vence num mes (criando antes o que falta), inclusive o que ja foi pago ou pulado. */
    occurrencesOf(month) {
        if (!isYearMonth(month)) throw badRequest(`Mês inválido: ${month}`);
        this.sync();
        return this.db.all(`${OCCURRENCE_SELECT} where o.occurrence_month = ? order by o.due_date, o.id`, [month])
            .map(o => this.occurrenceResponse(o));
    }

    /**
     * Cria as ocorrencias que faltam, do inicio de cada regra ate o mes atual, e, com o pagamento automatico ligado,
     * paga as que ja venceram. Pode ser chamada varias vezes (e depois de dias sem abrir o app).
     */
    sync() {
        this.db.tx(() => {
            const now = this.currentMonth();
            const today = this.today();
            for (const rule of this.db.all('select * from recurring_payments where active = 1')) {
                const last = rule.end_month && rule.end_month < now ? rule.end_month : now;
                const existing = new Set(this.db.all('select occurrence_month m from recurring_occurrences where recurring_id = ?', [rule.id]).map(r => r.m));
                for (let m = rule.start_month; m <= last; m = addMonths(m, 1)) {
                    if (existing.has(m)) continue;
                    this.db.run(`insert into recurring_occurrences (uuid, recurring_id, occurrence_month, due_date, status, amount_cents, updated_at)
                                 values (?, ?, ?, ?, 'PENDING', ?, ?)`,
                        [this.db.newId(), rule.id, m, dueDate(m, rule.day_of_month), rule.variable_amount ? null : rule.amount_cents, this.db.now()]);
                }
            }
            if (this.settings.autoPayRecurring()) {
                const oldest = addMonths(now, -AUTO_PAY_LOOKBACK_MONTHS);
                const due = this.db.all(`${OCCURRENCE_SELECT} where o.status = 'PENDING' and o.due_date <= ? order by o.due_date, o.id`, [today]);
                for (const o of due) {
                    if (o.active && !o.variable_amount && o.occurrence_month >= oldest) this.payRow(o, o.due_date, null, null, null);
                }
            }
        });
    }

    /** Paga uma ocorrencia agora ou na data escolhida (por exemplo dia 28 para um vencimento no 30). Variavel exige valor. */
    pay(id, body = {}) {
        const errors = {};
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount != null && (Number.isNaN(amount) || amount < 0.01)) errors.amount = 'O valor deve ser de pelo menos 0,01.';
        else if (amount != null && amount > MAX_AMOUNT) errors.amount = 'O valor é alto demais.';
        if (body.date != null && !isIsoDate(body.date)) errors.date = 'Data inválida.';
        if (Object.keys(errors).length) throw invalid(errors);
        return this.db.tx(() => {
            const o = this.occurrence(id);
            if (o.status === 'PAID') throw conflict('Este pagamento já foi feito.');
            this.payRow(o, body.date || this.today(), amount, body.accountId ?? null, body.paymentMethodId ?? null);
            return this.occurrenceResponse(this.occurrence(id));
        });
    }

    payRow(o, date, amount, accountId, methodId) {
        const cents = amount != null ? toCents(amount) : o.amount_cents ?? o.rule_cents;
        if (cents == null || cents <= 0) throw badRequest('Informe o valor deste pagamento.');
        const rule = this.db.get('select * from recurring_payments where id = ?', [o.recurring_id]);
        const account = accountId == null ? this.catalog.account(rule.account_id) : this.catalog.account(accountId);
        if (methodId != null) this.catalog.method(methodId);
        const expenseId = this.expenses.insert({
            name: rule.name, description: 'Pagamento recorrente', amountCents: cents, date, type: rule.type, status: 'PAID',
            categoryId: rule.category_id, accountId: account.id, paymentMethodId: methodId ?? rule.payment_method_id, tagIds: []
        });
        this.db.run("update recurring_occurrences set status = 'PAID', paid_date = ?, amount_cents = ?, expense_id = ?, updated_at = ? where id = ?",
            [date, cents, expenseId, this.db.now(), o.id]);
    }

    skip(id) {
        return this.db.tx(() => {
            if (this.occurrence(id).status === 'PAID') throw conflict('Este pagamento já foi feito.');
            this.db.run("update recurring_occurrences set status = 'SKIPPED', updated_at = ? where id = ?", [this.db.now(), id]);
            return this.occurrenceResponse(this.occurrence(id));
        });
    }

    reopen(id) {
        return this.db.tx(() => {
            if (this.occurrence(id).status !== 'SKIPPED') throw conflict('Só é possível reabrir um pagamento pulado.');
            this.db.run("update recurring_occurrences set status = 'PENDING', updated_at = ? where id = ?", [this.db.now(), id]);
            return this.occurrenceResponse(this.occurrence(id));
        });
    }

    // ---- "Por vir" ----

    /** O que falta pagar/receber ate `end`: ocorrencias pendentes de regras ativas e as de meses futuros que ainda nao existem. */
    upcoming(end, accountId, today) {
        this.sync();
        const items = [];
        const unknownOrRule = o => o.amount_cents ?? (o.variable_amount ? null : o.rule_cents);
        for (const o of this.db.all(`${OCCURRENCE_SELECT} where o.status = 'PENDING' and o.due_date <= ? order by o.due_date, o.id`, [end])) {
            if (!o.active || (accountId != null && accountId !== o.account_id)) continue;
            items.push({kind: 'OCCURRENCE', id: o.id, date: o.due_date, name: o.name, type: o.type, cents: unknownOrRule(o),
                accountName: o.acc_name, overdue: o.due_date < today});
        }
        const current = today.slice(0, 7);
        for (const r of this.db.all(`${RULE_SELECT} where r.active = 1`)) {
            if (accountId != null && accountId !== r.account_id) continue;
            const lastMonth = !r.end_month || r.end_month > end.slice(0, 7) ? end.slice(0, 7) : r.end_month;
            const existing = new Set(this.db.all('select occurrence_month m from recurring_occurrences where recurring_id = ?', [r.id]).map(x => x.m));
            for (let m = addMonths(current, 1); m <= lastMonth; m = addMonths(m, 1)) {
                const due = dueDate(m, r.day_of_month);
                if (m < r.start_month || due > end || existing.has(m)) continue;
                items.push({kind: 'OCCURRENCE', id: null, date: due, name: r.name, type: r.type, cents: r.variable_amount ? null : r.amount_cents,
                    accountName: r.acc_name, overdue: false});
            }
        }
        return items;
    }
}
