-- O estado do sync passa a guardar a sessao de login (tokens longos): o valor deixa de caber em 255 caracteres.
alter table sync_state alter column state_value set data type varchar(8000);
