use super::*;
use axum::{
    body::Bytes,
    extract::{Path, Query},
    http::Method,
    response::{Html, Redirect},
    routing::any,
};
use std::collections::HashMap;
use std::sync::LazyLock;
pub type Params = HashMap<String, String>;
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(app_page))
        .route(
            "/favicon.ico",
            get(|| async { Redirect::permanent("/assets/favicon.png") }),
        )
        .route("/app", get(app_page))
        .route("/app/{*page}", get(app_page))
        .route("/avatar/{seed}", get(avatar))
        .route("/b/{org}/{board}", get(public_page))
        .route("/b/{org}/{board}/p/{post}", get(post_page))
        .route("/api/v1/b/{org}/{board}/{*path}", any(public_action))
}
pub fn label(k: &str, pt: bool) -> String {
    if !pt {
        return k.into();
    }
    match k {
        "Suggestions" => "Sugestões",
        "Under review" => "Em análise",
        "Planned" => "Planejado",
        "In progress" => "Em desenvolvimento",
        "Done" => "Concluído",
        "Declined" => "Recusado",
        "Improvement" => "Melhoria",
        _ => k,
    }
    .into()
}
pub(crate) fn pt(h: &HeaderMap, q: &Params) -> bool {
    q.get("locale")
        .map(String::as_str)
        .or(cookie(h, "pb_lang"))
        .or_else(|| h.get("accept-language").and_then(|v| v.to_str().ok()))
        .unwrap_or("en")
        .starts_with("pt")
}
pub fn author(g: Option<Uuid>, n: Option<&str>, staff: Option<&str>) -> V {
    json!({"name":staff.or(n).unwrap_or(""),"avatar_url":g.map(|v|format!("/avatar/{v}")),"staff":staff.is_some()})
}
pub(crate) async fn find(
    s: &AppState,
    org: &str,
    slug: &str,
    h: &HeaderMap,
) -> Result<(Uuid, String)> {
    let r=sqlx::query("SELECT b.id,b.slug,b.published FROM board_names n JOIN boards b ON b.id=n.board_id JOIN orgs o ON o.id=b.org_id WHERE n.slug=$1 AND o.slug=$2 AND NOT o.suspended AND NOT b.suspended AND o.closed_at IS NULL AND b.closed_at IS NULL").bind(slug).bind(org).fetch_one(&s.db).await?;
    let id = r.get("id");
    if !r.get::<bool, _>("published") && board_access(&s.db, h, id).await?.role.is_none() {
        return Err(Error::not_found());
    }
    Ok((id, r.get("slug")))
}
pub async fn posts(
    db: &PgPool,
    b: Uuid,
    g: Option<Uuid>,
    staff: bool,
    q: &Params,
) -> Result<(Vec<V>, Option<usize>, i64)> {
    let selected_ids = |key: &str| -> Result<Option<Vec<Uuid>>> {
        q.get(key)
            .filter(|v| !v.is_empty())
            .map(|v| v.split(',').map(parse_id).collect())
            .transpose()
    };
    let status = selected_ids("status")?;
    let tag = selected_ids("tag")?;
    let offset = offset(q);
    let limit = q
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(30)
        .clamp(1, 50);
    let where_sql = "p.board_id=$1 AND (p.visibility='published' OR (p.visibility='pending' AND p.guest_id=$2) OR $3) AND p.merged_into IS NULL AND ($4::uuid[] IS NULL OR p.status_id=ANY($4)) AND ($5::uuid[] IS NULL OR p.tag_id=ANY($5)) AND ($6='' OR p.id IN (SELECT id FROM posts WHERE board_id=$1 AND search_terms @@ feedback_prefixes($6))) AND ($7='' OR p.visibility=$7)";
    let sort = match q.get("sort").map(String::as_str) {
        Some("top") => "p.votes DESC",
        Some("new") => "p.created_at DESC",
        Some("status") => "(SELECT position FROM statuses WHERE id=p.status_id),p.votes DESC",
        Some("manual") => {
            "array_position(ARRAY(SELECT jsonb_array_elements_text(COALESCE((SELECT settings->'manual_order' FROM boards WHERE id=$1),'[]'))),p.id::text) NULLS LAST"
        }
        _ => "p.weekly_votes DESC,p.votes DESC",
    };
    let query = format!(
        "SELECT to_jsonb(p)||jsonb_build_object('is_default',(SELECT is_default FROM statuses WHERE id=p.status_id),'voted',EXISTS(SELECT 1 FROM votes WHERE post_id=p.id AND guest_id=$2),'voters',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',v.name,'avatar_url','/avatar/'||v.id)) FROM (SELECT g.id,g.name FROM votes JOIN guests g ON g.id=votes.guest_id WHERE post_id=p.id ORDER BY votes.created_at DESC LIMIT 3)v),'[]'::jsonb)) FROM post_cards p WHERE {where_sql} ORDER BY p.pinned DESC,{sort},p.id LIMIT $8 OFFSET $9"
    );
    let search = q.get("q").map(String::as_str).unwrap_or("");
    let vis = q
        .get("visibility")
        .filter(|v| staff && v.as_str() != "all")
        .map(String::as_str)
        .unwrap_or("");
    let rows = sqlx::query_scalar::<_, V>(&query)
        .bind(b)
        .bind(g)
        .bind(staff)
        .bind(&status)
        .bind(&tag)
        .bind(search)
        .bind(vis)
        .bind(limit + 1)
        .bind(offset)
        .fetch_all(db)
        .await?;
    let next = (rows.len() > limit as usize).then_some(offset as usize + limit as usize);
    let result = rows
        .into_iter()
        .take(limit as usize)
        .map(|p| card(p, g))
        .collect();
    let total = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM post_cards p WHERE {where_sql}"
    ))
    .bind(b)
    .bind(g)
    .bind(staff)
    .bind(status)
    .bind(tag)
    .bind(search)
    .bind(vis)
    .fetch_one(db)
    .await?;
    Ok((result, next, total))
}
pub(crate) fn offset(q: &Params) -> i64 {
    q.get("cursor")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0i64)
        .clamp(0, 10000000)
}
fn card(mut p: V, g: Option<Uuid>) -> V {
    let gid = workspace::opt_id(&p, "guest_id").ok().flatten();
    p["author"] = author(gid, p["guest_name"].as_str(), p["staff_name"].as_str());
    p["author"]["authenticated"] = json!(p["authenticated"] == true || p["staff_name"].is_string());
    p["can_edit"] =
        json!(g.is_some() && gid == g && p["is_default"] == true && p["visibility"] != "hidden");
    p["excerpt"] = json!(
        p["body"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(180)
            .collect::<String>()
    );
    if let Some(m) = p.as_object_mut() {
        m.remove("account_id");
        m.remove("guest_name");
        m.remove("staff_name");
        m.remove("authenticated");
    }
    p
}
pub async fn detail(
    s: &AppState,
    b: Uuid,
    p: Uuid,
    h: &HeaderMap,
    q: &Params,
    staff: bool,
) -> Result<V> {
    let access = board_access(&s.db, h, b).await?;
    let g = guest_id(&s.db, h, access.org_id).await?;
    let row:V=sqlx::query_scalar("SELECT to_jsonb(p)||jsonb_build_object('voted',EXISTS(SELECT 1 FROM votes WHERE post_id=p.id AND guest_id=$3),'is_default',(SELECT is_default FROM statuses WHERE id=p.status_id)) FROM post_cards p WHERE board_id=$1 AND p.id=$2 AND (visibility='published' OR (visibility='pending' AND guest_id=$3) OR $4)").bind(b).bind(p).bind(g).bind(staff).fetch_one(&s.db).await?;
    if let Some(dest) = workspace::opt_id(&row, "merged_into")? {
        let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id=$1 AND board_id=$2 AND visibility='published')").bind(dest).bind(b).fetch_one(&s.db).await?;
        if !active {
            return Err(Error::not_found());
        }
        return Ok(json!({"redirect_id":dest}));
    }
    let mut post = card(row, g);
    post["can_edit"] = json!(
        post["can_edit"] == true && post["is_default"] == true && post["visibility"] != "hidden"
    );
    post["body_html"] = json!(render(val(&post, "body")));
    post["media"]=V::Array(sqlx::query_scalar("SELECT jsonb_build_object('id',id,'url','/api/v1/media/'||id) FROM media WHERE post_id=$1 AND ready AND bound ORDER BY position").bind(p).fetch_all(&s.db).await?);
    let mut comments:Vec<V>=sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'revision',c.revision,'parent_id',c.parent_id,'body',CASE WHEN c.hidden AND NOT $3 THEN '' ELSE c.body END,'hidden',c.hidden,'created_at',c.created_at,'guest_id',c.guest_id,'author',jsonb_build_object('name',coalesce(c.staff_name,g.name,''),'avatar_url','/avatar/'||g.id,'staff',c.staff_name IS NOT NULL,'authenticated',g.account_id IS NOT NULL OR c.staff_name IS NOT NULL),'can_edit',coalesce(c.guest_id=$2,false) AND NOT c.hidden,'likes',(SELECT count(*) FROM likes WHERE comment_id=c.id),'liked',EXISTS(SELECT 1 FROM likes WHERE comment_id=c.id AND guest_id=$2)) FROM comments c LEFT JOIN guests g ON g.id=c.guest_id WHERE post_id=$1 AND (NOT hidden OR $3 OR EXISTS(SELECT 1 FROM comments r WHERE r.parent_id=c.id AND NOT r.hidden)) ORDER BY c.created_at,c.id LIMIT 31 OFFSET $4").bind(p).bind(g).bind(staff).bind(offset(q)).fetch_all(&s.db).await?;
    let next = (comments.len() > 30).then_some(offset(q) + 30);
    comments.truncate(30);
    for c in &mut comments {
        c["body_html"] = json!(render(val(c, "body")));
        if c["hidden"] == true && !staff {
            c["deleted"] = json!(true);
            c["author"] = V::Null;
            c["guest_id"] = V::Null;
            c["can_edit"] = json!(false);
        }
    }
    Ok(json!({"post":post,"comments":comments,"next_cursor":next}))
}
pub async fn board_data(
    s: &AppState,
    b: Uuid,
    h: &HeaderMap,
    q: &Params,
    staff: bool,
) -> Result<V> {
    let access = board_access(&s.db, h, b).await?;
    if !access.public && access.role.is_none() {
        return Err(Error::not_found());
    }
    let mut board:V=sqlx::query_scalar("SELECT to_jsonb(b)||jsonb_build_object('org_slug',o.slug) FROM boards b JOIN orgs o ON o.id=b.org_id WHERE b.id=$1").bind(b).fetch_one(&s.db).await?;
    let g = guest_id(&s.db, h, access.org_id).await?;
    let pt = pt(h, q);
    let mut statuses: Vec<V> = sqlx::query_scalar(
        "SELECT to_jsonb(s) FROM statuses s WHERE board_id=$1 ORDER BY position",
    )
    .bind(b)
    .fetch_all(&s.db)
    .await?;
    let mut tags: Vec<V> =
        sqlx::query_scalar("SELECT to_jsonb(t) FROM tags t WHERE board_id=$1 ORDER BY position")
            .bind(b)
            .fetch_all(&s.db)
            .await?;
    for x in statuses.iter_mut().chain(tags.iter_mut()) {
        if let Some(p) = x["preset"].as_str() {
            x["name"] = json!(label(p, pt));
        }
    }
    let mut listq = q.clone();
    listq
        .entry("sort".into())
        .or_insert_with(|| val(&board["settings"], "sort").into());
    let (posts, next, total) = posts(&s.db, b, g, staff, &listq).await?;
    let mut cols = Vec::new();
    if q.get("view")
        .map(String::as_str)
        .unwrap_or_else(|| val(&board["settings"], "opening_view"))
        == "roadmap"
        || staff
    {
        for st in statuses.iter().filter(|s| {
            s["on_roadmap"] == true
                && (staff
                    || q.get("status").is_none_or(|ids| {
                        ids.is_empty() || ids.split(',').any(|id| id == val(s, "id"))
                    }))
        }) {
            let mut col = q.clone();
            col.insert("status".into(), val(st, "id").into());
            col.insert("sort".into(), "top".into());
            col.remove("cursor");
            let (data, next, n) = self::posts(&s.db, b, g, staff, &col).await?;
            cols.push(json!({"status_id":st["id"],"posts":data,"next_cursor":next,"total":n}));
        }
    }
    let (updates, updates_next_cursor) = publishing::updates(&s.db, b, pt, 0).await?;
    if !staff && let Some(settings) = board["settings"].as_object_mut() {
        settings.remove("manual_order");
    }
    Ok(
        json!({"board":board,"settings":board["settings"],"appearance":board["appearance"],"revision":board["revision"],"statuses":statuses,"tags":tags,"posts":posts,"next_cursor":next,"total":total,"columns":cols,"authenticated":access.account_id.is_some(),"role":access.role,"locale":if pt{"pt-BR"}else{"en"},"updates":updates,"updates_next_cursor":updates_next_cursor}),
    )
}
fn shell(
    entry: &str,
    title: &str,
    locale: &str,
    head: &str,
    content: &str,
    data: &V,
) -> Html<String> {
    let boot = data
        .to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    Html(format!(
        r#"<!doctype html><html lang="{locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{}</title><link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon.png"><link rel="apple-touch-icon" href="/assets/kiska.png">{head}<link rel="stylesheet" href="/assets/{entry}.css"></head><body><div id="root">{content}</div><script>window.__KISKA__={boot}</script><script type="module" src="/assets/{entry}.js"></script></body></html>"#,
        esc(title)
    ))
}
const BRAND_DESCRIPTION: &str =
    "Collect community feedback, vote on ideas, and follow the roadmap.";

