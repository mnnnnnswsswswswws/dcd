-- Unveränderlichkeit der Buchführung: UPDATE/DELETE auf ledger_entries hart ablehnen.
-- Wird nach `prisma db push` bzw. als Teil der Migration angewendet (db push erzeugt
-- keine Trigger). Idempotent via CREATE OR REPLACE / DROP IF EXISTS.

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries ist unveränderlich (append-only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

DROP TRIGGER IF EXISTS ledger_entries_no_delete ON ledger_entries;
CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
