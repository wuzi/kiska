//! Contract for dispatchers sharing a handler across an operation family.
use super::*;
use serde_json::{Value, json};
use utoipa::OpenApi;

#[allow(dead_code)]
#[derive(ToSchema)]
struct Account {
    id: Uuid,
    name: String,
    display_name: String,
    email: String,
    verified: bool,
    notification_email: Option<String>,
    pending_notification_email: Option<String>,
    operator: bool,
    org_limit: i32,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct Organization {
    id: Uuid,
    name: String,
    slug: String,
    owner_id: Uuid,
    board_limit: i32,
    seat_limit: i32,
    media_limit: i64,
    suspended: bool,
    closed_at: Option<String>,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct CurrentAccount {
    user: Option<Account>,
    organizations: Vec<Organization>,
    operator: bool,
    owned_count: Option<i64>,
    owned_limit: Option<i32>,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct Usage {
    board_count: i64,
    board_limit: i32,
    seat_count: i64,
    seat_limit: i32,
    media_bytes: i64,
    media_limit: i64,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct OrganizationHome {
    organization: Organization,
    boards: Vec<BoardSummary>,
    members: Vec<V>,
    folders: Vec<V>,
    usage: Usage,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct BoardDraft {
    revision: i32,
    title: String,
    description: String,
    slug: String,
    settings: V,
    appearance: V,
    statuses: Option<Vec<Label>>,
    tags: Option<Vec<Label>>,
    logo_id: Option<Uuid>,
    cover_id: Option<Uuid>,
    reassignments: Option<std::collections::BTreeMap<String, Uuid>>,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct CommentInput {
    guest_name: Option<String>,
    body: String,
    parent_id: Option<Uuid>,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct Comment {
    revision: i32,
    id: Uuid,
    parent_id: Option<Uuid>,
    author: Option<ActorSummary>,
    body: String,
    body_html: String,
    created_at: String,
    can_edit: bool,
    hidden: bool,
    liked: bool,
    likes: i64,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct PostDetail {
    post: PostSummary,
    comments: Vec<Comment>,
    next_cursor: Option<i64>,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct UpdateInput {
    revision: Option<i32>,
    title: String,
    body: String,
    post_ids: Option<Vec<Uuid>>,
    operation_id: Uuid,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct ModerationInput {
    revision: Option<i32>,
    action: String,
    post_id: Option<Uuid>,
    guest_id: Option<Uuid>,
    target_id: Option<Uuid>,
    status_id: Option<Uuid>,
    comment_id: Option<Uuid>,
    media_id: Option<Uuid>,
    body: Option<String>,
    title: Option<String>,
    scope: Option<String>,
    ip_ban: Option<bool>,
    update: Option<UpdateInput>,
}
#[allow(dead_code)]
#[derive(ToSchema)]
struct UploadedMedia {
    id: Uuid,
    url: String,
    bytes: i64,
}
#[derive(OpenApi)]
#[openapi(components(schemas(
    Account,
    Organization,
    CurrentAccount,
    Usage,
    OrganizationHome,
    BoardDraft,
    CommentInput,
    Comment,
    PostDetail,
    UpdateInput,
    ModerationInput,
    UploadedMedia
)))]
struct WorkspaceContracts;

fn reference(name: &str) -> V {
    json!({"$ref":format!("#/components/schemas/{name}")})
}
fn fields(names: &str) -> V {
    let mut props = serde_json::Map::new();
    let mut required = Vec::new();
    for key in names.split_whitespace() {
        let optional = key.ends_with('?');
        let k = key.trim_end_matches('?');
        props.insert(k.into(), json!({"type":"string"}));
        if !optional {
            required.push(k)
        }
    }
    json!({"type":"object","properties":props,"required":required})
}
pub(super) fn generate(mut api: utoipa::openapi::OpenApi) -> String {
    api.merge(WorkspaceContracts::openapi());
    let mut doc = serde_json::to_value(api).expect("serialize contract");
    doc["info"] = json!({"title":"kiska API","description":"Community feedback boards and roadmaps","version":env!("CARGO_PKG_VERSION")});
    let any = json!({"type":"object","additionalProperties":true});
    let success = json!({"type":"object","properties":{"ok":{"type":"boolean"}}});
    let mut put = |method: &str, path: &str, input: Option<V>, output: V| {
        let path = format!("/api/v1{path}");
        let params: Vec<V> = path
            .split('/')
            .filter_map(|s| s.strip_prefix('{')?.strip_suffix('}'))
            .map(|s| json!({"name":s,"in":"path","required":true,"schema":{"type":"string"}}))
            .collect();
        let mut op = json!({"parameters":params,"responses":{"200":{"description":"Success","content":{"application/json":{"schema":output}}},"default":{"description":"Request failed","content":{"application/json":{"schema":{"type":"object","required":["code"],"properties":{"code":{"type":"string"},"message":{"type":"string"}}}}}}}});
        if let Some(v) = input {
            op["requestBody"] = json!({"required":true,"content":{"application/json":{"schema":v}}})
        }
        doc["paths"][path][method] = op;
    };
    for (flow, params) in [
        ("register", "email password name"),
        ("login", "email password"),
        ("forgot", "email"),
        ("reset", "token password"),
        ("verify", "token"),
        ("verify-notification", "token"),
        ("invite", "token"),
        ("recover-account", "token"),
        ("logout", ""),
    ] {
        put(
            "post",
            &format!("/auth/{flow}"),
            Some(fields(params)),
            success.clone(),
        )
    }
    put("get", "/me", None, reference("CurrentAccount"));
    put(
        "patch",
        "/me",
        Some(fields("name? notification_email?")),
        reference("CurrentAccount"),
    );
    put(
        "delete",
        "/me",
        Some(
            json!({"type":"object","properties":{"close_organization_ids":{"type":"array","items":{"type":"string","format":"uuid"}}}}),
        ),
        any.clone(),
    );
    put(
        "post",
        "/organizations",
        Some(fields("name slug?")),
        reference("Organization"),
    );
    put(
        "get",
        "/organizations/{org_id}",
        None,
        reference("OrganizationHome"),
    );
    for (verb, end, input) in [
        (
            "post",
            "boards",
            fields("title slug? description? folder_id?"),
        ),
        ("post", "folders", fields("name")),
        ("patch", "folders/{folder_id}", any.clone()),
        ("delete", "folders/{folder_id}", Value::Null),
        ("post", "invitations", fields("email role")),
        ("patch", "members/{member_id}", any.clone()),
        ("delete", "members/{member_id}", Value::Null),
        ("post", "transfer", fields("user_id")),
        ("post", "close", Value::Null),
        ("post", "restore", Value::Null),
    ] {
        put(
            verb,
            &format!("/organizations/{{org_id}}/{end}"),
            (!input.is_null()).then_some(input),
            any.clone(),
        )
    }
    let b = "/boards/{board_id}";
    put("get", b, None, any.clone());
    put("put", b, Some(reference("BoardDraft")), success.clone());
    for (verb, end, input, output) in [
        ("post", "publish", Value::Null, success.clone()),
        ("post", "close", Value::Null, success.clone()),
        ("post", "restore", Value::Null, success.clone()),
        ("put", "pin", any.clone(), success.clone()),
        ("patch", "position", any.clone(), success.clone()),
        ("get", "posts", Value::Null, any.clone()),
        ("get", "updates", Value::Null, any.clone()),
        (
            "post",
            "posts",
            reference("PostInput"),
            reference("PostCreated"),
        ),
        (
            "get",
            "posts/{post_id}",
            Value::Null,
            reference("PostDetail"),
        ),
        ("get", "posts/{post_id}/votes", Value::Null, any.clone()),
        (
            "post",
            "posts/{post_id}/comments",
            reference("CommentInput"),
            any.clone(),
        ),
        (
            "post",
            "moderate",
            reference("ModerationInput"),
            success.clone(),
        ),
        ("post", "updates", reference("UpdateInput"), success.clone()),
        (
            "patch",
            "updates/{update_id}",
            reference("UpdateInput"),
            success.clone(),
        ),
        (
            "delete",
            "updates/{update_id}",
            json!({"type":"object","required":["revision"],"properties":{"revision":{"type":"integer"}}}),
            success.clone(),
        ),
    ] {
        put(
            verb,
            &format!("{b}/{end}"),
            (!input.is_null()).then_some(input),
            output,
        )
    }
    let base = "/b/{org}/{board}";
    for (verb, end, input, output) in [
        ("get", "suggestions", Value::Null, any.clone()),
        ("get", "updates", Value::Null, any.clone()),
        (
            "get",
            "posts/{post_id}",
            Value::Null,
            reference("PostDetail"),
        ),
        (
            "patch",
            "posts/{post_id}",
            reference("PostInput"),
            success.clone(),
        ),
        ("delete", "posts/{post_id}", Value::Null, success.clone()),
        ("put", "posts/{post_id}/vote", Value::Null, any.clone()),
        ("delete", "posts/{post_id}/vote", Value::Null, any.clone()),
        (
            "post",
            "posts/{post_id}/comments",
            reference("CommentInput"),
            any.clone(),
        ),
        (
            "patch",
            "comments/{comment_id}",
            reference("CommentInput"),
            success.clone(),
        ),
        (
            "delete",
            "comments/{comment_id}",
            Value::Null,
            success.clone(),
        ),
        (
            "put",
            "comments/{comment_id}/like",
            Value::Null,
            success.clone(),
        ),
        (
            "delete",
            "comments/{comment_id}/like",
            Value::Null,
            success.clone(),
        ),
        ("get", "guest", Value::Null, any.clone()),
        ("patch", "guest", fields("name"), any.clone()),
        ("post", "guest/recovery", Value::Null, fields("token url")),
        ("post", "guest/recover", fields("token"), success.clone()),
        ("post", "subscribe", fields("email locale"), success.clone()),
    ] {
        put(
            verb,
            &format!("{base}/{end}"),
            (!input.is_null()).then_some(input),
            output,
        )
    }
    put("get", "/operator", None, any.clone());
    put("post", "/operator/actions", Some(any), success.clone());
    put(
        "post",
        "/boards/{board_id}/media",
        None,
        reference("UploadedMedia"),
    );
    put("delete", "/media/{id}", None, success);
    doc["paths"]["/api/v1/boards/{board_id}/media"]["post"]["requestBody"] = json!({"required":true,"content":{"image/png":{"schema":{"type":"string","format":"binary"}},"image/jpeg":{"schema":{"type":"string","format":"binary"}},"image/webp":{"schema":{"type":"string","format":"binary"}}}});
    doc["paths"]["/api/v1/media/{id}"]["get"] = json!({"parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}}],"responses":{"200":{"description":"Authorized private image","content":{"image/webp":{"schema":{"type":"string","format":"binary"}}}},"307":{"description":"Time-limited published image URL"},"404":{"description":"Unavailable"}}});
    let upload = &mut doc["paths"]["/api/v1/boards/{board_id}/media"]["post"];
    upload["parameters"].as_array_mut().unwrap().push(json!({"name":"kind","in":"query","schema":{"type":"string","enum":["post","logo","cover"]}}));
    upload["responses"]["201"] = upload["responses"]
        .as_object_mut()
        .unwrap()
        .remove("200")
        .unwrap();
    let remove = &mut doc["paths"]["/api/v1/media/{id}"]["delete"]["responses"];
    remove.as_object_mut().unwrap().remove("200");
    remove["204"] = json!({"description":"Removed"});
    serde_json::to_string_pretty(&doc).expect("serialize OpenAPI")
}
