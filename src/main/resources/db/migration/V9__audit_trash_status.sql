-- Auditoria (criado/alterado em), lixeira (deleted_at) e situacao do pagamento (pago / a pagar) dos lancamentos.

alter table expenses add column created_at timestamp;
alter table expenses add column updated_at timestamp;
alter table expenses add column deleted_at timestamp;
alter table expenses add column status varchar(10) default 'PAID' not null;

-- Lancamentos antigos nao tem registro de quando foram criados: usa-se a data do proprio lancamento.
update expenses e set created_at = cast(e.date as timestamp), updated_at = cast(e.date as timestamp);

alter table expenses alter column created_at set not null;
alter table expenses alter column updated_at set not null;
