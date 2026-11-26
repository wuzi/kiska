-- Run only in a dedicated measurement database against a migrated PatchBoard.
-- Supply a freshly generated session_hash SHA256 using psql -v session_hash=...
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() !~ '(^|_)(perf|benchmark)(_|$)' THEN RAISE EXCEPTION 'use a dedicated perf database'; END IF;
END $$;
CREATE FUNCTION pg_temp.fixture_id(kind text,n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
SELECT md5('patchboard-perf:'||kind||':'||n)::uuid $$;
INSERT INTO accounts(id,email,password_hash,name,verified)
VALUES(pg_temp.fixture_id('account',1),'perf-owner@patchboard.invalid','disabled','Kaya Morgan',true) ON CONFLICT DO NOTHING;
INSERT INTO orgs(id,name,slug,owner_id)
SELECT pg_temp.fixture_id('org',n),CASE n WHEN 1 THEN 'Atlas Collective' ELSE 'Birch Studio' END,
 CASE n WHEN 1 THEN 'atlas-lab' ELSE 'birch-lab' END,pg_temp.fixture_id('account',1) FROM generate_series(1,2) n ON CONFLICT DO NOTHING;
INSERT INTO memberships(org_id,account_id,role)
SELECT pg_temp.fixture_id('org',n),pg_temp.fixture_id('account',1),'owner' FROM generate_series(1,2) n ON CONFLICT DO NOTHING;
INSERT INTO boards(id,org_id,slug,title,description,published)
SELECT pg_temp.fixture_id('board',n),pg_temp.fixture_id('org',n),'community','Community feedback',
'Share ideas, vote on improvements, and follow what our team is building.',true FROM generate_series(1,2) n ON CONFLICT DO NOTHING;
INSERT INTO board_names SELECT pg_temp.fixture_id('org',n),'community',pg_temp.fixture_id('board',n) FROM generate_series(1,2) n ON CONFLICT DO NOTHING;
INSERT INTO statuses(id,board_id,name,preset,color,position,is_default,visitor_allowed)
SELECT pg_temp.fixture_id('status'||b,n),pg_temp.fixture_id('board',b),names[n],names[n],colors[n],n-1,n=1,n=1
FROM generate_series(1,6) n,generate_series(1,2)b,(SELECT ARRAY['Suggestions','Under review','Planned','In progress','Done','Declined'] names,
ARRAY['#85918a','#916ac0','#5284d2','#c48221','#388461','#cc6464'] colors)s ON CONFLICT DO NOTHING;
INSERT INTO tags(id,board_id,name,preset,color,position)
SELECT pg_temp.fixture_id('tag'||b,n),pg_temp.fixture_id('board',b),names[n],names[n],colors[n],n-1 FROM generate_series(1,3)n,generate_series(1,2)b,
(SELECT ARRAY['Feature','Improvement','Bug'] names,ARRAY['#7674be','#32825f','#bd6561'] colors)s ON CONFLICT DO NOTHING;
INSERT INTO guests(id,org_id,token,name,ip_hash)
SELECT pg_temp.fixture_id('guest',n),pg_temp.fixture_id('org',1),md5('perf-guest'||n), (ARRAY['Marina','Ben','Jules','Lia','Alan','Ren'])[1+n%6],md5(n::text) FROM generate_series(1,60)n ON CONFLICT DO NOTHING;
INSERT INTO posts(id,board_id,guest_id,title,slug,body,status_id,tag_id,visibility,pinned,created_at)
SELECT pg_temp.fixture_id('post',n),pg_temp.fixture_id('board',1),pg_temp.fixture_id('guest',1+n%60),
 CASE n WHEN 1 THEN 'Save favorite routes offline' ELSE names[1+n%8]||' · '||n END,CASE n WHEN 1 THEN 'save-favorite-routes-offline' ELSE 'community-feedback-'||n END,
 bodies[1+n%3],pg_temp.fixture_id('status1',CASE WHEN n%10<6 THEN 1 ELSE 2+n%5 END),pg_temp.fixture_id('tag1',1+n%3),'published',n=1,
 now()-make_interval(hours=>10000-n) FROM generate_series(1,10000)n,
 (SELECT ARRAY['Save favorite routes offline','Add keyboard shortcuts to the map','Show the last sync time','Make group invites easier to find','Filter events by availability','Add a high-contrast map legend','Share an itinerary with a friend','Group nearby trail reports'] names,
 ARRAY['I would love to see this when planning a route with friends, especially on slower connections.','A small change to the current experience could make a big difference on mobile.','This would help our community organize the next group outing.'] bodies)s ON CONFLICT DO NOTHING;
INSERT INTO posts(id,board_id,title,slug,body,status_id,visibility)
VALUES(pg_temp.fixture_id('other',1),pg_temp.fixture_id('board',2),'Save favorite routes offline','save-favorite-routes-offline','Another community.',pg_temp.fixture_id('status2',1),'published') ON CONFLICT DO NOTHING;
INSERT INTO comments(id,post_id,guest_id,parent_id,body,created_at)
SELECT pg_temp.fixture_id('comment',n),pg_temp.fixture_id('post',1),pg_temp.fixture_id('guest',1+n%60),
 CASE WHEN n%4=0 THEN pg_temp.fixture_id('comment',n-1) END,'I tried this on our last trip. '||n,now()-make_interval(mins=>1001-n) FROM generate_series(1,1000)n ON CONFLICT DO NOTHING;
INSERT INTO votes(post_id,guest_id,created_at)
SELECT pg_temp.fixture_id('post',n),pg_temp.fixture_id('guest',1+(n+v)%60),now()-make_interval(days=>v%9)
FROM generate_series(1,10000)n CROSS JOIN LATERAL generate_series(1,n%5)v ON CONFLICT DO NOTHING;
INSERT INTO updates(id,board_id,title,body,links,operation_id)
VALUES(pg_temp.fixture_id('update',1),pg_temp.fixture_id('board',1),'A new home for community feedback','Follow the roadmap to see what is coming next.',
jsonb_build_array(jsonb_build_object('id',pg_temp.fixture_id('post',1),'title','Save favorite routes offline','slug','save-favorite-routes-offline','status_name','Suggestions','color','#85918a')),pg_temp.fixture_id('update-op',1)) ON CONFLICT DO NOTHING;
INSERT INTO updates(id,board_id,title,body,links,operation_id,created_at)
SELECT pg_temp.fixture_id('update',n),pg_temp.fixture_id('board',1),'Community digest '||n,
'An update from the organizing team about trail reports and upcoming releases.','[]'::jsonb,
pg_temp.fixture_id('update-op',n),now()-make_interval(days=>n)
FROM generate_series(2,35)n ON CONFLICT DO NOTHING;
INSERT INTO sessions(token,account_id,expires) VALUES(:'session_hash',pg_temp.fixture_id('account',1),now()+interval '8 hours')
ON CONFLICT(token) DO UPDATE SET expires=EXCLUDED.expires;
COMMIT;
ANALYZE;
