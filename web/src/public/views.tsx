import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Plus,
  TrendingUp,
  Pin,
  MessageSquare,
  Newspaper,
  ExternalLink,
  LayoutList,
} from "lucide-react";
import type {
  BoardData,
  ColumnPage,
  Filters,
  Label,
  Post,
  Update,
} from "./types";
import { postPath } from "./types";
import { useBoard } from "./context";
import { dateString, labelName } from "./i18n";
import {
  Avatar,
  Body,
  Chip,
  CommentCount,
  ErrorBox,
  PagedList,
  Vote,
} from "./ui";

export function eligibleStatuses(data: BoardData) {
  if (data.board.settings?.public_posting === false && !data.role) return [];
  return data.statuses.filter(
    (s) => s.visitor_allowed !== false || !!data.role,
  );
}
export function PostCard({
  post,
  roadmap = false,
}: {
  post: Post;
  roadmap?: boolean;
}) {
  const { data, openPost, t } = useBoard();
  const tag = data.tags.find((i) => i.id === post.tag_id);
  const status = data.statuses.find((i) => i.id === post.status_id);
  const fields = data.board.settings?.board_fields ?? {};
  const excerpt =
    post.excerpt || post.body?.replace(/[#*_`|>~]/g, "").slice(0, 160) || "";
  const showVoters = fields.votes !== false && (post.voters?.length ?? 0) > 0;
  return (
    <article
      className={"pb-card " + (roadmap ? "pb-road-card" : "pb-list-card")}
      data-post={post.id}
    >
      {!roadmap && <Vote post={post} />}
      <div className="pb-card-main">
        <div className="pb-card-head">
          {post.pinned && <Pin size={13} aria-label={t("pinned")} />}
          <a
            href={postPath(data.board, post)}
            data-post-link={post.id}
            className="pb-card-title"
            onClick={(e) => {
              if (
                e.button === 0 &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.shiftKey &&
                !e.altKey
              ) {
                e.preventDefault();
                openPost(post);
              }
            }}
          >
            {post.title}
          </a>
        </div>
        {fields.body !== false && excerpt && (
          <p className="pb-excerpt">{excerpt}</p>
        )}
        <div className="pb-meta">
          {!roadmap && status && <Chip item={status} status />}
          {fields.tag !== false && tag && <Chip item={tag} />}
          {(post.pending || post.visibility === "pending") && (
            <span className="pb-pending">{t("pending")}</span>
          )}
          {!roadmap && <CommentCount post={post} />}
        </div>
      </div>
      {(roadmap || showVoters) && (
        <div className="pb-card-end">
          {roadmap && (
            <>
              <Vote post={post} />
              <CommentCount post={post} />
            </>
          )}
          {fields.votes !== false && (post.weekly_votes ?? 0) >= 2 && (
            <span className="pb-week" title={t("nextWeek")}>
              <TrendingUp size={13} />+{post.weekly_votes}
            </span>
          )}
          {showVoters && (
            <span className="pb-avatars">
              {post.voters!.slice(0, 3).map((g, i) => (
                <Avatar key={i} guest={g} size={22} />
              ))}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
export function Empty({
  title,
  detail,
  updates = false,
}: {
  title: string;
  detail?: string;
  updates?: boolean;
}) {
  return (
    <div className="pb-empty">
      {updates ? <Newspaper size={28} /> : <MessageSquare size={28} />}
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  );
}
function Column({
  status,
  seed,
  filters,
}: {
  status: Label;
  seed: ColumnPage;
  filters: Filters;
}) {
  const { adapter, data, locale, t, openComposer } = useBoard();
  const column = useInfiniteQuery({
    queryKey: ["column", locale, status.id, filters],
    initialPageParam: "",
    initialData: { pages: [seed], pageParams: [""] },
    queryFn: async ({ pageParam, signal }) => {
      const page = await adapter.board(
        { ...filters, view: "list", status: status.id, sort: "top" },
        locale,
        pageParam,
        signal,
      );
      return {
        status_id: status.id,
        total: page.total ?? seed.total,
        posts: page.posts,
        next_cursor: page.next_cursor,
      };
    },
    getNextPageParam: (p) =>
      p.next_cursor != null ? String(p.next_cursor) : undefined,
  });
  const rows = column.data.pages.flatMap((p) => p.posts);
  const canPost = eligibleStatuses(data).some((s) => s.id === status.id);
  return (
    <section className="pb-column">
      <div className="pb-col-head">
        <Chip item={status} status />
        <span className="pb-col-count">{column.data.pages[0].total}</span>
        {canPost && (
          <button
            className="pb-icon"
            aria-label={t("newPost") + " · " + labelName(status, locale)}
            onClick={() => openComposer(status.id)}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {rows.length ? (
        <PagedList
          items={rows}
          label={labelName(status, locale)}
          render={(p) => <PostCard post={p} roadmap />}
          estimate={156}
        />
      ) : (
        <p className="pb-col-empty">{t("emptyColumn")}</p>
      )}
      {column.hasNextPage && (
        <button
          className="pb-more"
          disabled={column.isFetchingNextPage}
          onClick={() => void column.fetchNextPage()}
        >
          {t("loadMore")}
        </button>
      )}
      <ErrorBox error={column.error} />
    </section>
  );
}
export function Roadmap({
  data,
  filters,
}: {
  data: BoardData;
  filters: Filters;
}) {
  return (
    <div className="pb-roadmap">
      {data.statuses
        .filter(
          (s) =>
            s.on_roadmap !== false &&
            (!filters.status || s.id === filters.status),
        )
        .map((status) => {
          const posts = data.posts.filter((p) => p.status_id === status.id);
          const seed = data.columns?.find((c) => c.status_id === status.id) ?? {
            status_id: status.id,
            total: status.total ?? posts.length,
            posts,
          };
          return (
            <Column
              key={status.id}
              status={status}
              seed={seed}
              filters={filters}
            />
          );
        })}
    </div>
  );
}
export function Updates({ rows }: { rows: Update[] }) {
  const { data, t, locale, openPost } = useBoard();
  if (!rows.length)
    return <Empty title={t("noUpdates")} detail={t("updatesHelp")} updates />;
  return (
    <PagedList
      label={t("updates")}
      items={rows}
      estimate={180}
      render={(u) => (
        <article className="pb-update">
          <time>{dateString(u.published_at || u.created_at, locale)}</time>
          <h2>{u.title}</h2>
          <Body html={u.body_html} text={u.body} />
          {!!u.posts?.length && (
            <ul className="pb-update-links">
              {u.posts.map((p) => {
                const id = p.id ?? p.post_id;
                if (!id) return null;
                return (
                  <li key={id}>
                    <a
                      href={postPath(data.board, { id, slug: p.slug })}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
                          return;
                        e.preventDefault();
                        openPost({ ...p, id, status_id: "" });
                      }}
                    >
                      <LayoutList size={14} />
                      {p.title}
                      <span className="pb-status">
                        <i style={{ background: p.status_color || p.color }} />
                        {p.status_name}
                      </span>
                      <ExternalLink size={13} />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      )}
    />
  );
}
