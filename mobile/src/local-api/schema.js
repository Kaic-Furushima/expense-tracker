// Esquema do SQLite do aplicativo. Consolida as migracoes Flyway V1..V13 do back-end Java, com duas diferencas
// pensadas para a sincronizacao futura: toda tabela tem "uuid" (identidade estavel entre aparelhos) e "updated_at".
// Dinheiro e guardado em centavos inteiros (colunas *_cents), sem erro de arredondamento.
// Para mudar o esquema, acrescente uma entrada no fim de MIGRATIONS (nunca edite as antigas).

const V1 = `
create table categories (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null collate nocase unique,
    icon text,
    color text,
    parent_id integer references categories (id),
    updated_at text not null
);

create table payment_methods (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null collate nocase unique,
    updated_at text not null
);

create table accounts (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null collate nocase unique,
    type text not null,
    color text,
    icon text,
    initial_cents integer not null default 0,
    archived integer not null default 0,
    parent_id integer references accounts (id),
    closing_day integer,
    due_day integer,
    updated_at text not null
);

create table expenses (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null,
    description text,
    amount_cents integer not null,
    date text not null,
    type text not null default 'EXPENSE',
    status text not null default 'PAID',
    category_id integer references categories (id),
    account_id integer not null references accounts (id),
    payment_method_id integer references payment_methods (id),
    installment_group text,
    installment_number integer,
    installment_total integer,
    created_at text not null,
    updated_at text not null,
    deleted_at text
);
create index idx_expenses_date on expenses (date);
create index idx_expenses_category on expenses (category_id);
create index idx_expenses_account on expenses (account_id);
create index idx_expenses_installment_group on expenses (installment_group);

create table tags (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null collate nocase unique,
    updated_at text not null
);

create table expense_tags (
    expense_id integer not null references expenses (id) on delete cascade,
    tag_id integer not null references tags (id) on delete cascade,
    primary key (expense_id, tag_id)
);

create table budgets (
    id integer primary key autoincrement,
    uuid text not null unique,
    category_id integer references categories (id) on delete cascade,
    from_month text not null,
    amount_cents integer,
    updated_at text not null
);
create unique index uk_budgets_category_month on budgets (coalesce(category_id, 0), from_month);

create table transfers (
    id integer primary key autoincrement,
    uuid text not null unique,
    from_account_id integer not null references accounts (id),
    to_account_id integer not null references accounts (id),
    amount_cents integer not null,
    date text not null,
    description text,
    invoice_month text,
    created_at text not null,
    updated_at text not null,
    deleted_at text
);

create table recurring_payments (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null,
    type text not null,
    amount_cents integer,
    variable_amount integer not null default 0,
    day_of_month integer not null,
    account_id integer not null references accounts (id),
    payment_method_id integer references payment_methods (id),
    category_id integer references categories (id),
    active integer not null default 1,
    start_month text not null,
    end_month text,
    updated_at text not null
);

create table recurring_occurrences (
    id integer primary key autoincrement,
    uuid text not null unique,
    recurring_id integer not null references recurring_payments (id),
    occurrence_month text not null,
    due_date text not null,
    status text not null,
    paid_date text,
    amount_cents integer,
    expense_id integer references expenses (id),
    updated_at text not null,
    unique (recurring_id, occurrence_month)
);

create table pots (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null collate nocase unique,
    color text,
    icon text,
    goal_cents integer,
    mode text not null,
    monthly_cents integer,
    start_month text not null,
    active integer not null default 1,
    updated_at text not null
);

create table wish_items (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null,
    estimated_cents integer,
    notes text,
    url text,
    status text not null,
    pot_id integer references pots (id),
    real_cents integer,
    purchase_date text,
    expense_id integer references expenses (id),
    created_at text not null,
    updated_at text not null
);

create table pot_entries (
    id integer primary key autoincrement,
    uuid text not null unique,
    pot_id integer not null references pots (id),
    entry_date text not null,
    amount_cents integer not null,
    kind text not null,
    note text,
    auto_month text,
    wish_item_id integer references wish_items (id),
    updated_at text not null,
    unique (pot_id, auto_month)
);

create table expense_templates (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null,
    type text not null,
    amount_cents integer,
    category_id integer references categories (id) on delete set null,
    account_id integer references accounts (id) on delete cascade,
    payment_method_id integer references payment_methods (id) on delete set null,
    description text,
    tags text,
    created_at text not null,
    updated_at text not null
);

create table attachments (
    id integer primary key autoincrement,
    uuid text not null unique,
    expense_id integer not null references expenses (id) on delete cascade,
    file_name text not null,
    content_type text not null,
    size_bytes integer not null,
    data text not null,
    created_at text not null,
    updated_at text not null
);
create index idx_attachments_expense on attachments (expense_id);

create table app_settings (
    setting_key text primary key,
    setting_value text not null,
    updated_at text not null
);
`;

// --- Sincronizacao (ver src/sync/) ---
// Tabelas que viajam entre os aparelhos, na ordem em que podem ser gravadas (quem e referenciado vem antes).
export const SYNC_TABLES = ['categories', 'payment_methods', 'accounts', 'tags', 'expenses', 'budgets', 'transfers',
    'recurring_payments', 'recurring_occurrences', 'pots', 'wish_items', 'pot_entries', 'expense_templates', 'attachments'];

// "Agora" em milissegundos; sync_ctl.clock_ms (so os testes preenchem) tem prioridade sobre o relogio do SQLite.
const NOW_MS = "coalesce((select clock_ms from sync_ctl), cast((julianday('now') - 2440587.5) * 86400000 as integer))";

