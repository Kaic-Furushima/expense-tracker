-- Estado do motor de sincronizacao (ver sync/SyncEngine): o que ja foi enviado ao hub, apelidos de registros que
-- viraram um so, e alteracoes recebidas que esperam o registro do qual dependem.

create table sync_state (
    state_key varchar(80) primary key,
    state_value varchar(255) not null
);

-- Impressao digital (hash) do conteudo de cada linha no ultimo envio: so o que mudou depois dela e enviado de novo.
create table sync_sent (
    table_name varchar(40) not null,
    uuid varchar(36) not null,
    content_hash varchar(64) not null,
    updated_ms bigint not null,
    primary key (table_name, uuid)
);

create table sync_alias (
    table_name varchar(40) not null,
    from_uuid varchar(36) not null,
    to_uuid varchar(36) not null,
    primary key (table_name, from_uuid)
);

create table sync_pending (
    table_name varchar(40) not null,
    uuid varchar(36) not null,
    change_json clob not null,
    reason varchar(500),
    primary key (table_name, uuid)
);
