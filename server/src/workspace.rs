use super::*;
use axum::{
    body::Bytes,
    extract::{Path, Query},
    http::Method,
    routing::{any, post},
};
use std::collections::HashMap;
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/organizations", post(create_org))
        .route("/api/v1/organizations/{o}", any(org_root))
        .route("/api/v1/organizations/{o}/{*path}", any(org_child))
        .route("/api/v1/boards/{b}", any(board_root))
        .route("/api/v1/boards/{b}/{*path}", any(board_child))
        .route("/api/v1/operator", get(operator_home))
        .route("/api/v1/operator/actions", post(operator_action))
}
fn payload(b: &Bytes) -> Result<V> {
    if b.is_empty() {
        Ok(json!({}))
    } else {
        serde_json::from_slice(b).map_err(|_| Error::bad("invalid_json"))
    }
}
async fn create_org(State(s): State<AppState>, h: HeaderMap, Json(j): Json<V>) -> Api {
    let a = signed(&s.db, &h).await?;
    rate(&s.db, &h, "create_org", 20, 3600).await?;
    let name = required(&j, "name", 1, 80)?;
    let slug = valid_slug(val(&j, "slug"), &name);
    let mut tx = s.db.begin().await?;
    let limit: i32 = sqlx::query_scalar(
        "SELECT org_limit FROM accounts WHERE id=$1 AND verified AND closed_at IS NULL FOR UPDATE",
    )
    .bind(a)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(Error::forbidden())?;
    if sqlx::query_scalar::<_, i64>("SELECT count(*) FROM orgs WHERE owner_id=$1")
        .bind(a)
        .fetch_one(&mut *tx)
        .await?
        >= limit as i64
    {
        return Err(Error::conflict("org_limit"));
    }
    let o: V = sqlx::query_scalar(
        "INSERT INTO orgs(name,slug,owner_id,board_limit,seat_limit,media_limit) SELECT $1,$2,$3,board_limit,seat_limit,media_limit FROM platform_defaults RETURNING to_jsonb(orgs)",
    )
    .bind(name)
    .bind(slug)
    .bind(a)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO memberships(org_id,account_id,role) VALUES($1,$2,'owner')")
        .bind(id(&o, "id")?)
        .bind(a)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(o))
}
fn valid_slug(given: &str, name: &str) -> String {
    let slug = slug(if given.is_empty() { name } else { given });
    if slug.is_empty() {
        Uuid::new_v4().simple().to_string()
    } else {
        slug
    }
}
async fn org_root(
    State(s): State<AppState>,
    Path(o): Path<Uuid>,
    h: HeaderMap,
    m: Method,
    b: Bytes,
) -> Api {
    org_dispatch(s, o, "", &h, m, payload(&b)?).await
}
async fn org_child(
    State(s): State<AppState>,
    Path((o, p)): Path<(Uuid, String)>,
    h: HeaderMap,
    m: Method,
    b: Bytes,
) -> Api {
    org_dispatch(s, o, &p, &h, m, payload(&b)?).await
}
async fn org_dispatch(s: AppState, o: Uuid, p: &str, h: &HeaderMap, m: Method, j: V) -> Api {
    let a = signed(&s.db, h).await?;
    let mut tx = s.db.begin().await?;
    let row=sqlx::query("SELECT to_jsonb(o) org,m.role FROM orgs o JOIN memberships m ON m.org_id=o.id WHERE o.id=$1 AND m.account_id=$2 FOR UPDATE OF o").bind(o).bind(a).fetch_one(&mut *tx).await?;
    let mut org: V = row.get("org");
    let role: String = row.get("role");
    org["role"] = json!(role);
    let owner = role == "owner";
    let admin = owner || role == "admin";
    let restore = p == "restore" && m == Method::POST && owner;
    if (org["suspended"] == true
        && !(restore || owner && p.is_empty() && m == Method::GET && !org["closed_at"].is_null()))
        || (!org["closed_at"].is_null() && !(restore || p.is_empty() && m == Method::GET && owner))
    {
        return Err(Error::forbidden());
    }
    let path: Vec<_> = p.split('/').collect();
    let mut result = json!({"ok":true});
    match (m.as_str(), path.as_slice()) {
        ("GET", [""]) => {
            let boards:Vec<V>=sqlx::query_scalar("SELECT to_jsonb(b)||jsonb_build_object('org_slug',$3::text,'pinned',EXISTS(SELECT 1 FROM pins WHERE account_id=$2 AND board_id=b.id),'post_count',(SELECT count(*) FROM posts WHERE board_id=b.id AND visibility='published')) FROM boards b WHERE org_id=$1 ORDER BY position,title").bind(o).bind(a).bind(val(&org,"slug")).fetch_all(&mut *tx).await?;
            let folders: Vec<V> = sqlx::query_scalar(
                "SELECT to_jsonb(f) FROM folders f WHERE org_id=$1 ORDER BY position,name",
            )
            .bind(o)
            .fetch_all(&mut *tx)
            .await?;
            let members:Vec<V>=sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'user_id',a.id,'display_name',a.name,'name',a.name,'email',a.email,'role',m.role,'alerts',CASE WHEN m.account_id=$2 THEN m.alerts END) FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE org_id=$1 ORDER BY a.name").bind(o).bind(a).fetch_all(&mut *tx).await?;
            let media:i64=sqlx::query_scalar("SELECT COALESCE(sum(m.bytes),0)::bigint FROM media m JOIN boards b ON b.id=m.board_id WHERE b.org_id=$1").bind(o).fetch_one(&mut *tx).await?;
            let reserved:i64=sqlx::query_scalar("SELECT count(*) FROM tokens WHERE org_id=$1 AND purpose='invite' AND expires>now()").bind(o).fetch_one(&mut *tx).await?;
            result = json!({"organization":org,"boards":boards,"folders":folders,"members":members,"usage":{"board_count":boards.len(),"board_limit":org["board_limit"],"seat_count":members.len() as i64+reserved,"seat_limit":org["seat_limit"],"media_bytes":media,"media_limit":org["media_limit"]}});
        }
        ("POST", ["boards"]) if admin => {
            rate(&s.db, h, "create_board", 60, 3600).await?;
            let n: i64 = sqlx::query_scalar("SELECT count(*) FROM boards WHERE org_id=$1")
                .bind(o)
                .fetch_one(&mut *tx)
                .await?;
            if n >= org["board_limit"].as_i64().unwrap_or(10) {
                return Err(Error::conflict("board_limit"));
            }
            let title = required(&j, "title", 1, 80)?;
            let bslug = valid_slug(val(&j, "slug"), &title);
            let b:V=sqlx::query_scalar("INSERT INTO boards(org_id,title,slug,description,folder_id,position) SELECT $1,$2,$3,$4,$5,COALESCE(MAX(position)+1,0) FROM boards WHERE org_id=$1 AND folder_id IS NOT DISTINCT FROM $5 RETURNING to_jsonb(boards)").bind(o).bind(&title).bind(&bslug).bind(val(&j,"description")).bind(opt_id(&j,"folder_id")?).fetch_one(&mut *tx).await?;
            let bid = id(&b, "id")?;
            sqlx::query("INSERT INTO board_names VALUES($1,$2,$3)")
                .bind(o)
                .bind(bslug)
                .bind(bid)
                .execute(&mut *tx)
                .await?;
            for (i, (name, color)) in [
                ("Suggestions", "#9ca3af"),
                ("Under review", "#7c3aed"),
                ("Planned", "#2563eb"),
                ("In progress", "#f59e0b"),
                ("Done", "#16a34a"),
                ("Declined", "#dc2626"),
            ]
            .iter()
            .enumerate()
            {
                sqlx::query("INSERT INTO statuses(board_id,name,preset,color,position,is_default,visitor_allowed) VALUES($1,$2,$2,$3,$4,$5,$5)").bind(bid).bind(name).bind(color).bind(i as i32).bind(i==0).execute(&mut *tx).await?;
            }
            for (i, n) in ["Feature", "Improvement", "Bug"].iter().enumerate() {
                sqlx::query("INSERT INTO tags(board_id,name,preset,color,position) VALUES($1,$2,$2,'#777777',$3)").bind(bid).bind(n).bind(i as i32).execute(&mut *tx).await?;
            }
            result = b;
        }
        ("POST", ["folders"]) if admin => {
            result = sqlx::query_scalar(
                "INSERT INTO folders(org_id,name,position) SELECT $1,$2,COALESCE(MAX(position)+1,0) FROM folders WHERE org_id=$1 RETURNING to_jsonb(folders)",
            )
            .bind(o)
            .bind(required(&j, "name", 1, 80)?)
            .fetch_one(&mut *tx)
            .await?;
        }
        ("PATCH", ["folders", f]) if admin => {
            let folder = parse_id(f)?;
            if j.get("name").is_some() {
                sqlx::query("UPDATE folders SET name=$3 WHERE org_id=$1 AND id=$2 RETURNING id")
                    .bind(o)
                    .bind(folder)
                    .bind(required(&j, "name", 1, 80)?)
                    .fetch_one(&mut *tx)
                    .await?;
            }
            if let Some(position) = position(&j)? {
                let siblings = sqlx::query_scalar(
                    "SELECT id FROM folders WHERE org_id=$1 ORDER BY position, name, id",
                )
                .bind(o)
                .fetch_all(&mut *tx)
                .await?;
                reorder(&mut tx, "folders", siblings, folder, position).await?;
            }
        }
        ("DELETE", ["folders", f]) if admin => {
            let f = parse_id(f)?;
            sqlx::query("UPDATE boards SET folder_id=NULL WHERE org_id=$1 AND folder_id=$2")
                .bind(o)
                .bind(f)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM folders WHERE org_id=$1 AND id=$2")
                .bind(o)
                .bind(f)
                .execute(&mut *tx)
                .await?;
        }
        ("POST", ["invitations"]) if owner => {
            let e = accounts::email(&j)?;
            let role = invite_role(&j)?;
            sqlx::query("DELETE FROM tokens WHERE org_id=$1 AND email=$2 AND purpose='invite'")
                .bind(o)
                .bind(&e)
                .execute(&mut *tx)
                .await?;
            let n:i64=sqlx::query_scalar("SELECT (SELECT count(*) FROM memberships WHERE org_id=$1)+(SELECT count(*) FROM tokens WHERE org_id=$1 AND purpose='invite' AND expires>now())").bind(o).fetch_one(&mut *tx).await?;
            if n >= org["seat_limit"].as_i64().unwrap_or(10) {
                return Err(Error::conflict("seat_limit"));
            }
            accounts::mail_token(&mut tx, &s, "invite", None, Some(o), &e, Some(role)).await?;
        }
        ("PATCH", ["members", member]) if parse_id(member)? == a && j.get("alerts").is_some() => {
            sqlx::query("UPDATE memberships SET alerts=$3 WHERE org_id=$1 AND account_id=$2")
                .bind(o)
                .bind(a)
                .bind(j["alerts"].as_bool().ok_or(Error::bad("alerts"))?)
                .execute(&mut *tx)
                .await?;
        }
        ("PATCH", ["members", member]) if owner => {
            sqlx::query("UPDATE memberships SET role=$3 WHERE org_id=$1 AND account_id=$2 AND role<>'owner'").bind(o).bind(parse_id(member)?).bind(invite_role(&j)?).execute(&mut *tx).await?;
        }
        ("DELETE", ["members", member]) if owner => {
            sqlx::query(
                "DELETE FROM memberships WHERE org_id=$1 AND account_id=$2 AND role<>'owner'",
            )
            .bind(o)
            .bind(parse_id(member)?)
            .execute(&mut *tx)
            .await?;
        }
        ("POST", ["transfer"]) if owner => {
            let target = id(&j, "user_id")?;
            let lim:i32=sqlx::query_scalar("SELECT a.org_limit FROM accounts a JOIN memberships m ON m.account_id=a.id WHERE a.id=$1 AND m.org_id=$2 AND a.verified AND a.closed_at IS NULL FOR UPDATE OF a").bind(target).bind(o).fetch_one(&mut *tx).await?;
            let n: i64 = sqlx::query_scalar("SELECT count(*) FROM orgs WHERE owner_id=$1")
                .bind(target)
                .fetch_one(&mut *tx)
                .await?;
            if n >= lim as i64 {
                return Err(Error::conflict("org_limit"));
            }
            sqlx::query("UPDATE memberships SET role='admin' WHERE org_id=$1 AND account_id=$2")
                .bind(o)
                .bind(a)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE memberships SET role='owner' WHERE org_id=$1 AND account_id=$2")
                .bind(o)
                .bind(target)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE orgs SET owner_id=$2 WHERE id=$1")
                .bind(o)
                .bind(target)
                .execute(&mut *tx)
                .await?;
        }
        ("POST", ["close"]) if owner => {
            sqlx::query("UPDATE orgs SET closed_at=now() WHERE id=$1")
                .bind(o)
                .execute(&mut *tx)
                .await?;
        }
        ("POST", ["restore"]) if owner => {
            sqlx::query("UPDATE orgs SET closed_at=NULL WHERE id=$1 AND closed_at>now()-interval '30 days' RETURNING id").bind(o).fetch_one(&mut *tx).await?;
        }
        _ => return Err(Error::forbidden()),
    }
    tx.commit().await?;
    Ok(Json(result))
}
fn position(j: &V) -> Result<Option<usize>> {
    j.get("position")
        .map(|v| {
            v.as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .ok_or(Error::bad("position"))
        })
        .transpose()
}
// The caller locks the organization before changing sibling order.
async fn reorder(
    tx: &mut Tx<'_>,
    table: &str,
    mut siblings: Vec<Uuid>,
    moved: Uuid,
    index: usize,
) -> Result<()> {
    if table == "folders" && !siblings.contains(&moved) {
        return Err(Error::not_found());
    }
    siblings.retain(|id| *id != moved);
    siblings.insert(index.min(siblings.len()), moved);
    sqlx::query(&format!("UPDATE {table} t SET position=(items.rank-1)::integer FROM unnest($1::uuid[]) WITH ORDINALITY items(id, rank) WHERE items.id=t.id"))
        .bind(siblings).execute(&mut **tx).await?;
    Ok(())
}
fn invite_role(j: &V) -> Result<&str> {
    match val(j, "role") {
        s @ ("moderator" | "admin") => Ok(s),
        _ => Err(Error::bad("invalid_role")),
    }
}
pub fn opt_id(j: &V, k: &str) -> Result<Option<Uuid>> {
    j[k].as_str()
        .filter(|s| !s.is_empty())
        .map(parse_id)
        .transpose()
}
async fn board_root(
    State(s): State<AppState>,
    Path(b): Path<Uuid>,
    Query(q): Query<HashMap<String, String>>,
    h: HeaderMap,
    m: Method,
    bytes: Bytes,
) -> Api {
    board_dispatch(s, b, "", &h, m, payload(&bytes)?, q).await
}
async fn board_child(
    State(s): State<AppState>,
    Path((b, p)): Path<(Uuid, String)>,
    Query(q): Query<HashMap<String, String>>,
    h: HeaderMap,
    m: Method,
    bytes: Bytes,
) -> Api {
    board_dispatch(s, b, &p, &h, m, payload(&bytes)?, q).await
}
async fn board_dispatch(
    s: AppState,
    b: Uuid,
    p: &str,
    h: &HeaderMap,
    m: Method,
    j: V,
    q: HashMap<String, String>,
) -> Api {
    let a = signed(&s.db, h).await?;
    if p == "restore" && m == Method::POST {
        sqlx::query("UPDATE boards b SET closed_at=NULL FROM orgs o WHERE b.id=$1 AND o.id=b.org_id AND o.owner_id=$2 AND o.closed_at IS NULL AND b.closed_at>now()-interval '30 days' RETURNING b.id").bind(b).bind(a).fetch_one(&s.db).await?;
        return Ok(Json(json!({"ok":true})));
    }
    let access = staff(&s.db, h, b, false).await?;
    let admin = access.role.as_deref() != Some("moderator");
    let path: Vec<_> = p.split('/').collect();
    let mut tx = s.db.begin().await?;
    match (m.as_str(), path.as_slice()) {
        ("GET", [""]) => {
            drop(tx);
            return feedback::board_data(&s, b, h, &q, true).await.map(Json);
        }
        ("PUT", [""]) if admin => {
            save(&mut tx, b, a, &access, &j).await?;
        }
        ("POST", ["publish"]) if admin => {
            sqlx::query("UPDATE boards SET published=true WHERE id=$1")
                .bind(b)
                .execute(&mut *tx)
                .await?;
        }
        ("POST", ["close"]) if access.role.as_deref() == Some("owner") => {
            sqlx::query("UPDATE boards SET closed_at=now() WHERE id=$1")
                .bind(b)
                .execute(&mut *tx)
                .await?;
        }
        ("PUT", ["pin"]) => {
            if j["pinned"] == false {
                sqlx::query("DELETE FROM pins WHERE account_id=$1 AND board_id=$2")
                    .bind(a)
                    .bind(b)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("INSERT INTO pins VALUES($1,$2) ON CONFLICT DO NOTHING")
                    .bind(b)
                    .bind(a)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        ("PATCH", ["position"]) if admin => {
            sqlx::query("SELECT id FROM orgs WHERE id=$1 FOR UPDATE")
                .bind(access.org_id)
                .fetch_one(&mut *tx)
                .await?;
            let current: Option<Uuid> =
                sqlx::query_scalar("SELECT folder_id FROM boards WHERE id=$1 FOR UPDATE")
                    .bind(b)
                    .fetch_one(&mut *tx)
                    .await?;
            let folder = if j.get("folder_id").is_some() {
                opt_id(&j, "folder_id")?
            } else {
                current
            };
            let siblings = sqlx::query_scalar("SELECT id FROM boards WHERE org_id=$1 AND folder_id IS NOT DISTINCT FROM $2 AND id<>$3 ORDER BY position,title,id")
                .bind(access.org_id).bind(folder).bind(b).fetch_all(&mut *tx).await?;
            sqlx::query("UPDATE boards SET folder_id=$2 WHERE id=$1")
                .bind(b)
                .bind(folder)
                .execute(&mut *tx)
                .await?;
            let index = position(&j)?.unwrap_or(siblings.len());
            reorder(&mut tx, "boards", siblings, b, index).await?;
        }
        ("GET", ["posts"]) => {
            drop(tx);
            let (items, next, _) = feedback::posts(&s.db, b, None, true, &q).await?;
            return Ok(Json(
                json!({"items":items,"posts":items,"next_cursor":next}),
            ));
        }
        ("GET", ["posts", pid]) => {
            drop(tx);
            return feedback::detail(&s, b, parse_id(pid)?, h, &q, true)
                .await
                .map(Json);
        }
        ("GET", ["posts", pid, "votes"]) => {
            let cursor = q
                .get("cursor")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);
            let mut votes:Vec<V>=sqlx::query_scalar("SELECT jsonb_build_object('guest_id',g.id,'name',g.name,'created_at',v.created_at,'new_identity',g.created_at>v.created_at-interval '1 hour','shared_ip',count(*) OVER(PARTITION BY g.ip_hash)>1) FROM votes v JOIN guests g ON g.id=v.guest_id JOIN posts p ON p.id=v.post_id WHERE p.board_id=$1 AND p.id=$2 ORDER BY v.created_at DESC,g.id LIMIT 31 OFFSET $3").bind(b).bind(parse_id(pid)?).bind(i64::from(cursor)).fetch_all(&mut *tx).await?;
            let next = (votes.len() > 30).then_some(u64::from(cursor) + 30);
            votes.truncate(30);
            return Ok(Json(json!({"votes":votes,"next_cursor":next})));
        }
        ("POST", ["posts"]) => {
            drop(tx);
            return feedback::write_post(&s, b, h, &j)
                .await
                .map(|(v, _)| Json(v));
        }
        ("POST", ["posts", pid, "comments"]) => {
            drop(tx);
            return feedback::write_comment(&s, b, parse_id(pid)?, h, &j)
                .await
                .map(|(v, _)| Json(v));
        }
        ("POST", ["moderate"]) => publishing::moderate(&mut tx, &s, b, &access, &j).await?,
        ("GET", ["updates"]) => {
            drop(tx);
            let (entries, next) =
                publishing::updates(&s.db, b, feedback::pt(h, &q), feedback::offset(&q)).await?;
            return Ok(Json(json!({"updates":entries,"next_cursor": next})));
        }
        ("POST", ["updates"]) if admin => {
            publishing::publish(&mut tx, &s, b, &j).await?;
        }
        ("PATCH", ["updates", uid]) if admin => {
            publishing::edit_update(&mut tx, b, parse_id(uid)?, &j).await?;
        }
        ("DELETE", ["updates", uid]) if admin => {
            let revision: i32 = sqlx::query_scalar(
                "SELECT revision FROM updates WHERE id=$1 AND board_id=$2 FOR UPDATE",
            )
            .bind(parse_id(uid)?)
            .bind(b)
            .fetch_one(&mut *tx)
            .await?;
            publishing::check_revision(&j, revision)?;
            sqlx::query("DELETE FROM updates WHERE id=$1 AND board_id=$2")
                .bind(parse_id(uid)?)
                .bind(b)
                .execute(&mut *tx)
                .await?;
        }
        _ => return Err(Error::forbidden()),
    }
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

fn validate_settings(settings: &V, appearance: &V) -> Result<()> {
    if !settings.is_object() || !appearance.is_object() {
        return Err(Error::bad("invalid_settings"));
    }
    for key in [
        "roadmap_visible",
        "public_posting",
        "require_approval",
        "voting_enabled",
        "guest_uploads",
        "indexing",
    ] {
        if settings.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(Error::bad("invalid_settings"));
        }
    }
    for key in ["form_fields", "board_fields"] {
        if settings.get(key).is_some_and(|v| {
            !v.as_object()
                .is_some_and(|fields| fields.values().all(V::is_boolean))
        }) {
            return Err(Error::bad("invalid_fields"));
        }
    }
    let sizes = &["small", "medium", "large"][..];
    let shapes = &["square", "rounded", "pill"][..];
    for (value, key, choices) in [
        (settings, "opening_view", &["list", "roadmap"][..]),
        (settings, "density", &["roomy", "compact"]),
        (
            settings,
            "sort",
            &["trending", "top", "new", "status", "manual"],
        ),
        (
            appearance,
            "font",
            &["Poppins", "Arial", "Georgia", "system-ui", "monospace"],
        ),
        (appearance, "text_size", sizes),
        (appearance, "page_width", &["narrow", "medium", "wide"]),
        (appearance, "cover_height", &["short", "medium", "tall"]),
        (appearance, "logo_size", sizes),
        (appearance, "logo_shape", &["circle", "rounded", "square"]),
        (appearance, "input_style", &["outline", "filled"]),
        (appearance, "input_size", sizes),
        (appearance, "button_size", sizes),
        (appearance, "input_shape", shapes),
        (appearance, "button_shape", shapes),
    ] {
        if value
            .get(key)
            .is_some_and(|v| !v.as_str().is_some_and(|name| choices.contains(&name)))
        {
            return Err(Error::bad("invalid_choice"));
        }
    }
    for key in ["background", "text", "accent", "button"] {
        if appearance
            .get(key)
            .is_some_and(|v| !v.as_str().is_some_and(hex_color))
        {
            return Err(Error::bad("invalid_color"));
        }
    }
    if settings.get("links").is_some_and(|v| !v.is_array())
        || settings.get("button_text").is_some_and(|v| !v.is_string())
        || settings.get("manual_order").is_some_and(|v| {
            !v.as_array().is_some_and(|entries| {
                entries
                    .iter()
                    .all(|id| id.as_str().is_some_and(|s| Uuid::parse_str(s).is_ok()))
            })
        })
    {
        return Err(Error::bad("invalid_settings"));
    }
    Ok(())
}
fn hex_color(color: &str) -> bool {
    color
        .strip_prefix('#')
        .is_some_and(|c| matches!(c.len(), 3 | 6) && c.bytes().all(|b| b.is_ascii_hexdigit()))
}
async fn save(tx: &mut Tx<'_>, b: Uuid, a: Uuid, access: &BoardAccess, j: &V) -> Result<()> {
    let old: V = sqlx::query_scalar("SELECT to_jsonb(b) FROM boards b WHERE id=$1 FOR UPDATE")
        .bind(b)
        .fetch_one(&mut **tx)
        .await?;
    if j["revision"] != old["revision"] {
        return Err(Error::conflict("stale_revision"));
    }
    let title = required(j, "title", 1, 80)?;
    let desc = val(j, "description");
    if desc.chars().count() > 500 {
        return Err(Error::bad("invalid_description"));
    }
    let slug = valid_slug(val(j, "slug"), &title);
    let settings = j.get("settings").unwrap_or(&old["settings"]);
    let appearance = j.get("appearance").unwrap_or(&old["appearance"]);
    validate_settings(settings, appearance)?;
    if settings["indexing"].as_bool().unwrap_or(false)
        != old["settings"]["indexing"].as_bool().unwrap_or(false)
        && access.role.as_deref() != Some("owner")
    {
        return Err(Error::forbidden());
    }
    if let Some(links) = settings["links"].as_array() {
        for l in links {
            let url = url::Url::parse(val(l, "url")).map_err(|_| Error::bad("invalid_link"))?;
            if !matches!(url.scheme(), "https" | "http") {
                return Err(Error::bad("invalid_link"));
            }
        }
    }
    if old["slug"] != slug {
        let r=sqlx::query("INSERT INTO board_names VALUES($1,$2,$3) ON CONFLICT(org_id,slug) DO UPDATE SET board_id=excluded.board_id WHERE board_names.board_id=excluded.board_id").bind(access.org_id).bind(&slug).bind(b).execute(&mut **tx).await?;
        if r.rows_affected() == 0 {
            return Err(Error::conflict("slug_reserved"));
        }
    }
    for (kind, key) in [("logo", "logo_id"), ("cover", "cover_id")] {
        if j.get(key).is_some() && j[key] != old[key] {
            media::bind_brand(tx, b, a, kind, opt_id(j, key)?).await?;
        }
    }
    sqlx::query("UPDATE boards SET title=$2,description=$3,slug=$4,settings=$5,appearance=$6,logo_id=$7,cover_id=$8,revision=revision+1 WHERE id=$1").bind(b).bind(title).bind(desc).bind(slug).bind(settings).bind(appearance).bind(opt_id(if j.get("logo_id").is_some(){j}else{&old},"logo_id")?).bind(opt_id(if j.get("cover_id").is_some(){j}else{&old},"cover_id")?).execute(&mut **tx).await?;
    for is_status in [true, false] {
        let table = if is_status { "statuses" } else { "tags" };
        let Some(entries) = j[table].as_array() else {
            continue;
        };
        if entries.len() > 200 {
            return Err(Error::bad("too_many_labels"));
        }
        let prior: Vec<Uuid> =
            sqlx::query_scalar(&format!("SELECT id FROM {table} WHERE board_id=$1"))
                .bind(b)
                .fetch_all(&mut **tx)
                .await?;
        let default = if is_status {
            if entries.iter().filter(|e| e["is_default"] == true).count() != 1
                || (settings["public_posting"] != false
                    && !entries.iter().any(|e| e["visitor_allowed"] == true))
            {
                return Err(Error::bad("invalid_destinations"));
            }
            let d: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM statuses WHERE board_id=$1 AND is_default")
                    .bind(b)
                    .fetch_optional(&mut **tx)
                    .await?;
            sqlx::query("UPDATE statuses SET is_default=false WHERE board_id=$1")
                .bind(b)
                .execute(&mut **tx)
                .await?;
            d
        } else {
            None
        };
        let mut keep = Vec::new();
        for (i, e) in entries.iter().enumerate() {
            let eid = opt_id(e, "id")?.unwrap_or_else(Uuid::new_v4);
            let name = required(e, "name", 1, 30)?;
            let color = val(e, "color");
            if !hex_color(color) {
                return Err(Error::bad("invalid_color"));
            }
            let existing: Option<(String, Option<String>)> = sqlx::query_as(&format!(
                "SELECT name,preset FROM {table} WHERE board_id=$1 AND id=$2"
            ))
            .bind(b)
            .bind(eid)
            .fetch_optional(&mut **tx)
            .await?;
            let preset = existing.and_then(|(n, p)| {
                if name == n || p.as_ref().is_some_and(|k| feedback::label(k, true) == name) {
                    p
                } else {
                    None
                }
            });
            let sql = if is_status {
                "INSERT INTO statuses(id,board_id,name,preset,color,position,is_default,visitor_allowed,on_roadmap) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=$3,preset=$4,color=$5,position=$6,is_default=$7,visitor_allowed=$8,on_roadmap=$9 WHERE statuses.board_id=$2"
            } else {
                "INSERT INTO tags(id,board_id,name,preset,color,position) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$3,preset=$4,color=$5,position=$6 WHERE tags.board_id=$2"
            };
            let mut q = sqlx::query(sql)
                .bind(eid)
                .bind(b)
                .bind(preset.as_deref().unwrap_or(&name))
                .bind(&preset)
                .bind(color)
                .bind(i as i32);
            if is_status {
                q = q
                    .bind(e["is_default"] == true)
                    .bind(e["visitor_allowed"] == true)
                    .bind(e["on_roadmap"] != false);
            }
            if keep.contains(&eid) || q.execute(&mut **tx).await?.rows_affected() != 1 {
                return Err(Error::bad("invalid_label_id"));
            }
            keep.push(eid)
        }
        for removed in prior.into_iter().filter(|x| !keep.contains(x)) {
            if Some(removed) == default {
                return Err(Error::bad("protected_default"));
            }
            if is_status {
                let replacement = id(&j["reassignments"], &removed.to_string())?;
                if !keep.contains(&replacement) {
                    return Err(Error::bad("invalid_replacement"));
                }
                sqlx::query("UPDATE posts SET status_id=$2 WHERE status_id=$1")
                    .bind(removed)
                    .bind(replacement)
                    .execute(&mut **tx)
                    .await?;
            } else {
                sqlx::query("UPDATE posts SET tag_id=NULL WHERE tag_id=$1")
                    .bind(removed)
                    .execute(&mut **tx)
                    .await?;
            }
            sqlx::query(&format!("DELETE FROM {table} WHERE id=$1 AND board_id=$2"))
                .bind(removed)
                .bind(b)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(())
}
async fn operator(db: &PgPool, h: &HeaderMap) -> Result<Uuid> {
    let a = signed(db, h).await?;
    if sqlx::query_scalar::<_, bool>("SELECT operator FROM accounts WHERE id=$1")
        .bind(a)
        .fetch_one(db)
        .await?
    {
        Ok(a)
    } else {
        Err(Error::forbidden())
    }
}
async fn operator_home(
    State(s): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    h: HeaderMap,
) -> Api {
    operator(&s.db, &h).await?;
    let kind = q.get("kind").map(String::as_str).unwrap_or("all");
    let search = q.get("q").map(String::as_str).unwrap_or("");
    let cursor = feedback::offset(&q);
    let mut result = json!({"organizations":[],"boards":[],"audit":[],"next_cursor":null});
    for (wanted, field, query) in [
        (
            "organization",
            "organizations",
            r#"
            SELECT to_jsonb(o) || jsonb_build_object('media_bytes',COALESCE((
                SELECT sum(m.bytes) FROM media m JOIN boards b ON b.id=m.board_id WHERE b.org_id=o.id
            ),0))
            FROM orgs o WHERE strpos(lower(o.name),lower($1))>0 OR o.id::text=$1
            ORDER BY o.name,o.id LIMIT 31 OFFSET $2"#,
        ),
        (
            "board",
            "boards",
            r#"
            SELECT jsonb_build_object('id',b.id,'title',b.title,'suspended',b.suspended,'closed_at',b.closed_at)
            FROM boards b WHERE strpos(lower(b.title),lower($1))>0 OR b.id::text=$1
            ORDER BY b.title,b.id LIMIT 31 OFFSET $2"#,
        ),
        (
            "audit",
            "audit",
            r#"
            SELECT to_jsonb(a) FROM operator_audit a
            WHERE strpos(lower(concat_ws(' ',a.actor,a.target_id,a.action,a.reason)),lower($1))>0
            ORDER BY a.created_at DESC,a.id LIMIT 31 OFFSET $2"#,
        ),
    ] {
        if kind != "all" && kind != wanted {
            continue;
        }
        let mut rows: Vec<V> = sqlx::query_scalar(query)
            .bind(search)
            .bind(cursor)
            .fetch_all(&s.db)
            .await?;
        if rows.len() > 30 {
            result["next_cursor"] = json!(cursor + 30);
            rows.truncate(30);
        }
        result[field] = V::Array(rows);
    }
    result["defaults"] = sqlx::query_scalar("SELECT to_jsonb(d) FROM platform_defaults d")
        .fetch_one(&s.db)
        .await?;
    Ok(Json(result))
}
async fn operator_action(State(s): State<AppState>, h: HeaderMap, Json(j): Json<V>) -> Api {
    let a = operator(&s.db, &h).await?;
    let target = id(&j, "target_id")?;
    let ty = val(&j, "target_type");
    let action = val(&j, "action");
    let reason = required(&j, "reason", 1, 500)?;
    let table = match ty {
        "board" => "boards",
        "organization" => "orgs",
        "account" => "accounts",
        "platform" => "platform_defaults",
        _ => return Err(Error::bad("target_type")),
    };
    let mut tx = s.db.begin().await?;
    let mut change = json!({});
    match action {
        "suspend" | "restore" if matches!(ty, "organization" | "board") => {
            change["suspended"] = json!(action == "suspend");
            sqlx::query(&format!(
                "UPDATE {table} SET suspended=$2 WHERE id=$1 RETURNING id"
            ))
            .bind(target)
            .bind(action == "suspend")
            .fetch_one(&mut *tx)
            .await?;
        }
        "limits" if ty != "board" => {
            let l = j["limits"].as_object().ok_or(Error::bad("limits"))?;
            if l.is_empty() {
                return Err(Error::bad("limits"));
            }
            for (k, v) in l {
                if !(matches!(ty, "platform" | "account") && k == "org_limit"
                    || matches!(ty, "organization" | "platform")
                        && matches!(k.as_str(), "seat_limit" | "board_limit" | "media_limit"))
                {
                    return Err(Error::bad("limit"));
                }
                let n = v.as_i64().filter(|n| *n >= 0).ok_or(Error::bad("limit"))?;
                if (k != "media_limit" && n > i64::from(i32::MAX))
                    || (ty == "platform" && k == "seat_limit" && n < 1)
                {
                    return Err(Error::bad("limit"));
                }
                change[k] = json!(n);
                sqlx::query(&format!(
                    "UPDATE {table} SET {k}=$2::bigint WHERE id=$1 RETURNING id"
                ))
                .bind(target)
                .bind(n)
                .fetch_one(&mut *tx)
                .await?;
            }
        }
        _ => return Err(Error::bad("action")),
    }
    sqlx::query("INSERT INTO operator_audit(actor,target_type,target_id,action,reason,change) VALUES($1,$2,$3,$4,$5,$6)").bind(a).bind(ty).bind(target).bind(action).bind(reason).bind(change).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}
