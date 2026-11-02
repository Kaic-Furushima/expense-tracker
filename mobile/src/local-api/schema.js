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

export const MIGRATIONS = [V1];
export const SCHEMA_VERSION = MIGRATIONS.length;
