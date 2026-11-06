import {conflict, invalid, notFound} from './http.js';
import {fromCents, isIsoDate, isoDate, toCents} from './util.js';

const MAX_AMOUNT = 999999999.99;
const MAX_INSTALLMENTS = 60;

/**
 * Lista de desejos: produtos com preco estimado que nao pertencem a nenhuma conta ate serem comprados. Comprar registra
 * o preco real e a conta e cria a despesa (e, se quiser, tira o dinheiro da caixinha do item).
 */
export class Wishes {
    constructor(db, catalog, expenses, pots) {
        this.db = db;
        this.catalog = catalog;
        this.expenses = expenses;
        this.pots = pots;
    }

    response(w) {
        return {
            id: w.id, name: w.name, estimatedPrice: fromCents(w.estimated_cents), notes: w.notes, url: w.url, status: w.status,
            potId: w.pot_id, potName: w.pot_name ?? null, realPrice: fromCents(w.real_cents), purchaseDate: w.purchase_date,
            expenseId: w.expense_id, createdAt: w.created_at.slice(0, 10)
        };
    }

    select(where = '', params = []) {
        return this.db.all(`select w.*, p.name pot_name from wish_items w left join pots p on p.id = w.pot_id ${where}`, params);
    }

    row(id) {
        const row = this.select('where w.id = ?', [id])[0];
        if (!row) throw notFound(`Item da lista de desejos não encontrado: ${id}`);
        return row;
    }

    list() {
        return this.select('order by w.id desc').map(w => this.response(w));
    }

    create(body) {
        return this.db.tx(() => {
            const f = this.validate(body);
            const {lastId} = this.db.run(`insert into wish_items (uuid, name, estimated_cents, notes, url, status, pot_id, created_at, updated_at)
                                          values (?, ?, ?, ?, ?, 'WISHED', ?, ?, ?)`,
                [this.db.newId(), f.name, f.cents, f.notes, f.url, f.potId, isoDate(this.db.clock()), this.db.now()]);
            return this.response(this.row(lastId));
        });
    }

    update(id, body) {
        return this.db.tx(() => {
            this.row(id);
            const f = this.validate(body);
            this.db.run('update wish_items set name = ?, estimated_cents = ?, notes = ?, url = ?, pot_id = ?, updated_at = ? where id = ?',
                [f.name, f.cents, f.notes, f.url, f.potId, this.db.now(), id]);
            return this.response(this.row(id));
        });
    }

    /** Excluir um item comprado mantem a despesa criada por ele. */
    delete(id) {
        this.row(id);
        this.db.tx(() => {
            this.db.run("delete from pot_entries where wish_item_id = ? and kind = 'PURCHASE'", [id]);
            this.db.run('delete from wish_items where id = ?', [id]);
        });
    }

    discard(id) {
        if (this.row(id).status === 'BOUGHT') throw conflict('Este item já foi comprado.');
        this.setStatus(id, 'DISCARDED');
        return this.response(this.row(id));
    }

    restore(id) {
        if (this.row(id).status !== 'DISCARDED') throw conflict('Só itens descartados podem voltar para a lista.');
        this.setStatus(id, 'WISHED');
        return this.response(this.row(id));
    }

    setStatus(id, status) {
        this.db.run('update wish_items set status = ?, updated_at = ? where id = ?', [status, this.db.now(), id]);
    }

    buy(id, body) {
        const errors = {};
        const price = body.price == null || body.price === '' ? null : Number(body.price);
        if (price == null || Number.isNaN(price)) errors.price = 'Informe o preço pago.';
        else if (price < 0.01) errors.price = 'O preço deve ser de pelo menos 0,01.';
        else if (price > MAX_AMOUNT) errors.price = 'O preço é alto demais.';
        if (body.accountId == null) errors.accountId = 'Informe em qual conta foi a compra.';
        if (body.date != null && !isIsoDate(body.date)) errors.date = 'Data inválida.';
        const installments = body.installments == null ? 1 : body.installments;
        if (!Number.isInteger(installments) || installments < 1) errors.installments = 'O número de parcelas deve ser de pelo menos 1.';
        else if (installments > MAX_INSTALLMENTS) errors.installments = 'O número de parcelas pode ser de até 60.';
        if (Object.keys(errors).length) throw invalid(errors);

        return this.db.tx(() => {
            const item = this.row(id);
            if (item.status === 'BOUGHT') throw conflict('Este item já foi comprado.');
            const cents = toCents(price);
            const date = body.date || isoDate(this.db.clock());
            const account = this.catalog.account(body.accountId);
            if (body.paymentMethodId != null) this.catalog.method(body.paymentMethodId);
            if (body.categoryId != null) this.catalog.category(body.categoryId);
            const fields = {
                name: item.name, description: item.notes, amountCents: cents, date, type: 'EXPENSE', status: 'PAID',
                categoryId: body.categoryId ?? null, accountId: account.id, accountType: account.type,
                paymentMethodId: body.paymentMethodId ?? null, tagIds: [], installments
            };
            // parcelado: o preco e o total; a primeira parcela fica paga e as outras "a pagar" (no cartao, todas ja contam)
            const expenseId = installments > 1 ? this.expenses.insertInstallments(fields)[0] : this.expenses.insert(fields);
            if (body.usePot === true && item.pot_id != null) this.pots.recordPurchase(item.pot_id, cents, date, `Compra: ${item.name}`, item.id);
            this.db.run("update wish_items set status = 'BOUGHT', real_cents = ?, purchase_date = ?, expense_id = ?, updated_at = ? where id = ?",
                [cents, date, expenseId, this.db.now(), id]);
            return this.response(this.row(id));
        });
    }

    validate(body) {
        const errors = {};
        const name = body.name == null ? '' : String(body.name).trim();
        if (!name) errors.name = 'Informe o nome do produto.';
        else if (name.length > 120) errors.name = 'O nome pode ter até 120 caracteres.';
        const price = body.estimatedPrice == null || body.estimatedPrice === '' ? null : Number(body.estimatedPrice);
        if (price != null && (Number.isNaN(price) || price < 0.01)) errors.estimatedPrice = 'O preço deve ser de pelo menos 0,01.';
        else if (price != null && price > MAX_AMOUNT) errors.estimatedPrice = 'O preço é alto demais.';
        if (body.notes != null && String(body.notes).length > 255) errors.notes = 'A observação pode ter até 255 caracteres.';
        if (body.url != null && String(body.url).length > 500) errors.url = 'O link pode ter até 500 caracteres.';
        if (Object.keys(errors).length) throw invalid(errors);
        if (body.potId != null) this.pots.row(body.potId);
        const text = v => (v == null || !String(v).trim() ? null : String(v).trim());
        return {name, cents: price == null ? null : toCents(price), notes: text(body.notes), url: text(body.url), potId: body.potId ?? null};
    }
}
