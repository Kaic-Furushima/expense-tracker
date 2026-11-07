-- Moeda por conta (nulo = a moeda principal do app) e, numa transferência entre moedas diferentes, o valor que chegou
-- na conta de destino (nulo = o mesmo valor que saiu). Ficam sem NOT NULL de propósito: aparelhos com versão antiga do
-- sync mandam linhas sem esses campos.

alter table accounts add column currency varchar(3);
alter table transfers add column to_amount decimal(15,2);
