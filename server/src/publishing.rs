use super::*;
use axum::{extract::Path, response::Html, routing::post};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    transport::smtp::authentication::Credentials,
};
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/email/{action}/{token}", get(mail_page).post(mail_confirm))
        .route("/api/v1/email/{action}", post(email_api))
}
pub async fn updates(db: &PgPool, b: Uuid, pt: bool, cursor: i64) -> Result<(Vec<V>, Option<i64>)> {
    let mut entries:Vec<V>=sqlx::query_scalar("SELECT to_jsonb(u)-'operation_id' FROM updates u WHERE board_id=$1 ORDER BY created_at DESC,id LIMIT 31 OFFSET $2").bind(b).bind(cursor).fetch_all(db).await?;
    let next = (entries.len() > 30).then_some(cursor + 30);
    entries.truncate(30);
    let ids: Vec<Uuid> = entries
        .iter()
        .flat_map(|u| u["links"].as_array().into_iter().flatten())
        .filter_map(|l| id(l, "id").ok())
        .collect();
    let visible:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM posts WHERE board_id=$1 AND visibility='published' AND merged_into IS NULL AND id=ANY($2)").bind(b).bind(ids).fetch_all(db).await?;
    for e in &mut entries {
        let mut links = e
            .as_object_mut()
            .unwrap()
            .remove("links")
            .unwrap_or_default();
        if let Some(xs) = links.as_array_mut() {
            xs.retain(|v| id(v, "id").ok().is_some_and(|p| visible.contains(&p)));
            for x in xs {
                if let Some(p) = x["preset"].as_str() {
                    x["status_name"] = json!(feedback::label(p, pt))
                }
            }
        }
        e["posts"] = links;
        e["body_html"] = json!(render(val(e, "body")));
    }
    Ok((entries, next))
}
async fn snapshots(tx: &mut Tx<'_>, b: Uuid, j: &V) -> Result<V> {
    let ids = feedback::uuid_list(j, "post_ids", 10)?;
    let mut links = Vec::new();
    for p in ids {
        links.push(sqlx::query_scalar::<_,V>("SELECT jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug,'status_name',s.name,'preset',s.preset,'color',s.color) FROM posts p JOIN statuses s ON s.id=p.status_id WHERE p.board_id=$1 AND p.id=$2 AND p.visibility='published' AND p.merged_into IS NULL").bind(b).bind(p).fetch_one(&mut **tx).await?);
    }
    Ok(json!(links))
}
pub async fn publish(tx: &mut Tx<'_>, s: &AppState, b: Uuid, j: &V) -> Result<()> {
    let title = required(j, "title", 1, 120)?;
    let body = required(j, "body", 1, 10000)?;
    let op = id(j, "operation_id")?;
    let links = snapshots(tx, b, j).await?;
    let inserted:Option<Uuid>=sqlx::query_scalar("INSERT INTO updates(board_id,title,body,links,operation_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(board_id,operation_id) DO NOTHING RETURNING id").bind(b).bind(&title).bind(&body).bind(links).bind(op).fetch_optional(&mut **tx).await?;
    if let Some(u) = inserted {
        sqlx::query("INSERT INTO outbox(email,subject,body,board_id,subscriber_id,event_key,update_id) SELECT sub.email,$2,$3||E'\n\n'||CASE WHEN sub.locale LIKE 'pt%' THEN 'Cancelar inscrição' ELSE 'Unsubscribe' END||': '||$4||'/email/unsubscribe/'||sub.unsubscribe_token,$1,sub.id,'update:'||$5::text||':'||sub.id,$5::text::uuid FROM subscribers sub JOIN boards b ON b.id=sub.board_id WHERE b.id=$1 AND b.published AND sub.verified ON CONFLICT(event_key) DO NOTHING").bind(b).bind(title).bind(body).bind(&s.origin).bind(u.to_string()).execute(&mut **tx).await?;
    }
    Ok(())
}
pub(crate) fn check_revision(j: &V, current: i32) -> Result<()> {
    let expected = j["revision"]
        .as_i64()
        .ok_or(Error::bad("revision_required"))?;
    if expected != i64::from(current) {
        return Err(Error::conflict("stale_revision"));
    }
    Ok(())
}
pub async fn edit_update(tx: &mut Tx<'_>, b: Uuid, u: Uuid, j: &V) -> Result<()> {
    let row =
        sqlx::query("SELECT links,revision FROM updates WHERE board_id=$1 AND id=$2 FOR UPDATE")
            .bind(b)
            .bind(u)
            .fetch_one(&mut **tx)
            .await?;
    check_revision(j, row.get("revision"))?;
    let old: V = row.get("links");
    let mut links = snapshots(tx, b, j).await?;
    for l in links.as_array_mut().into_iter().flatten() {
        if let Some(saved) = old
            .as_array()
            .into_iter()
            .flatten()
            .find(|x| x["id"] == l["id"])
        {
            *l = saved.clone()
        }
    }
    sqlx::query("UPDATE updates SET title=$3,body=$4,links=$5 WHERE id=$1 AND board_id=$2")
        .bind(u)
        .bind(b)
        .bind(required(j, "title", 1, 120)?)
        .bind(required(j, "body", 1, 10000)?)
        .bind(links)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
pub async fn subscribe(s: &AppState, b: Uuid, j: &V) -> Result<()> {
    let e = accounts::email(j)?;
    let pt = val(j, "locale").starts_with("pt");
    let t = token();
    let mut tx = s.db.begin().await?;
    let n=sqlx::query("INSERT INTO subscribers(board_id,email,locale,confirm_token,unsubscribe_token) SELECT $1,$2,$3,$4,$5 FROM boards WHERE id=$1 AND published ON CONFLICT(board_id,email) DO UPDATE SET confirm_token=excluded.confirm_token,locale=excluded.locale WHERE NOT subscribers.verified").bind(b).bind(&e).bind(if pt{"pt-BR"}else{"en"}).bind(hash(&t)).bind(token()).execute(&mut *tx).await?;
    if n.rows_affected() == 1 {
        let subject = if pt {
            "Confirme sua inscrição"
        } else {
            "Confirm your subscription"
        };
        sqlx::query("INSERT INTO outbox(email,subject,body,board_id) VALUES($1,$2,$3,$4)")
            .bind(&e)
            .bind(subject)
            .bind(format!("{}/email/confirm/{t}", s.origin))
            .bind(b)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
async fn subscription_action(s: &AppState, action: &str, t: &str) -> Result<()> {
    match action {
        "confirm" => {
            sqlx::query("UPDATE subscribers sub SET verified=true FROM boards b JOIN orgs o ON o.id=b.org_id WHERE sub.confirm_token=$1 AND b.id=sub.board_id AND b.published AND NOT b.suspended AND b.closed_at IS NULL AND NOT o.suspended AND o.closed_at IS NULL RETURNING sub.id")
                .bind(hash(t))
                .fetch_one(&s.db)
                .await?;
        }
        "unsubscribe" => {
            sqlx::query("DELETE FROM subscribers WHERE unsubscribe_token=$1")
                .bind(t)
                .execute(&s.db)
                .await?;
        }
        _ => return Err(Error::not_found()),
    }
    Ok(())
}
async fn mail_page(Path((action, _)): Path<(String, String)>) -> Result<Html<String>> {
    if !matches!(action.as_str(), "confirm" | "unsubscribe") {
        return Err(Error::not_found());
    }
    Ok(Html(format!(
        "<!doctype html><meta name=referrer content=no-referrer><title>PatchBoard</title><main><h1>PatchBoard</h1><button id=go>{}</button><p id=message></p></main><script>go.onclick=async()=>{{const r=await fetch(location.href,{{method:'POST',headers:{{'X-PatchBoard':'1'}}}});message.textContent=r.ok?'Done':'Link unavailable';go.disabled=r.ok}}</script>",
        if action == "confirm" {
            "Confirm subscription / Confirmar inscrição"
        } else {
            "Unsubscribe / Cancelar inscrição"
        }
    )))
}
async fn mail_confirm(State(s): State<AppState>, Path((a, t)): Path<(String, String)>) -> Api {
    subscription_action(&s, &a, &t).await?;
    Ok(Json(json!({"ok":true})))
}
async fn email_api(State(s): State<AppState>, Path(a): Path<String>, Json(j): Json<V>) -> Api {
    subscription_action(&s, &a, val(&j, "token")).await?;
    Ok(Json(json!({"ok":true})))
}
pub async fn moderate(
    tx: &mut Tx<'_>,
    s: &AppState,
    b: Uuid,
    access: &BoardAccess,
    j: &V,
) -> Result<()> {
    let action = val(j, "action");
    if matches!(action, "ban" | "unban") {
        let g = id(j, "guest_id")?;
        let ip: String = sqlx::query_scalar("SELECT ip_hash FROM guests WHERE id=$1 AND org_id=$2")
            .bind(g)
            .bind(access.org_id)
            .fetch_one(&mut **tx)
            .await?;
        let orgwide = val(j, "scope") == "organization";
        if orgwide && access.role.as_deref() == Some("moderator") {
            return Err(Error::forbidden());
        }
        let scoped = (!orgwide).then_some(b);
        if action == "ban" {
            sqlx::query("INSERT INTO bans(org_id,board_id,guest_id,ip_hash) VALUES($1,$2,$3,$4)")
                .bind(access.org_id)
                .bind(scoped)
                .bind(g)
                .bind((j["ip_ban"] == true).then_some(ip))
                .execute(&mut **tx)
                .await?;
        } else {
            sqlx::query("DELETE FROM bans WHERE org_id=$1 AND board_id IS NOT DISTINCT FROM $2 AND guest_id=$3").bind(access.org_id).bind(scoped).bind(g).execute(&mut **tx).await?;
        }
        return Ok(());
    }
    let p = id(j, "post_id")?;
    sqlx::query("SELECT id FROM boards WHERE id=$1 FOR UPDATE")
        .bind(b)
        .fetch_one(&mut **tx)
        .await?;
    let revision: i32 = sqlx::query_scalar(
        "SELECT revision FROM posts WHERE board_id=$1 AND id=$2 AND merged_into IS NULL FOR UPDATE",
    )
    .bind(b)
    .bind(p)
    .fetch_one(&mut **tx)
    .await?;
    match action {
        "approve" | "restore" | "hide" => {
            sqlx::query("UPDATE posts SET visibility=$2 WHERE id=$1")
                .bind(p)
                .bind(if action == "hide" {
                    "hidden"
                } else {
                    "published"
                })
                .execute(&mut **tx)
                .await?;
        }
        "pin" | "unpin" | "lock" | "unlock" => {
            sqlx::query(if matches!(action, "pin" | "unpin") {
                "UPDATE posts SET pinned=$2 WHERE id=$1"
            } else {
                "UPDATE posts SET locked=$2 WHERE id=$1"
            })
            .bind(p)
            .bind(matches!(action, "pin" | "lock"))
            .execute(&mut **tx)
            .await?;
        }
        "move" | "respond" => {
            if j["update"].is_object() {
                if access.role.as_deref() == Some("moderator") {
                    return Err(Error::forbidden());
                }
                let already_published: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM updates WHERE board_id=$1 AND operation_id=$2)",
                )
                .bind(b)
                .bind(id(&j["update"], "operation_id")?)
                .fetch_one(&mut **tx)
                .await?;
                if already_published {
                    return Ok(());
                }
            }
            if action == "move" {
                sqlx::query("UPDATE posts SET status_id=$2 WHERE id=$1")
                    .bind(p)
                    .bind(id(j, "status_id")?)
                    .execute(&mut **tx)
                    .await?;
            }
            if j.get("body").is_some() {
                sqlx::query("UPDATE posts SET team_response=$2 WHERE id=$1")
                    .bind(p)
                    .bind(required(j, "body", 0, 5000)?)
                    .execute(&mut **tx)
                    .await?;
            }
            if j["update"].is_object() {
                publish(tx, s, b, &j["update"]).await?;
            }
        }
        "edit" => {
            check_revision(j, revision)?;
            let title = required(j, "title", 3, 120)?;
            sqlx::query("UPDATE posts SET title=$2,slug=$3,body=$4 WHERE id=$1")
                .bind(p)
                .bind(&title)
                .bind(slug(&title))
                .bind(required(j, "body", 0, 10000)?)
                .execute(&mut **tx)
                .await?;
        }
        "merge" => {
            let dest = id(j, "target_id")?;
            if p == dest {
                return Err(Error::bad("merge_cycle"));
            }
            sqlx::query("SELECT id FROM posts WHERE id=$1 AND board_id=$2 AND visibility='published' AND merged_into IS NULL FOR UPDATE").bind(dest).bind(b).fetch_one(&mut **tx).await?;
            sqlx::query("UPDATE comments SET post_id=$2 WHERE post_id=$1")
                .bind(p)
                .bind(dest)
                .execute(&mut **tx)
                .await?;
            sqlx::query("INSERT INTO votes SELECT $2,guest_id,created_at FROM votes WHERE post_id=$1 ON CONFLICT DO NOTHING").bind(p).bind(dest).execute(&mut **tx).await?;
            sqlx::query("DELETE FROM votes WHERE post_id=$1")
                .bind(p)
                .execute(&mut **tx)
                .await?;
            sqlx::query("UPDATE posts SET merged_into=$2,visibility='published' WHERE id=$1 OR merged_into=$1").bind(p).bind(dest).execute(&mut **tx).await?;
        }
        "remove_vote" => {
            sqlx::query("DELETE FROM votes WHERE post_id=$1 AND guest_id=$2")
                .bind(p)
                .bind(id(j, "guest_id")?)
                .execute(&mut **tx)
                .await?;
        }
        "edit_comment" | "hide_comment" | "restore_comment" => {
            if action == "edit_comment" {
                let revision: i32 = sqlx::query_scalar(
                    "SELECT revision FROM comments WHERE post_id=$1 AND id=$2 FOR UPDATE",
                )
                .bind(p)
                .bind(id(j, "comment_id")?)
                .fetch_one(&mut **tx)
                .await?;
                check_revision(j, revision)?;
            }
            sqlx::query("UPDATE comments SET hidden=CASE WHEN $4='edit_comment' THEN hidden ELSE $4='hide_comment' END,body=COALESCE($3,body) WHERE post_id=$1 AND id=$2 RETURNING id").bind(p).bind(id(j,"comment_id")?).bind(if action=="edit_comment"{Some(required(j,"body",1,5000)?)}else{None}).bind(action).fetch_one(&mut **tx).await?;
        }
        "delete_image" => {
            sqlx::query(
                "DELETE FROM media WHERE id=$1 AND post_id=$2 AND board_id=$3 RETURNING id",
            )
            .bind(id(j, "media_id")?)
            .bind(p)
            .bind(b)
            .fetch_one(&mut **tx)
            .await?;
        }
        _ => return Err(Error::bad("unknown_action")),
    }
    Ok(())
}
pub async fn work_once(db: &PgPool) -> anyhow::Result<bool> {
    let mut tx = db.begin().await?;
    let Some(r)=sqlx::query("SELECT q.*, (SELECT unsubscribe_token FROM subscribers WHERE id=q.subscriber_id AND verified) unsub, (q.board_id IS NULL OR EXISTS(SELECT 1 FROM boards b JOIN orgs o ON o.id=b.org_id WHERE b.id=q.board_id AND (b.published OR q.staff_id IS NOT NULL) AND NOT b.suspended AND b.closed_at IS NULL AND NOT o.suspended AND o.closed_at IS NULL AND (q.staff_id IS NULL OR EXISTS(SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.org_id=o.id AND m.account_id=q.staff_id AND m.alerts AND a.closed_at IS NULL AND coalesce(a.notification_email,a.email)=q.email)))) deliver FROM outbox q WHERE next_try<=now() ORDER BY next_try LIMIT 1 FOR UPDATE SKIP LOCKED").fetch_optional(&mut *tx).await?else{return Ok(false)};
    let id: Uuid = r.get("id");
    if r.get("deliver") {
        let host = std::env::var("SMTP_HOST")?;
        let port = std::env::var("SMTP_PORT")
            .unwrap_or_else(|_| "587".into())
            .parse()?;
        let mut transport = if std::env::var("SMTP_TLS").as_deref() == Ok("none") {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host)
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)?
        };
        transport = transport
            .port(port)
            .timeout(Some(std::time::Duration::from_secs(10)));
        if let Some(u) = std::env::var("SMTP_USERNAME")
            .ok()
            .filter(|u| !u.is_empty())
        {
            transport = transport.credentials(Credentials::new(u, std::env::var("SMTP_PASSWORD")?));
        }
        let mut message = Message::builder()
            .from(std::env::var("SMTP_FROM")?.parse()?)
            .to(r.get::<String, _>("email").parse()?)
            .subject(r.get::<String, _>("subject"))
            .message_id(Some(format!("<{id}@patchboard>")));
        if let Some(token) = r.get::<Option<String>, _>("unsub") {
            use lettre::message::header::{HeaderName, HeaderValue};
            let origin = std::env::var("PUBLIC_ORIGIN")?;
            message = message
                .raw_header(HeaderValue::new(
                    HeaderName::new_from_ascii_str("List-Unsubscribe"),
                    format!(
                        "<{}/email/unsubscribe/{token}>",
                        origin.trim_end_matches('/')
                    ),
                ))
                .raw_header(HeaderValue::new(
                    HeaderName::new_from_ascii_str("List-Unsubscribe-Post"),
                    "List-Unsubscribe=One-Click".to_string(),
                ));
        }
        let msg = message.body(r.get::<String, _>("body"))?;
        if let Err(e) = transport.build().send(msg).await {
            tracing::warn!(error=%e,"mail delivery deferred");
            sqlx::query("UPDATE outbox SET attempts=attempts+1,next_try=now()+make_interval(secs=>LEAST(3600,15*(attempts+1))) WHERE id=$1").bind(id).execute(&mut *tx).await?;
            tx.commit().await?;
            return Ok(true);
        }
    }
    sqlx::query("DELETE FROM outbox WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}
pub async fn maintenance(db: &PgPool) -> anyhow::Result<()> {
    for sql in [
        "DELETE FROM boards WHERE closed_at<=now()-interval '30 days'",
        "DELETE FROM orgs WHERE closed_at<=now()-interval '30 days'",
        "DELETE FROM accounts WHERE closed_at<=now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM orgs WHERE owner_id=accounts.id)",
        "DELETE FROM rate_limits WHERE until_at<now()",
        "DELETE FROM sessions WHERE expires<now()",
        "DELETE FROM tokens WHERE expires<now()",
    ] {
        sqlx::query(sql).execute(db).await?;
    }
    media::cleanup(db)
        .await
        .map_err(|_| anyhow::anyhow!("media cleanup failed"))?;
    Ok(())
}
