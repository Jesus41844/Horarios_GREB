-- Cambios sobre una base que ya existe. Todo tiene que poder ejecutarse dos
-- veces sin romper nada: la app los aplica sola al arrancar si detecta que
-- falta alguno. Solo Postgres; en SQLite las tablas se rehacen desde schema.sql.

alter table horarios.blocks add column if not exists kind text not null default 'clase';

alter table horarios.groups add column if not exists owner_user_id bigint
  references horarios.users(id) on delete set null;

-- Agrupaciones que ya existían: el dueño pasa a ser su admin más antiguo.
update horarios.groups g set owner_user_id = (
  select min(m.user_id) from horarios.memberships m
  where m.group_id = g.id and m.role = 'admin'
) where g.owner_user_id is null;

create table if not exists horarios.applied_migrations (
  name text primary key,
  applied_at bigint not null,
  detail text not null default ''
);
alter table horarios.applied_migrations enable row level security;
