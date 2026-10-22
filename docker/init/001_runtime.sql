-- Runs only on first initialization of the local Docker volume.
CREATE ROLE rb_runtime LOGIN PASSWORD 'local-development-runtime-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE lu4_rb TO rb_runtime;
