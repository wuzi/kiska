CREATE TABLE media (
    id uuid PRIMARY KEY,
    board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
    guest_id uuid,
    account_id uuid,
    kind text NOT NULL CHECK (kind IN ('post','cover','logo')),
    object_key text NOT NULL UNIQUE,
    bytes bigint NOT NULL CHECK (bytes > 0),
    position smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 3),
    ready boolean NOT NULL DEFAULT false,
    bound boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(guest_id,account_id) = 1),
    CHECK (NOT bound OR ready),
    CHECK ((kind = 'post' AND bound) = (post_id IS NOT NULL))
);
ALTER TABLE boards ADD FOREIGN KEY (logo_id) REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE boards ADD FOREIGN KEY (cover_id) REFERENCES media(id) ON DELETE SET NULL;
CREATE INDEX media_board ON media(board_id);
CREATE UNIQUE INDEX media_post_slot ON media(post_id,position) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX media_board_brand ON media(board_id,kind) WHERE bound AND kind <> 'post';
CREATE INDEX media_expiry ON media(created_at) WHERE NOT bound;

-- Cascades from expired organizations, boards, posts and explicit moderation all
-- enqueue the immutable object key in the transaction that removes its reference.
CREATE TABLE media_deletions (
    object_key text PRIMARY KEY,
    next_attempt timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION queue_media_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO media_deletions(object_key) VALUES (OLD.object_key) ON CONFLICT DO NOTHING;
    RETURN OLD;
END;
$$;
CREATE TRIGGER media_removed AFTER DELETE ON media FOR EACH ROW EXECUTE FUNCTION queue_media_deletion();
