-- Revoking an agent token is for good (B5): no account, whatever its grants,
-- can bring one back or move its revocation.
CREATE FUNCTION agent_tokens_revocation_is_final() RETURNS trigger AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'agent token % is revoked for good', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER agent_tokens_revocation_is_final
  BEFORE UPDATE ON agent_tokens
  FOR EACH ROW EXECUTE FUNCTION agent_tokens_revocation_is_final();
