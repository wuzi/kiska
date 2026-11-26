ALTER TABLE posts ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE comments ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE updates ADD COLUMN revision integer NOT NULL DEFAULT 1;

CREATE FUNCTION increment_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.revision := OLD.revision + 1;
    RETURN NEW;
END;
$$;
CREATE TRIGGER revise_post BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION increment_content_revision();
CREATE TRIGGER revise_comment BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION increment_content_revision();
CREATE TRIGGER revise_update BEFORE UPDATE ON updates FOR EACH ROW EXECUTE FUNCTION increment_content_revision();

CREATE OR REPLACE VIEW post_cards AS
SELECT p.id,p.board_id,p.guest_id,p.account_id,p.staff_name,p.title,p.slug,p.body,p.status_id,p.tag_id,
       p.visibility,p.pinned,p.locked,p.team_response,p.merged_into,p.created_at,g.name AS guest_name,
       (SELECT count(*) FROM votes v WHERE v.post_id=p.id) votes,
       (SELECT count(*) FROM votes v WHERE v.post_id=p.id AND v.created_at>now()-interval '7 days') weekly_votes,
       (SELECT count(*) FROM comments c WHERE c.post_id=p.id AND NOT c.hidden) comment_count,
       p.revision
FROM posts p LEFT JOIN guests g ON g.id=p.guest_id;
