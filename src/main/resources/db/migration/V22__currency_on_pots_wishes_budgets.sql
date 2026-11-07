-- Moeda em caixinhas, itens da lista de desejos e limites de orçamento (nulo = a moeda principal do app). Ficam sem
-- NOT NULL de propósito: aparelhos com versão antiga do sync mandam linhas sem esse campo.

alter table pots add column currency varchar(3);
alter table wish_items add column currency varchar(3);
alter table budgets add column currency varchar(3);
