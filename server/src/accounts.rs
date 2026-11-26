use super::*;
use argon2::{
    Argon2, PasswordHasher, PasswordVerifier,
    password_hash::{PasswordHash, SaltString, rand_core::OsRng},
};
use axum::{
    extract::Path,
    http::HeaderMap,
    routing::{get, post},
};
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/{flow}", post(auth))
        .route("/api/v1/me", get(me).patch(profile).delete(close_account))
}
pub(crate) async fn queue(tx: &mut Tx<'_>, email: &str, subject: &str, body: &str) -> Result<()> {
    sqlx::query("INSERT INTO outbox(email,subject,body) VALUES($1,$2,$3)")
        .bind(email)
        .bind(subject)
        .bind(body)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
pub(crate) fn email(j: &V) -> Result<String> {
    let e = required(j, "email", 3, 254)?.to_lowercase();
    let parsed = e
        .parse::<lettre::Address>()
        .map_err(|_| Error::bad("invalid_email"))?;
    Ok(parsed.to_string())
}
async fn password(s: &str) -> Result<String> {
    if !(10..=256).contains(&s.len()) {
        return Err(Error::bad("invalid_password"));
    }
    let v = s.to_string();
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(v.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
            .map_err(Error::internal)
    })
    .await
    .map_err(Error::internal)?
}
pub(crate) async fn mail_token(
    tx: &mut Tx<'_>,
    s: &AppState,
    flow: &str,
    a: Option<Uuid>,
    org: Option<Uuid>,
    e: &str,
    role: Option<&str>,
) -> Result<()> {
    let t = token();
    sqlx::query("INSERT INTO tokens(token,purpose,account_id,org_id,email,role,expires) VALUES($1,$2,$3,$4,$5,$6,now()+CASE WHEN $2='invite' THEN interval '7 days' WHEN $2='recover-account' THEN interval '30 days' ELSE interval '1 hour' END)").bind(hash(&t)).bind(flow).bind(a).bind(org).bind(e).bind(role).execute(&mut **tx).await?;
    queue(
        tx,
        e,
        &format!("PatchBoard · {flow}"),
        &format!(
            "Open this link to continue:\n{}/app?flow={flow}&token={t}",
            s.origin
        ),
    )
    .await
}
async fn me(State(s): State<AppState>, h: HeaderMap) -> Api {
    let Some(a) = account_id(&s.db, &h).await? else {
        return Ok(Json(
            json!({"user":null,"organizations":[],"operator":false}),
        ));
    };
    let user:V=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'email',email,'name',name,'display_name',name,'pending_notification_email',(SELECT email FROM tokens WHERE purpose='verify-notification' AND account_id=accounts.id AND expires>now() ORDER BY expires DESC LIMIT 1),'notification_email',notification_email,'verified',verified,'operator',operator,'org_limit',org_limit) FROM accounts WHERE id=$1").bind(a).fetch_one(&s.db).await?;
    let orgs:Vec<V>=sqlx::query_scalar("SELECT to_jsonb(o)||jsonb_build_object('role',m.role) FROM memberships m JOIN orgs o ON o.id=m.org_id WHERE m.account_id=$1 ORDER BY o.name").bind(a).fetch_all(&s.db).await?;
    Ok(Json(
        json!({"operator":user["operator"],"owned_limit":user["org_limit"],"owned_count":orgs.iter().filter(|o|o["role"]=="owner").count(),"user":user,"organizations":orgs,"support_url":std::env::var("SUPPORT_URL").ok(),"policy_url":std::env::var("POLICY_URL").ok()}),
    ))
}
async fn profile(State(s): State<AppState>, h: HeaderMap, Json(j): Json<V>) -> Api {
    let a = signed(&s.db, &h).await?;
    let mut tx = s.db.begin().await?;
    if j.get("name").is_some() {
        sqlx::query("UPDATE accounts SET name=$2 WHERE id=$1")
            .bind(a)
            .bind(required(&j, "name", 1, 40)?)
            .execute(&mut *tx)
            .await?;
    }
    if !val(&j, "notification_email").is_empty() {
        let e = email(&json!({"email":j["notification_email"]}))?;
        sqlx::query("DELETE FROM tokens WHERE purpose='verify-notification' AND account_id=$1")
            .bind(a)
            .execute(&mut *tx)
            .await?;
        mail_token(&mut tx, &s, "verify-notification", Some(a), None, &e, None).await?;
    }
    tx.commit().await?;
    me(State(s), h).await
}
async fn close_account(State(s): State<AppState>, h: HeaderMap, body: Option<Json<V>>) -> Api {
    let a = signed(&s.db, &h).await?;
    let mut tx = s.db.begin().await?;
    let e: String =
        sqlx::query_scalar("UPDATE accounts SET closed_at=now() WHERE id=$1 RETURNING email")
            .bind(a)
            .fetch_one(&mut *tx)
            .await?;
    if let Some(Json(data)) = body {
        let selected = feedback::uuid_list(&data, "close_organization_ids", 10000)?;
        let changed=sqlx::query("UPDATE orgs SET closed_at=now() WHERE owner_id=$1 AND id=ANY($2) AND closed_at IS NULL").bind(a).bind(&selected).execute(&mut *tx).await?;
        if changed.rows_affected() != selected.len() as u64 {
            return Err(Error::conflict("ownership_changed"));
        }
    }
    if sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM orgs WHERE owner_id=$1 AND closed_at IS NULL)",
    )
    .bind(a)
    .fetch_one(&mut *tx)
    .await?
    {
        return Err(Error::conflict("transfer_or_close_organizations"));
    }
    sqlx::query("DELETE FROM sessions WHERE account_id=$1")
        .bind(a)
        .execute(&mut *tx)
        .await?;
    mail_token(&mut tx, &s, "recover-account", Some(a), None, &e, None).await?;
    tx.commit().await?;
    Ok(Json(json!({"closed":true})))
}
async fn auth(
    State(s): State<AppState>,
    Path(flow): Path<String>,
    h: HeaderMap,
    Json(j): Json<V>,
) -> Result<Response> {
    if !matches!(
        flow.as_str(),
        "register"
            | "login"
            | "logout"
            | "forgot"
            | "reset"
            | "verify"
            | "verify-notification"
            | "invite"
            | "recover-account"
    ) {
        return Err(Error::not_found());
    }
    if flow != "logout" {
        rate(&s.db, &h, &flow, if flow == "login" { 15 } else { 30 }, 900).await?;
    }
    match flow.as_str() {
        "register" => {
            let e = email(&j)?;
            let p = password(val(&j, "password")).await?;
            let name = required(&j, "name", 1, 40)?;
            let mut tx = s.db.begin().await?;
            let a = sqlx::query_scalar(
                "INSERT INTO accounts(email,password_hash,name,org_limit) SELECT $1,$2,$3,org_limit FROM platform_defaults RETURNING id",
            )
            .bind(&e)
            .bind(p)
            .bind(name)
            .fetch_one(&mut *tx)
            .await?;
            mail_token(&mut tx, &s, "verify", Some(a), None, &e, None).await?;
            tx.commit().await?;
        }
        "login" => {
            let e = email(&j)?;
            let r = sqlx::query(
                "SELECT id,password_hash FROM accounts WHERE email=$1 AND closed_at IS NULL",
            )
            .bind(e)
            .fetch_optional(&s.db)
            .await?
            .ok_or(Error(StatusCode::UNAUTHORIZED, "invalid_login".into()))?;
            let p = val(&j, "password").to_owned();
            let hashed: String = r.get("password_hash");
            if !tokio::task::spawn_blocking(move || {
                PasswordHash::new(&hashed)
                    .is_ok_and(|x| Argon2::default().verify_password(p.as_bytes(), &x).is_ok())
            })
            .await
            .map_err(Error::internal)?
            {
                return Err(Error(StatusCode::UNAUTHORIZED, "invalid_login".into()));
            }
            let t = token();
            sqlx::query("INSERT INTO sessions VALUES($1,$2,now()+interval '30 days')")
                .bind(hash(&t))
                .bind(r.get::<Uuid, _>("id"))
                .execute(&s.db)
                .await?;
            return Ok(response_cookie(
                json!({"ok":true}),
                Some(set_cookie("pb_session", &t, 2592000, &s.origin)),
            ));
        }
        "logout" => {
            if let Some(k) = cookie(&h, "pb_session") {
                sqlx::query("DELETE FROM sessions WHERE token=$1")
                    .bind(hash(k))
                    .execute(&s.db)
                    .await?;
            }
            return Ok(response_cookie(
                json!({"ok":true}),
                Some(set_cookie("pb_session", "", 0, &s.origin)),
            ));
        }
        "forgot" => {
            let e = email(&j)?;
            let mut tx = s.db.begin().await?;
            if let Some(a) =
                sqlx::query_scalar("SELECT id FROM accounts WHERE email=$1 AND closed_at IS NULL")
                    .bind(&e)
                    .fetch_optional(&mut *tx)
                    .await?
            {
                mail_token(&mut tx, &s, "reset", Some(a), None, &e, None).await?
            }
            tx.commit().await?;
        }
        "reset" | "verify" | "verify-notification" | "invite" | "recover-account" => {
            let mut tx = s.db.begin().await?;
            let r = sqlx::query(
                "DELETE FROM tokens WHERE token=$1 AND purpose=$2 AND expires>now() RETURNING *",
            )
            .bind(hash(val(&j, "token")))
            .bind(&flow)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(Error::bad("invalid_or_expired_token"))?;
            let a: Option<Uuid> = r.get("account_id");
            match flow.as_str() {
                "invite" => {
                    let a = signed(&s.db, &h).await?;
                    let org: Uuid = r.get("org_id");
                    let o=sqlx::query("SELECT seat_limit FROM orgs WHERE id=$1 AND closed_at IS NULL AND NOT suspended FOR UPDATE").bind(org).fetch_one(&mut *tx).await?;
                    let count: i64 =
                        sqlx::query_scalar("SELECT count(*) FROM memberships WHERE org_id=$1")
                            .bind(org)
                            .fetch_one(&mut *tx)
                            .await?;
                    if count >= o.get::<i32, _>("seat_limit") as i64 {
                        return Err(Error::conflict("seat_limit"));
                    }
                    let n=sqlx::query("INSERT INTO memberships(org_id,account_id,role) SELECT $1,id,$3 FROM accounts WHERE id=$2 AND verified AND email=$4 ON CONFLICT DO NOTHING").bind(org).bind(a).bind(r.get::<String,_>("role")).bind(r.get::<String,_>("email")).execute(&mut *tx).await?;
                    if n.rows_affected() != 1 {
                        return Err(Error::forbidden());
                    }
                }
                "reset" => {
                    let p = password(val(&j, "password")).await?;
                    sqlx::query("UPDATE accounts SET password_hash=$2 WHERE id=$1")
                        .bind(a)
                        .bind(p)
                        .execute(&mut *tx)
                        .await?;
                    sqlx::query("DELETE FROM sessions WHERE account_id=$1")
                        .bind(a)
                        .execute(&mut *tx)
                        .await?;
                    sqlx::query("DELETE FROM tokens WHERE account_id=$1 AND purpose='reset'")
                        .bind(a)
                        .execute(&mut *tx)
                        .await?;
                }
                "verify-notification" => {
                    sqlx::query("UPDATE accounts SET notification_email=$2 WHERE id=$1")
                        .bind(a)
                        .bind(r.get::<String, _>("email"))
                        .execute(&mut *tx)
                        .await?;
                }
                "recover-account" => {
                    sqlx::query("UPDATE accounts SET closed_at=NULL WHERE id=$1")
                        .bind(a)
                        .execute(&mut *tx)
                        .await?;
                }
                _ => {
                    sqlx::query("UPDATE accounts SET verified=true WHERE id=$1")
                        .bind(a)
                        .execute(&mut *tx)
                        .await?;
                }
            }
            tx.commit().await?;
        }
        _ => return Err(Error::not_found()),
    }
    Ok(Json(json!({"ok":true})).into_response())
}