fn share_tags(
    origin: &str,
    path: &str,
    title: &str,
    description: &str,
    media: Option<&str>,
) -> String {
    let image = media.unwrap_or("/assets/kiska-share.png");
    let dimensions = if media.is_none() {
        r#"<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="kiska, a great kiskadee with a bright yellow chest">"#
    } else {
        ""
    };
    format!(
        r##"<link rel="canonical" href="{url}"><meta property="og:url" content="{url}"><meta property="og:type" content="website"><meta property="og:site_name" content="kiska"><meta property="og:title" content="{title}"><meta name="description" content="{description}"><meta property="og:description" content="{description}"><meta property="og:image" content="{image}">{dimensions}<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#fbd331">"##,
        url = esc(&format!("{origin}{path}")),
        title = esc(title),
        description = esc(description),
        image = esc(&format!("{origin}{image}"))
    )
}
async fn app_page(State(s): State<AppState>) -> Html<String> {
    let head = format!(
        r#"<meta name="robots" content="noindex">{}"#,
        share_tags(&s.origin, "/", "kiska", BRAND_DESCRIPTION, None)
    );
    shell(
        "workspace",
        "kiska",
        "en",
        &head,
        r#"<main aria-busy="true" aria-label="kiska"></main>"#,
        &V::Null,
    )
}
async fn public_page(
    State(s): State<AppState>,
    Path((o, n)): Path<(String, String)>,
    h: HeaderMap,
    Query(q): Query<Params>,
) -> Result<Response> {
    page(&s, &o, &n, None, &h, &q).await
}
async fn post_page(
    State(s): State<AppState>,
    Path((o, n, p)): Path<(String, String, String)>,
    h: HeaderMap,
    Query(q): Query<Params>,
) -> Result<Response> {
    page(&s, &o, &n, Some(p), &h, &q).await
}
async fn page(
    s: &AppState,
    o: &str,
    n: &str,
    p: Option<String>,
    h: &HeaderMap,
    q: &Params,
) -> Result<Response> {
    let (b, canonical) = find(s, o, n, h).await?;
    let base = format!("/b/{o}/{canonical}");
    let mut data = board_data(s, b, h, q, false).await?;
    let mut title = val(&data["board"], "title").to_string();
    let mut description = val(&data["board"], "description").to_owned();
    let mut body = format!(
        "<main class=\"pb-server\"><h1>{}</h1><p>{}</p>",
        esc(&title),
        esc(&description)
    );
    let mut path = base.clone();
    let mut image = None;
    let show_body = data["settings"]["board_fields"]["body"] != false;
    let show_images = data["settings"]["board_fields"]["images"] != false;
    if let Some(raw) = p {
        let mut pid = parse_id(raw.get(..36).unwrap_or(&raw))?;
        let staff = data["role"].is_string();
        let mut d = detail(s, b, pid, h, q, staff).await?;
        if let Some(r) = workspace::opt_id(&d, "redirect_id")? {
            pid = r;
            d = detail(s, b, pid, h, q, staff).await?
        }
        let post = &d["post"];
        path = format!("{base}/p/{pid}-{}", val(post, "slug"));
        if n != canonical || raw != path.rsplit('/').next().unwrap_or("") {
            return Ok(Redirect::temporary(&path).into_response());
        }
        title = val(post, "title").into();
        if show_body {
            description = val(post, "excerpt").into();
        }
        if show_images && post["visibility"] == "published" {
            image = post["media"][0]["url"].as_str().map(str::to_owned);
        }
        body = format!(
            "<main class=\"pb-server\"><h1>{}</h1><article>{}</article>",
            esc(&title),
            if show_body {
                val(post, "body_html")
            } else {
                ""
            }
        );
        data["detail"] = d;
    } else if n != canonical {
        return Ok(Redirect::temporary(&path).into_response());
    } else {
        let view = q
            .get("view")
            .map(String::as_str)
            .unwrap_or_else(|| val(&data["settings"], "opening_view"));
        if view == "roadmap" {
            for column in data["columns"].as_array().into_iter().flatten() {
                let status = data["statuses"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|st| st["id"] == column["status_id"]);
                body.push_str(&format!(
                    "<section><h2>{}</h2>",
                    esc(status.map(|s| val(s, "name")).unwrap_or(""))
                ));
                for post in column["posts"].as_array().into_iter().flatten() {
                    body.push_str(&format!(
                        "<article><a href=\"{base}/p/{}-{}\">{}</a></article>",
                        val(post, "id"),
                        esc(val(post, "slug")),
                        esc(val(post, "title"))
                    ));
                }
                body.push_str("</section>");
            }
        }
        let items = if view == "roadmap" {
            &V::Null
        } else if view == "updates" {
            &data["updates"]
        } else {
            &data["posts"]
        };
        for item in items.as_array().into_iter().flatten() {
            if view == "updates" {
                body.push_str(&format!(
                    "<article><h2>{}</h2>{}</article>",
                    esc(val(item, "title")),
                    val(item, "body_html")
                ));
            } else {
                body.push_str(&format!(
                    "<article><a href=\"{base}/p/{}-{}\">{}</a><p>{}</p></article>",
                    val(item, "id"),
                    esc(val(item, "slug")),
                    esc(val(item, "title")),
                    if show_body {
                        esc(val(item, "excerpt"))
                    } else {
                        String::new()
                    }
                ));
            }
        }
    }
    body.push_str("</main>");
    let index = if data["board"]["published"] == true && data["settings"]["indexing"] == true {
        "index,follow"
    } else {
        "noindex,nofollow"
    };
    let description = if description.trim().is_empty() {
        if pt(h, q) {
            "Compartilhe ideias, vote em sugestões e acompanhe o roadmap."
        } else {
            BRAND_DESCRIPTION
        }
    } else {
        &description
    };
    let head = format!(
        r#"<meta name="robots" content="{index}">{}"#,
        share_tags(&s.origin, &path, &title, description, image.as_deref())
    );
    let mut res =
        shell("public", &title, val(&data, "locale"), &head, &body, &data).into_response();
    if cookie(h, "pb_browser").is_none() {
        res.headers_mut().append(
            header::SET_COOKIE,
            set_cookie("pb_browser", &token(), 31536000, &s.origin)
                .parse()
                .unwrap(),
        );
    }
    Ok(res)
}
async fn avatar(Path(seed): Path<Uuid>) -> Result<Response> {
    static STYLE: LazyLock<dicebear_core::Style> = LazyLock::new(|| {
        dicebear_core::Style::from_str(dicebear_styles::LORELEI).expect("pinned style")
    });
    let svg = dicebear_core::Avatar::new(&STYLE, json!({"seed":seed.to_string(),"size":64}))
        .map_err(Error::internal)?
        .to_svg()
        .to_owned();
    Ok((
        [
            (header::CONTENT_TYPE, "image/svg+xml"),
            (header::CACHE_CONTROL, "public,max-age=86400"),
        ],
        svg,
    )
        .into_response())
}

