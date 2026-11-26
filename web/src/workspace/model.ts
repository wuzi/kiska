import type { components } from "../api/generated";
type Wire = components["schemas"];
export type Role = "owner" | "admin" | "moderator";
export type Locale = "en" | "pt";
export type T = (en: string, pt: string) => string;
export type Org = Pick<
  Wire["Organization"],
  "id" | "name" | "slug" | "closed_at" | "suspended"
> & { role: Role };
export type User = Wire["Account"] & {
  display_name: string;
  email_verified?: boolean;
  notification_verified?: boolean;
  submission_alerts?: boolean;
};
export type Me = {
  user: User | null;
  organizations: Org[];
  operator?: boolean;
  owned_count?: number;
  owned_limit?: number;
  support_url?: string;
  policy_url?: string;
};
export type Folder = { id: string; name: string; position: number };
export type Board = Pick<
  Wire["BoardSummary"],
  | "id"
  | "title"
  | "description"
  | "slug"
  | "org_slug"
  | "logo_id"
  | "cover_id"
  | "published"
> & {
  suspended?: boolean;
  closed_at?: string | null;
  pinned?: boolean;
  position?: number;
  folder_id?: string | null;
  post_count?: number;
};
export type Member = {
  id: string;
  user_id?: string;
  display_name: string;
  email: string;
  role: Role;
};
export type Usage = Wire["Usage"];
export type OrgData = {
  organization: Org;
  boards: Board[];
  folders: Folder[];
  members: Member[];
  usage: Usage;
};
export type Category = {
  id: string;
  name: string;
  color: string;
  position: number;
  preset?: string | null;
  is_default?: boolean;
  visitor_allowed?: boolean;
  on_roadmap?: boolean;
};
export type Post = {
  id: string;
  title: string;
  body?: string;
  excerpt?: string;
  status_id: string;
  tag_id?: string | null;
  votes?: number;
  vote_count?: number;
  comment_count?: number;
  visibility?: string;
  team_response?: string;
  pending?: boolean;
  hidden?: boolean;
  pinned?: boolean;
  locked?: boolean;
  guest_id?: string;
  author_name?: string;
  media_ids?: string[];
  revision: number;
};
export type Announcement = {
  revision: number;
  id: string;
  title: string;
  body: string;
  post_ids?: string[];
  posts?: { id: string; title: string; status_name?: string; color?: string }[];
  linked_posts?: { id: string; post_id?: string; title: string }[];
  created_at?: string;
  published_at?: string;
};
export type Settings = {
  opening_view: "list" | "roadmap";
  density: "roomy" | "compact";
  sort: "trending" | "top" | "new" | "manual";
  roadmap_visible: boolean;
  public_posting: boolean;
  require_approval: boolean;
  voting_enabled: boolean;
  guest_uploads: boolean;
  indexing: boolean;
  button_text: string;
  board_fields: Record<string, boolean>;
  form_fields: Record<string, boolean>;
  manual_order: string[];
  links: { label: string; url: string }[];
};
export type Appearance = Record<
  | "background"
  | "text"
  | "accent"
  | "button"
  | "font"
  | "text_size"
  | "page_width"
  | "cover_height"
  | "logo_size"
  | "logo_shape"
  | "input_style"
  | "input_size"
  | "input_shape"
  | "button_size"
  | "button_shape",
  string
>;
export type BoardData = {
  board: Board;
  settings: Settings;
  appearance: Appearance;
  statuses: Category[];
  tags: Category[];
  posts: Post[];
  updates: Announcement[];
  revision: number;
};
export type Draft = Pick<
  BoardData,
  "settings" | "appearance" | "statuses" | "tags" | "revision"
> &
  Pick<Board, "title" | "description" | "slug" | "logo_id" | "cover_id"> & {
    reassignments: Record<string, string>;
  };
export const defaultAppearance: Appearance = {
  background: "#ffffff",
  text: "#262626",
  accent: "#2f7d4f",
  button: "#2f7d4f",
  font: "Poppins",
  text_size: "medium",
  page_width: "medium",
  cover_height: "medium",
  logo_size: "medium",
  logo_shape: "circle",
  input_style: "outline",
  input_size: "medium",
  input_shape: "rounded",
  button_size: "medium",
  button_shape: "rounded",
};
export const defaultSettings: Settings = {
  opening_view: "list",
  density: "roomy",
  sort: "trending",
  roadmap_visible: true,
  public_posting: true,
  require_approval: false,
  voting_enabled: true,
  guest_uploads: true,
  indexing: false,
  button_text: "",
  board_fields: {
    body: true,
    tag: true,
    images: true,
    author: true,
    votes: true,
    comments: true,
  },
  form_fields: { body: true, tag: true, images: true },
  manual_order: [],
  links: [],
};
export function makeDraft(data: BoardData): Draft {
  const { title, description, slug, logo_id, cover_id } = data.board;
  return {
    title,
    description,
    slug,
    logo_id: logo_id ?? null,
    cover_id: cover_id ?? null,
    settings: {
      ...defaultSettings,
      ...data.settings,
      board_fields: {
        ...defaultSettings.board_fields,
        ...data.settings?.board_fields,
      },
      form_fields: {
        ...defaultSettings.form_fields,
        ...data.settings?.form_fields,
      },
    },
    appearance: { ...defaultAppearance, ...data.appearance },
    statuses: data.statuses,
    tags: data.tags,
    revision: data.revision,
    reassignments: {},
  };
}
export const canConfigure = (role: Role) =>
  role === "owner" || role === "admin";
export const apiPath = (path: string) => `/api/v1${path}`;
export const boardPath = (id: string) => `/boards/${encodeURIComponent(id)}`;
export const orgPath = (id: string) =>
  `/organizations/${encodeURIComponent(id)}`;
export const publicPath = (board: Board, org: Org) =>
  `/b/${encodeURIComponent(board.org_slug || org.slug)}/${encodeURIComponent(board.slug)}`;
export function moveItem<T>(items: T[], index: number, delta: number) {
  const next = [...items];
  const to = index + delta;
  if (to < 0 || to >= next.length) return items;
  next.splice(to, 0, ...next.splice(index, 1));
  return next;
}
export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
}
export function safeWebUrl(value: string | undefined | null) {
  try {
    const u = new URL(value || "");
    return ["https:", "http:", "mailto:"].includes(u.protocol)
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
