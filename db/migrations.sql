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

-- Ruleta de actividades: reparto, quién participó y strikes por ausencia.
create table if not exists horarios.actividades (
  id bigint generated always as identity primary key,
  group_id bigint not null references horarios.groups(id) on delete cascade,
  nombre text not null,
  modo text not null check (modo in ('ventas', 'horario')),
  dia smallint not null default 0,
  inicio integer not null default 0,
  fin integer not null default 0,
  cuantas integer not null default 1,
  creada bigint not null,
  cerrada integer not null default 0
);
create index if not exists actividades_group_idx on horarios.actividades(group_id);

create table if not exists horarios.participaciones (
  actividad_id bigint not null references horarios.actividades(id) on delete cascade,
  person_key text not null,
  creada bigint not null,
  primary key (actividad_id, person_key)
);
create index if not exists participaciones_key_idx on horarios.participaciones(person_key);

create table if not exists horarios.strikes (
  group_id bigint not null references horarios.groups(id) on delete cascade,
  person_key text not null,
  veces integer not null default 0,
  detalle text not null default '',
  actualizado bigint not null,
  primary key (group_id, person_key)
);

alter table horarios.actividades enable row level security;
alter table horarios.participaciones enable row level security;
alter table horarios.strikes enable row level security;

-- Ruleta: los días exactos de la actividad, para cuando no es solo uno. Las
-- ventas suelen ser de varios días y en las ventas da igual el horario, así que
-- los días son de quién mostrarlo y no de a quién ofrecerlo.
alter table horarios.actividades add column if not exists dias text not null default '';
update horarios.actividades set dias = dia::text where dias = '' and modo = 'horario';
