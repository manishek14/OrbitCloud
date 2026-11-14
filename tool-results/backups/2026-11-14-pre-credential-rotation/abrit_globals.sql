--
-- PostgreSQL database cluster dump
--

\restrict BqpCU4fYyeo2k0cmS3f5S8QSFfF5jF7akcuagBeQ6IYpvZGaaApn43If9aCWWXg

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE abrit;
ALTER ROLE abrit WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS PASSWORD 'SCRAM-SHA-256$4096:mg8JueXCIqJT+zvdrs0WWg==$hLMgT4yDJ/u+lWKJl7CDPwXBX1fgvF9a9AALYw1Laxc=:CQd+qlIatPGwcgEsZ5AbD8GgMENqqTPW+nb5WqoXBjc=';

--
-- User Configurations
--








\unrestrict BqpCU4fYyeo2k0cmS3f5S8QSFfF5jF7akcuagBeQ6IYpvZGaaApn43If9aCWWXg

--
-- PostgreSQL database cluster dump complete
--

