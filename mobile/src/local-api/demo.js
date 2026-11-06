import {addMonths, isoDate, lastDay, toCents} from './util.js';

const PALETTE = ['#E57373', '#81C784', '#64B5F6', '#FFB74D', '#BA68C8', '#4DB6AC', '#F06292', '#A1887F'];
const MONTHS = 6;

/** String.hashCode() do Java: as categorias novas ganham a mesma cor que ganhariam no PC. */
export function javaHash(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return h;
}

const pad = n => String(n).padStart(2, '0');

/**
 * Preenche o app com dados de exemplo (seis meses de lancamentos em varias contas e um cartao, parcelados, tags,
 * orcamentos, pagamentos recorrentes, caixinhas, desejos e modelos) para quem acabou de instalar ter o que ver.
 * Pode rodar de novo sem duplicar. O PC tem o mesmo cenario (DemoDataService.java): mantenha os dois iguais.
 */
export class Demo {
    constructor(db, catalog, expenses, transfers, budgets, {recurring, pots, wishes, templates}) {
        this.db = db;
        this.catalog = catalog;
        this.expenses = expenses;
        this.transfers = transfers;
        this.budgets = budgets;
        this.recurring = recurring;
        this.pots = pots;
        this.wishes = wishes;
        this.templates = templates;
    }

