-- Coordinates the in-memory BM25 indexes of multiple backend instances.
-- Qdrant remains the chunk source of truth; this single version number tells
-- each instance when its local keyword index needs to be rebuilt.

CREATE TABLE IF NOT EXISTS knowledge_base_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO knowledge_base_state (id, version)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE knowledge_base_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE knowledge_base_state FROM anon, authenticated;
GRANT SELECT ON TABLE knowledge_base_state TO service_role;

CREATE OR REPLACE FUNCTION bump_knowledge_base_version()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version BIGINT;
BEGIN
  UPDATE knowledge_base_state
     SET version = version + 1,
         updated_at = clock_timestamp()
   WHERE id = 1
  RETURNING version INTO v_version;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION bump_knowledge_base_version()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bump_knowledge_base_version()
  TO service_role;
