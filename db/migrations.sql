-- Cambios sobre una base que ya existe. Todo tiene que poder ejecutarse dos
-- veces sin romper nada: la app los aplica sola al arrancar si detecta que
-- faltan. Solo Postgres; en SQLite las tablas se rehacen desde schema.sql.

alter table horarios.blocks add column if not exists kind text not null default 'clase';
