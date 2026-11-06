import {badRequest, conflict, invalid, notFound} from './http.js';
import {addMonths, fromCents, isIsoDate, isYearMonth, isoDate, toCents} from './util.js';

const MAX_AMOUNT = 999999999.99;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Caixinhas: dinheiro separado que cresce todo mes. A fixa recebe sozinha o mesmo valor por mes; a variavel recebe o
 * que a pessoa depositar. O dinheiro e uma reserva logica: continua na conta e o app so anota.
 */
export class Pots {
    constructor(db) {
        this.db = db;
    }

    currentMonth() { return isoDate(this.db.clock()).slice(0, 7); }

    response(p) {
        return {
            id: p.id, name: p.name, color: p.color, icon: p.icon, goal: fromCents(p.goal_cents), mode: p.mode,
            monthlyAmount: fromCents(p.monthly_cents), startMonth: p.start_month, active: !!p.active, balance: fromCents(p.balance_cents),
            accountId: p.account_id ?? null, accountName: p.account_name ?? null
        };
    }

    select(where = '', params = []) {
        return this.db.all(`select p.*, coalesce((select sum(e.amount_cents) from pot_entries e where e.pot_id = p.id), 0) balance_cents,
                                   a.name account_name
                            from pots p left join accounts a on a.id = p.account_id ${where}`, params);
    }

    row(id) {
        const row = this.select('where p.id = ?', [id])[0];
        if (!row) throw notFound(`Caixinha não encontrada: ${id}`);
        return row;
    }

    balanceOf(id) {
        return this.db.value('select coalesce(sum(amount_cents), 0) from pot_entries where pot_id = ?', [id]);
    }

    /** Lista as caixinhas, depois de somar o aporte automatico que ja venceu. */
    list() {
        this.sync();
        return this.select('order by p.name collate nocase').map(p => this.response(p));
    }