/**
 * Gatilhos de uma tabela sincronizada. Nao usar "insert or replace" neles: quando o comando que os dispara (ex.: acao de
 * chave estrangeira) tem outra politica de conflito, o SQLite ignora a do gatilho. "on conflict do update" nao tem esse problema.
 */
const IDLE = 'when (select applying from sync_ctl) = 0';
const UPSERT = 'on conflict (table_name, uuid) do update set deleted = excluded.deleted, at = excluded.at';
const mark = (table, uuid, deleted) =>
    `insert into sync_outbox (table_name, uuid, deleted, at) values ('${table}', ${uuid}, ${deleted}, ${NOW_MS}) ${UPSERT};`;
const triggersFor = t => [
    `create trigger sync_ai_${t} after insert on ${t} ${IDLE} begin ${mark(t, 'new.uuid', 0)} end;`,
    `create trigger sync_au_${t} after update on ${t} ${IDLE} begin ${mark(t, 'new.uuid', 0)} end;`,
    `create trigger sync_ad_${t} after delete on ${t} ${IDLE} begin ${mark(t, 'old.uuid', 1)} end;`
];

/**
 * Caixa de saida: qualquer inclusao, alteracao ou exclusao feita no aparelho anota a linha em sync_outbox (a menos que o
 * proprio sync esteja gravando: sync_ctl.applying = 1). O motor so precisa enviar o que esta na caixa.
 */
function syncSchema() {
    const lines = [`
create table sync_ctl (applying integer not null default 0, clock_ms integer);
insert into sync_ctl (applying, clock_ms) values (0, null);
create table sync_state (key text primary key, value text not null);
create table sync_outbox (
    table_name text not null,
    uuid text not null,
    deleted integer not null default 0,
    at integer not null,
    primary key (table_name, uuid)
);
create table sync_alias (table_name text not null, from_uuid text not null, to_uuid text not null, primary key (table_name, from_uuid));
create table sync_pending (table_name text not null, uuid text not null, change text not null, reason text, primary key (table_name, uuid));
`];
    const idle = IDLE;
    for (const t of SYNC_TABLES) {
        // linhas que ja existiam entram com at = 0: valem pelo proprio updated_at, nao por "agora"
        lines.push(`insert or replace into sync_outbox (table_name, uuid, deleted, at) select '${t}', uuid, 0, 0 from ${t};`);
        lines.push(...triggersFor(t));
    }
    // etiquetas de um lancamento: mexer nelas altera o lancamento
    const parent = (ref, deleted) =>
        `insert into sync_outbox (table_name, uuid, deleted, at) select 'expenses', uuid, ${deleted}, ${NOW_MS} from expenses where id = ${ref}.expense_id ${UPSERT};`;
    lines.push(`create trigger sync_ai_expense_tags after insert on expense_tags ${idle} begin ${parent('new', 0)} end;`);
    lines.push(`create trigger sync_ad_expense_tags after delete on expense_tags ${idle} begin ${parent('old', 0)} end;`);
    return lines.join('\n');
}

/**
 * Categorias de despesa e de receita separadas: "kind" (EXPENSE ou INCOME) e o nome passa a ser unico dentro de cada tipo.
 * O SQLite nao apaga uma restricao "unique", entao a tabela e refeita (receita oficial: tabela nova, copia, troca de nome).
 * Quem ja era usado por receitas ganha uma copia de receita e as receitas passam a apontar para ela.
 */
export const SPLIT_KINDS_SQL = `
insert into categories (uuid, name, icon, color, kind, updated_at)
select lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       c.name, c.icon, c.color, 'INCOME', strftime('%Y-%m-%dT%H:%M:%S.000', 'now', 'localtime')
from categories c
where c.kind = 'EXPENSE' and not exists (select 1 from categories i where i.kind = 'INCOME' and i.name = c.name) and (
    exists (select 1 from expenses e where e.category_id = c.id and e.type = 'INCOME')
    or exists (select 1 from recurring_payments r where r.category_id = c.id and r.type = 'INCOME')
    or exists (select 1 from expense_templates t where t.category_id = c.id and t.type = 'INCOME'));
update expenses set category_id = (select n.id from categories n join categories o on o.name = n.name and n.kind = 'INCOME' where o.id = expenses.category_id)
where type = 'INCOME' and category_id is not null and exists (select 1 from categories o where o.id = expenses.category_id and o.kind = 'EXPENSE');
update recurring_payments set category_id = (select n.id from categories n join categories o on o.name = n.name and n.kind = 'INCOME' where o.id = recurring_payments.category_id)
where type = 'INCOME' and category_id is not null and exists (select 1 from categories o where o.id = recurring_payments.category_id and o.kind = 'EXPENSE');
update expense_templates set category_id = (select n.id from categories n join categories o on o.name = n.name and n.kind = 'INCOME' where o.id = expense_templates.category_id)
where type = 'INCOME' and category_id is not null and exists (select 1 from categories o where o.id = expense_templates.category_id and o.kind = 'EXPENSE');
`;

const V3 = `
pragma foreign_keys = off;
create table categories_new (
    id integer primary key autoincrement,
    uuid text not null unique,
    name text not null collate nocase,
    icon text,
    color text,
    parent_id integer references categories (id),
    kind text not null default 'EXPENSE',
    updated_at text not null,
    unique (name, kind)
);
insert into categories_new (id, uuid, name, icon, color, parent_id, kind, updated_at)
    select id, uuid, name, icon, color, parent_id, 'EXPENSE', updated_at from categories;
drop table categories;
alter table categories_new rename to categories;
${triggersFor('categories').join('\n')}
pragma foreign_keys = on;
${SPLIT_KINDS_SQL}`;

export const MIGRATIONS = [V1, syncSchema(), V3];
export const SCHEMA_VERSION = MIGRATIONS.length;
