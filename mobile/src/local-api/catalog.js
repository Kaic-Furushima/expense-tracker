import {badRequest, conflict, invalid, notFound} from './http.js';
import {fromCents, toCents} from './util.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const requireText = (value, field, message, max, tooLong) => {
    const text = value == null ? '' : String(value).trim();
    if (!text) throw invalid({[field]: message});
    if (max && text.length > max) throw invalid({[field]: tooLong});
    return text;
};

/** Categorias, formas de pagamento, contas e tags: os cadastros que os lancamentos referenciam. */
export class Catalog {
    constructor(db) {
        this.db = db;
    }

    // ---- categorias ----

    categoryResponse(row) {
        return {id: row.id, name: row.name, icon: row.icon, color: row.color, parentId: row.parent_id};
    }

    categories() {
        return this.db.all('select * from categories order by name collate nocase').map(r => this.categoryResponse(r));
    }

    category(id) {
        const row = this.db.get('select * from categories where id = ?', [id]);
        if (!row) throw notFound(`Categoria não encontrada: ${id}`);
        return row;
    }

    createCategory({name, icon, color, parentId}) {
        const clean = this.categoryFields({name, icon, color, parentId}, null);
        if (this.db.get('select 1 from categories where name = ?', [clean.name])) throw conflict('Já existe uma categoria com esse nome.');
        const {lastId} = this.db.run('insert into categories (uuid, name, icon, color, parent_id, updated_at) values (?, ?, ?, ?, ?, ?)',
            [this.db.newId(), clean.name, clean.icon, clean.color, clean.parentId, this.db.now()]);
        return this.categoryResponse(this.category(lastId));
    }

    updateCategory(id, body) {
        const current = this.category(id);
        const clean = this.categoryFields(body, current);
        const renamed = current.name.toLowerCase() !== clean.name.toLowerCase();
        if (renamed && this.db.get('select 1 from categories where name = ?', [clean.name])) throw conflict('Já existe uma categoria com esse nome.');
        this.db.run('update categories set name = ?, icon = ?, color = ?, parent_id = ?, updated_at = ? where id = ?',
            [clean.name, clean.icon, clean.color, clean.parentId, this.db.now(), id]);
        return this.categoryResponse(this.category(id));
    }

    /** Os lancamentos ficam (sem categoria, lixeira inclusa) e as subcategorias sobem para o primeiro nivel. */
    deleteCategory(id) {
        this.category(id);
        this.db.tx(() => {
            const now = this.db.now();
            this.db.run('update categories set parent_id = null, updated_at = ? where parent_id = ?', [now, id]);
            this.db.run('update expenses set category_id = null, updated_at = ? where category_id = ?', [now, id]);
            this.db.run('update recurring_payments set category_id = null, updated_at = ? where category_id = ?', [now, id]);
            this.db.run('delete from budgets where category_id = ?', [id]);
            this.db.run('delete from categories where id = ?', [id]);
        });
    }

    categoryFields(body, current) {
        const name = requireText(body.name, 'name', 'Informe o nome da categoria.', 60, 'O nome pode ter até 60 caracteres.');
        if (body.icon && String(body.icon).length > 16) throw invalid({icon: 'O ícone é longo demais.'});
        if (body.color && String(body.color).length > 7) throw invalid({color: 'A cor deve ser um código como #6750A4.'});
        const parentId = this.resolveParent('categories', 'Categoria', current, body.parentId,
            'Uma categoria não pode ser subcategoria dela mesma.', 'Só existe um nível de subcategorias.',
            'Esta categoria já tem subcategorias; não pode virar subcategoria.');
        return {
            name,
            icon: body.icon && String(body.icon).trim() ? String(body.icon).trim() : '🏷️',
            color: body.color && HEX_COLOR.test(body.color) ? body.color : '#6750A4',
            parentId
        };
    }

    /** Um nivel so: o pai tem que ser de primeiro nivel e quem tem filhos nao pode virar filho. */
    resolveParent(table, label, current, parentId, selfMessage, depthMessage, hasChildrenMessage) {
        if (parentId == null) return null;
        if (current && current.id === parentId) throw badRequest(selfMessage);
        const parent = this.db.get(`select * from ${table} where id = ?`, [parentId]);
        if (!parent) throw notFound(`${label} não encontrada: ${parentId}`);
        if (parent.parent_id != null) throw badRequest(depthMessage);
        if (current && this.db.get(`select 1 from ${table} where parent_id = ?`, [current.id])) throw badRequest(hasChildrenMessage);
        return parent.id;
    }

    // ---- formas de pagamento ----

    methods() {
        return this.db.all('select id, name from payment_methods order by name collate nocase');
    }

    method(id) {
        const row = this.db.get('select id, name from payment_methods where id = ?', [id]);
        if (!row) throw notFound(`Forma de pagamento não encontrada: ${id}`);
        return row;
    }

