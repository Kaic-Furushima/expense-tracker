-- Preparacao para a sincronizacao com o celular: toda linha sincronizada ganha uma identidade estavel (uuid, igual nos
-- dois aparelhos) e o instante da ultima alteracao (updated_at). As exclusoes definitivas ficam registradas em
-- sync_tombstones para que o outro aparelho saiba que o registro foi apagado.

-- Tabelas que ainda nao tinham updated_at: usa o created_at quando existe, senao o instante da migracao.
alter table categories add column uuid varchar(36);
alter table categories add column updated_at timestamp;
alter table payment_methods add column uuid varchar(36);
alter table payment_methods add column updated_at timestamp;
alter table accounts add column uuid varchar(36);
alter table accounts add column updated_at timestamp;
alter table tags add column uuid varchar(36);
alter table tags add column updated_at timestamp;
alter table budgets add column uuid varchar(36);
alter table budgets add column updated_at timestamp;
alter table recurring_payments add column uuid varchar(36);
alter table recurring_payments add column updated_at timestamp;
alter table recurring_occurrences add column uuid varchar(36);
alter table recurring_occurrences add column updated_at timestamp;
alter table pots add column uuid varchar(36);
alter table pots add column updated_at timestamp;
alter table wish_items add column uuid varchar(36);
alter table wish_items add column updated_at timestamp;
alter table pot_entries add column uuid varchar(36);
alter table pot_entries add column updated_at timestamp;
alter table expense_templates add column uuid varchar(36);
alter table expense_templates add column updated_at timestamp;
alter table attachments add column uuid varchar(36);
alter table attachments add column updated_at timestamp;

-- Lancamentos e transferencias ja tem updated_at (V6 e V9): so falta o uuid.
alter table expenses add column uuid varchar(36);
alter table transfers add column uuid varchar(36);

update categories set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update payment_methods set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update accounts set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update tags set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update budgets set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update recurring_payments set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update recurring_occurrences set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update pots set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update wish_items set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update pot_entries set uuid = cast(random_uuid() as varchar(36)), updated_at = current_timestamp;
update expense_templates set uuid = cast(random_uuid() as varchar(36)), updated_at = created_at;
update attachments set uuid = cast(random_uuid() as varchar(36)), updated_at = created_at;
update expenses set uuid = cast(random_uuid() as varchar(36));
update transfers set uuid = cast(random_uuid() as varchar(36));

alter table categories alter column uuid set not null;
alter table categories alter column updated_at set not null;
alter table payment_methods alter column uuid set not null;
alter table payment_methods alter column updated_at set not null;
alter table accounts alter column uuid set not null;
alter table accounts alter column updated_at set not null;
alter table tags alter column uuid set not null;
alter table tags alter column updated_at set not null;
alter table budgets alter column uuid set not null;
alter table budgets alter column updated_at set not null;
alter table recurring_payments alter column uuid set not null;
alter table recurring_payments alter column updated_at set not null;
alter table recurring_occurrences alter column uuid set not null;
alter table recurring_occurrences alter column updated_at set not null;
alter table pots alter column uuid set not null;
alter table pots alter column updated_at set not null;
alter table wish_items alter column uuid set not null;
alter table wish_items alter column updated_at set not null;
alter table pot_entries alter column uuid set not null;
alter table pot_entries alter column updated_at set not null;
alter table expense_templates alter column uuid set not null;
alter table expense_templates alter column updated_at set not null;
alter table attachments alter column uuid set not null;
alter table attachments alter column updated_at set not null;
alter table expenses alter column uuid set not null;
alter table transfers alter column uuid set not null;

alter table categories add constraint uk_categories_uuid unique (uuid);
alter table payment_methods add constraint uk_payment_methods_uuid unique (uuid);
alter table accounts add constraint uk_accounts_uuid unique (uuid);
alter table tags add constraint uk_tags_uuid unique (uuid);
alter table budgets add constraint uk_budgets_uuid unique (uuid);
alter table recurring_payments add constraint uk_recurring_payments_uuid unique (uuid);
alter table recurring_occurrences add constraint uk_recurring_occurrences_uuid unique (uuid);
alter table pots add constraint uk_pots_uuid unique (uuid);
alter table wish_items add constraint uk_wish_items_uuid unique (uuid);
alter table pot_entries add constraint uk_pot_entries_uuid unique (uuid);
alter table expense_templates add constraint uk_expense_templates_uuid unique (uuid);
alter table attachments add constraint uk_attachments_uuid unique (uuid);
alter table expenses add constraint uk_expenses_uuid unique (uuid);
alter table transfers add constraint uk_transfers_uuid unique (uuid);

-- Exclusoes definitivas ainda nao enviadas aos outros aparelhos.
create table sync_tombstones (
    id bigint generated by default as identity primary key,
    table_name varchar(40) not null,
    uuid varchar(36) not null,
    deleted_at timestamp not null,
    constraint uk_sync_tombstones unique (table_name, uuid)
);
