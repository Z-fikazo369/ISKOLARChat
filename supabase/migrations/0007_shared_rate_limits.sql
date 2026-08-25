-- Shared API rate-limit counters for horizontally scaled backend instances.
-- Only the service-role backend can consume this function. Raw user IDs and
-- client IPs are not stored; the backend sends a SHA-256 digest instead.

CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, key_hash)
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE api_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION consume_api_rate_limit(
  p_scope TEXT,
  p_key_hash TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_started_at TIMESTAMPTZ;
  v_request_count INTEGER;
BEGIN
  IF p_scope IS NULL OR p_scope = '' OR p_key_hash IS NULL OR p_key_hash = ''
     OR p_max_requests < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate-limit parameters';
  END IF;

  INSERT INTO api_rate_limits (scope, key_hash, window_started_at, request_count, updated_at)
  VALUES (p_scope, p_key_hash, v_now, 0, v_now)
  ON CONFLICT (scope, key_hash) DO NOTHING;

  SELECT window_started_at, request_count
    INTO v_window_started_at, v_request_count
    FROM api_rate_limits
   WHERE scope = p_scope AND key_hash = p_key_hash
   FOR UPDATE;

  IF v_now >= v_window_started_at + make_interval(secs => p_window_seconds) THEN
    UPDATE api_rate_limits
       SET window_started_at = v_now,
           request_count = 1,
           updated_at = v_now
     WHERE scope = p_scope AND key_hash = p_key_hash;
    RETURN TRUE;
  END IF;

  IF v_request_count >= p_max_requests THEN
    RETURN FALSE;
  END IF;

  UPDATE api_rate_limits
     SET request_count = request_count + 1,
         updated_at = v_now
   WHERE scope = p_scope AND key_hash = p_key_hash;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION consume_api_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_api_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  TO service_role;