    load() {
        this.db.tx(() => {
            const santander = this.account('Santander', 'CHECKING', '#E53935', 4000);
            const bradesco = this.account('Bradesco', 'CHECKING', '#D81B60', 6000);
            const nubank = this.account('Nubank', 'CHECKING', '#8E24AA', 800);
            // O investimento e uma parte da conta Nubank (a "caixinha"): o dinheiro que vai para la sai do saldo disponivel.
            const caixinha = this.account('Caixinha Nubank', 'INVESTMENT', '#43A047', 0);
            if (caixinha.parentId == null) this.catalog.updateAccount(caixinha.id, {...caixinha, parentId: nubank.id});
            const carteira = this.account('Carteira', 'WALLET', '#FB8C00', 200);
            const cartao = this.account('Cartão Nubank', 'CREDIT_CARD', '#7B1FA2', 0, 25, 5);

            const today = isoDate(this.db.clock());
            const now = today.slice(0, 7);
            const todayDay = Number(today.slice(8, 10));
            for (let back = MONTHS - 1; back >= 0; back--) {
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

                this.add(m, day(6), 'EXPENSE', 'Academia', 'Saúde', '99.90', bradesco, 'Débito');
                this.add(m, day(8), 'EXPENSE', 'Combustível', 'Transporte', `${160 + back * 5}.00`, santander, 'Débito');
                this.add(m, day(10), 'EXPENSE', 'Padaria', 'Alimentação', `${18 + back}.40`, carteira, 'Dinheiro');
                this.add(m, day(11), 'EXPENSE', 'Curso online', 'Educação', '49.90', cartao, 'Crédito');
                this.add(m, day(18), 'EXPENSE', 'Mercado', 'Mercado', `${150 + back * 7}.60`, bradesco, 'Débito');
                this.add(m, day(21), 'EXPENSE', 'Padaria', 'Alimentação', `${22 + back}.70`, carteira, 'Dinheiro');
                this.add(m, day(28), 'INCOME', 'Rendimentos', 'Rendimentos', `${12 + back}.35`, caixinha, null);
                if (back % 2 === 0) {
                    this.add(m, day(16), 'EXPENSE', 'Cinema', 'Lazer', '64.00', cartao, 'Crédito');
                    this.transfer(m, day(11), santander, carteira, '200.00', 'Saque para a carteira');
                }
                if (back % 2 === 1) {
                    this.add(m, day(13), 'EXPENSE', 'Farmácia', 'Saúde', `${35 + back * 4}.80`, bradesco, 'Débito');
                    this.add(m, day(18), 'INCOME', 'Freelance', 'Freelance', '850.00', nubank, 'Pix', 'PAID', ['trabalho']);
                }
                if (back % 3 === 0) this.add(m, day(19), 'EXPENSE', 'Pet shop', 'Pets', '120.00', cartao, 'Crédito');
                if (back === 2) {
                    this.add(m, day(15), 'EXPENSE', 'Passagem aérea', 'Viagem', '1240.00', cartao, 'Crédito', 'PAID', ['viagem']);
                    this.add(m, day(16), 'EXPENSE', 'Hospedagem', 'Viagem', '980.00', cartao, 'Crédito', 'PAID', ['viagem']);
                    this.add(m, day(23), 'EXPENSE', 'Presente', 'Presentes', '180.00', cartao, 'Crédito', 'PAID', ['presente']);
                }
                if (back === 0) {
                    this.add(m, 28, 'EXPENSE', 'Conta de luz', 'Moradia', '142.30', santander, null, 'PENDING');
                    this.add(m, 27, 'INCOME', 'Freelance a receber', 'Freelance', '600.00', nubank, null, 'PENDING', ['trabalho']);
                }
            }
            this.installments(addMonths(now, -3), 10, 'Notebook', 'Outros', '4500.00', 10, cartao);
            this.installments(addMonths(now, -1), 7, 'Geladeira', 'Moradia', '2400.00', 12, cartao);

            for (const [name, limit] of [['Alimentação', 500], ['Mercado', 700], ['Transporte', 150], ['Lazer', 250], ['Saúde', 300],
                ['Assinaturas', 120], ['Pets', 150]]) {
                this.budgets.upsertRow(this.category(name), '2000-01', toCents(limit)); // vale para todos os meses
            }

            this.rule('Plano de saúde', 'EXPENSE', '389.90', false, 10, santander, 'Débito', 'Saúde');
            this.rule('Seguro do carro', 'EXPENSE', '210.00', false, 15, bradesco, 'Débito', 'Transporte');
            this.rule('Conta de água', 'EXPENSE', null, true, 20, santander, 'Débito', 'Moradia');
            this.rule('Aluguel recebido', 'INCOME', '700.00', false, 8, santander, 'Pix', 'Outros');

            const viagem = this.pot('Viagem', '#64B5F6', 'plane', '8000', 'VARIABLE', null, null, nubank);
            if (viagem) {
                this.deposit(viagem, addMonths(now, -4), 5, '500.00', 'Primeiro aporte');
                this.deposit(viagem, addMonths(now, -2), 20, '800.00', 'Bônus');
                this.deposit(viagem, now, Math.min(2, todayDay), '400.00', null);
            }
            this.pot('Reserva de emergência', '#43A047', 'landmark', '20000', 'FIXED', '300', addMonths(now, -5), santander);
            const equipamentos = this.pot('Equipamentos', '#FFB74D', 'phone', '3000', 'VARIABLE', null, null, null);
            if (equipamentos) this.deposit(equipamentos, addMonths(now, -1), 12, '600.00', null);
            const equipamentosId = this.db.value('select id from pots where name = ?', ['Equipamentos']);
            this.wish('Fone de ouvido', '450.00', 'Com cancelamento de ruído', null, equipamentosId);
            this.wish('Cadeira ergonômica', '1200.00', null, null, equipamentosId);
            this.wish('Bicicleta', '1800.00', null, 'https://exemplo.com/bicicleta', null);

            this.template('Almoço', 'EXPENSE', '35.00', 'Alimentação', bradesco, 'Débito');
            this.template('Uber', 'EXPENSE', '25.00', 'Transporte', santander, 'Pix');
            this.template('Café', 'EXPENSE', '12.00', 'Alimentação', carteira, 'Dinheiro');
        });
    }

    account(name, type, color, initial, closingDay = null, dueDay = null) {
        const found = this.db.get('select id from accounts where name = ?', [name]);
        return found ? this.catalog.accountWithBalance(found.id)
            : this.catalog.createAccount({name, type, color, initialBalance: initial, closingDay, dueDay});
    }

