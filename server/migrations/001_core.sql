CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL,
 name text NOT NULL, verified boolean NOT NULL DEFAULT false, operator boolean NOT NULL DEFAULT false,
 notification_email text, org_limit int NOT NULL DEFAULT 3 CHECK(org_limit>=0), closed_at timestamptz
);
CREATE TABLE sessions (token text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE, expires timestamptz NOT NULL);
CREATE TABLE orgs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
 owner_id uuid NOT NULL REFERENCES accounts, board_limit int NOT NULL DEFAULT 10, seat_limit int NOT NULL DEFAULT 10,
 media_limit bigint NOT NULL DEFAULT 262144000, suspended boolean NOT NULL DEFAULT false, closed_at timestamptz
);
CREATE TABLE memberships(org_id uuid REFERENCES orgs ON DELETE CASCADE,account_id uuid REFERENCES accounts ON DELETE CASCADE, role text NOT NULL CHECK(role IN ('owner','admin','moderator')), alerts boolean NOT NULL DEFAULT false,PRIMARY KEY(org_id,account_id));
CREATE UNIQUE INDEX sole_owner ON memberships(org_id) WHERE role='owner';
CREATE TABLE tokens(token text PRIMARY KEY, purpose text NOT NULL, account_id uuid REFERENCES accounts ON DELETE CASCADE,org_id uuid REFERENCES orgs ON DELETE CASCADE,email text,role text,expires timestamptz NOT NULL);
CREATE TABLE folders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,name text NOT NULL,position int NOT NULL DEFAULT 0, UNIQUE(org_id,id));
CREATE TABLE boards(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
 slug text NOT NULL,title text NOT NULL,description text NOT NULL DEFAULT '', folder_id uuid,position int NOT NULL DEFAULT 0,
 published boolean NOT NULL DEFAULT false,suspended boolean NOT NULL DEFAULT false,closed_at timestamptz,revision int NOT NULL DEFAULT 1,
 settings jsonb NOT NULL DEFAULT '{"opening_view":"list","density":"roomy","sort":"trending","public_posting":true,"require_approval":false,"voting_enabled":true,"guest_uploads":true,"indexing":false,"roadmap_visible":true,"links":[]}',
 appearance jsonb NOT NULL DEFAULT '{}',logo_id uuid,cover_id uuid,
 FOREIGN KEY(org_id,folder_id) REFERENCES folders(org_id,id), UNIQUE(org_id,slug)
);
CREATE TABLE board_names(org_id uuid REFERENCES orgs ON DELETE CASCADE,slug text, board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,PRIMARY KEY(org_id,slug));
CREATE TABLE pins(board_id uuid REFERENCES boards ON DELETE CASCADE,account_id uuid REFERENCES accounts ON DELETE CASCADE,PRIMARY KEY(board_id,account_id));
CREATE TABLE statuses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,name text NOT NULL,preset text,color text NOT NULL,position int NOT NULL,is_default boolean NOT NULL DEFAULT false,visitor_allowed boolean NOT NULL DEFAULT false,on_roadmap boolean NOT NULL DEFAULT true, UNIQUE(board_id,id));
CREATE UNIQUE INDEX board_default ON statuses(board_id) WHERE is_default;
CREATE TABLE tags(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,name text NOT NULL,preset text,color text NOT NULL,position int NOT NULL, UNIQUE(board_id,id));
CREATE TABLE guests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,token text NOT NULL, recovery text UNIQUE,name text NOT NULL DEFAULT '',ip_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,token));
CREATE TABLE posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,guest_id uuid REFERENCES guests ON DELETE SET NULL,account_id uuid REFERENCES accounts ON DELETE SET NULL,staff_name text,
 title text NOT NULL,slug text NOT NULL,body text NOT NULL,status_id uuid NOT NULL,tag_id uuid,visibility text NOT NULL CHECK(visibility IN('published','pending','hidden')),
 pinned boolean NOT NULL DEFAULT false,locked boolean NOT NULL DEFAULT false,team_response text NOT NULL DEFAULT '',merged_into uuid REFERENCES posts ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(board_id,status_id) REFERENCES statuses(board_id,id),FOREIGN KEY(board_id,tag_id) REFERENCES tags(board_id,id));
CREATE INDEX posts_board ON posts(board_id,status_id,visibility,created_at DESC);
CREATE TABLE votes(post_id uuid REFERENCES posts ON DELETE CASCADE,guest_id uuid REFERENCES guests ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(post_id,guest_id));
CREATE TABLE comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),post_id uuid NOT NULL REFERENCES posts ON DELETE CASCADE,guest_id uuid REFERENCES guests ON DELETE SET NULL,staff_name text,parent_id uuid REFERENCES comments ON DELETE CASCADE,body text NOT NULL,hidden boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX comments_post ON comments(post_id,created_at,id);
CREATE TABLE likes(comment_id uuid REFERENCES comments ON DELETE CASCADE,guest_id uuid REFERENCES guests ON DELETE CASCADE,PRIMARY KEY(comment_id,guest_id));
CREATE TABLE bans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES orgs ON DELETE CASCADE,board_id uuid REFERENCES boards ON DELETE CASCADE,guest_id uuid REFERENCES guests ON DELETE CASCADE,ip_hash text);
CREATE TABLE updates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,title text NOT NULL,body text NOT NULL,links jsonb NOT NULL,operation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(board_id,operation_id));
CREATE TABLE subscribers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,email text NOT NULL,locale text NOT NULL,verified boolean NOT NULL DEFAULT false,confirm_token text NOT NULL,unsubscribe_token text NOT NULL, UNIQUE(board_id,email));
CREATE TABLE outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL,subject text NOT NULL,body text NOT NULL,board_id uuid REFERENCES boards ON DELETE CASCADE,subscriber_id uuid REFERENCES subscribers ON DELETE CASCADE,staff_id uuid REFERENCES accounts ON DELETE CASCADE,event_key text UNIQUE,attempts int NOT NULL DEFAULT 0,next_try timestamptz NOT NULL DEFAULT now());
CREATE INDEX due_mail ON outbox(next_try);
CREATE TABLE operator_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor uuid, target_type text NOT NULL,target_id uuid NOT NULL,action text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits(bucket text PRIMARY KEY, hits int NOT NULL, until_at timestamptz NOT NULL);
