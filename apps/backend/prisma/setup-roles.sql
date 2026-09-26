-- Acadlyx database roles — ONE-TIME setup, run as a PostgreSQL SUPERUSER before migrations.
-- (Role creation and BYPASSRLS require superuser; they cannot run inside Prisma migrations.)
--
--   psql -h localhost -d postgres \
--     -v owner_password="'...'" -v app_password="'...'" \
--     -f apps/backend/prisma/setup-roles.sql
--
-- acadlyx      Schema owner. Runs migrations. Used ONLY by the platform path
--              (PlatformPrismaService): Platform Admin APIs and tenant resolution.
--              BYPASSRLS because tenant tables use FORCE ROW LEVEL SECURITY, which
--              otherwise applies even to the table owner.
-- acadlyx_app  Restricted login used ONLY by TenantPrismaService for tenant-scoped queries.
--              Not an owner, no BYPASSRLS: every row it touches is filtered by RLS policies.
--              Table privileges are granted by the phase_2_multi_tenancy migration.

SELECT 'CREATE ROLE acadlyx LOGIN CREATEDB'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'acadlyx') \gexec
ALTER ROLE acadlyx WITH LOGIN CREATEDB BYPASSRLS PASSWORD :owner_password;

SELECT 'CREATE ROLE acadlyx_app LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'acadlyx_app') \gexec
ALTER ROLE acadlyx_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD :app_password;

SELECT 'CREATE DATABASE acadlyx OWNER acadlyx'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'acadlyx') \gexec
GRANT CONNECT ON DATABASE acadlyx TO acadlyx_app;
