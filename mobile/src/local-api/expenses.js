import {badRequest, conflict, invalid, notFound} from './http.js';
import {addMonthsToDate, firstDay, fromCents, isIsoDate, isYearMonth, isoDate, lastDay, toCents} from './util.js';

const MAX_BATCH = 500;
const MAX_PAGE = 500;
const MAX_INSTALLMENTS = 60;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MAX_AMOUNT = 999999999.99;

const SELECT = `select e.*, c.name cat_name, c.icon cat_icon, c.color cat_color, c.parent_id cat_parent,
    pc.name cat_parent_name, a.name acc_name, a.color acc_color, m.name pm_name
    from expenses e
    left join categories c on c.id = e.category_id
    left join categories pc on pc.id = c.parent_id
    left join accounts a on a.id = e.account_id
    left join payment_methods m on m.id = e.payment_method_id`;

/** Lancamentos (receitas e despesas): CRUD, filtros, parcelas, lixeira e acoes em lote. */
export class Expenses {
    constructor(db, catalog) {
        this.db = db;
        this.catalog = catalog;
    }

    today() {
        return isoDate(this.db.clock());
    }

    // ---- leitura ----

    tagsByExpense() {
        const map = new Map();
        for (const r of this.db.all('select et.expense_id, t.name from expense_tags et join tags t on t.id = et.tag_id order by t.name')) {
            if (!map.has(r.expense_id)) map.set(r.expense_id, []);
            map.get(r.expense_id).push(r.name);
        }
        return map;
    }

    response(row, tags) {
        return {
            id: row.id, name: row.name, description: row.description, amount: fromCents(row.amount_cents), date: row.date,
            type: row.type, status: row.status === 'PENDING' ? 'PENDING' : 'PAID',
            categoryId: row.category_id, categoryName: row.cat_name ?? null, categoryIcon: row.cat_icon ?? null,
            categoryColor: row.cat_color ?? null, categoryParentId: row.cat_parent ?? null,
            accountId: row.account_id, accountName: row.acc_name ?? null, accountColor: row.acc_color ?? null,
            paymentMethodId: row.payment_method_id, paymentMethodName: row.pm_name ?? null,
            tags: tags.get(row.id) ?? [],
            installmentNumber: row.installment_number, installmentTotal: row.installment_total,
            createdAt: row.created_at, updatedAt: row.updated_at
        };
    }

    row(id) {
        const row = this.db.get(`${SELECT} where e.deleted_at is null and e.id = ?`, [id]);
        if (!row) throw notFound(`Lançamento não encontrado: ${id}`);
        return row;
    }

    get(id) {
        return this.response(this.row(id), this.tagsByExpense());
    }

    /** Lancamentos de uma conta (pagos e a pagar), do mais antigo ao mais novo, ja com categoria, conta e forma de pagamento. */
    byAccount(accountId) {
        return this.db.all(`${SELECT} where e.deleted_at is null and e.account_id = ? order by e.date, e.id`, [accountId]);
    }

