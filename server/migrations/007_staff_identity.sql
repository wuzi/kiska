-- Team contributions have a stable organization-specific author across signed-in devices.
ALTER TABLE guests ADD COLUMN staff_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX unique_staff_identity ON guests(org_id, staff_account_id);
