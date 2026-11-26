use axum::{
    Json, Router,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value as V, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::net::SocketAddr;
use uuid::Uuid;
pub mod accounts;
pub mod contract;
pub mod feedback;
pub mod media;
pub mod publishing;
pub mod workspace;
type Tx<'a> = Transaction<'a, Postgres>;
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub origin: String,
}
#[derive(Debug)]
pub struct Error(StatusCode, String);
impl Error {
    pub fn bad(msg: &str) -> Self {
        Self(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn forbidden() -> Self {
        Self(StatusCode::FORBIDDEN, "forbidden".into())
    }
    pub fn not_found() -> Self {
        Self(StatusCode::NOT_FOUND, "not_found".into())
    }
    pub fn internal(e: impl std::fmt::Display) -> Self {
        tracing::error!(error=%e,"server operation failed");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "internal_error".into())
    }
    pub fn conflict(msg: &str) -> Self {
        Self(StatusCode::CONFLICT, msg.into())
    }
}
impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::RowNotFound => Self::not_found(),
            sqlx::Error::Database(d) if d.is_unique_violation() => Self::conflict("already_exists"),
            sqlx::Error::Database(d) if d.is_foreign_key_violation() => {
                Self::conflict("invalid_reference")
            }
            _ => Self::internal(e),
        }
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"code":self.1,"message":self.1}))).into_response()
    }
}
type Result<T, E = Error> = std::result::Result<T, E>;
type Api = Result<Json<V>>;
fn val<'a>(j: &'a V, k: &str) -> &'a str {
    j[k].as_str().unwrap_or("").trim()
}
fn required(j: &V, k: &str, min: usize, max: usize) -> Result<String> {
    let s = val(j, k);
    if !(min..=max).contains(&s.chars().count()) {
        return Err(Error::bad(&format!("invalid_{k}")));
    }
    Ok(s.into())
}
fn id(j: &V, k: &str) -> Result<Uuid> {
    parse_id(val(j, k))
}
fn parse_id(s: &str) -> Result<Uuid> {
    s.parse().map_err(|_| Error::bad("invalid_id"))
}
fn token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
fn hash(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}
fn cookie<'a>(h: &'a HeaderMap, name: &str) -> Option<&'a str> {
    h.get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|s| s.trim().split_once('='))
        .find(|(n, _)| *n == name)
        .map(|(_, v)| v)
}
fn set_cookie(name: &str, value: &str, age: i64, origin: &str) -> String {
    format!(
        "{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
        if origin.starts_with("https:") {
            "; Secure"
        } else {
            ""
        }
    )
}
fn response_cookie(v: V, c: Option<String>) -> Response {
    let mut r = Json(v).into_response();
    if let Some(c) = c {
        r.headers_mut()
            .append(header::SET_COOKIE, c.parse().expect("cookie"));
    }
    r
}
pub async fn account_id(db: &PgPool, h: &HeaderMap) -> Result<Option<Uuid>> {
    let Some(key) = cookie(h, "pb_session") else {
        return Ok(None);
    };
    Ok(sqlx::query_scalar("SELECT a.id FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token=$1 AND s.expires>now() AND a.closed_at IS NULL").bind(hash(key)).fetch_optional(db).await?)
}
async fn signed(db: &PgPool, h: &HeaderMap) -> Result<Uuid> {
    account_id(db, h)
        .await?
        .ok_or(Error(StatusCode::UNAUTHORIZED, "sign_in_required".into()))
}
pub struct BoardAccess {
    pub role: Option<String>,
    pub public: bool,
    pub org_id: Uuid,
}
pub async fn board_access(db: &PgPool, h: &HeaderMap, board: Uuid) -> Result<BoardAccess> {
    let a = account_id(db, h).await?;
    let r=sqlx::query("SELECT b.org_id,m.role,b.published AND NOT(b.suspended OR o.suspended) AND b.closed_at IS NULL AND o.closed_at IS NULL AS public, (b.suspended OR o.suspended OR b.closed_at IS NOT NULL OR o.closed_at IS NOT NULL) blocked FROM boards b JOIN orgs o ON o.id=b.org_id LEFT JOIN memberships m ON m.org_id=o.id AND m.account_id=$2 WHERE b.id=$1").bind(board).bind(a).fetch_one(db).await?;
    Ok(BoardAccess {
        role: if r.get("blocked") {
            None
        } else {
            r.get("role")
        },
        org_id: r.get("org_id"),
        public: r.get("public"),
    })
}
async fn staff(db: &PgPool, h: &HeaderMap, b: Uuid, editor: bool) -> Result<BoardAccess> {
    let a = board_access(db, h, b).await?;
    match a.role.as_deref() {
        Some("owner" | "admin") => Ok(a),
        Some("moderator") if !editor => Ok(a),
        _ => Err(Error::forbidden()),
    }
}
fn browser_guest(h: &HeaderMap, org: Uuid) -> Option<String> {
    cookie(h, &format!("pb_g_{org}"))
        .or(cookie(h, "pb_browser"))
        .map(|k| hash(&format!("{org}:{k}")))
}
async fn staff_account(db: &PgPool, h: &HeaderMap, org: Uuid) -> Result<Option<Uuid>> {
    let Some(session) = cookie(h, "pb_session") else {
        return Ok(None);
    };
    Ok(sqlx::query_scalar("SELECT m.account_id FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN memberships m ON m.account_id=a.id WHERE s.token=$1 AND s.expires>now() AND a.closed_at IS NULL AND m.org_id=$2")
        .bind(hash(session)).bind(org).fetch_optional(db).await?)
}
pub async fn guest_id(db: &PgPool, h: &HeaderMap, org: Uuid) -> Result<Option<Uuid>> {
    if let Some(a) = staff_account(db, h, org).await? {
        return Ok(sqlx::query_scalar(
            "SELECT id FROM guests WHERE org_id=$1 AND staff_account_id=$2",
        )
        .bind(org)
        .bind(a)
        .fetch_optional(db)
        .await?);
    }
    let Some(t) = browser_guest(h, org) else {
        return Ok(None);
    };
    Ok(
        sqlx::query_scalar("SELECT id FROM guests WHERE org_id=$1 AND staff_account_id IS NULL AND (token=$2 OR id=(SELECT guest_id FROM guest_devices WHERE token=$2))")
            .bind(org)
            .bind(t)
            .fetch_optional(db)
            .await?,
    )
}
fn ip_hash(h: &HeaderMap, org: Uuid) -> String {
    let s = h
        .get("x-pb-client")
        .and_then(|s| s.to_str().ok())
        .unwrap_or("local");
    let k = std::env::var("IP_HASH_KEY")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .unwrap_or_default();
    hash(&format!("{k}|{org}|{s}"))
}
pub async fn ensure_guest(db: &PgPool, h: &HeaderMap, org: Uuid) -> Result<(Uuid, Option<String>)> {
    if let Some(a) = staff_account(db, h, org).await? {
        let guest = sqlx::query_scalar("INSERT INTO guests(org_id,token,ip_hash,staff_account_id) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,staff_account_id) DO UPDATE SET staff_account_id=excluded.staff_account_id RETURNING id")
            .bind(org).bind(token()).bind(ip_hash(h,org)).bind(a).fetch_one(db).await?;
        return Ok((guest, None));
    }
    if let Some(id) = guest_id(db, h, org).await? {
        return Ok((id, None));
    }
    let fresh = token();
    let existing = browser_guest(h, org);
    let cookie_value = existing.is_none().then(|| {
        set_cookie(
            &format!("pb_g_{org}"),
            &fresh,
            31536000,
            &std::env::var("PUBLIC_ORIGIN").unwrap_or_default(),
        )
    });
    let t = existing.unwrap_or_else(|| hash(&format!("{org}:{fresh}")));
    rate(db, h, "identity", 20, 3600).await?;
    let g=sqlx::query_scalar("INSERT INTO guests(org_id,token,ip_hash) VALUES($1,$2,$3) ON CONFLICT(org_id,token) DO UPDATE SET token=excluded.token RETURNING id").bind(org).bind(t).bind(ip_hash(h,org)).fetch_one(db).await?;
    Ok((g, cookie_value))
}
pub async fn check_ban(db: &PgPool, h: &HeaderMap, board: Uuid, g: Uuid) -> Result<()> {
    let org: Uuid = sqlx::query_scalar("SELECT org_id FROM boards WHERE id=$1")
        .bind(board)
        .fetch_one(db)
        .await?;
    if sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM bans WHERE org_id=$1 AND (board_id=$2 OR board_id IS NULL) AND (guest_id=$3 OR ip_hash=$4))").bind(org).bind(board).bind(g).bind(ip_hash(h,org)).fetch_one(db).await?{return Err(Error::forbidden())}
    Ok(())
}
async fn rate(db: &PgPool, h: &HeaderMap, kind: &str, limit: i32, seconds: i32) -> Result<()> {
    let limit = std::env::var(format!(
        "PATCHBOARD_RATE_{}",
        kind.replace('-', "_").to_uppercase()
    ))
    .ok()
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or(limit);
    let k = format!("{kind}:{}", ip_hash(h, Uuid::nil()));
    let hits:i32=sqlx::query_scalar("INSERT INTO rate_limits VALUES($1,1,now()+make_interval(secs=>$2)) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN rate_limits.until_at<=now() THEN 1 ELSE rate_limits.hits+1 END,until_at=CASE WHEN rate_limits.until_at<=now() THEN excluded.until_at ELSE rate_limits.until_at END RETURNING hits").bind(k).bind(seconds as f64).fetch_one(db).await?;
    if hits > limit {
        Err(Error(StatusCode::TOO_MANY_REQUESTS, "rate_limited".into()))
    } else {
        Ok(())
    }
}
fn slug(s: &str) -> String {
    s.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|x| !x.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(80)
        .collect()
}
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn render(s: &str) -> String {
    use pulldown_cmark::{Event, Options, Parser, html};
    let mut html = String::new();
    let p = Parser::new_ext(s, Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH)
        .filter(|e| !matches!(e, Event::Html(_) | Event::InlineHtml(_)));
    html::push_html(&mut html, p);
    ammonia::Builder::default()
        .link_rel(Some("noopener noreferrer nofollow"))
        .rm_tags(&["img"])
        .clean(&html)
        .to_string()
}
pub async fn effective_ip(mut req: Request, next: Next) -> Response {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip());
    let trusted = std::env::var("TRUSTED_PROXY_IPS").unwrap_or_default();
    let mut ip = peer;
    if peer.is_some_and(|p| trusted.split(',').any(|s| s.trim() == p.to_string())) {
        ip = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.split(',').next_back())
            .and_then(|s| s.trim().parse().ok())
            .or(peer)
    }
    let addr = match ip {
        Some(std::net::IpAddr::V6(p)) => format!("{:x}", u128::from(p) >> 64),
        Some(p) => p.to_string(),
        None => "test".into(),
    };
    req.headers_mut()
        .insert("x-pb-client", addr.parse().unwrap());
    // Mail clients authenticate one-click unsubscribe with the unique link token.
    let unsubscribe = req.method() == axum::http::Method::POST
        && req
            .uri()
            .path()
            .strip_prefix("/email/unsubscribe/")
            .is_some_and(|token| token.len() == 64 && token.bytes().all(|c| c.is_ascii_hexdigit()));
    if !unsubscribe
        && !matches!(
            *req.method(),
            axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
        )
        && req
            .headers()
            .get("x-patchboard")
            .and_then(|h| h.to_str().ok())
            != Some("1")
    {
        return Error::forbidden().into_response();
    }
    let asset = req.uri().path().strip_prefix("/assets/").map(|name| {
        let stem = name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name);
        if stem.rsplit_once('-').is_some_and(|(_, hash)| {
            hash.len() >= 8
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        }) {
            "public, max-age=31536000, immutable"
        } else {
            "public, no-cache"
        }
    });
    let mut r = next.run(req).await;
    let cache = asset
        .filter(|_| r.status().is_success())
        .unwrap_or("private, no-store");
    r.headers_mut()
        .entry(header::CACHE_CONTROL)
        .or_insert(axum::http::HeaderValue::from_static(cache));
    r.headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    r.headers_mut()
        .insert("referrer-policy", "same-origin".parse().unwrap());
    r
}
pub fn app(state: AppState) -> Router {
    let assets = std::env::var("WEB_DIST").unwrap_or_else(|_| "web/dist".into());
    Router::new()
        .merge(contract::router())
        .merge(accounts::router())
        .merge(workspace::router())
        .merge(feedback::router())
        .merge(publishing::router())
        .merge(media::router())
        .route(
            "/readyz",
            get(|State(s): State<AppState>| async move {
                sqlx::query("SELECT 1")
                    .execute(&s.db)
                    .await
                    .map(|_| "ready")
                    .map_err(Error::from)
            }),
        )
        .nest_service(
            "/assets",
            tower_http::services::ServeDir::new(format!("{assets}/assets")).precompressed_gzip(),
        )
        .layer(middleware::from_fn(effective_ip))
        .with_state(state)
}