    /**
     * Lista filtrada. Filtros (todos opcionais): month, type, status, categoryId (acha tambem as subcategorias),
     * accountId, paymentMethodId, tag, q (texto livre), from/to, minAmount/maxAmount. sort: date,desc (padrao),
     * date,asc, amount,desc, amount,asc, name,asc. Com size, devolve uma pagina (page conta a partir de 0).
     */
    list(query = {}) {
        const where = ['e.deleted_at is null'];
        const params = [];
        const q = query;
        if (q.month) {
            if (!isYearMonth(q.month)) throw badRequest(`Mês inválido: ${q.month}`);
            where.push('e.date between ? and ?');
            params.push(firstDay(q.month), lastDay(q.month));
        }
        if (q.from) { where.push('e.date >= ?'); params.push(q.from); }
        if (q.to) { where.push('e.date <= ?'); params.push(q.to); }
        if (q.type) { where.push('e.type = ?'); params.push(q.type); }
        if (q.status === 'PAID') where.push("e.status = 'PAID'");
        else if (q.status === 'PENDING') where.push("e.status = 'PENDING'");
        if (q.categoryId) { where.push('(e.category_id = ? or c.parent_id = ?)'); params.push(Number(q.categoryId), Number(q.categoryId)); }
        if (q.accountId) { where.push('e.account_id = ?'); params.push(Number(q.accountId)); }
        if (q.paymentMethodId) { where.push('e.payment_method_id = ?'); params.push(Number(q.paymentMethodId)); }
        if (q.minAmount) { where.push('e.amount_cents >= ?'); params.push(toCents(q.minAmount)); }
        if (q.maxAmount) { where.push('e.amount_cents <= ?'); params.push(toCents(q.maxAmount)); }
        const tag = (q.tag ?? '').trim().toLowerCase().replace(/^#/, '');
        if (tag) {
            where.push('exists (select 1 from expense_tags et join tags t on t.id = et.tag_id where et.expense_id = e.id and t.name = ?)');
            params.push(tag);
        }
        const tags = this.tagsByExpense();
        let rows = this.db.all(`${SELECT} where ${where.join(' and ')}`, params);

        const text = (q.q ?? '').trim().toLowerCase();
        if (text) {
            const bare = text.replace(/^#/, '');
            rows = rows.filter(r => [r.name, r.description, r.acc_name, r.pm_name, r.cat_name, r.cat_parent_name]
                .some(v => v && v.toLowerCase().includes(text))
                || (tags.get(r.id) ?? []).some(t => t.includes(bare)));
        }

        rows.sort(comparator(q.sort));
        if (q.size != null && q.size !== '') {
            const size = Number(q.size);
            if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) throw badRequest(`O tamanho da página deve ficar entre 1 e ${MAX_PAGE}.`);
            const page = Math.max(0, Number(q.page ?? 0) || 0);
            rows = rows.slice(page * size, page * size + size);
        }
        return rows.map(r => this.response(r, tags));
    }

    /** O que ja foi digitado antes numa descricao (ultimo uso de cada nome), para preencher um lancamento novo. */
    suggestions(text) {
        const needle = (text ?? '').trim().toLowerCase();
        if (needle.length < 2) return [];
        const latest = new Map();
        const tags = this.tagsByExpense();
        const rows = this.db.all(`${SELECT} where e.deleted_at is null`)
            .filter(r => r.name.toLowerCase().includes(needle))
            .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
        for (const r of rows) if (!latest.has(r.name.toLowerCase())) latest.set(r.name.toLowerCase(), r);
        return [...latest.values()].slice(0, 6).map(r => this.response(r, tags));
    }

    // ---- escrita ----

    validate(body) {
        const errors = {};
        const name = body.name == null ? '' : String(body.name).trim();
        if (!name) errors.name = 'Informe uma descrição.';
        else if (name.length > 120) errors.name = 'A descrição pode ter até 120 caracteres.';
        if (body.description != null && String(body.description).length > 255) errors.description = 'A observação pode ter até 255 caracteres.';
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount == null || Number.isNaN(amount)) errors.amount = 'Informe o valor.';
        else if (amount < 0.01) errors.amount = 'O valor deve ser de pelo menos 0,01.';
        else if (amount > MAX_AMOUNT) errors.amount = 'O valor é alto demais.';
        if (!body.date) errors.date = 'Informe a data.';
        else if (!isIsoDate(body.date)) errors.date = 'Data inválida.';
        if (body.installments != null) {
            if (!Number.isInteger(body.installments) || body.installments < 1) errors.installments = 'O número de parcelas deve ser de pelo menos 1.';
            else if (body.installments > MAX_INSTALLMENTS) errors.installments = 'O número de parcelas pode ser de até 60.';
        }
        if (Object.keys(errors).length) throw invalid(errors);
        const year = Number(body.date.slice(0, 4));
        if (year < MIN_YEAR || year > MAX_YEAR) throw badRequest(`A data deve estar entre os anos ${MIN_YEAR} e ${MAX_YEAR}.`);
        const type = body.type ?? 'EXPENSE';
        if (!['EXPENSE', 'INCOME'].includes(type)) throw badRequest(`Tipo inválido: ${type}`);
        const status = body.status ?? 'PAID';
        if (!['PAID', 'PENDING'].includes(status)) throw badRequest(`Situação inválida: ${status}`);

        if (body.categoryId != null) this.catalog.category(body.categoryId);
        const account = body.accountId == null ? this.catalog.defaultAccount() : this.catalog.account(body.accountId);
        if (body.paymentMethodId != null) this.catalog.method(body.paymentMethodId);
        return {
            name, description: body.description ?? null, amountCents: toCents(amount), date: body.date, type, status,
            categoryId: body.categoryId ?? null, accountId: account.id, accountType: account.type,
            paymentMethodId: body.paymentMethodId ?? null, tags: body.tags ?? [],
            installments: body.installments ?? 1
        };
    }