    category(name, kind = 'EXPENSE') {
        const found = this.db.get('select id from categories where name = ? and kind = ?', [name, kind]);
        if (found) return found.id;
        return this.catalog.createCategory({name, kind, color: PALETTE[((javaHash(name) % PALETTE.length) + PALETTE.length) % PALETTE.length]}).id;
    }

    method(name) {
        return this.db.get('select id from payment_methods where name = ?', [name])?.id ?? this.catalog.createMethod({name}).id;
    }

    dateIn(month, day) {
        return `${month}-${pad(Math.max(1, Math.min(day, Number(lastDay(month).slice(8, 10)))))}`;
    }

    fields(date, type, name, category, amount, account, paymentMethod, status, tags) {
        return {
            name, description: null, amountCents: toCents(amount), date, type, status, categoryId: this.category(category, type), accountId: account.id,
            accountType: account.type, paymentMethodId: paymentMethod == null ? null : this.method(paymentMethod), tagIds: this.catalog.resolveTags(tags)
        };
    }

    add(month, day, type, name, category, amount, account, paymentMethod, status = 'PAID', tags = []) {
        const date = this.dateIn(month, day);
        const cents = toCents(amount);
        if (this.db.get('select 1 from expenses where deleted_at is null and name = ? and type = ? and date = ? and amount_cents = ?', [name, type, date, cents])) return;
        this.expenses.insert(this.fields(date, type, name, category, amount, account, paymentMethod, status, tags));
    }

    /** Compra parcelada em `count` vezes; a primeira parcela cai em `month`. */
    installments(month, day, name, category, total, count, account) {
        const date = this.dateIn(month, day);
        if (this.db.get('select 1 from expenses where deleted_at is null and name = ? and date = ? and installment_total is not null', [name, date])) return;
        this.expenses.insertInstallments({...this.fields(date, 'EXPENSE', name, category, total, account, 'Crédito', 'PAID', []), installments: count});
    }

    transfer(month, day, from, to, amount, description) {
        const date = this.dateIn(month, day);
        if (this.db.get(`select 1 from transfers where deleted_at is null and from_account_id = ? and to_account_id = ? and date = ? and amount_cents = ?`,
            [from.id, to.id, date, toCents(amount)])) return;
        this.transfers.create({fromAccountId: from.id, toAccountId: to.id, amount, date, description});
    }

    rule(name, type, amount, variableAmount, dayOfMonth, account, paymentMethod, category) {
        if (this.db.get('select 1 from recurring_payments where name = ?', [name])) return;
        this.recurring.create({
            name, type, amount: amount == null ? null : Number(amount), variableAmount, dayOfMonth, accountId: account.id,
            paymentMethodId: this.method(paymentMethod), categoryId: this.category(category, type), active: true,
            startMonth: isoDate(this.db.clock()).slice(0, 7)
        });
    }

    /** Cria a caixinha se nao existir; devolve o id so quando acabou de criar (para os aportes nao se repetirem). */
    pot(name, color, icon, goal, mode, monthly, startMonth, account) {
        if (this.db.get('select 1 from pots where name = ?', [name])) return null;
        return this.pots.create({
            name, color, icon, goal: Number(goal), mode, monthlyAmount: monthly == null ? null : Number(monthly), startMonth, active: true,
            accountId: account ? account.id : null
        }).id;
    }

    deposit(potId, month, day, amount, note) {
        this.pots.deposit(potId, {amount: Number(amount), date: this.dateIn(month, day), note});
    }

    wish(name, price, notes, url, potId) {
        if (this.db.get('select 1 from wish_items where name = ?', [name])) return;
        this.wishes.create({name, estimatedPrice: Number(price), notes, url, potId});
    }

    template(name, type, amount, category, account, paymentMethod) {
        if (this.db.get('select 1 from expense_templates where name = ?', [name])) return;
        this.templates.create({name, type, amount: Number(amount), categoryId: this.category(category, type), accountId: account.id,
            paymentMethodId: this.method(paymentMethod), tags: []});
    }
}
