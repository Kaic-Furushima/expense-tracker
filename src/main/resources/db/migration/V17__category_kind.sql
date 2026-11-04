-- Categorias de despesa e de receita passam a ser separadas (a mesma pessoa pode ter "Outros" nas duas).
-- O nome continua unico dentro de cada tipo. As categorias que ja eram usadas por receitas ganham uma copia de receita
-- e as receitas, os pagamentos recorrentes e os modelos de receita passam a apontar para a copia.

alter table categories add column kind varchar(10) default 'EXPENSE' not null;
alter table categories drop constraint uk_categories_name;
alter table categories add constraint uk_categories_name_kind unique (name, kind);

insert into categories (name, icon, color, kind, uuid, updated_at)
select c.name, c.icon, c.color, 'INCOME', cast(random_uuid() as varchar(36)), current_timestamp
from categories c
where c.kind = 'EXPENSE' and (
    exists (select 1 from expenses e where e.category_id = c.id and e.type = 'INCOME')
    or exists (select 1 from recurring_payments r where r.category_id = c.id and r.type = 'INCOME')
    or exists (select 1 from expense_templates t where t.category_id = c.id and t.type = 'INCOME'));

update expenses e set category_id = (
    select n.id from categories n join categories o on o.name = n.name and n.kind = 'INCOME' where o.id = e.category_id)
where e.type = 'INCOME' and e.category_id is not null
  and exists (select 1 from categories o where o.id = e.category_id and o.kind = 'EXPENSE');

update recurring_payments r set category_id = (
    select n.id from categories n join categories o on o.name = n.name and n.kind = 'INCOME' where o.id = r.category_id)
where r.type = 'INCOME' and r.category_id is not null
  and exists (select 1 from categories o where o.id = r.category_id and o.kind = 'EXPENSE');

update expense_templates t set category_id = (
    select n.id from categories n join categories o on o.name = n.name and n.kind = 'INCOME' where o.id = t.category_id)
where t.type = 'INCOME' and t.category_id is not null
  and exists (select 1 from categories o where o.id = t.category_id and o.kind = 'EXPENSE');
