-- Compras parceladas (grupo + numero da parcela), cartao de credito (dias de fechamento e vencimento)
-- e pagamento de fatura (a transferencia guarda de qual fatura ela e).

alter table expenses add column installment_group varchar(36);
alter table expenses add column installment_number int;
alter table expenses add column installment_total int;
create index idx_expenses_installment_group on expenses (installment_group);

alter table accounts add column closing_day int;
alter table accounts add column due_day int;

alter table transfers add column invoice_month varchar(7);
