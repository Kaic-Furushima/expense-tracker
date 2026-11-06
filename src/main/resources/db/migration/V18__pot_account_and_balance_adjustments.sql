-- Caixinha atrelada a uma conta (o banco onde o dinheiro está) e correção de saldo.
-- "adjustment" fica sem NOT NULL de propósito: aparelhos com versão antiga do sync mandam linhas sem esse campo.

alter table pots add column account_id bigint;
alter table pots add constraint fk_pots_account foreign key (account_id) references accounts (id);

alter table expenses add column adjustment boolean default false;
