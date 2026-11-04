-- Hub de sincronizacao do Expense Tracker no Supabase.
-- Como usar: crie um projeto em supabase.com, abra "SQL Editor", cole este arquivo inteiro e execute.
-- Em Authentication > Providers deixe so "Email" ligado; crie a sua conta pelo proprio app (ou desligue novos cadastros
-- depois de criar a sua em Authentication > Sign In / Providers).
--
-- O servidor nunca ve os dados: "payload" e "check_value" chegam cifrados (AES-GCM) com uma chave que so existe nos
-- seus aparelhos. Ficam em claro apenas: nome da tabela, uuid da linha, instante da alteracao e se foi uma exclusao.

create table if not exists vault (
    user_id uuid primary key default auth.uid(),
    salt text not null,
    check_value text not null
);

create sequence if not exists changes_seq;

create table if not exists changes (
    user_id uuid not null default auth.uid(),
    profile_id text not null,
    table_name text not null,
    row_uuid text not null,
    seq bigint not null default nextval('changes_seq'),
    updated_at bigint not null,          -- milissegundos UTC da alteracao feita no aparelho
    deleted boolean not null default false,
    payload text,                        -- JSON cifrado; nulo quando deleted
    device_id text not null,
    primary key (user_id, profile_id, table_name, row_uuid)
);
create index if not exists changes_pull on changes (user_id, profile_id, seq);

alter table vault enable row level security;
alter table changes enable row level security;

drop policy if exists vault_own on vault;
create policy vault_own on vault for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists changes_own on changes;
create policy changes_own on changes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Grava um lote de alteracoes. So entra uma versao mais nova (updated_at maior) que a guardada; cada linha aceita ganha
-- um numero de sequencia novo, que e o que os aparelhos usam para saber "o que mudou desde a ultima vez".
create or replace function push_changes(p_profile text, p_device text, p_changes jsonb)
returns integer
language sql
security invoker
as $$
    with up as (
        insert into changes as c (user_id, profile_id, table_name, row_uuid, updated_at, deleted, payload, device_id)
        select auth.uid(), p_profile, x.table_name, x.row_uuid, x.updated_at, coalesce(x.deleted, false),
               case when coalesce(x.deleted, false) then null else x.payload end, p_device
        from jsonb_to_recordset(p_changes) as x(table_name text, row_uuid text, updated_at bigint, deleted boolean, payload text)
        on conflict (user_id, profile_id, table_name, row_uuid) do update
            set seq = nextval('changes_seq'), updated_at = excluded.updated_at, deleted = excluded.deleted,
                payload = excluded.payload, device_id = excluded.device_id
            where excluded.updated_at > c.updated_at
        returning 1
    )
    select count(*)::integer from up;
$$;

grant usage on sequence changes_seq to authenticated;
grant execute on function push_changes(text, text, jsonb) to authenticated;
