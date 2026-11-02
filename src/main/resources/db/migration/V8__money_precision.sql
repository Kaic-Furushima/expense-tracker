-- Todos os valores em dinheiro passam a ter precisao explicita: ate 13 digitos inteiros e 2 casas decimais.

alter table expenses alter column amount set data type numeric(15, 2);
alter table accounts alter column initial_balance set data type numeric(15, 2);
alter table recurring_payments alter column amount set data type numeric(15, 2);
alter table recurring_occurrences alter column amount set data type numeric(15, 2);
alter table pots alter column goal set data type numeric(15, 2);
alter table pots alter column monthly_amount set data type numeric(15, 2);
alter table pot_entries alter column amount set data type numeric(15, 2);
alter table wish_items alter column estimated_price set data type numeric(15, 2);
alter table wish_items alter column real_price set data type numeric(15, 2);
