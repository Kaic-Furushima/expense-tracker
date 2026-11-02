import {badRequest} from './http.js';
import {parseH2Script} from './h2script.js';
import {SCHEMA_VERSION} from './schema.js';

const APP = 'expense-tracker';
const NOT_A_BACKUP = 'Este arquivo não parece um backup deste aplicativo.';

/** Tabelas na ordem em que podem ser gravadas (quem e referenciado vem antes). */
export const TABLES = ['categories', 'payment_methods', 'accounts', 'expenses', 'tags', 'expense_tags', 'budgets', 'transfers',
    'recurring_payments', 'recurring_occurrences', 'pots', 'wish_items', 'pot_entries', 'expense_templates', 'attachments',
    'app_settings'];

/**
 * Como cada tabela do backup do computador (H2) vira uma tabela daqui. coluna_destino: 'origem' (copia), ou
 * [origem, tipo] com tipo cents (decimal -> centavos), bool (0/1) ou ts (data e hora no formato do app).
 */
const FROM_H2 = {
    categories: {id: 'id', name: 'name', icon: 'icon', color: 'color', parent_id: 'parent_id'},
    payment_methods: {id: 'id', name: 'name'},
    accounts: {
        id: 'id', name: 'name', type: 'type', color: 'color', icon: 'icon', initial_cents: ['initial_balance', 'cents'],
        archived: ['archived', 'bool'], parent_id: 'parent_id', closing_day: 'closing_day', due_day: 'due_day'
    },
    expenses: {
        id: 'id', name: 'name', description: 'description', amount_cents: ['amount', 'cents'], date: 'date', type: 'type',
        status: 'status', category_id: 'category_id', account_id: 'account_id', payment_method_id: 'payment_method_id',
        installment_group: 'installment_group', installment_number: 'installment_number', installment_total: 'installment_total',
        created_at: ['created_at', 'ts'], updated_at: ['updated_at', 'ts'], deleted_at: ['deleted_at', 'ts']
    },
    tags: {id: 'id', name: 'name'},
    expense_tags: {expense_id: 'expense_id', tag_id: 'tag_id'},
    budgets: {id: 'id', category_id: 'category_id', from_month: 'from_month', amount_cents: ['amount', 'cents']},
    transfers: {
        id: 'id', from_account_id: 'from_account_id', to_account_id: 'to_account_id', amount_cents: ['amount', 'cents'],
        date: 'date', description: 'description', invoice_month: 'invoice_month', created_at: ['created_at', 'ts'],
        updated_at: ['updated_at', 'ts'], deleted_at: ['deleted_at', 'ts']
    },
    recurring_payments: {
        id: 'id', name: 'name', type: 'type', amount_cents: ['amount', 'cents'], variable_amount: ['variable_amount', 'bool'],
        day_of_month: 'day_of_month', account_id: 'account_id', payment_method_id: 'payment_method_id', category_id: 'category_id',
        active: ['active', 'bool'], start_month: 'start_month', end_month: 'end_month'
    },
    recurring_occurrences: {
        id: 'id', recurring_id: 'recurring_id', occurrence_month: 'occurrence_month', due_date: 'due_date', status: 'status',
        paid_date: 'paid_date', amount_cents: ['amount', 'cents'], expense_id: 'expense_id'
    },
    pots: {
        id: 'id', name: 'name', color: 'color', icon: 'icon', goal_cents: ['goal', 'cents'], mode: 'mode',
        monthly_cents: ['monthly_amount', 'cents'], start_month: 'start_month', active: ['active', 'bool']
    },
    wish_items: {
        id: 'id', name: 'name', estimated_cents: ['estimated_price', 'cents'], notes: 'notes', url: 'url', status: 'status',
        pot_id: 'pot_id', real_cents: ['real_price', 'cents'], purchase_date: 'purchase_date', expense_id: 'expense_id',
        created_at: ['created_at', 'ts']
    },
    pot_entries: {
        id: 'id', pot_id: 'pot_id', entry_date: 'entry_date', amount_cents: ['amount', 'cents'], kind: 'kind', note: 'note',
        auto_month: 'auto_month', wish_item_id: 'wish_item_id'
    },
    expense_templates: {
        id: 'id', name: 'name', type: 'type', amount_cents: ['amount', 'cents'], category_id: 'category_id', account_id: 'account_id',
        payment_method_id: 'payment_method_id', description: 'description', tags: 'tags', created_at: ['created_at', 'ts']
    },
    attachments: {
        id: 'id', expense_id: 'expense_id', file_name: 'file_name', content_type: 'content_type', size_bytes: 'size_bytes',
        data: 'data', created_at: ['created_at', 'ts']
    },
    app_settings: {setting_key: 'setting_key', setting_value: 'setting_value'}
};

