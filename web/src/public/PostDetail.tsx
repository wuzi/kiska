import { Suspense, useEffect, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import {
  Link2,
  Heart,
  LockKeyhole,
  MessageCircle,
  Reply,
  Pencil,
  Trash2,
  BadgeCheck,
} from "lucide-react";
import { useBoard } from "./context";
import { dateString } from "./i18n";
import { Avatar, Body, Chip, ErrorBox, Modal, PagedList, Vote } from "./ui";
import { Editor } from "./composer/PostComposer";
import { postPath, type Post, type Comment } from "./types";
import { ApiError } from "../api/client";

function CommentForm({
  postId,
  parentId,
  original,
  close,
}: {
  postId: string;
  parentId?: string;
  original?: Comment;
  close: () => void;
}) {
  const { t, adapter, refresh, notify } = useBoard();
  const [body, setBody] = useState(original?.body ?? "");
  const save = useMutation({
    mutationFn: async () => {
      if (body.length > 5000) throw new Error(t("bodyLimit"));
      await adapter.comment(postId, body, parentId ?? null, original?.id);
    },
    onSuccess: async () => {
      await refresh();
      close();
      notify(t("commentSaved"));
    },
  });
  const label = t(parentId ? "writeReply" : "writeComment");
  return (
    <form
      className="pb-form pb-comment-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Suspense
        fallback={<div className="pb-editor-placeholder">{t("loading")}</div>}
      >
        <Editor autoFocus label={label} initial={body} onChange={setBody} />
      </Suspense>
      <ErrorBox error={save.error} />
      <div className="pb-form-actions">
        <button type="button" className="pb-neutral" onClick={close}>
          {t("cancel")}
        </button>
        <button
          className="pb-primary"
          disabled={!body.trim() || save.isPending}
        >
          {t(original ? "save" : parentId ? "postReply" : "postComment")}
        </button>
      </div>
    </form>
  );
}
function CommentRow({ c, post }: { c: Comment; post: Post }) {
  const { adapter, t, locale, refresh } = useBoard();
  const [form, setForm] = useState<"reply" | "edit" | "delete" | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const like = useMutation({
    mutationFn: (desired: boolean) => adapter.like(c.id, desired),
    onMutate: (desired) => setOptimistic(desired),
    onSettled: async () => {
      await refresh();
      setOptimistic(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => adapter.removeComment(c.id),
    onSuccess: async () => {
      setForm(null);
      await refresh();
    },
  });
  const liked = optimistic ?? !!c.liked;
  const count = (c.likes ?? 0) + Number(liked) - Number(!!c.liked);
  return (
    <article className={"pb-comment" + (c.parent_id ? " pb-reply" : "")}>
      <Avatar guest={c.deleted ? undefined : c.author} size={30} />
      <div className="pb-comment-main">
        {c.deleted ? (
          <p className="pb-help">{t("deleted")}</p>
        ) : (
          <>
            <div className="pb-byline">
              <b>{c.author?.name || t("anonymous")}</b>
              {c.author?.staff && <span className="pb-team">{t("team")}</span>}
              <time>{dateString(c.created_at, locale)}</time>
            </div>
            <Body html={c.body_html} text={c.body} />
            <div className="pb-comment-actions">
              <button
                aria-label={t(liked ? "unlike" : "like")}
                aria-pressed={liked}
                disabled={like.isPending}
                onClick={() => like.mutate(!liked)}
              >
                <Heart size={14} />
                {count}
              </button>
              {!post.locked && (
                <button onClick={() => setForm("reply")}>
                  <Reply size={13} />
                  {t("reply")}
                </button>
              )}
              {c.can_edit && (
                <>
                  <button onClick={() => setForm("edit")}>{t("edit")}</button>
                  <button onClick={() => setForm("delete")}>
                    {t("remove")}
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {form === "delete" && (
          <div className="pb-confirm">
            <span>{t("confirmDelete")}</span>
            <button className="pb-neutral" onClick={() => setForm(null)}>
              {t("cancel")}
            </button>
            <button
              className="pb-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t("confirmRemove")}
            </button>
          </div>
        )}
        {form === "reply" && !post.locked && (
          <CommentForm
            postId={post.id}
            parentId={c.parent_id || c.id}
            close={() => setForm(null)}
          />
        )}
        {form === "edit" && (
          <CommentForm
            postId={post.id}
            original={c}
            close={() => setForm(null)}
          />
        )}
        <ErrorBox error={like.error || remove.error} />
      </div>
    </article>
  );
}
export function orderedComments(rows: Comment[]): Comment[] {
  const replies = new Map<string, Comment[]>();
  for (const row of rows) {
    if (row.parent_id) {
      const list = replies.get(row.parent_id) ?? [];
      list.push(row);
      replies.set(row.parent_id, list);
    }
  }
  return rows
    .filter((row) => !row.parent_id)
    .flatMap((row) => {
      const children = (replies.get(row.id) ?? []).filter((c) => !c.deleted);
      return row.deleted && !children.length ? [] : [row, ...children];
    });
}
export function PostDetail({
  known,
  onClose,
  restoreFocus,
}: {
  known: Post;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const { data, adapter, locale, t, refresh, notify, openComposer, preview } =
    useBoard();
  const [compose, setCompose] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  const seed = data.detail?.post.id === known.id ? data.detail : null;
  const details = useInfiniteQuery({
    staleTime: 0,
    queryKey: ["detail", locale, known.id],
    queryFn: ({ pageParam, signal }) =>
      adapter.detail(known.id, locale, pageParam, signal),
    initialPageParam: "",
    ...(seed ? { initialData: { pages: [seed], pageParams: [""] } } : {}),
    getNextPageParam: (p) =>
      p.next_cursor != null ? String(p.next_cursor) : undefined,
  });
  const post = details.data?.pages[0]?.post ?? known;
  const status = data.statuses.find((s) => s.id === post.status_id);
  const tag = data.tags.find((s) => s.id === post.tag_id);
  const fields = data.board.settings?.board_fields ?? {};
  const rows = orderedComments(
    (details.data?.pages.flatMap((p) => p.comments ?? []) ?? []).map((c) => ({
      ...c,
      deleted: c.deleted || c.hidden,
    })),
  );
  const absent =
    details.error instanceof ApiError &&
    [403, 404, 410].includes(details.error.status);
  const remove = useMutation({
    mutationFn: () => adapter.removePost(post.id),
    onSuccess: async () => {
      onClose();
      await refresh();
      notify(t("saved"));
    },
  });
  useEffect(() => {
    if (preview) return;
    if (details.data && location.pathname !== postPath(data.board, post))
      history.replaceState(
        history.state,
        "",
        postPath(data.board, post) + location.search,
      );
  }, [post, data.board, details.data, preview]);
  return (
    <Modal
      wide
      title={absent ? t("unavailable") : post.title || t("details")}
      onClose={onClose}
      focusBack={restoreFocus}
    >
      {absent ? (
        <div className="pb-modal-body">
          <ErrorBox error={details.error} />
        </div>
      ) : (
        <div className="pb-modal-body pb-detail" data-detail={post.id}>
          <div className="pb-detail-meta">
            {status && <Chip item={status} status />}
            {tag && fields.tag !== false && <Chip item={tag} />}
            {(post.pending || post.visibility === "pending") && (
              <span className="pb-pending">{t("pending")}</span>
            )}
            {post.locked && <LockKeyhole size={14} aria-label={t("locked")} />}
          </div>
          {fields.author !== false && (
            <div className="pb-byline">
              <Avatar guest={post.author} />
              <b>{post.author?.name || t("anonymous")}</b>
              {post.author?.staff && (
                <span className="pb-team">{t("team")}</span>
              )}
              <time>{dateString(post.created_at, locale)}</time>
            </div>
          )}
          {fields.body !== false && (
            <Body html={post.body_html} text={post.body || post.excerpt} />
          )}
          {fields.images !== false && !!post.media?.length && (
            <div className="pb-detail-media">
              {post.media.map((m) => (
                <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                  <img loading="lazy" src={m.url} alt={t("attachment")} />
                </a>
              ))}
            </div>
          )}
          <div className="pb-detail-actions">
            <Vote post={post} />
            <button
              className="pb-neutral"
              onClick={async () => {
                const url = location.origin + postPath(data.board, post);
                try {
                  await navigator.clipboard.writeText(url);
                  notify(t("copied"));
                } catch {
                  setCopyFallback(url);
                }
              }}
            >
              <Link2 size={15} />
              {t("share")}
            </button>
            {post.can_edit && details.data && (
              <>
                <button
                  className="pb-icon"
                  aria-label={t("edit")}
                  onClick={() => openComposer(undefined, post)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="pb-icon"
                  aria-label={t("remove")}
                  onClick={() => setConfirm(true)}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
          {copyFallback && (
            <input
              aria-label={t("share")}
              readOnly
              value={copyFallback}
              onFocus={(e) => e.target.select()}
              autoFocus
            />
          )}
          {confirm && (
            <div className="pb-confirm">
              {t("confirmDelete")}
              <button className="pb-neutral" onClick={() => setConfirm(false)}>
                {t("cancel")}
              </button>
              <button
                className="pb-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {t("confirmRemove")}
              </button>
            </div>
          )}
          {!!post.team_response && (
            <aside className="pb-team-response">
              <strong>
                <BadgeCheck size={17} />
                {t("teamResponse")}
              </strong>
              <Body text={post.team_response} />
            </aside>
          )}
          <ErrorBox error={details.error || remove.error} />
          <div className="pb-discussion">
            <h3>
              <MessageCircle size={19} />
              {t("discussion")} <span>{post.comment_count ?? 0}</span>
            </h3>
            {post.locked ? (
              <p className="pb-help">{t("locked")}</p>
            ) : compose ? (
              <CommentForm postId={post.id} close={() => setCompose(false)} />
            ) : (
              <button
                className="pb-start-comment"
                onClick={() => setCompose(true)}
              >
                {t("writeComment")}…
              </button>
            )}
            {details.isPending ? (
              <p className="pb-help">{t("loadingDiscussion")}</p>
            ) : !rows.length ? (
              <p className="pb-help">{t("noComments")}</p>
            ) : (
              <PagedList
                label={t("comments")}
                items={rows}
                render={(c) => <CommentRow c={c} post={post} />}
                estimate={95}
              />
            )}
            {details.hasNextPage && (
              <button
                className="pb-more"
                disabled={details.isFetchingNextPage}
                onClick={() => void details.fetchNextPage()}
              >
                {t("loadMore")}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
