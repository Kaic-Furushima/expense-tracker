alter table expenses alter column account_id set not null;
alter table expenses drop column source;
