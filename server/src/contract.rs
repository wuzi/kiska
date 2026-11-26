use super::*;
use axum::extract::{Path, Query};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

#[derive(Deserialize, Serialize, ToSchema)]
pub struct PostInput {
    pub guest_name: Option<String>,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub tag_id: Option<Uuid>,
    pub status_id: Option<Uuid>,
    #[serde(default)]
    pub media_ids: Vec<Uuid>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct PostCreated {
    id: Uuid,
    title: String,
    slug: String,
    visibility: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct BoardSummary {
    pub id: Uuid,
    pub org_id: Uuid,
    pub org_slug: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub published: bool,
    pub logo_id: Option<Uuid>,
    pub cover_id: Option<Uuid>,
    pub settings: V,
    pub appearance: V,
    pub revision: i32,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ActorSummary {
    pub authenticated: bool,
    pub name: String,
    pub avatar_url: Option<String>,
    pub staff: bool,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Label {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub position: i32,
    pub preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_roadmap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visitor_allowed: Option<bool>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct PostSummary {
    pub revision: i32,
    pub id: Uuid,
    pub title: String,
    pub slug: String,
    pub body: String,
    pub excerpt: String,
    pub status_id: Uuid,
    pub tag_id: Option<Uuid>,
    pub pinned: bool,
    pub locked: bool,
    pub visibility: String,
    pub votes: i64,
    pub voted: bool,
    pub weekly_votes: i64,
    pub voters: Vec<V>,
    pub author: ActorSummary,
    pub comment_count: i64,
    pub can_edit: bool,
    pub created_at: String,
    pub team_response: String,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct RoadmapColumn {
    pub status_id: Uuid,
    pub posts: Vec<PostSummary>,
    pub total: i64,
    pub next_cursor: Option<i64>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct PublicPage {
    pub authenticated: bool,
    pub board: BoardSummary,
    pub statuses: Vec<Label>,
    pub tags: Vec<Label>,
    pub posts: Vec<PostSummary>,
    pub columns: Vec<RoadmapColumn>,
    pub total: i64,
    pub locale: String,
    pub role: Option<String>,
    pub updates: Vec<V>,
    pub updates_next_cursor: Option<i64>,
    pub next_cursor: Option<i64>,
}
#[utoipa::path(get,path="/healthz",responses((status=200,body=String)))]
async fn health() -> &'static str {
    "ok"
}
#[utoipa::path(get,path="/api/v1/b/{org}/{board}",params(("org"=String,Path),("board"=String,Path)),responses((status=200,body=PublicPage),(status=404)))]
async fn public_board(
    State(s): State<AppState>,
    Path((o, n)): Path<(String, String)>,
    h: HeaderMap,
    Query(q): Query<feedback::Params>,
) -> Result<Json<PublicPage>> {
    let (b, _) = feedback::find(&s, &o, &n, &h).await?;
    let v = feedback::board_data(&s, b, &h, &q, false).await?;
    Ok(Json(serde_json::from_value(v).map_err(Error::internal)?))
}
#[utoipa::path(post,path="/api/v1/b/{org}/{board}/posts",params(("org"=String,Path),("board"=String,Path)),request_body=PostInput,responses((status=200,body=PostCreated),(status=403)))]
async fn submit(
    State(s): State<AppState>,
    Path((o, n)): Path<(String, String)>,
    h: HeaderMap,
    Json(input): Json<PostInput>,
) -> Result<Response> {
    let (b, _) = feedback::find(&s, &o, &n, &h).await?;
    let (v, c) = feedback::write_post(
        &s,
        b,
        &h,
        &serde_json::to_value(input).map_err(Error::internal)?,
    )
    .await?;
    Ok(response_cookie(v, c))
}
fn registered() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(health))
        .routes(routes!(public_board))
        .routes(routes!(submit))
}
pub fn router() -> Router<AppState> {
    registered().split_for_parts().0
}
mod operations;
pub fn spec() -> String {
    operations::generate(registered().split_for_parts().1)
}