async fn participant(
    s: &AppState,
    b: Uuid,
    h: &HeaderMap,
    kind: &str,
    max: i32,
) -> Result<(Uuid, Option<String>, Option<String>)> {
    let a = board_access(&s.db, h, b).await?;
    if !a.public && a.role.is_none() {
        return Err(Error::not_found());
    }
    let (g, c) = ensure_guest(&s.db, h, a.org_id).await?;
    check_ban(&s.db, h, b, g).await?;
    if a.role.is_none() {
        rate(&s.db, h, kind, max, 3600).await?
    }
    let name = if a.role.is_some() {
        sqlx::query_scalar("SELECT name FROM accounts WHERE id=$1")
            .bind(account_id(&s.db, h).await?)
            .fetch_optional(&s.db)
            .await?
    } else {
        None
    };
    Ok((g, c, name))
}
async fn save_guest_name(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    guest: Uuid,
    input: &V,
) -> Result<()> {
    if let Some(name) = input.get("guest_name").and_then(V::as_str) {
        let name = name.trim();
        if name.chars().count() > 40 {
            return Err(Error::bad("invalid_guest_name"));
        }
        sqlx::query("UPDATE guests SET name=$2 WHERE id=$1 AND account_id IS NULL")
            .bind(guest)
            .bind(name)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
pub async fn write_post(
    s: &AppState,
    b: Uuid,
    h: &HeaderMap,
    j: &V,
) -> Result<(V, Option<String>)> {
    let (g, c, staff) = participant(s, b, h, "post", 5).await?;
    let account = account_id(&s.db, h).await?;
    let title = required(j, "title", 3, 120)?;
    let body = required(j, "body", 0, 10000)?;
    let mut tx = s.db.begin().await?;
    let settings: V = sqlx::query_scalar("SELECT settings FROM boards WHERE id=$1 FOR SHARE")
        .bind(b)
        .fetch_one(&mut *tx)
        .await?;
    if staff.is_none() && settings["public_posting"] == false {
        return Err(Error::forbidden());
    }
    let tag = workspace::opt_id(j, "tag_id")?;
    let media = uuid_list(j, "media_ids", 4)?;
    if staff.is_none()
        && ((!body.is_empty() && settings["form_fields"]["body"] == false)
            || (tag.is_some() && settings["form_fields"]["tag"] == false)
            || (!media.is_empty()
                && (settings["guest_uploads"] == false
                    || settings["form_fields"]["images"] == false)))
    {
        return Err(Error::bad("disabled_field"));
    }
    let status=sqlx::query_scalar::<_,Uuid>("SELECT id FROM statuses WHERE board_id=$1 AND (visitor_allowed OR $2) AND ($3::uuid IS NULL OR id=$3) ORDER BY is_default DESC,position LIMIT 1").bind(b).bind(staff.is_some()).bind(workspace::opt_id(j,"status_id")?).fetch_one(&mut *tx).await?;
    let visibility = if staff.is_none() && settings["require_approval"] == true {
        "pending"
    } else {
        "published"
    };
    save_guest_name(&mut tx, g, j).await?;
    let pid:Uuid=sqlx::query_scalar("INSERT INTO posts(board_id,guest_id,account_id,staff_name,title,slug,body,status_id,tag_id,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id").bind(b).bind(g).bind(account).bind(staff).bind(&title).bind(slug(&title)).bind(body).bind(status).bind(tag).bind(visibility).fetch_one(&mut *tx).await?;
    media::bind_post(&mut tx, b, pid, Some(g), account, &media).await?;
    sqlx::query("INSERT INTO outbox(email,subject,body,board_id,staff_id,event_key) SELECT coalesce(a.notification_email,a.email),'kiska · New submission',$2,$1,a.id,'post:'||$3::text||':'||a.id FROM boards b JOIN memberships m ON m.org_id=b.org_id JOIN accounts a ON a.id=m.account_id WHERE b.id=$1 AND m.alerts AND a.closed_at IS NULL").bind(b).bind(&title).bind(pid.to_string()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        json!({"id":pid,"slug":slug(&title),"title":title,"visibility":visibility}),
        c,
    ))
}
pub(crate) fn uuid_list(j: &V, k: &str, max: usize) -> Result<Vec<Uuid>> {
    match j.get(k) {
        None | Some(V::Null) => Ok(vec![]),
        Some(V::Array(xs)) if xs.len() <= max => xs
            .iter()
            .map(|v| parse_id(v.as_str().unwrap_or("")))
            .collect(),
        _ => Err(Error::bad(k)),
    }
}
pub async fn write_comment(
    s: &AppState,
    b: Uuid,
    p: Uuid,
    h: &HeaderMap,
    j: &V,
) -> Result<(V, Option<String>)> {
    let (g, c, name) = participant(s, b, h, "comment", 20).await?;
    let body = required(j, "body", 1, 5000)?;
    let mut tx = s.db.begin().await?;
    sqlx::query("SELECT id FROM posts WHERE board_id=$1 AND id=$2 AND NOT locked AND merged_into IS NULL AND (visibility='published' OR visibility='pending' AND (guest_id=$3 OR $4)) FOR SHARE").bind(b).bind(p).bind(g).bind(name.is_some()).fetch_one(&mut *tx).await?;
    let parent=match workspace::opt_id(j,"parent_id")?{Some(id)=>Some(sqlx::query_scalar::<_,Uuid>("SELECT coalesce(parent_id,id) FROM comments WHERE id=$1 AND post_id=$2 AND NOT hidden").bind(id).bind(p).fetch_one(&mut *tx).await?),None=>None};
    save_guest_name(&mut tx, g, j).await?;
    let cid:Uuid=sqlx::query_scalar("INSERT INTO comments(post_id,guest_id,staff_name,parent_id,body) VALUES($1,$2,$3,$4,$5) RETURNING id").bind(p).bind(g).bind(name).bind(parent).bind(&body).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok((json!({"id":cid,"body":body}), c))
}
async fn public_action(
    State(s): State<AppState>,
    Path((o, n, path)): Path<(String, String, String)>,
    Query(q): Query<Params>,
    h: HeaderMap,
    m: Method,
    bytes: Bytes,
) -> Result<Response> {
    let (b, _) = find(&s, &o, &n, &h).await?;
    let ac = board_access(&s.db, &h, b).await?;
    let path: Vec<_> = path.split('/').collect();
    let j: V = if bytes.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&bytes).map_err(|_| Error::bad("invalid_json"))?
    };
    let mut c = None;
    let mut result = json!({"ok":true});
    match (m.as_str(), path.as_slice()) {
        ("GET", ["posts", pid]) => {
            result = detail(&s, b, parse_id(pid)?, &h, &q, ac.role.is_some()).await?
        }
        ("GET", ["updates"]) => {
            let (entries, next) = publishing::updates(&s.db, b, pt(&h, &q), offset(&q)).await?;
            result = json!({"updates":entries,"next_cursor":next});
        }
        ("GET", ["suggestions"]) => {
            let mut opts = q;
            opts.insert("limit".into(), "5".into());
            let (p, _, _) = posts(&s.db, b, None, false, &opts).await?;
            result = json!({"posts":p});
        }
        ("POST", ["posts"]) => {
            (result, c) = write_post(&s, b, &h, &j).await?;
        }
        ("POST", ["posts", pid, "comments"]) => {
            (result, c) = write_comment(&s, b, parse_id(pid)?, &h, &j).await?;
        }
        ("PUT" | "DELETE", ["posts", pid, "vote"]) => {
            let pid = parse_id(pid)?;
            let (g, ck, _) = participant(&s, b, &h, "vote", 120).await?;
            c = ck;
            let mut tx = s.db.begin().await?;
            sqlx::query("SELECT p.id FROM posts p JOIN boards b ON b.id=p.board_id WHERE p.id=$1 AND p.board_id=$2 AND p.visibility='published' AND p.merged_into IS NULL AND COALESCE((b.settings->>'voting_enabled')::boolean,true) FOR SHARE OF p,b").bind(pid).bind(b).fetch_one(&mut *tx).await?;
            if m == Method::PUT {
                sqlx::query(
                    "INSERT INTO votes(post_id,guest_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
                )
                .bind(pid)
                .bind(g)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query("DELETE FROM votes WHERE post_id=$1 AND guest_id=$2")
                    .bind(pid)
                    .bind(g)
                    .execute(&mut *tx)
                    .await?;
            }
            let num: i64 = sqlx::query_scalar("SELECT count(*) FROM votes WHERE post_id=$1")
                .bind(pid)
                .fetch_one(&mut *tx)
                .await?;
            tx.commit().await?;
            result = json!({"voted":m==Method::PUT,"votes":num});
        }
        ("PUT" | "DELETE", ["comments", cid, "like"]) => {
            let (g, ck, _) = participant(&s, b, &h, "like", 120).await?;
            c = ck;
            let cid = parse_id(cid)?;
            let mut tx = s.db.begin().await?;
            sqlx::query("SELECT c.id FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=$1 AND p.board_id=$2 AND p.visibility='published' AND NOT c.hidden FOR SHARE").bind(cid).bind(b).fetch_one(&mut *tx).await?;
            if m == Method::PUT {
                sqlx::query("INSERT INTO likes VALUES($1,$2) ON CONFLICT DO NOTHING")
                    .bind(cid)
                    .bind(g)
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("DELETE FROM likes WHERE comment_id=$1 AND guest_id=$2")
                    .bind(cid)
                    .bind(g)
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
        }
        ("PATCH" | "DELETE", ["posts", pid]) => {
            let (g, ck, _) = participant(&s, b, &h, "post_edit", 60).await?;
            c = ck;
            let mut tx = s.db.begin().await?;
            let pid = parse_id(pid)?;
            let original=sqlx::query("SELECT p.body,p.tag_id,b.settings FROM posts p JOIN statuses st ON st.id=p.status_id JOIN boards b ON b.id=p.board_id WHERE p.id=$1 AND p.board_id=$2 AND p.guest_id=$3 AND p.visibility<>'hidden' AND st.is_default AND p.merged_into IS NULL FOR UPDATE OF p FOR SHARE OF b")
                .bind(pid).bind(b).bind(g).fetch_one(&mut *tx).await?;
            if m == Method::DELETE {
                sqlx::query("UPDATE posts SET visibility='hidden' WHERE id=$1")
                    .bind(pid)
                    .execute(&mut *tx)
                    .await?;
            } else {
                let title = required(&j, "title", 3, 120)?;
                let settings: V = original.get("settings");
                let old_body: String = original.get("body");
                let old_tag: Option<Uuid> = original.get("tag_id");
                let body = if j.get("body").is_some() {
                    required(&j, "body", 0, 10000)?
                } else {
                    old_body.clone()
                };
                let tag = if j.get("tag_id").is_some() {
                    workspace::opt_id(&j, "tag_id")?
                } else {
                    old_tag
                };
                if ac.role.is_none()
                    && ((settings["form_fields"]["body"] == false && old_body != body)
                        || (settings["form_fields"]["tag"] == false && old_tag != tag))
                {
                    return Err(Error::bad("disabled_field"));
                }
                sqlx::query("UPDATE posts SET title=$2,slug=$3,body=$4,tag_id=$5 WHERE id=$1")
                    .bind(pid)
                    .bind(&title)
                    .bind(slug(&title))
                    .bind(body)
                    .bind(tag)
                    .execute(&mut *tx)
                    .await?;
                if j.get("media_ids").is_some() {
                    let ids = uuid_list(&j, "media_ids", 4)?;
                    media::bind_post(&mut tx, b, pid, Some(g), account_id(&s.db, &h).await?, &ids)
                        .await?;
                }
            }
            tx.commit().await?;
        }
        ("PATCH" | "DELETE", ["comments", cid]) => {
            let (g, ck, _) = participant(&s, b, &h, "comment_edit", 120).await?;
            c = ck;
            sqlx::query("UPDATE comments c SET body=$4,hidden=$5 FROM posts p WHERE c.id=$1 AND c.post_id=p.id AND p.board_id=$2 AND c.guest_id=$3 AND NOT c.hidden AND p.visibility<>'hidden' RETURNING c.id").bind(parse_id(cid)?).bind(b).bind(g).bind(if m==Method::DELETE{String::new()}else{required(&j,"body",1,5000)?}).bind(m==Method::DELETE).fetch_one(&s.db).await?;
        }
        ("GET", ["guest"]) => {
            let g = guest_id(&s.db, &h, ac.org_id).await?;
            result = if let Some(g) = g {
                sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'avatar_url','/avatar/'||id) FROM guests WHERE id=$1").bind(g).fetch_one(&s.db).await?
            } else {
                json!({"name":"","avatar_url":null})
            }
        }
        ("PATCH", ["guest"]) => {
            if ac.account_id.is_some() {
                return Err(Error::forbidden());
            }
            let (g, ck, _) = participant(&s, b, &h, "profile", 60).await?;
            c = ck;
            let name = required(&j, "name", 0, 40)?;
            sqlx::query("UPDATE guests SET name=$2 WHERE id=$1")
                .bind(g)
                .bind(&name)
                .execute(&s.db)
                .await?;
            result = author(Some(g), Some(&name), None);
        }
        ("POST", ["guest", "recovery"]) => {
            if ac.account_id.is_some() {
                return Err(Error::bad("use_account_recovery"));
            }
            let (g, ck, _) = participant(&s, b, &h, "recovery", 20).await?;
            c = ck;
            let t = token();
            sqlx::query("UPDATE guests SET recovery=$2 WHERE id=$1")
                .bind(g)
                .bind(hash(&t))
                .execute(&s.db)
                .await?;
            result = json!({"token":t,"url":format!("{}/b/{o}/{n}#recover={t}",s.origin)});
        }
        ("POST", ["guest", "recover"]) => {
            if ac.account_id.is_some() {
                return Err(Error::bad("use_account_recovery"));
            }
            rate(&s.db, &h, "guest_recover", 30, 900).await?;
            let t = token();
            let mut tx = s.db.begin().await?;
            let g: Uuid = sqlx::query_scalar(
                "UPDATE guests SET recovery=NULL WHERE org_id=$1 AND account_id IS NULL AND recovery=$2 RETURNING id",
            )
            .bind(ac.org_id)
            .bind(hash(val(&j, "token")))
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query("INSERT INTO guest_devices(token,guest_id) VALUES($1,$2)")
                .bind(hash(&format!("{}:{t}", ac.org_id)))
                .bind(g)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            c = Some(set_cookie(
                &format!("pb_g_{}", ac.org_id),
                &t,
                31536000,
                &s.origin,
            ));
        }
        ("POST", ["subscribe"]) => {
            rate(&s.db, &h, "subscribe", 20, 3600).await?;
            publishing::subscribe(&s, b, &j).await?;
        }
        _ => return Err(Error::not_found()),
    }
    Ok(response_cookie(result, c))
}
