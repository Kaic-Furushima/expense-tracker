import {addMonths, isoDate, lastDay, toCents} from './util.js';

const PALETTE = ['#E57373', '#81C784', '#64B5F6', '#FFB74D', '#BA68C8', '#4DB6AC', '#F06292', '#A1887F'];

/** String.hashCode() do Java: as categorias novas ganham a mesma cor que ganhariam no PC. */
export function javaHash(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return h;
}

const pad = n => String(n).padStart(2, '0');

/** Preenche o app com lancamentos de exemplo (3 meses) para quem acabou de instalar ter o que ver. Pode rodar de novo sem duplicar. */
export class Demo {
    constructor(db, catalog, expenses, transfers, budgets) {
        this.db = db;
        this.catalog = catalog;
        this.expenses = expenses;
        this.transfers = transfers;
        this.budgets = budgets;
    }

    load() {
        this.db.tx(() => {
            const santander = this.account('Santander', 'CHECKING', '#E53935');
            const bradesco = this.account('Bradesco', 'CHECKING', '#D81B60');
            const nubank = this.account('Nubank', 'CHECKING', '#8E24AA');
            // O investimento e uma parte da conta Nubank (a "caixinha"): o dinheiro que vai para la sai do saldo disponivel.
            const caixinha = this.account('Caixinha Nubank', 'INVESTMENT', '#43A047');
            if (caixinha.parentId == null) this.catalog.updateAccount(caixinha.id, {...caixinha, parentId: nubank.id});

            const today = isoDate(this.db.clock());
            const now = today.slice(0, 7);
            const todayDay = Number(today.slice(8, 10));
            for (let back = 2; back >= 0; back--) {
                const m = addMonths(now, -back);
                const last = back === 0 ? todayDay : Number(lastDay(m).slice(8, 10));
                const day = d => Math.min(d, last);
                this.add(m, day(5), 'INCOME', 'Salário', 'Salário', '5200.00', santander, 'Transferência');
                this.add(m, 1, 'EXPENSE', 'Aluguel', 'Moradia', '1450.00', santander, 'Pix');
                this.add(m, day(3), 'EXPENSE', 'Mercado', 'Mercado', `${380 + back * 25}.90`, bradesco, 'Débito');
                this.add(m, day(9), 'EXPENSE', 'Internet', 'Moradia', '99.90', bradesco, 'Crédito');
                this.add(m, day(12), 'EXPENSE', 'Streaming', 'Assinaturas', '55.90', bradesco, 'Crédito');
                this.add(m, day(14), 'EXPENSE', 'Restaurante', 'Alimentação', `${88 + back * 12}.50`, bradesco, 'Crédito');
                this.add(m, day(17), 'EXPENSE', 'Transporte por app', 'Transporte', `${42 + back * 6}.30`, santander, 'Pix');
                this.transfer(m, day(20), santander, caixinha, '400.00', 'Aporte mensal na caixinha');
                if (back === 0) this.add(m, 28, 'EXPENSE', 'Conta de luz', 'Moradia', '142.30', santander, null, 'PENDING');
            }
            for (const [name, limit] of [['Alimentação', 500], ['Mercado', 700], ['Transporte', 150]]) {
                this.budgets.upsertRow(this.category(name), '2000-01', toCents(limit)); // vale para todos os meses
            }
        });
    }

    account(name, type, color) {
        const found = this.db.get('select id from accounts where name = ?', [name]);
        return found ? this.catalog.accountWithBalance(found.id) : this.catalog.createAccount({name, type, color});
    }

    category(name) {
        const found = this.db.get('select id from categories where name = ?', [name]);
        if (found) return found.id;
        return this.catalog.createCategory({name, color: PALETTE[((javaHash(name) % PALETTE.length) + PALETTE.length) % PALETTE.length]}).id;
    }

    method(name) {
        return this.db.get('select id from payment_methods where name = ?', [name])?.id ?? this.catalog.createMethod({name}).id;
    }

    dateIn(month, day) {
        return `${month}-${pad(Math.max(1, Math.min(day, Number(lastDay(month).slice(8, 10)))))}`;
    }

    add(month, day, type, name, category, amount, account, paymentMethod, status = 'PAID') {
        const date = this.dateIn(month, day);
        const cents = toCents(amount);
        if (this.db.get('select 1 from expenses where deleted_at is null and name = ? and type = ? and date = ? and amount_cents = ?', [name, type, date, cents])) return;
        this.expenses.insert({
            name, description: null, amountCents: cents, date, type, status, categoryId: this.category(category), accountId: account.id,
            paymentMethodId: paymentMethod == null ? null : this.method(paymentMethod), tagIds: []
        });
    }

    transfer(month, day, from, to, amount, description) {
        const date = this.dateIn(month, day);
        if (this.db.get(`select 1 from transfers where deleted_at is null and from_account_id = ? and to_account_id = ? and date = ? and amount_cents = ?`,
            [from.id, to.id, date, toCents(amount)])) return;
        this.transfers.create({fromAccountId: from.id, toAccountId: to.id, amount, date, description});
    }
}
