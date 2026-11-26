CREATE TABLE platform_defaults (
    id uuid PRIMARY KEY CHECK (id = '00000000-0000-0000-0000-000000000001'),
    org_limit integer NOT NULL CHECK (org_limit >= 0),
    board_limit integer NOT NULL CHECK (board_limit >= 0),
    seat_limit integer NOT NULL CHECK (seat_limit >= 1),
    media_limit bigint NOT NULL CHECK (media_limit >= 0)
);
INSERT INTO platform_defaults VALUES ('00000000-0000-0000-0000-000000000001', 3, 10, 10, 262144000);
ALTER TABLE operator_audit ADD COLUMN change jsonb NOT NULL DEFAULT '{}';
