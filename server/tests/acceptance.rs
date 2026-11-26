use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use patchboard::{AppState, app};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

struct TestApp {
    db: PgPool,
    router: Router,
}
struct Reply {
    status: u16,
    data: Value,
    cookie: String,
    html: String,
}
impl Reply {
    fn success(self) -> Self {
        assert!(
            (200..300).contains(&self.status),
            "{} {}",
            self.status,
            self.html
        );
        self
    }
}
impl TestApp {
    fn new(db: PgPool) -> Self {
        Self {
            router: app(AppState {
                db: db.clone(),
                origin: "http://localhost".into(),
            }),
            db,
        }
    }
    async fn call(&self, method: &str, path: &str, cookie: &str, data: Value) -> Reply {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header("X-PatchBoard", "1")
            .header("content-type", "application/json");
        if !cookie.is_empty() {
            req = req.header("cookie", cookie)
        }
        let res = self
            .router
            .clone()
            .oneshot(req.body(Body::from(data.to_string())).unwrap())
            .await
            .unwrap();
        let status = res.status().as_u16();
        let cookie = res
            .headers()
            .get("set-cookie")
            .and_then(|s| s.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let html = String::from_utf8_lossy(&to_bytes(res.into_body(), 8 << 20).await.unwrap())
            .into_owned();
        Reply {
            data: serde_json::from_str(&html).unwrap_or(Value::Null),
            status,
            cookie,
            html,
        }
    }
    async fn account(&self, name: &str) -> (String, String) {
        let e = format!("{name}@example.test");
        let cred = json!({"email":e,"password":"sample-password-123","name":name});
        self.call("POST", "/api/v1/auth/register", "", cred.clone())
            .await
            .success();
        let msg: String =
            sqlx::query_scalar("SELECT body FROM outbox WHERE email=$1 AND subject LIKE '%verify'")
                .bind(&e)
                .fetch_one(&self.db)
                .await
                .unwrap();
        let t = msg.rsplit("token=").next().unwrap();
        self.call("POST", "/api/v1/auth/verify", "", json!({"token":t}))
            .await
            .success();
        assert_eq!(
            self.call("POST", "/api/v1/auth/verify", "", json!({"token":t}))
                .await
                .status,
            400
        );
        let c = self
            .call("POST", "/api/v1/auth/login", "", cred)
            .await
            .success()
            .cookie;
        (e, c)
    }
    async fn board(&self, n: &str) -> (String, String, String, String) {
        let (_, c) = self.account(n).await;
        let o = self
            .call("POST", "/api/v1/organizations", &c, json!({"name":n}))
            .await
            .success()
            .data["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let b = self
            .call(
                "POST",
                &format!("/api/v1/organizations/{o}/boards"),
                &c,
                json!({"title":"Ideas"}),
            )
            .await
            .success()
            .data["id"]
            .as_str()
            .unwrap()
            .to_owned();
        self.call(
            "POST",
            &format!("/api/v1/boards/{b}/publish"),
            &c,
            json!({}),
        )
        .await
        .success();
        (c, o, b, format!("/api/v1/b/{n}/ideas"))
    }
}
#[sqlx::test]
async fn fresh_boot(db: PgPool) {
    let t = TestApp::new(db);
    for path in ["/healthz", "/readyz", "/app"] {
        t.call("GET", path, "", Value::Null).await.success();
    }
    assert_eq!(
        t.call("GET", "/api/v1/operator", "", Value::Null)
            .await
            .status,
        401
    );
    t.db.close().await;
    assert!(t.call("GET", "/readyz", "", Value::Null).await.status >= 500);
    t.call("GET", "/healthz", "", Value::Null).await.success();
}
#[sqlx::test]
async fn organization_access(db: PgPool) {
    let t = TestApp::new(db);
    let (c, o, b, _) = t.board("alpha").await;
    let (_, other) = t.account("beta").await;
    assert_eq!(
        t.call("GET", &format!("/api/v1/boards/{b}"), &other, Value::Null)
            .await
            .status,
        403
    );
    t.call(
        "POST",
        &format!("/api/v1/organizations/{o}/invitations"),
        &c,
        json!({"email":"beta@example.test","role":"moderator"}),
    )
    .await
    .success();
    let msg: String = sqlx::query_scalar(
        "SELECT body FROM outbox WHERE email='beta@example.test' AND subject LIKE '%invite'",
    )
    .fetch_one(&t.db)
    .await
    .unwrap();
    t.call(
        "POST",
        "/api/v1/auth/invite",
        &other,
        json!({"token":msg.rsplit("token=").next().unwrap()}),
    )
    .await
    .success();
    t.call("GET", &format!("/api/v1/boards/{b}"), &other, Value::Null)
        .await
        .success();
    assert_eq!(
        t.call(
            "POST",
            &format!("/api/v1/boards/{b}/publish"),
            &other,
            json!({})
        )
        .await
        .status,
        403
    );
    sqlx::query("UPDATE orgs SET board_limit=2")
        .execute(&t.db)
        .await
        .unwrap();
    let url = format!("/api/v1/organizations/{o}/boards");
    let (a, b) = tokio::join!(
        t.call("POST", &url, &c, json!({"title":"one"})),
        t.call("POST", &url, &c, json!({"title":"two"}))
    );
    assert!(matches!((a.status, b.status), (200, 409) | (409, 200)));
}

#[sqlx::test]
async fn public_feedback_and_snapshots(db: PgPool) {
    let t = TestApp::new(db);
    let (c, _, b, base) = t.board("studio").await;
    let board = t.call("GET", &base, "", Value::Null).await.success().data;
    assert_eq!(board["statuses"].as_array().unwrap().len(), 6);
    let created = t
        .call(
            "POST",
            &format!("{base}/posts"),
            "",
            json!({"title":"Bigger chat","body":"Please **expand** chat"}),
        )
        .await
        .success();
    let guest = created.cookie;
    let p = created.data["id"].as_str().unwrap();
    let url = format!("{base}/posts/{p}");
    for _ in 0..2 {
        t.call("PUT", &format!("{url}/vote"), &guest, json!({}))
            .await
            .success();
    }
    let comment = t
        .call(
            "POST",
            &format!("{url}/comments"),
            &guest,
            json!({"body":"yes!"}),
        )
        .await
        .success()
        .data;
    t.call(
        "POST",
        &format!("{url}/comments"),
        &guest,
        json!({"body":"also mobile","parent_id":comment["id"]}),
    )
    .await
    .success();
    let d = t
        .call("GET", &url, &guest, Value::Null)
        .await
        .success()
        .data;
    assert_eq!(d["post"]["votes"], 1);
    assert_eq!(d["comments"].as_array().unwrap().len(), 2);
    assert!(
        d["post"]["body_html"]
            .as_str()
            .unwrap()
            .contains("<strong>expand</strong>")
    );
    let sub = t
        .call(
            "POST",
            &format!("{base}/subscribe"),
            "",
            json!({"email":"player@example.test","locale":"pt-BR"}),
        )
        .await;
    sub.success();
    let msg: String =
        sqlx::query_scalar("SELECT body FROM outbox WHERE email='player@example.test'")
            .fetch_one(&t.db)
            .await
            .unwrap();
    t.call(
        "POST",
        msg.strip_prefix("http://localhost").unwrap(),
        "",
        json!({}),
    )
    .await
    .success();
    let move_url = format!("/api/v1/boards/{b}/moderate");
    let change = json!({"action":"move","status_id":board["statuses"][2]["id"],"post_id":p,"update":{"title":"Roadmap update","body":"Coming soon","post_ids":[p],"operation_id":Uuid::new_v4()}});
    for _ in 0..2 {
        t.call("POST", &move_url, &c, change.clone())
            .await
            .success();
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox WHERE subscriber_id IS NOT NULL")
            .fetch_one(&t.db)
            .await
            .unwrap(),
        1
    );
    let list = t
        .call(
            "GET",
            &format!("{base}?view=updates&locale=pt"),
            "",
            Value::Null,
        )
        .await
        .success()
        .data;
    assert_eq!(list["updates"][0]["posts"][0]["status_name"], "Planejado");
    let html = t
        .call(
            "GET",
            &format!("/b/studio/ideas/p/{p}-bigger-chat"),
            "",
            Value::Null,
        )
        .await
        .success()
        .html;
    assert!(html.contains("og:title") && html.contains("<strong>expand</strong>"));
    t.call("POST", &move_url, &c, json!({"post_id":p,"action":"hide"}))
        .await
        .success();
    assert_eq!(t.call("GET", &url, "", Value::Null).await.status, 404);
    assert!(
        t.call("GET", &base, "", Value::Null).await.success().data["updates"][0]["posts"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[sqlx::test]
async fn settings_revision_and_recovery(db: PgPool) {
    let t = TestApp::new(db);
    let (c, o, b, base) = t.board("community").await;
    let url = format!("/api/v1/boards/{b}");
    let view = t.call("GET", &url, &c, Value::Null).await.success().data;
    let mut draft = view["board"].clone();
    draft["title"] = json!("Community news");
    draft["slug"] = json!("community-news");
    draft["statuses"] = view["statuses"].clone();
    draft["statuses"][2]["name"] = json!("Next patch");
    t.call("PUT", &url, &c, draft.clone()).await.success();
    assert_eq!(t.call("PUT", &url, &c, draft).await.status, 409);
    let pt = t
        .call("GET", &format!("{base}?locale=pt"), "", Value::Null)
        .await
        .success()
        .data;
    assert_eq!(pt["statuses"][0]["name"], "Sugestões");
    assert_eq!(pt["statuses"][2]["name"], "Next patch");
    assert_eq!(
        t.call("GET", "/b/community/ideas", "", Value::Null)
            .await
            .status,
        307
    );
    let guest = t
        .call(
            "PATCH",
            &format!("{base}/guest"),
            "",
            json!({"name":"Nila"}),
        )
        .await
        .success();
    let token = t
        .call(
            "POST",
            &format!("{base}/guest/recovery"),
            &guest.cookie,
            json!({}),
        )
        .await
        .success();
    let recovered = t
        .call("POST", &format!("{base}/guest/recover"), "", token.data)
        .await
        .success();
    assert_eq!(
        t.call(
            "GET",
            &format!("{base}/guest"),
            &recovered.cookie,
            Value::Null
        )
        .await
        .success()
        .data["name"],
        "Nila"
    );
    t.call(
        "POST",
        &format!("/api/v1/organizations/{o}/close"),
        &c,
        json!({}),
    )
    .await
    .success();
    assert_eq!(t.call("GET", &base, "", Value::Null).await.status, 404);
    t.call(
        "POST",
        &format!("/api/v1/organizations/{o}/restore"),
        &c,
        json!({}),
    )
    .await
    .success();
    t.call("GET", &base, "", Value::Null).await.success();
}

#[sqlx::test]
async fn operator_defaults_and_independent_restoration(db: PgPool) {
    let t = TestApp::new(db);
    let (owner, org, board, public) = t.board("original").await;
    let (_, operator) = t.account("operator").await;
    sqlx::query("UPDATE accounts SET operator=true WHERE name='operator'")
        .execute(&t.db)
        .await
        .unwrap();
    let screen = t
        .call("GET", "/api/v1/operator", &operator, Value::Null)
        .await
        .success()
        .data;
    let action = "/api/v1/operator/actions";
    let config = json!({"target_id":screen["defaults"]["id"],"target_type":"platform","reason":"New creator allocation","action":"limits","limits":{"org_limit":1,"board_limit":4}});
    assert_eq!(
        t.call("POST", action, &owner, config.clone()).await.status,
        403
    );
    t.call("POST", action, &operator, config).await.success();
    let (new, new_org, _, _) = t.board("after").await;
    let new_home = t
        .call(
            "GET",
            &format!("/api/v1/organizations/{new_org}"),
            &new,
            Value::Null,
        )
        .await
        .success()
        .data;
    assert_eq!(new_home["usage"]["board_limit"], 4);
    assert_eq!(
        t.call(
            "POST",
            "/api/v1/organizations",
            &new,
            json!({"name":"Another"})
        )
        .await
        .status,
        409
    );
    for (kind, target) in [("organization", &org), ("board", &board)] {
        t.call("POST",action,&operator,json!({"target_type":kind,"target_id":target,"action":"suspend","reason":"Investigating a report"})).await.success();
    }
    t.call("POST",action,&operator,json!({"target_type":"organization","target_id":org,"action":"restore","reason":"Organization cleared"})).await.success();
    assert_eq!(t.call("GET", &public, "", Value::Null).await.status, 404);
    t.call("POST",action,&operator,json!({"target_type":"board","target_id":board,"action":"restore","reason":"Board cleared"})).await.success();
    t.call("GET", &public, "", Value::Null).await.success();
    let updated = t
        .call("GET", "/api/v1/operator", &operator, Value::Null)
        .await
        .success()
        .data;
    assert!(
        updated["audit"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["change"]["board_limit"] == 4 && v["reason"] == "New creator allocation")
    );
}

#[sqlx::test]
async fn moderation_merge_and_ban_scope(db: PgPool) {
    let t = TestApp::new(db);
    let (owner, org, board, public) = t.board("players").await;
    let second = t
        .call(
            "POST",
            &format!("/api/v1/organizations/{org}/boards"),
            &owner,
            json!({"title":"Requests"}),
        )
        .await
        .success()
        .data;
    t.call(
        "POST",
        &format!("/api/v1/boards/{}/publish", second["id"].as_str().unwrap()),
        &owner,
        json!({}),
    )
    .await
    .success();
    let first = t
        .call(
            "POST",
            &format!("{public}/posts"),
            "",
            json!({"title":"Target system"}),
        )
        .await
        .success();
    let guest = first.cookie;
    let dst = first.data["id"].as_str().unwrap();
    let duplicate = t
        .call(
            "POST",
            &format!("{public}/posts"),
            &guest,
            json!({"title":"Targeting system"}),
        )
        .await
        .success()
        .data;
    let src = duplicate["id"].as_str().unwrap();
    for p in [dst, src] {
        t.call(
            "PUT",
            &format!("{public}/posts/{p}/vote"),
            &guest,
            json!({}),
        )
        .await
        .success();
    }
    t.call(
        "POST",
        &format!("{public}/posts/{src}/comments"),
        &guest,
        json!({"body":"Agreed"}),
    )
    .await
    .success();
    let mod_url = format!("/api/v1/boards/{board}/moderate");
    t.call(
        "POST",
        &mod_url,
        &owner,
        json!({"action":"merge","post_id":src,"target_id":dst}),
    )
    .await
    .success();
    let detail = t
        .call("GET", &format!("{public}/posts/{dst}"), &guest, Value::Null)
        .await
        .success()
        .data;
    assert_eq!(detail["post"]["votes"], 1);
    assert_eq!(detail["comments"][0]["body"], "Agreed");
    assert_eq!(
        t.call("GET", &format!("{public}/posts/{src}"), "", Value::Null)
            .await
            .success()
            .data["redirect_id"],
        dst
    );
    let who = detail["post"]["guest_id"].clone();
    let ban = json!({"action":"ban","guest_id":who});
    t.call("POST", &mod_url, &owner, ban.clone())
        .await
        .success();
    assert_eq!(
        t.call(
            "POST",
            &format!("{public}/posts"),
            &guest,
            json!({"title":"Another post"})
        )
        .await
        .status,
        403
    );
    let sibling = "/api/v1/b/players/requests/posts";
    t.call("POST", sibling, &guest, json!({"title":"Another idea"}))
        .await
        .success();
    let mut extended = ban;
    extended["scope"] = json!("organization");
    t.call("POST", &mod_url, &owner, extended).await.success();
    assert_eq!(
        t.call("POST", sibling, &guest, json!({"title":"Yet another idea"}))
            .await
            .status,
        403
    );
    t.call(
        "POST",
        &mod_url,
        &owner,
        json!({"action":"hide","post_id":dst}),
    )
    .await
    .success();
    assert_eq!(
        t.call("GET", &format!("{public}/posts/{src}"), "", Value::Null)
            .await
            .status,
        404
    );
}

#[sqlx::test]
async fn account_reset_and_closure(db: PgPool) {
    let t = TestApp::new(db);
    let (original, org, _, public) = t.board("founder").await;
    let email = "founder@example.test";
    t.call("POST", "/api/v1/auth/forgot", "", json!({"email":email}))
        .await
        .success();
    let msg: String =
        sqlx::query_scalar("SELECT body FROM outbox WHERE subject LIKE '%reset' AND email=$1")
            .bind(email)
            .fetch_one(&t.db)
            .await
            .unwrap();
    let reset =
        json!({"token":msg.rsplit("token=").next().unwrap(),"password":"new-password-long"});
    t.call("POST", "/api/v1/auth/reset", "", reset.clone())
        .await
        .success();
    assert_eq!(
        t.call("POST", "/api/v1/auth/reset", "", reset).await.status,
        400
    );
    assert_eq!(
        t.call(
            "POST",
            "/api/v1/auth/login",
            "",
            json!({"email":email,"password":"sample-password-123"})
        )
        .await
        .status,
        401
    );
    assert!(
        t.call("GET", "/api/v1/me", &original, Value::Null)
            .await
            .success()
            .data["user"]
            .is_null()
    );
    let session = t
        .call(
            "POST",
            "/api/v1/auth/login",
            "",
            json!({"email":email,"password":"new-password-long"}),
        )
        .await
        .success()
        .cookie;
    assert_eq!(
        t.call("DELETE", "/api/v1/me", &session, json!({}))
            .await
            .status,
        409
    );
    t.call(
        "DELETE",
        "/api/v1/me",
        &session,
        json!({"close_organization_ids":[org]}),
    )
    .await
    .success();
    assert_eq!(t.call("GET", &public, "", Value::Null).await.status, 404);
    let mail: String = sqlx::query_scalar(
        "SELECT body FROM outbox WHERE subject LIKE '%recover-account' AND email=$1",
    )
    .bind(email)
    .fetch_one(&t.db)
    .await
    .unwrap();
    t.call(
        "POST",
        "/api/v1/auth/recover-account",
        "",
        json!({"token":mail.rsplit("token=").next().unwrap()}),
    )
    .await
    .success();
    let restored = t
        .call(
            "POST",
            "/api/v1/auth/login",
            "",
            json!({"email":email,"password":"new-password-long"}),
        )
        .await
        .success()
        .cookie;
    t.call(
        "POST",
        &format!("/api/v1/organizations/{org}/restore"),
        &restored,
        json!({}),
    )
    .await
    .success();
    t.call("GET", &public, "", Value::Null).await.success();
}

#[sqlx::test]
async fn private_workflow_and_staff_edits(db: PgPool) {
    let t = TestApp::new(db);
    let (owner, org, board_id, public) = t.board("feedback").await;
    let workspace = format!("/api/v1/boards/{board_id}");
    let home = t
        .call("GET", &workspace, &owner, Value::Null)
        .await
        .success()
        .data;
    let mut draft = home["board"].clone();
    draft["settings"]["require_approval"] = json!(true);
    t.call("PUT", &workspace, &owner, draft).await.success();
    let pending = t
        .call(
            "POST",
            &format!("{public}/posts"),
            "",
            json!({"title":"Unpublished feedback"}),
        )
        .await
        .success()
        .data;
    let pid = pending["id"].as_str().unwrap();
    let home = t
        .call("GET", &workspace, &owner, Value::Null)
        .await
        .success()
        .data;
    let mut draft = home["board"].clone();
    draft["settings"]["manual_order"] = json!([pid]);
    t.call("PUT", &workspace, &owner, draft).await.success();
    for endpoint in [public.as_str(), "/b/feedback/ideas"] {
        let resp = t.call("GET", endpoint, "", Value::Null).await.success();
        assert!(!resp.html.contains(pid));
    }
    let permalink = format!("/b/feedback/ideas/p/{pid}-unpublished-feedback");
    assert_eq!(t.call("GET", &permalink, "", Value::Null).await.status, 404);
    assert!(
        t.call("GET", &permalink, &owner, Value::Null)
            .await
            .success()
            .html
            .contains("Unpublished feedback")
    );
    let board_post = t
        .call(
            "POST",
            &format!("{workspace}/posts"),
            &owner,
            json!({"title":"Staff post"}),
        )
        .await
        .success()
        .data;
    let staff_pid = board_post["id"].as_str().unwrap();
    let other_session = t
        .call(
            "POST",
            "/api/v1/auth/login",
            "",
            json!({"email":"feedback@example.test","password":"sample-password-123"}),
        )
        .await
        .success()
        .cookie;
    let comment_json = t
        .call(
            "POST",
            &format!("{workspace}/posts/{staff_pid}/comments"),
            &other_session,
            json!({"body":"Team reply"}),
        )
        .await
        .success()
        .data;
    let detail = t
        .call(
            "GET",
            &format!("{workspace}/posts/{staff_pid}"),
            &owner,
            Value::Null,
        )
        .await
        .success()
        .data;
    assert_eq!(
        detail["post"]["guest_id"],
        detail["comments"][0]["guest_id"]
    );
    let edit = json!({"action":"edit","post_id":staff_pid,"title":"Revised staff post","body":"Details","revision":detail["post"]["revision"]});
    t.call(
        "POST",
        &format!("{workspace}/moderate"),
        &owner,
        edit.clone(),
    )
    .await
    .success();
    assert_eq!(
        t.call(
            "POST",
            &format!("{workspace}/moderate"),
            &other_session,
            edit
        )
        .await
        .status,
        409
    );
    let edit_comment = json!({"action":"edit_comment","post_id":staff_pid,"comment_id":comment_json["id"],"body":"More detail","revision":detail["comments"][0]["revision"]});
    t.call(
        "POST",
        &format!("{workspace}/moderate"),
        &owner,
        edit_comment.clone(),
    )
    .await
    .success();
    assert_eq!(
        t.call(
            "POST",
            &format!("{workspace}/moderate"),
            &other_session,
            edit_comment
        )
        .await
        .status,
        409
    );
    let grant = t
        .call(
            "POST",
            &format!("{public}/guest/recovery"),
            &owner,
            json!({}),
        )
        .await;
    assert_eq!(grant.status, 400);
    let org_url = format!("/api/v1/organizations/{org}");
    t.call("POST", &format!("{org_url}/close"), &owner, json!({}))
        .await
        .success();
    sqlx::query("UPDATE orgs SET suspended=true WHERE id=$1")
        .bind(Uuid::parse_str(&org).unwrap())
        .execute(&t.db)
        .await
        .unwrap();
    t.call("POST", &format!("{org_url}/restore"), &owner, json!({}))
        .await
        .success();
    assert_eq!(t.call("GET", &public, "", Value::Null).await.status, 404);
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT suspended AND closed_at IS NULL FROM orgs WHERE id=$1"
        )
        .bind(Uuid::parse_str(&org).unwrap())
        .fetch_one(&t.db)
        .await
        .unwrap()
    );
}

#[sqlx::test]
async fn folder_order_and_expired_closure(db: PgPool) {
    let t = TestApp::new(db);
    let (owner, org, board, public) = t.board("maker").await;
    let org_url = format!("/api/v1/organizations/{org}");
    let mut folders = Vec::new();
    for name in ["Wishlist", "Community", "Bugs"] {
        folders.push(
            t.call(
                "POST",
                &format!("{org_url}/folders"),
                &owner,
                json!({"name":name}),
            )
            .await
            .success()
            .data["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    t.call(
        "PATCH",
        &format!("{org_url}/folders/{}", folders[2]),
        &owner,
        json!({"position":0}),
    )
    .await
    .success();
    let home = t
        .call("GET", &org_url, &owner, Value::Null)
        .await
        .success()
        .data;
    assert_eq!(home["folders"][0]["name"], "Bugs");
    assert_eq!(home["folders"][1]["name"], "Wishlist");
    t.call(
        "PATCH",
        &format!("/api/v1/boards/{board}/position"),
        &owner,
        json!({"folder_id":folders[1],"position":0}),
    )
    .await
    .success();
    t.call("GET", &public, "", Value::Null).await.success();
    t.call(
        "POST",
        &format!("/api/v1/boards/{board}/close"),
        &owner,
        json!({}),
    )
    .await
    .success();
    sqlx::query("UPDATE boards SET closed_at=now()-interval '31 days' WHERE id=$1")
        .bind(Uuid::parse_str(&board).unwrap())
        .execute(&t.db)
        .await
        .unwrap();
    assert_eq!(
        t.call(
            "POST",
            &format!("/api/v1/boards/{board}/restore"),
            &owner,
            json!({})
        )
        .await
        .status,
        404
    );
    for _ in 0..2 {
        patchboard::publishing::maintenance(&t.db).await.unwrap();
    }
    assert_eq!(t.call("GET", &public, "", Value::Null).await.status, 404);
    let after = t
        .call("GET", &org_url, &owner, Value::Null)
        .await
        .success()
        .data;
    assert_eq!(after["usage"]["board_count"], 0);
    t.call(
        "POST",
        &format!("{org_url}/boards"),
        &owner,
        json!({"title":"Ideas"}),
    )
    .await
    .success();
}
