// Formato das linhas que viajam entre os aparelhos (o "contrato" do sync; o computador tem o mesmo, em Java).
//
// Cada linha vira um objeto JSON com os nomes de coluna do SQLite do celular, mas:
//  * "id" nao viaja (cada aparelho tem os seus); no lugar vai o uuid da linha, no campo "uuid" do envelope;
//  * chaves estrangeiras viajam como uuid da linha apontada (campo terminado em _uuid, ex.: category_id -> category_uuid);
//  * instantes (tipo ts) viajam como milissegundos UTC; datas ficam "AAAA-MM-DD"; dinheiro em centavos; booleano 0/1.
// Tipos: text, int, date, ts, fk:<tabela>. "natural" e a chave que a pessoa enxerga como a mesma coisa (duas contas com
// o mesmo nome): quando dois aparelhos criam a mesma coisa com uuids diferentes, vale o menor uuid.

export const TABLES = {
    categories: {
        columns: {name: 'text', icon: 'text', color: 'text', kind: 'text', parent_id: 'fk:categories'},
        natural: ['name', 'kind']
    },
    payment_methods: {
        columns: {name: 'text'},
        natural: ['name']
    },
    accounts: {
        columns: {
            name: 'text', type: 'text', color: 'text', icon: 'text', initial_cents: 'int', archived: 'int',
            parent_id: 'fk:accounts', closing_day: 'int', due_day: 'int'
        },
        natural: ['name']
    },
    tags: {
        columns: {name: 'text'},
        natural: ['name']
    },
    expenses: {
        columns: {
            name: 'text', description: 'text', amount_cents: 'int', date: 'date', type: 'text', status: 'text',
            category_id: 'fk:categories', account_id: 'fk:accounts', payment_method_id: 'fk:payment_methods',
            installment_group: 'text', installment_number: 'int', installment_total: 'int', created_at: 'ts', deleted_at: 'ts'
        },
        tags: true // tag_uuids: as etiquetas do lancamento
    },
    budgets: {
        columns: {category_id: 'fk:categories', from_month: 'text', amount_cents: 'int'},
        natural: ['category_id', 'from_month']
    },
    transfers: {
        columns: {
            from_account_id: 'fk:accounts', to_account_id: 'fk:accounts', amount_cents: 'int', date: 'date',
            description: 'text', invoice_month: 'text', created_at: 'ts', deleted_at: 'ts'
        }
    },
    recurring_payments: {
        columns: {
            name: 'text', type: 'text', amount_cents: 'int', variable_amount: 'int', day_of_month: 'int',
            account_id: 'fk:accounts', payment_method_id: 'fk:payment_methods', category_id: 'fk:categories',
            active: 'int', start_month: 'text', end_month: 'text'
        }
    },
    recurring_occurrences: {
        columns: {
            recurring_id: 'fk:recurring_payments', occurrence_month: 'text', due_date: 'date', status: 'text',
            paid_date: 'date', amount_cents: 'int', expense_id: 'fk:expenses'
        },
        natural: ['recurring_id', 'occurrence_month']
    },
    pots: {
        columns: {
            name: 'text', color: 'text', icon: 'text', goal_cents: 'int', mode: 'text', monthly_cents: 'int',
            start_month: 'text', active: 'int'
        },
        natural: ['name']
    },
    wish_items: {
        columns: {
            name: 'text', estimated_cents: 'int', notes: 'text', url: 'text', status: 'text', pot_id: 'fk:pots',
            real_cents: 'int', purchase_date: 'date', expense_id: 'fk:expenses', created_at: 'ts'
        }
    },
    pot_entries: {
        columns: {
            pot_id: 'fk:pots', entry_date: 'date', amount_cents: 'int', kind: 'text', note: 'text', auto_month: 'text',
            wish_item_id: 'fk:wish_items'
        },
        natural: ['pot_id', 'auto_month'],
        naturalWhen: 'auto_month' // so as parcelas automaticas se repetem; lancamentos manuais nao
    },
    expense_templates: {
        columns: {
            name: 'text', type: 'text', amount_cents: 'int', category_id: 'fk:categories', account_id: 'fk:accounts',
            payment_method_id: 'fk:payment_methods', description: 'text', tags: 'text', created_at: 'ts'
        }
    },
    attachments: {
        columns: {
            expense_id: 'fk:expenses', file_name: 'text', content_type: 'text', size_bytes: 'int', data: 'text', created_at: 'ts'
        }
    }
};

export const fkName = column => column.replace(/_id$/, '_uuid');
export const isFk = type => type.startsWith('fk:');
export const fkTarget = type => type.slice(3);
