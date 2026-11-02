-- O campo de texto livre "source" (conta / forma) vira duas coisas: conta e forma de pagamento.
--  * valores que sao formas de pagamento (Pix, Debito, Cartao...) viram forma de pagamento, na conta principal;
--  * "Geral" e vazio ficam na conta principal;
--  * qualquer outro valor (Santander, Corretora, Conta corrente...) vira uma conta com esse nome.

insert into payment_methods (name) values ('Pix'), ('Débito'), ('Crédito'), ('Dinheiro'), ('Boleto'), ('Transferência');

insert into accounts (name, type, color, icon, initial_balance, archived)
values ('Conta principal', 'CHECKING', '#2F7D6D', 'wallet', 0, false);

insert into accounts (name, type, color, icon, initial_balance, archived)
select s.src,
       case when lower(s.src) like '%corretora%' or lower(s.src) like '%invest%' then 'INVESTMENT' else 'CHECKING' end,
       '#64B5F6', null, 0, false
from (select distinct trim(source) as src from expenses) s
where s.src is not null
  and s.src <> ''
  and lower(s.src) not in ('geral', 'pix', 'débito', 'debito', 'cartão de débito', 'cartao de debito',
                           'cartão', 'cartao', 'cartão de crédito', 'cartao de credito', 'crédito', 'credito',
                           'dinheiro', 'boleto', 'ted', 'doc', 'transferência', 'transferencia')
  and not exists (select 1 from accounts a where lower(a.name) = lower(s.src));

update expenses e
set account_id = coalesce(
        (select a.id from accounts a where lower(a.name) = lower(trim(e.source))),
        (select a.id from accounts a where a.name = 'Conta principal'));

update expenses set payment_method_id = (select id from payment_methods where name = 'Pix')
where lower(trim(source)) = 'pix';
update expenses set payment_method_id = (select id from payment_methods where name = 'Débito')
where lower(trim(source)) in ('débito', 'debito', 'cartão de débito', 'cartao de debito');
update expenses set payment_method_id = (select id from payment_methods where name = 'Crédito')
where lower(trim(source)) in ('cartão', 'cartao', 'cartão de crédito', 'cartao de credito', 'crédito', 'credito');
update expenses set payment_method_id = (select id from payment_methods where name = 'Dinheiro')
where lower(trim(source)) = 'dinheiro';
update expenses set payment_method_id = (select id from payment_methods where name = 'Boleto')
where lower(trim(source)) = 'boleto';
update expenses set payment_method_id = (select id from payment_methods where name = 'Transferência')
where lower(trim(source)) in ('ted', 'doc', 'transferência', 'transferencia');

insert into app_settings (setting_key, setting_value) values ('autoPayRecurring', 'false');
