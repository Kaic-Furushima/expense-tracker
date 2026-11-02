-- Removidos os marcadores "essencial", "planejado" e "investimento" dos lancamentos e dos recorrentes.
alter table expenses drop column necessary;
alter table expenses drop column planned;
alter table expenses drop column invested;
alter table recurring_payments drop column necessary;
alter table recurring_payments drop column invested;