const CONVERT = {
    cents: v => (v == null ? null : Math.round(Number(v) * 100)),
    bool: v => (v ? 1 : 0),
    // '2026-11-01 22:14:01.124074' -> '2026-11-01T22:14:01.124'; uma data sem hora ganha meia-noite
    ts: v => {
        if (v == null) return null;
        const text = String(v).replace(' ', 'T');
        if (!text.includes('T')) return `${text}T00:00:00.000`;
        const [head, fraction = ''] = text.split('.');
        return `${head}.${(fraction.replace(/[^0-9].*$/, '') + '000').slice(0, 3)}`;
    }
};

/** Copia de seguranca e restauracao de todos os dados, no formato do app (JSON) ou a partir do backup do computador (H2). */
export class Backup {
    constructor(db) {
        this.db = db;
    }

    columnsOf(table) {
        return this.db.all(`pragma table_info(${table})`).map(c => c.name);
    }

    /** Todo o banco como texto JSON. */
    dump() {
        const tables = {};
        for (const table of TABLES) tables[table] = this.db.all(`select * from ${table}`);
        return JSON.stringify({app: APP, format: 1, schemaVersion: SCHEMA_VERSION, createdAt: this.db.now(), tables});
    }

    /** Substitui TUDO pelo conteudo do arquivo. Tudo ou nada: se algo estiver errado, os dados atuais ficam como estao. */
    restore(content) {
        const tables = this.parse(content);
        this.db.tx(() => {
            this.db.sql.run('pragma defer_foreign_keys = on');
            for (const table of [...TABLES].reverse()) this.db.run(`delete from ${table}`);
            this.db.run('delete from sqlite_sequence');
            for (const table of TABLES) this.insertAll(table, tables[table] ?? []);
            if (this.db.all('pragma foreign_key_check').length) throw badRequest('O backup tem registros que apontam para dados que não existem.');
            if (!this.db.value('select count(*) from accounts')) throw badRequest('O backup não tem nenhuma conta.');
        });
    }

    /** Reconhece o formato e devolve {tabela: [linhas]} ja no esquema daqui. */
    parse(content) {
        const text = typeof content === 'string' ? content.replace(/^﻿/, '').trim() : '';
        if (text.startsWith('{')) return this.parseJson(text);
        if (/CREATE\s+(MEMORY\s+|CACHED\s+)?TABLE/i.test(text) && /"EXPENSES"/i.test(text) && /"ACCOUNTS"/i.test(text)) return this.fromH2(text);
        throw badRequest(NOT_A_BACKUP);
    }

    parseJson(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw badRequest(NOT_A_BACKUP);
        }
        if (data?.app !== APP || typeof data.tables !== 'object' || data.tables === null) throw badRequest(NOT_A_BACKUP);
        if (data.schemaVersion > SCHEMA_VERSION) throw badRequest('Este backup é de uma versão mais nova do aplicativo. Atualize o app antes de restaurar.');
        return data.tables;
    }

    fromH2(text) {
        const parsed = parseH2Script(text);
        const out = {};
        for (const [table, spec] of Object.entries(FROM_H2)) {
            const source = parsed.get(table);
            out[table] = (source?.rows ?? []).map(row => {
                const mapped = {};
                for (const [target, how] of Object.entries(spec)) {
                    const [from, kind] = Array.isArray(how) ? how : [how, null];
                    const value = row[from] === undefined ? null : row[from];
                    mapped[target] = kind ? CONVERT[kind](value) : value;
                }
                return mapped;
            });
        }
        if (!parsed.has('expenses') || !parsed.has('accounts')) throw badRequest(NOT_A_BACKUP);
        // colunas que so existem aqui: o backup antigo nao tem
        for (const e of out.expenses) { e.type ??= 'EXPENSE'; e.status ??= 'PAID'; }
        for (const w of out.wish_items) w.updated_at = w.created_at;
        return out;
    }

    insertAll(table, rows) {
        if (!rows.length) return;
        const known = this.columnsOf(table);
        const now = this.db.now();
        for (const row of rows) {
            const values = {...row};
            if (known.includes('uuid') && !values.uuid) values.uuid = this.db.newId();
            if (known.includes('updated_at') && !values.updated_at) values.updated_at = values.created_at ?? now;
            if (known.includes('created_at') && !values.created_at) values.created_at = values.updated_at ?? now;
            const columns = known.filter(c => values[c] !== undefined);
            this.db.run(`insert into ${table} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`,
                columns.map(c => values[c]));
        }
    }
}
