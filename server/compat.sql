CREATE SCHEMA IF NOT EXISTS fa_compat;
ALTER TABLE attempts ALTER COLUMN percent TYPE DOUBLE PRECISION;
CREATE OR REPLACE FUNCTION fa_compat.round(value double precision, places integer) RETURNS double precision LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT pg_catalog.round(value::numeric,places)::double precision $$;
CREATE OR REPLACE FUNCTION fa_compat.json(value text) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT value::jsonb $$;
CREATE OR REPLACE FUNCTION fa_compat.json_array_length(value text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT jsonb_array_length(value::jsonb) $$;
CREATE OR REPLACE FUNCTION fa_compat.json_extract(value text, path text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT value::jsonb #>> string_to_array(substring(path from 3), '.') $$;
CREATE OR REPLACE FUNCTION fa_compat.json_each(source text, path text DEFAULT '$') RETURNS TABLE(key text,value text,type text) LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE data jsonb;
BEGIN
  data := CASE WHEN path='$' THEN source::jsonb ELSE source::jsonb #> string_to_array(substring(path from 3),'.') END;
  IF jsonb_typeof(data)='array' THEN
    RETURN QUERY SELECT (e.ordinality-1)::text, CASE WHEN jsonb_typeof(e.item)='string' THEN e.item#>>'{}' ELSE e.item::text END, CASE WHEN jsonb_typeof(e.item)='string' THEN 'text' ELSE jsonb_typeof(e.item) END FROM jsonb_array_elements(data) WITH ORDINALITY AS e(item,ordinality);
  ELSIF jsonb_typeof(data)='object' THEN
    RETURN QUERY SELECT e.key, CASE WHEN jsonb_typeof(e.value)='string' THEN e.value#>>'{}' ELSE e.value::text END, CASE WHEN jsonb_typeof(e.value)='string' THEN 'text' ELSE jsonb_typeof(e.value) END FROM jsonb_each(data) e;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION fa_compat.strftime(format text, base text, modifier text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT to_char((base::timestamptz + modifier::interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
