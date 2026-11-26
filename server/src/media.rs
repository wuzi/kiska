use std::{collections::HashSet, env, io::Cursor, sync::OnceLock, time::Duration};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits, imageops::FilterType};
use s3::{Bucket, Region, creds::Credentials};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{AppState, Error, account_id, board_access, check_ban, ensure_guest, guest_id};

const MAX_INPUT: usize = 5 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_EDGE: u32 = 2560;
const PRIVATE_CACHE: &str = "private, no-store";
static DECODERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/boards/{b}/media",
            post(upload).layer(DefaultBodyLimit::max(MAX_INPUT)),
        )
        .route("/api/v1/media/{id}", get(read).delete(remove))
}

#[derive(Deserialize)]
struct UploadQuery {
    kind: Option<String>,
}

#[derive(Serialize)]
struct Uploaded {
    id: Uuid,
    url: String,
    bytes: i64,
}

struct Store {
    internal: Box<Bucket>,
    public: Box<Bucket>,
    grant_seconds: u32,
}

fn store() -> Result<&'static Store, Error> {
    static STORE: OnceLock<Store> = OnceLock::new();
    if let Some(store) = STORE.get() {
        return Ok(store);
    }
    let required = |name| env::var(name).map_err(|_| Error::internal(format!("missing {name}")));
    let key = required("AWS_ACCESS_KEY_ID")?;
    let secret = required("AWS_SECRET_ACCESS_KEY")?;
    let name = required("S3_BUCKET")?;
    let region = env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".into());
    let credentials =
        Credentials::new(Some(&key), Some(&secret), None, None, None).map_err(Error::internal)?;
    let bucket = |endpoint| {
        Bucket::new(
            &name,
            Region::Custom {
                region: region.clone(),
                endpoint,
            },
            credentials.clone(),
        )?
        .with_path_style()
        .with_request_timeout(Duration::from_secs(20))
    };
    let internal = bucket(required("S3_ENDPOINT")?).map_err(Error::internal)?;
    let public = bucket(required("S3_PUBLIC_ORIGIN")?).map_err(Error::internal)?;
    let grant_seconds = env::var("S3_GRANT_SECONDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300u32)
        .clamp(1, 300);
    Ok(STORE.get_or_init(|| Store {
        internal,
        public,
        grant_seconds,
    }))
}

fn encode_image(bytes: &[u8]) -> Result<Vec<u8>, Error> {
    let format =
        image::guess_format(bytes).map_err(|_| Error::bad("Choose a PNG, JPEG, or WebP image"))?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err(Error::bad("Choose a PNG, JPEG, or WebP image"));
    }
    let invalid = |_| Error::bad("Invalid or oversized image");
    let mut limits = Limits::default();
    limits.max_alloc = Some(384 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits.clone());
    let mut decoder = reader.into_decoder().map_err(invalid)?;
    let (w, h) = decoder.dimensions();
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(Error::bad("Images must be at most 40 megapixels"));
    }
    limits.reserve(decoder.total_bytes()).map_err(invalid)?;
    decoder.set_limits(limits).map_err(invalid)?;
    let orientation = decoder.orientation().map_err(invalid)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(invalid)?;
    if w.max(h) > MAX_EDGE {
        image = image.resize(MAX_EDGE, MAX_EDGE, FilterType::Triangle);
    }
    image.apply_orientation(orientation);
    loop {
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image.to_rgba8())
            .write_to(&mut output, ImageFormat::WebP)
            .map_err(Error::internal)?;
        if output.get_ref().len() <= MAX_INPUT {
            return Ok(output.into_inner());
        }
        image = image.thumbnail((image.width() / 2).max(1), (image.height() / 2).max(1));
    }
}