    createMethod({name}) {
        const clean = requireText(name, 'name', 'Informe o nome.', 60, 'O nome pode ter até 60 caracteres.');
        if (this.db.get('select 1 from payment_methods where name = ?', [clean])) throw conflict('Já existe uma forma de pagamento com esse nome.');
        const {lastId} = this.db.run('insert into payment_methods (uuid, name, updated_at) values (?, ?, ?)', [this.db.newId(), clean, this.db.now()]);
        return this.method(lastId);
    }

    updateMethod(id, {name}) {
        const current = this.method(id);
        const clean = requireText(name, 'name', 'Informe o nome.', 60, 'O nome pode ter até 60 caracteres.');
        if (current.name.toLowerCase() !== clean.toLowerCase() && this.db.get('select 1 from payment_methods where name = ?', [clean])) {
            throw conflict('Já existe uma forma de pagamento com esse nome.');
        }
        this.db.run('update payment_methods set name = ?, updated_at = ? where id = ?', [clean, this.db.now(), id]);
        return this.method(id);
    }

    deleteMethod(id) {
        this.method(id);
        this.db.tx(() => {
            const now = this.db.now();
            this.db.run('update expenses set payment_method_id = null, updated_at = ? where payment_method_id = ?', [now, id]);
            this.db.run('update recurring_payments set payment_method_id = null, updated_at = ? where payment_method_id = ?', [now, id]);
            this.db.run('delete from payment_methods where id = ?', [id]);
        });
    }

    // ---- contas ----

    accountResponse(row, balanceCents, parentName) {
        return {
            id: row.id, name: row.name, type: row.type, color: row.color, icon: row.icon,
            initialBalance: fromCents(row.initial_cents), archived: !!row.archived,
            parentId: row.parent_id, parentName: parentName ?? null,
            balance: fromCents(balanceCents), closingDay: row.closing_day, dueDay: row.due_day
        };
    }

    account(id) {
        const row = this.db.get('select * from accounts where id = ?', [id]);
        if (!row) throw notFound(`Conta não encontrada: ${id}`);
        return row;
    }

    /** Saldo atual: inicial + receitas pagas - despesas pagas + transferencias recebidas - enviadas. */
    balances() {
        const result = new Map(this.db.all('select id, initial_cents from accounts').map(r => [r.id, r.initial_cents]));
        const add = (id, cents) => result.set(id, (result.get(id) ?? 0) + cents);
        for (const r of this.db.all(`select account_id, type, sum(amount_cents) total from expenses
                                     where deleted_at is null and status = 'PAID' group by account_id, type`)) {
            add(r.account_id, r.type === 'INCOME' ? r.total : -r.total);
        }
        for (const r of this.db.all('select to_account_id id, sum(amount_cents) total from transfers where deleted_at is null group by to_account_id')) add(r.id, r.total);
        for (const r of this.db.all('select from_account_id id, sum(amount_cents) total from transfers where deleted_at is null group by from_account_id')) add(r.id, -r.total);
        return result;
    }

    accounts() {
        const balances = this.balances();
        const rows = this.db.all('select * from accounts order by name collate nocase');
        const names = new Map(rows.map(r => [r.id, r.name]));
        return rows.map(r => this.accountResponse(r, balances.get(r.id) ?? r.initial_cents, names.get(r.parent_id)));
    }

    accountWithBalance(id) {
        return this.accounts().find(a => a.id === id);
    }

    /** A conta usada quando o lancamento nao diz qual: a conta de primeiro nivel mais antiga e nao arquivada. */
    defaultAccount() {
        const row = this.db.get('select * from accounts where archived = 0 and parent_id is null order by id limit 1');
        if (!row) throw conflict('Cadastre uma conta antes de lançar.');
        return row;
    }

