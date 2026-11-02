-- The monthly views filter by date and by category: without these, every month view scans the whole table.
create index idx_expenses_date on expenses (date);
create index idx_expenses_category on expenses (category_id);
