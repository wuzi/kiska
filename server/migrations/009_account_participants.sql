ALTER TABLE guests RENAME COLUMN staff_account_id TO account_id;
ALTER INDEX unique_staff_identity RENAME TO unique_account_identity;

CREATE OR REPLACE VIEW post_cards AS
SELECT p.id,p.board_id,p.guest_id,p.account_id,p.staff_name,p.title,p.slug,p.body,p.status_id,p.tag_id,
       p.visibility,p.pinned,p.locked,p.team_response,p.merged_into,p.created_at,g.name AS guest_name,
       (SELECT count(*) FROM votes v WHERE v.post_id=p.id) votes,
       (SELECT count(*) FROM votes v WHERE v.post_id=p.id AND v.created_at>now()-interval '7 days') weekly_votes,
       (SELECT count(*) FROM comments c WHERE c.post_id=p.id AND NOT c.hidden) comment_count,
       p.revision, g.account_id IS NOT NULL AS authenticated
FROM posts p LEFT JOIN guests g ON g.id=p.guest_id;