async fn upload(
    State(state): State<AppState>,
    Path(board): Path<Uuid>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Error> {
    let access = board_access(&state.db, &headers, board).await?;
    let kind = query.kind.as_deref().unwrap_or("post");
    if !matches!(kind, "post" | "logo" | "cover") {
        return Err(Error::bad("Unknown image purpose"));
    }
    let (account, guest, cookie) = match access.role.as_deref() {
        Some(role) => {
            if kind != "post" && !matches!(role, "admin" | "owner") {
                return Err(Error::forbidden());
            }
            let account = account_id(&state.db, &headers)
                .await?
                .ok_or_else(Error::forbidden)?;
            (Some(account), None, None)
        }
        None => {
            if !access.public || kind != "post" {
                return Err(Error::forbidden());
            }
            let enabled: bool = sqlx::query_scalar("SELECT coalesce((settings->>'guest_uploads')::boolean,true) AND coalesce((settings->>'public_posting')::boolean,true) AND coalesce((settings->'form_fields'->>'images')::boolean,true) FROM boards WHERE id=$1")
                .bind(board).fetch_one(&state.db).await?;
            if !enabled {
                return Err(Error::forbidden());
            }
            let (id, cookie) = ensure_guest(&state.db, &headers, access.org_id).await?;
            check_ban(&state.db, &headers, board, id).await?;
            (None, Some(id), cookie)
        }
    };
    crate::rate(&state.db, &headers, "upload", 60, 3600).await?;
    // Skip decoding when no space remains. The transaction below reserves the actual encoded size.
    let full:bool = sqlx::query_scalar(
        "SELECT o.media_limit <= (SELECT COALESCE(sum(m.bytes),0) FROM media m JOIN boards b ON b.id=m.board_id WHERE b.org_id=o.id) FROM orgs o WHERE o.id=$1"
    ).bind(access.org_id).fetch_one(&state.db).await?;
    if full {
        return Err(Error::bad("Organization media allowance reached"));
    }

    let storage = store()?;
    let permit = tokio::time::timeout(Duration::from_secs(15), DECODERS.acquire())
        .await
        .map_err(|_| {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Image processing is busy. Try again shortly".into(),
            )
        })?
        .map_err(Error::internal)?;
    let bytes = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        encode_image(&body)
    })
    .await
    .map_err(Error::internal)??;
    let size = bytes.len() as i64;
    let id = Uuid::new_v4();
    let key = format!("{}/{}/{}.webp", access.org_id, board, id);

    // Commit the reservation before writing the object. A crash leaves a durable
    // record that expires through the same path as an abandoned compose form.
    let mut tx = state.db.begin().await?;
    let limit: i64 = sqlx::query_scalar("SELECT media_limit FROM orgs WHERE id=$1 FOR UPDATE")
        .bind(access.org_id)
        .fetch_one(&mut *tx)
        .await?;
    let used: i64 = sqlx::query_scalar("SELECT coalesce(sum(m.bytes),0)::bigint FROM media m JOIN boards b ON b.id=m.board_id WHERE b.org_id=$1")
        .bind(access.org_id).fetch_one(&mut *tx).await?;
    if size > limit.saturating_sub(used) {
        return Err(Error::bad("Organization media allowance reached"));
    }
    sqlx::query("INSERT INTO media(id,board_id,kind,object_key,bytes,account_id,guest_id) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(id).bind(board).bind(kind).bind(&key).bind(size).bind(account).bind(guest).execute(&mut *tx).await?;
    tx.commit().await?;
    let mut tx = state.db.begin().await?;
    sqlx::query_scalar::<_, Uuid>("SELECT id FROM media WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let mut writer = storage.internal.clone();
    writer.add_header("Cache-Control", PRIVATE_CACHE);
    let result = writer
        .put_object_with_content_type(&key, &bytes, "image/webp")
        .await;
    match result {
        Ok(response) if (200..300).contains(&response.status_code()) => {
            sqlx::query("UPDATE media SET ready=true WHERE id=$1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
        }
        _ => {
            sqlx::query("DELETE FROM media WHERE id=$1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(Error::internal("Image storage unavailable"));
        }
    }
    let mut response = (
        StatusCode::CREATED,
        Json(Uploaded {
            id,
            url: format!("/api/v1/media/{id}"),
            bytes: size,
        }),
    )
        .into_response();
    if let Some(cookie) = cookie {
        response.headers_mut().append(
            header::SET_COOKIE,
            HeaderValue::from_str(&cookie).map_err(Error::internal)?,
        );
    }
    Ok(response)
}

#[derive(sqlx::FromRow)]
struct Item {
    board_id: Uuid,
    object_key: String,
    bound: bool,
    kind: String,
    account_id: Option<Uuid>,
    guest_id: Option<Uuid>,
    visibility: Option<String>,
    post_guest: Option<Uuid>,
}

async fn item(db: &PgPool, id: Uuid) -> Result<Item, Error> {
    sqlx::query_as("SELECT m.board_id,m.object_key,m.bound,m.kind,m.account_id,m.guest_id,CASE WHEN p.merged_into IS NULL THEN p.visibility END AS visibility,p.guest_id AS post_guest FROM media m LEFT JOIN posts p ON p.id=m.post_id AND p.board_id=m.board_id WHERE m.id=$1 AND m.ready")
        .bind(id).fetch_optional(db).await?.ok_or_else(Error::not_found)
}

async fn read(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, Error> {
    let item = item(&state.db, id).await?;
    let access = board_access(&state.db, &headers, item.board_id).await?;
    let published = item.bound
        && access.public
        && (item.kind != "post" || item.visibility.as_deref() == Some("published"));
    let storage = store()?;
    let mut response = if published {
        let url = storage
            .public
            .presign_get(&item.object_key, storage.grant_seconds, None)
            .await
            .map_err(Error::internal)?;
        Redirect::temporary(&url).into_response()
    } else {
        if access.role.is_none() {
            let guest = guest_id(&state.db, &headers, access.org_id).await?;
            let visible = !item.bound && guest.is_some() && item.guest_id == guest
                || item.visibility.as_deref() == Some("pending")
                    && guest.is_some()
                    && guest == item.post_guest;
            if !access.public || !visible {
                return Err(Error::not_found());
            }
        } else if !item.bound
            && (item.account_id.is_none()
                || item.account_id != account_id(&state.db, &headers).await?)
        {
            return Err(Error::not_found());
        }
        let response = storage
            .internal
            .get_object(&item.object_key)
            .await
            .map_err(Error::internal)?;
        if response.status_code() != 200 {
            return Err(Error::internal("Image unavailable"));
        }
        (
            [
                (header::CONTENT_TYPE, "image/webp"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            response.into_bytes(),
        )
            .into_response()
    };
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(PRIVATE_CACHE),
    );
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Cookie"));
    Ok(response)
}

async fn remove(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, Error> {
    let item = item(&state.db, id).await?;
    let access = board_access(&state.db, &headers, item.board_id).await?;
    if access.role.is_none() {
        let guest = guest_id(&state.db, &headers, access.org_id)
            .await?
            .ok_or_else(Error::not_found)?;
        if !access.public || item.bound || Some(guest) != item.guest_id {
            return Err(Error::not_found());
        }
        check_ban(&state.db, &headers, item.board_id, guest).await?;
        sqlx::query("DELETE FROM media WHERE id=$1 AND NOT bound AND guest_id=$2")
            .bind(id)
            .bind(guest)
            .execute(&state.db)
            .await?;
    } else {
        if item.kind != "post" && !matches!(access.role.as_deref(), Some("owner" | "admin")) {
            return Err(Error::forbidden());
        }
        sqlx::query("DELETE FROM media WHERE id=$1")
            .bind(id)
            .execute(&state.db)
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Apply the post's complete ordered image list inside the post creation or edit transaction.
pub async fn bind_post(
    tx: &mut Transaction<'_, Postgres>,
    board: Uuid,
    post: Uuid,
    guest: Option<Uuid>,
    account: Option<Uuid>,
    ids: &[Uuid],
) -> Result<(), Error> {
    if ids.len() > 4 || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
        return Err(Error::bad("Choose up to four distinct images"));
    }
    // The caller holds the post row lock. Free occupied slots before a reorder;
    // no other transaction can observe the intermediate unbound state.
    sqlx::query("DELETE FROM media WHERE board_id=$1 AND post_id=$2 AND NOT(id=ANY($3))")
        .bind(board)
        .bind(post)
        .bind(ids)
        .execute(&mut **tx)
        .await?;
    if ids.is_empty() {
        return Ok(());
    }
    let retained: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE media SET bound=false,post_id=NULL WHERE board_id=$1 AND post_id=$2 RETURNING id",
    )
    .bind(board)
    .bind(post)
    .fetch_all(&mut **tx)
    .await?;
    let updated = sqlx::query(
        "UPDATE media m SET bound=true,post_id=$2,position=(requested.ordinality-1)::smallint
         FROM unnest($1::uuid[]) WITH ORDINALITY AS requested(id,ordinality)
         JOIN posts p ON p.id=$2 AND p.board_id=$3
         JOIN boards b ON b.id=p.board_id
         WHERE m.id=requested.id AND m.board_id=b.id AND m.kind='post' AND NOT m.bound AND m.ready
           AND (m.id=ANY($6) OR
               (m.account_id=$4 AND EXISTS (
                   SELECT 1 FROM memberships WHERE org_id=b.org_id AND account_id=$4)) OR
               (m.guest_id=$5 AND coalesce((b.settings->>'guest_uploads')::boolean,true)
                AND coalesce((b.settings->'form_fields'->>'images')::boolean,true)))",
    )
    .bind(ids)
    .bind(post)
    .bind(board)
    .bind(account)
    .bind(guest)
    .bind(&retained)
    .execute(&mut **tx)
    .await?;
    if updated.rows_affected() != ids.len() as u64 {
        return Err(Error::bad("Image unavailable for this post"));
    }
    Ok(())
}

/// Replace one branding slot inside the board's version-checked save transaction.
pub async fn bind_brand(
    tx: &mut Transaction<'_, Postgres>,
    board: Uuid,
    account: Uuid,
    kind: &str,
    id: Option<Uuid>,
) -> Result<(), Error> {
    if !matches!(kind, "logo" | "cover") {
        return Err(Error::bad("Unknown branding slot"));
    }
    sqlx::query(
        "DELETE FROM media WHERE board_id=$1 AND kind=$2 AND bound AND id IS DISTINCT FROM $3",
    )
    .bind(board)
    .bind(kind)
    .bind(id)
    .execute(&mut **tx)
    .await?;
    if let Some(id) = id {
        let rows = sqlx::query("UPDATE media SET bound=true WHERE id=$1 AND board_id=$2 AND kind=$3 AND ready AND (bound OR account_id=$4)")
            .bind(id).bind(board).bind(kind).bind(account).execute(&mut **tx).await?;
        if rows.rows_affected() != 1 {
            return Err(Error::bad("Image unavailable for this board"));
        }
    }
    Ok(())
}

pub async fn cleanup(db: &PgPool) -> Result<(), Error> {
    sqlx::query("DELETE FROM media WHERE id IN (SELECT id FROM media WHERE NOT bound AND created_at <= now()-interval '24 hours' ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)")
        .execute(db).await?;
    for _ in 0..32 {
        let mut tx = db.begin().await?;
        let Some(key) = sqlx::query_scalar::<_,String>("SELECT object_key FROM media_deletions WHERE next_attempt <= now() ORDER BY next_attempt LIMIT 1 FOR UPDATE SKIP LOCKED")
            .fetch_optional(&mut *tx).await? else { break; };
        let result = store()?.internal.delete_object(&key).await;
        if result.is_ok_and(|r| (200..300).contains(&r.status_code()) || r.status_code() == 404) {
            sqlx::query("DELETE FROM media_deletions WHERE object_key=$1")
                .bind(&key)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("UPDATE media_deletions SET next_attempt=now()+interval '1 minute' WHERE object_key=$1").bind(&key).execute(&mut *tx).await?;
            tx.commit().await?;
            // Keep mail delivery responsive when storage is offline.
            break;
        }
        tx.commit().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_overlarge_dimensions_before_pixel_decode() {
        // Valid PNG header declaring 50 MP; its deliberately short pixel data must never be decoded.
        let png = hex::decode("89504e470d0a1a0a0000000d49484452000027100000138808020000009835e01f0000000949444154789cab000000790079a5316cf30000000049454e44ae426082").unwrap();
        assert_eq!(
            encode_image(&png).unwrap_err().1,
            "Images must be at most 40 megapixels"
        );
    }

    #[test]
    fn rejects_non_images_and_reencodes_without_metadata() {
        assert!(encode_image(b"plain text").is_err());
        let mut fixture = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(10, 10)
            .write_to(&mut fixture, ImageFormat::Png)
            .unwrap();
        let mut bytes = fixture.into_inner();
        bytes.extend_from_slice(b"private-metadata-trailer");
        let output = encode_image(&bytes).ok().unwrap();
        assert_eq!(image::guess_format(&output).unwrap(), ImageFormat::WebP);
        assert!(!output.windows(8).any(|s| s == b"metadata"));
        let mut fixture = Cursor::new(Vec::new());
        DynamicImage::new_rgba8(MAX_EDGE + 10, 1)
            .write_to(&mut fixture, ImageFormat::Png)
            .unwrap();
        let output = encode_image(&fixture.into_inner()).ok().unwrap();
        assert_eq!(image::load_from_memory(&output).unwrap().width(), MAX_EDGE);
    }
}
