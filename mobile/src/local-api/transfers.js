import {badRequest, conflict, invalid, notFound} from './http.js';
import {firstDay, fromCents, isIsoDate, isYearMonth, isoDate, lastDay, toCents} from './util.js';

const MAX_AMOUNT = 999999999.99;

/**
 * Transferencias entre contas (inclusive para um cofrinho). Nao sao receita nem despesa: so movem saldo.
 * Colocar dinheiro num cofrinho e como se registra um investimento.
 */
export class Transfers {
    constructor(db, catalog) {
        this.db = db;
        this.catalog = catalog;
    }

    response(r) {
        return {
            id: r.id, date: r.date, amount: fromCents(r.amount_cents), toAmount: r.to_amount_cents == null ? null : fromCents(r.to_amount_cents),
            description: r.description,
            fromAccountId: r.from_account_id, fromAccountName: r.from_name, fromAccountColor: r.from_color,
            toAccountId: r.to_account_id, toAccountName: r.to_name, toAccountColor: r.to_color,
            createdAt: r.created_at, updatedAt: r.updated_at
        };
    }

    select(where, params) {
        return this.db.all(`select t.*, f.name from_name, f.color from_color, d.name to_name, d.color to_color
                            from transfers t join accounts f on f.id = t.from_account_id join accounts d on d.id = t.to_account_id
                            where t.deleted_at is null ${where}`, params);
    }

    row(id) {
        const row = this.select('and t.id = ?', [id])[0];
        if (!row) throw notFound(`Transferência não encontrada: ${id}`);
        return row;
    }

    /** Do mes, mais novas primeiro; com conta, so as que sairam dela ou entraram nela. */
    list(month, accountId) {
        if (!isYearMonth(month)) throw badRequest(`Mês inválido: ${month}`);
        const rows = this.select('and t.date between ? and ? order by t.date desc, t.id desc', [firstDay(month), lastDay(month)]);
        return rows.filter(t => accountId == null || t.from_account_id === accountId || t.to_account_id === accountId).map(t => this.response(t));
    }

    /** Pagamentos de fatura recebidos por um cartao (transferencias marcadas com o mes da fatura), do mais antigo ao mais novo. */
    invoicePayments(cardId) {
        return this.select('and t.to_account_id = ? and t.invoice_month is not null order by t.date, t.id', [cardId]);
    }

    /** invoiceMonth ("2026-05") marca a transferencia como pagamento daquela fatura do cartao de destino. */
    create(body, invoiceMonth = null) {
        return this.db.tx(() => {
            const f = this.validate(body, null);
            const now = this.db.now();
            const {lastId} = this.db.run(`insert into transfers (uuid, from_account_id, to_account_id, amount_cents, to_amount_cents, date, description, invoice_month, created_at, updated_at)
                                          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [this.db.newId(), f.fromId, f.toId, f.cents, f.toCents, f.date, f.description, invoiceMonth, now, now]);
            return this.response(this.row(lastId));
        });
    }

    update(id, body) {
        return this.db.tx(() => {
            const current = this.row(id);
            const f = this.validate(body, current);
            this.db.run('update transfers set from_account_id = ?, to_account_id = ?, amount_cents = ?, to_amount_cents = ?, date = ?, description = ?, updated_at = ? where id = ?',
                [f.fromId, f.toId, f.cents, f.toCents, f.date, f.description, this.db.now(), id]);
            return this.response(this.row(id));
        });
    }

    /** Manda para a lixeira. */
    trash(id) {
        this.row(id);
        const now = this.db.now();
        this.db.run('update transfers set deleted_at = ?, updated_at = ? where id = ?', [now, now, id]);
    }

    validate(body, current) {
        const errors = {};
        if (body.fromAccountId == null) errors.fromAccountId = 'Informe a conta de origem.';
        if (body.toAccountId == null) errors.toAccountId = 'Informe a conta de destino.';
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount == null || Number.isNaN(amount)) errors.amount = 'Informe o valor.';
        else if (amount < 0.01) errors.amount = 'O valor deve ser de pelo menos 0,01.';
        else if (amount > MAX_AMOUNT) errors.amount = 'O valor é alto demais.';
        if (body.description != null && String(body.description).length > 255) errors.description = 'A observação pode ter até 255 caracteres.';
        if (Object.keys(errors).length) throw invalid(errors);

        if (body.fromAccountId === body.toAccountId) throw badRequest('A origem e o destino devem ser contas diferentes.');
        const date = body.date || isoDate(this.db.clock());
        if (!isIsoDate(date)) throw invalid({date: 'Data inválida.'});
        const year = Number(date.slice(0, 4));
        if (year < 2000 || year > 2100) throw badRequest('A data deve estar entre os anos 2000 e 2100.');

        const from = this.catalog.account(body.fromAccountId);
        const to = this.catalog.account(body.toAccountId);
        this.requireUsable(from, current?.from_account_id);
        this.requireUsable(to, current?.to_account_id);
        const description = body.description && String(body.description).trim() ? String(body.description).trim() : null;
        // entre moedas diferentes o valor que chegou e outro: a pessoa informa os dois lados (sem cotacao automatica)
        const main = this.catalog.mainCurrency();
        let toCentsValue = null;
        if ((from.currency ?? main) !== (to.currency ?? main)) {
            const received = body.toAmount == null || body.toAmount === '' ? null : Number(body.toAmount);
            if (received == null || Number.isNaN(received)) throw invalid({toAmount: 'Informe o valor que chegou na conta de destino.'});
            if (received < 0.01) throw invalid({toAmount: 'O valor deve ser de pelo menos 0,01.'});
            if (received > MAX_AMOUNT) throw invalid({toAmount: 'O valor é alto demais.'});
            toCentsValue = toCents(received);
        }
        return {fromId: from.id, toId: to.id, cents: toCents(amount), toCents: toCentsValue, date, description};
    }

    /** Conta arquivada nao recebe transferencias novas (uma antiga pode continuar apontando para ela). */
    requireUsable(account, currentId) {
        if (account.archived && account.id !== currentId) throw conflict(`A conta “${account.name}” está arquivada.`);
    }
}
