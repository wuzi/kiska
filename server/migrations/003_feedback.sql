CREATE VIEW post_cards AS SELECT p.*, g.name AS guest_name,
 (SELECT count(*) FROM votes v WHERE v.post_id=p.id) votes,
 (SELECT count(*) FROM votes v WHERE v.post_id=p.id AND v.created_at>now()-interval '7 days') weekly_votes,
 (SELECT count(*) FROM comments c WHERE c.post_id=p.id AND NOT c.hidden) comment_count
 FROM posts p LEFT JOIN guests g ON g.id=p.guest_id;
CREATE INDEX votes_recent ON votes(post_id,created_at DESC);
CREATE INDEX votes_guest ON votes(guest_id);
CREATE INDEX posts_tags ON posts(board_id,tag_id);