    create(body) {
        return this.db.tx(() => {
            const f = this.validate(body, null);
            const {lastId} = this.db.run(`insert into pots (uuid, name, color, icon, goal_cents, mode, monthly_cents, start_month, active, account_id, updated_at)
                                          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [this.db.newId(), f.name, f.color, f.icon, f.goalCents, f.mode, f.monthlyCents, f.start, f.active, f.accountId, this.db.now()]);
            this.sync();
            return this.response(this.row(lastId));
        });
    }

    /** O mes de inicio de uma caixinha existente nao muda, para os aportes ja criados continuarem coerentes. */
    update(id, body) {
        return this.db.tx(() => {
            const current = this.row(id);
            const f = this.validate(body, current);
            this.db.run('update pots set name = ?, color = ?, icon = ?, goal_cents = ?, mode = ?, monthly_cents = ?, active = ?, account_id = ?, updated_at = ? where id = ?',
                [f.name, f.color, f.icon, f.goalCents, f.mode, f.monthlyCents, f.active, f.accountId, this.db.now(), id]);
            this.sync();
            return this.response(this.row(id));
        });
    }

    /** Excluir apaga o historico; os desejos que apontavam para ela so perdem o vinculo. */
    delete(id) {
        this.row(id);
        this.db.tx(() => {
            this.db.run('update wish_items set pot_id = null, updated_at = ? where pot_id = ?', [this.db.now(), id]);
            this.db.run('delete from pot_entries where pot_id = ?', [id]);
            this.db.run('delete from pots where id = ?', [id]);
        });
    }

    entries(potId) {
        this.row(potId);
        return this.db.all('select * from pot_entries where pot_id = ? order by entry_date desc, id desc', [potId])
            .map(e => this.entryResponse(e));
    }

    entryResponse(e) {
        return {id: e.id, date: e.entry_date, amount: fromCents(e.amount_cents), kind: e.kind, note: e.note};
    }

    moveRequest(body) {
        const errors = {};
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount == null || Number.isNaN(amount)) errors.amount = 'Informe o valor.';
        else if (amount < 0.01) errors.amount = 'O valor deve ser de pelo menos 0,01.';
        else if (amount > MAX_AMOUNT) errors.amount = 'O valor é alto demais.';
        if (body.note != null && String(body.note).length > 255) errors.note = 'A observação pode ter até 255 caracteres.';
        if (body.date != null && !isIsoDate(body.date)) errors.date = 'Data inválida.';
        if (Object.keys(errors).length) throw invalid(errors);
        return {cents: toCents(amount), date: body.date, note: body.note};
    }

    deposit(potId, body) {
        return this.db.tx(() => {
            this.row(potId);
            const m = this.moveRequest(body ?? {});
            return this.entryResponse(this.addEntry(potId, m.cents, m.date, 'MANUAL', m.note));
        });
    }

    withdraw(potId, body) {
        return this.db.tx(() => {
            this.row(potId);
            const m = this.moveRequest(body ?? {});
            if (this.balanceOf(potId) < m.cents) throw badRequest('Saldo da caixinha insuficiente.');
            return this.entryResponse(this.addEntry(potId, -m.cents, m.date, 'WITHDRAWAL', m.note));
        });
    }

    /** So movimentos manuais saem; os aportes automaticos e as compras seguem a origem deles. */
    deleteEntry(entryId) {
        const entry = this.db.get('select * from pot_entries where id = ?', [entryId]);
        if (!entry) throw notFound(`Movimento não encontrado: ${entryId}`);
        if (entry.kind !== 'MANUAL' && entry.kind !== 'WITHDRAWAL') throw conflict('Só movimentos manuais podem ser removidos.');
        this.db.run('delete from pot_entries where id = ?', [entryId]);
    }

    /** Usado pela lista de desejos quando um item e pago com a caixinha. */
    recordPurchase(potId, cents, date, note, wishItemId) {
        if (this.balanceOf(potId) < cents) throw badRequest('Saldo da caixinha insuficiente.');
        return this.addEntry(potId, -cents, date, 'PURCHASE', note, null, wishItemId);
    }

    /** Soma o aporte mensal de toda caixinha fixa ativa, em cada mes que ainda nao tem um. */
    sync() {
        this.db.tx(() => {
            const now = this.currentMonth();
            for (const pot of this.db.all("select * from pots where active = 1 and mode = 'FIXED' and monthly_cents > 0")) {
                const existing = new Set(this.db.all('select auto_month m from pot_entries where pot_id = ? and auto_month is not null', [pot.id]).map(r => r.m));
                for (let m = pot.start_month; m <= now; m = addMonths(m, 1)) {
                    if (!existing.has(m)) this.addEntry(pot.id, pot.monthly_cents, `${m}-01`, 'AUTO', 'Aporte mensal', m);
                }
            }
        });
    }

    addEntry(potId, cents, date, kind, note, autoMonth = null, wishItemId = null) {
        const clean = note == null || !String(note).trim() ? null : String(note).trim();
        const {lastId} = this.db.run(`insert into pot_entries (uuid, pot_id, entry_date, amount_cents, kind, note, auto_month, wish_item_id, updated_at)
                                      values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [this.db.newId(), potId, date || isoDate(this.db.clock()), cents, kind, clean, autoMonth, wishItemId, this.db.now()]);
        return this.db.get('select * from pot_entries where id = ?', [lastId]);
    }

    validate(body, current) {
        const errors = {};
        const name = body.name == null ? '' : String(body.name).trim();
        if (!name) errors.name = 'Informe o nome da caixinha.';
        else if (name.length > 80) errors.name = 'O nome pode ter até 80 caracteres.';
        if (body.color && String(body.color).length > 7) errors.color = 'A cor deve ser um código como #6750A4.';
        if (body.icon && String(body.icon).length > 16) errors.icon = 'O ícone é longo demais.';
        const goal = body.goal == null || body.goal === '' ? null : Number(body.goal);
        if (goal != null && goal > MAX_AMOUNT) errors.goal = 'A meta é alta demais.';
        const monthly = body.monthlyAmount == null || body.monthlyAmount === '' ? null : Number(body.monthlyAmount);
        if (monthly != null && monthly > MAX_AMOUNT) errors.monthlyAmount = 'O aporte é alto demais.';
        if (Object.keys(errors).length) throw invalid(errors);

        const clash = this.db.get('select id from pots where name = ?', [name]);
        if (clash && clash.id !== current?.id) throw conflict('Já existe uma caixinha com esse nome.');
        const mode = body.mode ?? 'VARIABLE';
        if (!['FIXED', 'VARIABLE'].includes(mode)) throw badRequest(`Modo inválido: ${mode}`);
        if (mode === 'FIXED' && !(monthly > 0)) throw badRequest('Informe o valor do aporte mensal.');
        if (goal != null && !(goal > 0)) throw badRequest('A meta deve ser maior que zero.');
        if (body.startMonth && !isYearMonth(body.startMonth)) throw badRequest(`Mês inválido: ${body.startMonth} (use aaaa-mm).`);
        const accountId = body.accountId ?? null;
        if (accountId != null && !this.db.get('select 1 from accounts where id = ?', [accountId])) throw badRequest(`Conta não encontrada: ${accountId}`);
        return {
            name, accountId,
            color: body.color && HEX_COLOR.test(body.color) ? body.color : '#81C784',
            icon: body.icon && String(body.icon).trim() ? String(body.icon).trim() : null,
            goalCents: goal == null ? null : toCents(goal),
            mode,
            monthlyCents: mode === 'FIXED' ? toCents(monthly) : null,
            start: current ? current.start_month : body.startMonth || this.currentMonth(),
            active: body.active === false ? 0 : 1
        };
    }
}
