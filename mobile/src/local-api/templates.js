import {badRequest, conflict, notFound} from './http.js';
import {fromCents, toCents} from './util.js';

const MAX_TEMPLATES = 100;
const MAX_AMOUNT = 999999999.99;

const truncate = (text, max) => (text.length <= max ? text : text.slice(0, max));

/** Modelos ("favoritos"): lancamentos prontos que preenchem o formulario de um lancamento novo. */
export class Templates {
    constructor(db, catalog) {
        this.db = db;
        this.catalog = catalog;
    }

    response(t) {
        return {
            id: t.id, name: t.name, type: t.type, amount: fromCents(t.amount_cents),
            categoryId: t.category_id, categoryName: t.cat_name ?? null,
            accountId: t.account_id, accountName: t.acc_name ?? null,
            paymentMethodId: t.payment_method_id, paymentMethodName: t.pm_name ?? null,
            description: t.description, tags: t.tags && t.tags.trim() ? t.tags.split(' ') : []
        };
    }

    select(where = '', params = []) {
        return this.db.all(`select t.*, c.name cat_name, a.name acc_name, m.name pm_name from expense_templates t
                            left join categories c on c.id = t.category_id left join accounts a on a.id = t.account_id
                            left join payment_methods m on m.id = t.payment_method_id ${where}`, params);
    }

    list() {
        return this.select('order by t.name collate nocase').map(t => this.response(t));
    }

    create(body) {
        const name = body.name == null ? '' : String(body.name).trim();
        if (!name) throw badRequest('Informe o nome do modelo.');
        if (this.db.value('select count(*) from expense_templates') >= MAX_TEMPLATES) throw conflict(`Limite de ${MAX_TEMPLATES} modelos atingido.`);
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount != null && !(amount > 0 && amount <= MAX_AMOUNT)) throw badRequest('Informe um valor entre 0,01 e 999.999.999,99.');
        const type = body.type ?? 'EXPENSE';
        if (!['EXPENSE', 'INCOME'].includes(type)) throw badRequest(`Tipo inválido: ${type}`);
        if (body.categoryId != null) this.catalog.category(body.categoryId);
        if (body.accountId != null) this.catalog.account(body.accountId);
        if (body.paymentMethodId != null) this.catalog.method(body.paymentMethodId);
        const description = body.description && String(body.description).trim() ? truncate(String(body.description).trim(), 255) : null;
        const tags = Array.isArray(body.tags) && body.tags.length ? truncate(body.tags.join(' '), 255) : null;
        const now = this.db.now();
        const {lastId} = this.db.run(`insert into expense_templates (uuid, name, type, amount_cents, category_id, account_id, payment_method_id,
            description, tags, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [this.db.newId(), truncate(name, 120), type, amount == null ? null : toCents(amount), body.categoryId ?? null,
                body.accountId ?? null, body.paymentMethodId ?? null, description, tags, now, now]);
        return this.response(this.select('where t.id = ?', [lastId])[0]);
    }

    delete(id) {
        if (!this.db.get('select 1 from expense_templates where id = ?', [id])) throw notFound(`Modelo não encontrado: ${id}`);
        this.db.run('delete from expense_templates where id = ?', [id]);
    }
}