    createAccount(body) {
        const fields = this.accountFields(body, null);
        if (this.db.get('select 1 from accounts where name = ?', [fields.name])) throw conflict('Já existe uma conta com esse nome.');
        const {lastId} = this.db.run(`insert into accounts (uuid, name, type, color, icon, initial_cents, archived, parent_id, closing_day, due_day, updated_at)
                                      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [this.db.newId(), fields.name, fields.type, fields.color, fields.icon, fields.initialCents, fields.archived ? 1 : 0,
                fields.parentId, fields.closingDay, fields.dueDay, this.db.now()]);
        return this.accountWithBalance(lastId);
    }

    updateAccount(id, body) {
        const current = this.account(id);
        const fields = this.accountFields(body, current);
        if (current.name.toLowerCase() !== fields.name.toLowerCase() && this.db.get('select 1 from accounts where name = ?', [fields.name])) {
            throw conflict('Já existe uma conta com esse nome.');
        }
        if (fields.archived && !current.archived) {
            if (this.db.get('select 1 from accounts where parent_id = ? and archived = 0', [id])) throw conflict('Arquive primeiro as partes desta conta.');
            if (current.parent_id == null && this.activeTopLevelCount() <= 1) throw conflict('Mantenha pelo menos uma conta ativa.');
        }
        this.db.run(`update accounts set name = ?, type = ?, color = ?, icon = ?, initial_cents = ?, archived = ?, parent_id = ?,
                     closing_day = ?, due_day = ?, updated_at = ? where id = ?`,
            [fields.name, fields.type, fields.color, fields.icon, fields.initialCents, fields.archived ? 1 : 0, fields.parentId,
                fields.closingDay, fields.dueDay, this.db.now(), id]);
        return this.accountWithBalance(id);
    }

    /** Conta com historico nao pode ser excluida (os lancamentos ficariam orfaos): arquive. */
    deleteAccount(id) {
        const account = this.account(id);
        if (this.db.get('select 1 from accounts where parent_id = ?', [id])) throw conflict('Esta conta tem partes (cofrinhos). Exclua ou mova-as antes.');
        const used = this.db.value(`select (select count(*) from expenses where account_id = ?1)
            + (select count(*) from transfers where from_account_id = ?1 or to_account_id = ?1)
            + (select count(*) from recurring_payments where account_id = ?1)`, [id]);
        if (used > 0) {
            throw conflict('Esta conta tem lançamentos, transferências ou pagamentos recorrentes (a lixeira conta). Arquive-a em vez de excluir.');
        }
        if (!account.archived && account.parent_id == null && this.activeTopLevelCount() <= 1) throw conflict('Mantenha pelo menos uma conta ativa.');
        this.db.run('delete from accounts where id = ?', [id]);
    }

    activeTopLevelCount() {
        return this.db.value('select count(*) from accounts where archived = 0 and parent_id is null');
    }

    accountFields(body, current) {
        const name = requireText(body.name, 'name', 'Informe o nome da conta.', 80, 'O nome pode ter até 80 caracteres.');
        if (body.color && String(body.color).length > 7) throw invalid({color: 'A cor deve ser um código como #6750A4.'});
        if (body.icon && String(body.icon).length > 16) throw invalid({icon: 'O ícone é longo demais.'});
        const initial = body.initialBalance == null || body.initialBalance === '' ? 0 : Number(body.initialBalance);
        if (Number.isNaN(initial) || initial < -999999999.99) throw invalid({initialBalance: 'O saldo inicial é baixo demais.'});
        if (initial > 999999999.99) throw invalid({initialBalance: 'O saldo inicial é alto demais.'});
        const type = body.type ?? 'CHECKING';
        if (!['CHECKING', 'SAVINGS', 'WALLET', 'CREDIT_CARD', 'INVESTMENT'].includes(type)) throw badRequest(`Tipo de conta inválido: ${type}`);
        const card = type === 'CREDIT_CARD';
        const day = (value, what) => {
            if (value != null && (!Number.isInteger(value) || value < 1 || value > 31)) throw badRequest(`O dia de ${what} deve ficar entre 1 e 31.`);
            return value ?? null;
        };
        return {
            name, type,
            color: body.color && HEX_COLOR.test(body.color) ? body.color : '#64B5F6',
            icon: body.icon && String(body.icon).trim() ? String(body.icon).trim() : null,
            initialCents: toCents(initial),
            archived: body.archived === true,
            parentId: this.resolveParent('accounts', 'Conta', current, body.parentId,
                'Uma conta não pode ficar dentro dela mesma.', 'Só é possível ficar dentro de uma conta principal (um nível).',
                'Esta conta já tem partes; não pode ficar dentro de outra.'),
            closingDay: card ? day(body.closingDay, 'fechamento') : null,
            dueDay: card ? day(body.dueDay, 'vencimento') : null
        };
    }

    // ---- tags ----

    tagNames() {
        return this.db.all('select name from tags order by name collate nocase').map(r => r.name);
    }

    /** Transforma o que foi digitado em ids de tags, criando as que ainda nao existem (minusculas, sem "#"). */
    resolveTags(raw) {
        const ids = [];
        for (const text of raw ?? []) {
            const name = String(text ?? '').trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-');
            if (!name) continue;
            if (name.length > 40) throw badRequest('Cada tag pode ter até 40 caracteres.');
            let id = this.db.value('select id from tags where name = ?', [name]);
            if (id == null) id = this.db.run('insert into tags (uuid, name, updated_at) values (?, ?, ?)', [this.db.newId(), name, this.db.now()]).lastId;
            if (!ids.includes(id)) ids.push(id);
        }
        if (ids.length > 10) throw badRequest('Use no máximo 10 tags por lançamento.');
        return ids;
    }
}