    insert(f, extra = {}) {
        const now = this.db.now();
        const {lastId} = this.db.run(`insert into expenses (uuid, name, description, amount_cents, date, type, status, category_id, account_id,
            payment_method_id, installment_group, installment_number, installment_total, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [this.db.newId(), f.name, f.description, extra.amountCents ?? f.amountCents, extra.date ?? f.date, f.type,
                extra.status ?? f.status, f.categoryId, f.accountId, f.paymentMethodId, extra.group ?? null,
                extra.number ?? null, extra.total ?? null, now, now]);
        this.setTags(lastId, f.tagIds);
        return lastId;
    }

    setTags(expenseId, tagIds) {
        this.db.run('delete from expense_tags where expense_id = ?', [expenseId]);
        for (const tagId of tagIds) this.db.run('insert into expense_tags (expense_id, tag_id) values (?, ?)', [expenseId, tagId]);
    }

    create(body) {
        return this.db.tx(() => {
            const f = this.validate(body);
            f.tagIds = this.catalog.resolveTags(f.tags);
            if (f.installments > 1 && f.type === 'EXPENSE') return this.get(this.insertInstallments(f)[0]);
            return this.get(this.insert(f));
        });
    }

    /**
     * Compra parcelada: uma linha por parcela, ligadas por um grupo. O valor informado e o total; os centavos que
     * nao dividem certo ficam na primeira. A primeira mantem a situacao pedida e as outras ficam "a pagar", exceto
     * no cartao de credito, onde a compra toda ja esta comprometida.
     */
    insertInstallments(f) {
        const count = f.installments;
        const each = Math.floor(f.amountCents / count);
        if (each <= 0) throw badRequest('O valor é pequeno demais para tantas parcelas.');
        const first = f.amountCents - each * (count - 1);
        const card = f.accountType === 'CREDIT_CARD';
        const group = this.db.newId();
        const ids = [];
        for (let i = 0; i < count; i++) {
            ids.push(this.insert(f, {
                amountCents: i === 0 ? first : each,
                date: addMonthsToDate(f.date, i),
                status: i === 0 || card ? f.status : 'PENDING',
                group, number: i + 1, total: count
            }));
        }
        return ids;
    }

    update(id, body) {
        return this.db.tx(() => {
            this.row(id);
            const f = this.validate(body);
            const tagIds = this.catalog.resolveTags(f.tags);
            this.db.run(`update expenses set name = ?, description = ?, amount_cents = ?, date = ?, type = ?, status = ?, category_id = ?,
                account_id = ?, payment_method_id = ?, updated_at = ? where id = ?`,
                [f.name, f.description, f.amountCents, f.date, f.type, f.status, f.categoryId, f.accountId, f.paymentMethodId, this.db.now(), id]);
            this.setTags(id, tagIds);
            return this.get(id);
        });
    }

    pay(id, date) {
        return this.db.tx(() => {
            const row = this.row(id);
            if (row.status !== 'PENDING') throw conflict('Este lançamento já está pago.');
            this.db.run("update expenses set status = 'PAID', date = ?, updated_at = ? where id = ?", [date || this.today(), this.db.now(), id]);
            return this.get(id);
        });
    }

    /**
     * Manda para a lixeira. Tambem solta o que apontava para ele: a ocorrencia recorrente vira "ignorada" (para o
     * pagamento automatico nao recriar) e o item comprado da lista de desejos volta para a lista, devolvendo o dinheiro.
     */
    trash(id) {
        this.db.tx(() => {
            const now = this.db.now();
            this.db.run("update recurring_occurrences set expense_id = null, status = 'SKIPPED', paid_date = null, updated_at = ? where expense_id = ?", [now, id]);
            for (const wish of this.db.all('select id from wish_items where expense_id = ?', [id])) {
                this.db.run("delete from pot_entries where wish_item_id = ? and kind = 'PURCHASE'", [wish.id]);
            }
            this.db.run(`update wish_items set status = 'WISHED', expense_id = null, real_cents = null, purchase_date = null, updated_at = ?
                         where expense_id = ?`, [now, id]);
            this.db.run('update expenses set deleted_at = ?, updated_at = ? where id = ? and deleted_at is null', [now, now, id]);
        });
    }

    /** Parcela e as seguintes vao juntas para a lixeira; devolve os ids (para "desfazer"). */
    trashFollowing(id) {
        return this.db.tx(() => {
            const row = this.row(id);
            const targets = row.installment_group == null ? [row.id]
                : this.db.all(`select id from expenses where installment_group = ? and installment_number >= ? and deleted_at is null
                               order by installment_number`, [row.installment_group, row.installment_number]).map(r => r.id);
            targets.forEach(t => this.trash(t));
            return targets;
        });
    }

    batch({ids, action, categoryId, accountId, paymentMethodId, tag}) {
        const list = ids ?? [];
        const needIds = () => {
            if (!list.length || list.length > MAX_BATCH) throw badRequest(`Selecione de 1 a ${MAX_BATCH} lançamentos.`);
        };
        const placeholders = () => list.map(() => '?').join(',');
        const live = () => this.db.all(`select id, status from expenses where deleted_at is null and id in (${placeholders()})`, list);
        const touch = (sql, params) => this.db.tx(() => {
            const found = live();
            for (const e of found) this.db.run(sql, [...params, this.db.now(), e.id]);
            return found.length;
        });
        switch (String(action ?? '').toUpperCase()) {
            case 'DELETE': {
                needIds();
                const done = live().map(e => e.id);
                this.db.tx(() => done.forEach(id => this.trash(id)));
                return {count: done.length, ids: done};
            }
            case 'MARK_PAID': {
                const pending = list.length ? live().filter(e => e.status === 'PENDING') : [];
                this.db.tx(() => pending.forEach(e => this.pay(e.id, this.today())));
                return {count: pending.length};
            }
            case 'SET_CATEGORY': {
                needIds();
                if (categoryId != null) this.catalog.category(categoryId);
                return {count: touch('update expenses set category_id = ?, updated_at = ? where id = ?', [categoryId ?? null])};
            }
            case 'SET_ACCOUNT': {
                needIds();
                this.catalog.account(accountId);
                return {count: touch('update expenses set account_id = ?, updated_at = ? where id = ?', [accountId])};
            }
            case 'SET_PAYMENT_METHOD': {
                needIds();
                if (paymentMethodId != null) this.catalog.method(paymentMethodId);
                return {count: touch('update expenses set payment_method_id = ?, updated_at = ? where id = ?', [paymentMethodId ?? null])};
            }
            case 'ADD_TAG': {
                needIds();
                if (!tag || !String(tag).trim()) throw badRequest('Informe a tag.');
                return this.db.tx(() => {
                    const found = live();
                    for (const e of found) {
                        const names = this.db.all('select t.name from expense_tags et join tags t on t.id = et.tag_id where et.expense_id = ?', [e.id]).map(r => r.name);
                        this.setTags(e.id, this.catalog.resolveTags([...names, tag]));
                        this.db.run('update expenses set updated_at = ? where id = ?', [this.db.now(), e.id]);
                    }
                    return {count: found.length};
                });
            }
            default:
                throw badRequest(`Ação desconhecida: ${action}`);
        }
    }

    /** Manda tudo (lancamentos e transferencias) para a lixeira. */
    trashAll() {
        this.db.tx(() => {
            const now = this.db.now();
            this.db.run("update recurring_occurrences set expense_id = null, status = 'SKIPPED', paid_date = null, updated_at = ? where expense_id is not null", [now]);
            this.db.run("delete from pot_entries where kind = 'PURCHASE'");
            this.db.run(`update wish_items set status = 'WISHED', expense_id = null, real_cents = null, purchase_date = null, updated_at = ?
                         where expense_id is not null`, [now]);
            this.db.run('update expenses set deleted_at = ?, updated_at = ? where deleted_at is null', [now, now]);
            this.db.run('update transfers set deleted_at = ?, updated_at = ? where deleted_at is null', [now, now]);
        });
    }
}

function comparator(sort) {
    const [field = 'date', direction = 'desc'] = String(sort ?? 'date,desc').toLowerCase().split(',');
    const asc = direction === 'asc';
    const byId = (a, b) => b.id - a.id;
    if (field === 'amount') return (a, b) => (a.amount_cents - b.amount_cents) * (asc ? 1 : -1) || byId(a, b);
    if (field === 'name') return (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || byId(a, b);
    return (a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1) * (asc ? 1 : -1) || byId(a, b);
}
