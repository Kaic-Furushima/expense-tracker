-- "Dinheiro guardado" passa a ser uma escolha da conta (caixa de seleção), não mais automático por ficar dentro de outra.
-- Fica sem NOT NULL de propósito: aparelhos com versão antiga do sync mandam linhas sem esse campo (nulo vale falso).
-- As contas que já ficavam dentro de outra continuam contando como guardado.

alter table accounts add column saved boolean default false;
update accounts set saved = true where parent_id is not null;
