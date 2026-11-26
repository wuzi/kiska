import type { components } from "../api/generated";
type Schemas = components["schemas"];
export type Locale = "en" | "pt";
export type View = "list" | "roadmap" | "updates";
export type Sort = "trending" | "top" | "new" | "manual";
export interface Label extends Pick<Schemas["Label"], "id" | "name" | "color"> {
  position?: number;
  preset?: string | null;
  default_status?: boolean;
  is_default?: boolean;
  on_roadmap?: boolean;
  visitor_allowed?: boolean;
  total?: number;
}
export interface Guest {
  name?: string | null;
  avatar_url?: string | null;
  staff?: boolean;
}
export interface Media {
  id: string;
  url: string;
}
export interface Post extends Pick<
  Schemas["PostSummary"],
  "id" | "title" | "status_id"
> {
  visibility?: string;
  slug?: string;
  tag_id?: string | null;
  body?: string;
  body_html?: string;
  excerpt?: string;
  pinned?: boolean;
  locked?: boolean;
  pending?: boolean;
  can_edit?: boolean;
  votes?: number;
  voted?: boolean;
  weekly_votes?: number;
  comment_count?: number;
  voters?: Guest[];
  author?: Guest;
  created_at?: string;
  media?: Media[];
  team_response?: string | null;
}
export interface Comment {
  id: string;
  parent_id?: string | null;
  body?: string;
  body_html?: string;
  author?: Guest;
  deleted?: boolean;
  hidden?: boolean;
  can_edit?: boolean;
  likes?: number;
  liked?: boolean;
  created_at?: string;
}
export interface Detail {
  post: Post;
  comments: Comment[];
  next_cursor?: number | null;
}
export interface LinkedPost {
  id?: string;
  post_id?: string;
  title: string;
  slug?: string;
  status_name?: string;
  status_color?: string;
  color?: string;
}
export interface Update {
  id: string;
  title: string;
  body?: string;
  body_html?: string;
  created_at?: string;
  published_at?: string;
  posts?: LinkedPost[];
}
export type Fields = Partial<
  Record<"body" | "tag" | "images" | "author" | "votes" | "comments", boolean>
>;
export interface BoardSettings {
  opening_view?: "list" | "roadmap";
  density?: "roomy" | "compact";
  sort?: Sort;
  roadmap_visible?: boolean;
  public_posting?: boolean;
  require_approval?: boolean;
  voting_enabled?: boolean;
  guest_uploads?: boolean;
  button_text?: string;
  board_fields?: Fields;
  form_fields?: Fields;
  manual_order?: string[];
  links?: { label: string; url: string }[];
}
export interface Appearance {
  background?: string;
  text?: string;
  accent?: string;
  button?: string;
  font?: string;
  text_size?: string;
  page_width?: string;
  cover_height?: string;
  logo_size?: string;
  logo_shape?: string;
  input_style?: string;
  input_size?: string;
  input_shape?: string;
  button_size?: string;
  button_shape?: string;
}
export interface Board {
  id: string;
  slug: string;
  org_slug: string;
  title: string;
  description?: string;
  settings?: BoardSettings;
  appearance?: Appearance;
  logo_id?: string | null;
  cover_id?: string | null;
  logo_url?: string | null;
  cover_url?: string | null;
}
export interface ColumnPage {
  status_id: string;
  posts: Post[];
  total: number;
  next_cursor?: number | null;
}
export interface BoardData {
  board: Board;
  statuses: Label[];
  tags: Label[];
  posts: Post[];
  next_cursor?: number | null;
  role?: string | null;
  total?: number;
  updates?: Update[];
  updates_next_cursor?: number | null;
  columns?: ColumnPage[];
  locale?: string;
  detail?: Detail | null;
}
export interface Filters {
  view: View;
  sort: Sort;
  q: string;
  status: string;
  tag: string;
}
export interface Submission extends Required<Schemas["PostInput"]> {
  status_id: string;
}
export function publicPath(board: Board) {
  return (
    "/b/" +
    encodeURIComponent(board.org_slug) +
    "/" +
    encodeURIComponent(board.slug)
  );
}
export function postPath(board: Board, post: Pick<Post, "id" | "slug">) {
  return (
    publicPath(board) +
    "/p/" +
    encodeURIComponent(post.id + (post.slug ? "-" + post.slug : ""))
  );
}
export interface Adapter {
  board(
    filters: Filters,
    locale: Locale,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<BoardData>;
  detail(
    id: string,
    locale: Locale,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Detail>;
  updates(
    locale: Locale,
    cursor: string,
    signal?: AbortSignal,
  ): Promise<{ updates: Update[]; next_cursor?: number | null }>;
  suggestions(q: string, locale: Locale, signal?: AbortSignal): Promise<Post[]>;
  vote(id: string, desired: boolean): Promise<unknown>;
  writePost(
    value: Submission,
    id?: string,
  ): Promise<Post | Schemas["PostCreated"] | void>;
  removePost(id: string): Promise<unknown>;
  comment(
    post: string,
    body: string,
    parent_id: string | null,
    edit?: string,
  ): Promise<unknown>;
  removeComment(id: string): Promise<unknown>;
  like(id: string, desired: boolean): Promise<unknown>;
  guest(): Promise<Guest | null>;
  rename(name: string): Promise<unknown>;
  recovery(): Promise<{ token: string; url?: string }>;
  recover(token: string): Promise<unknown>;
  subscribe(email: string, locale: Locale): Promise<unknown>;
  upload(file: File): Promise<Media>;
  release(id: string): Promise<unknown>;
}
