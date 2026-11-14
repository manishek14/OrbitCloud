-- AbrIT Cloud — PostgreSQL bootstrap (runs once on the FIRST container start,
-- executed by the official postgres image entrypoint AFTER $POSTGRES_DB
-- (abrit_portal) has been created).
--
-- Two logical databases, two owners of data:
--   abrit_portal  : Next.js commerce records (Prisma)     — created via POSTGRES_DB
--   abrit_orchard : Orchard Core CMS documents (YesSql)   — created here
CREATE DATABASE abrit_orchard
    OWNER abrit
    ENCODING 'UTF8';
