import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  LockKeyhole,
  Mail,
  MessageCircle,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  boardPath,
  canConfigure,
  type Announcement,
  type BoardData,
  type Post,
  type Role,
} from "./model";
import {
  Empty,
  Field,
  Loading,
  Modal,
  Msg,
  Toggle,
  get,
  onSubmit,
  useJob,
  useT,
  write,
} from "./shared";
import { RichField } from "./RichField";
export type Refresh = () => Promise<void>;
type List = { items: Post[]; next_cursor?: string | null };
type VoteRow = {
  guest_id: string;
  name?: string;
  created_at: string;
  new_identity?: boolean;
  shared_ip?: boolean;
};
type Comment = {
  id: string;
  body: string;
  guest_id?: string;
  hidden?: boolean;
  deleted?: boolean;
  author?: { name?: string };
  revision: number;
};
export function Queue({
  data,
  edit,
}: {
  data: BoardData;
  edit: (p: Post) => void;
}) {
  const t = useT(),
    [term, setTerm] = useState(""),
    [filter, setFilter] = useState("all"),
    [cursors, setCursors] = useState([""]);
  const cursor = cursors.at(-1) || "";
  const q = useQuery({
    queryKey: ["queue", data.board.id, term, filter, cursor],
    queryFn: () =>
      get<List>(
        boardPath(data.board.id) +
          "/posts?" +
          new URLSearchParams({ q: term, visibility: filter, cursor }),
      ),
    placeholderData:
      term === "" && filter === "all" && !cursor
        ? { items: data.posts }
        : undefined,
  });
  return (
    <>
      <div className="ws-inline">
        <label className="ws-search">
          <Search size={15} />
          <input
            aria-label={t("Search feedback", "Buscar feedback")}
            placeholder={t("Search feedback", "Buscar feedback")}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setCursors([""]);
            }}
          />
        </label>
        <select
          value={filter}
          aria-label={t("Visibility", "Visibilidade")}
          onChange={(e) => {
            setFilter(e.target.value);
            setCursors([""]);
          }}
        >
          <option value="all">{t("All posts", "Todos os posts")}</option>
          <option value="pending">
            {t("Awaiting approval", "Aguardando aprovação")}
          </option>
          <option value="hidden">{t("Hidden", "Ocultos")}</option>
        </select>
      </div>
      {q.isLoading && <Loading />}
      <Msg error>{q.error?.message}</Msg>
      {q.data?.items.length === 0 && (
        <Empty icon={<ShieldCheck />}>
          {t("No posts in this queue", "Nenhum post nesta fila")}
        </Empty>
      )}
      {q.data?.items.map((p) => (
        <button className="ws-queue-row" key={p.id} onClick={() => edit(p)}>
          <div>
            <strong>{p.title}</strong>
            <small>
              {p.visibility ||
                data.statuses.find((s) => s.id === p.status_id)?.name}
            </small>
          </div>
          <ChevronDown size={14} />
        </button>
      ))}
      <div className="ws-actions">
        {cursors.length > 1 && (
          <button onClick={() => setCursors(cursors.slice(0, -1))}>
            <ArrowLeft size={13} />
            {t("Previous", "Anterior")}
          </button>
        )}
        {q.data?.next_cursor && (
          <button
            onClick={() => setCursors([...cursors, q.data!.next_cursor!])}
          >
            {t("Next", "Próxima")}
            <ArrowRight size={13} />
          </button>
        )}
      </div>
    </>
  );
}
function VoteAudit({
  bid,
  postId,
  moderate,
}: {
  bid: string;
  postId: string;
  moderate: (action: string, fields: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT(),
    [pages, setPages] = useState([""]),
    page = pages.at(-1) || "",
    job = useJob();
  const q = useQuery({
    queryKey: ["audit", bid, postId, page],
    queryFn: () =>
      get<{ votes: VoteRow[]; next_cursor?: string }>(
        boardPath(bid) +
          "/posts/" +
          postId +
          "/votes?cursor=" +
          encodeURIComponent(page),
      ),
  });
  return (
    <div>
      {q.isLoading && <Loading />}
      <Msg error>{q.error?.message || job.error}</Msg>
      {q.data?.votes?.length === 0 && (
        <p>{t("No votes recorded.", "Nenhum voto registrado.")}</p>
      )}
      {q.data?.votes?.map((v) => (
        <div className="ws-info-row" key={v.guest_id}>
          <div>
            <strong>{v.name || t("Anonymous", "Anônimo")}</strong>
            <small>
              {new Date(v.created_at).toLocaleString()}
              {v.new_identity
                ? " · " + t("New identity", "Nova identidade")
                : ""}
              {v.shared_ip ? " · " + t("Shared IP", "IP compartilhado") : ""}
            </small>
          </div>
          <button
            disabled={job.busy}
            aria-label={t("Remove vote", "Remover voto")}
            onClick={() =>
              void job.run(async () => {
                await moderate("remove_vote", { guest_id: v.guest_id });
                await q.refetch();
              })
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="ws-inline">
        {pages.length > 1 && (
          <button onClick={() => setPages(pages.slice(0, -1))}>
            {t("Previous", "Anterior")}
          </button>
        )}
        {q.data?.next_cursor && (
          <button onClick={() => setPages([...pages, q.data!.next_cursor!])}>
            {t("Next", "Próxima")}
          </button>
        )}
      </div>
    </div>
  );
}
export function ModeratePost({
  post,
  data,
  role,
  close,
  refresh,
}: {
  post: Post;
  data: BoardData;
  role: Role;
  close: () => void;
  refresh: Refresh;
}) {
  const t = useT(),
    job = useJob(),
    path = boardPath(data.board.id),
    [tab, setTab] = useState("post"),
    [status, setStatus] = useState(post.status_id),
    [response, setResponse] = useState<string | null>(null),
    [announcement, setAnnouncement] = useState(false),
    [updateTitle, setUpdateTitle] = useState(""),
    [updateBody, setUpdateBody] = useState(""),
    [operation, setOperation] = useState(() => crypto.randomUUID()),
    [target, setTarget] = useState(""),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("board"),
    [ipBan, setIpBan] = useState(false),
    [editComment, setEditComment] = useState<Comment | null>(null),
    [commentText, setCommentText] = useState(""),
    [postDraft, setPostDraft] = useState(post),
    [commentCursors, setCommentCursors] = useState([""]);
  const cursor = commentCursors.at(-1) || "";
  const detail = useQuery({
    queryKey: ["moderate", data.board.id, post.id, cursor],
    queryFn: () =>
      get<{
        post: Post & { media?: { id: string; url: string }[] };
        comments: Comment[];
        next_cursor?: string;
      }>(path + "/posts/" + post.id + "?cursor=" + encodeURIComponent(cursor)),
  });
  const p = detail.data?.post || post;
  const candidates = useQuery({
    queryKey: ["merge-targets", data.board.id, query],
    enabled: tab === "safety" && query.trim().length > 0,
    queryFn: () =>
      get<List>(
        path + "/posts?" + new URLSearchParams({ q: query, visibility: "all" }),
      ),
  });
  async function moderate(
    action: string,
    fields: Record<string, unknown> = {},
  ) {
    await write(path + "/moderate", "POST", {
      action,
      post_id: p.id,
      ...fields,
    });
    const [, snapshot] = await Promise.all([
      refresh(),
      detail.refetch({ throwOnError: true }),
    ]);
    if (action === "edit" && snapshot.data?.post)
      setPostDraft(snapshot.data.post);
  }
  const doAction = (action: string, fields?: Record<string, unknown>) =>
    void job.run(() => moderate(action, fields), t("Saved.", "Salvo."));
  return (
    <Modal wide title={p.title} close={close}>
      <div className="ws-tabs">
        {[
          ["post", t("Post", "Post")],
          ["discussion", t("Discussion", "Discussão")],
          ["votes", t("Vote audit", "Auditoria de votos")],
          ["safety", t("Moderation", "Moderação")],
        ].map(([v, n]) => (
          <button
            key={v}
            aria-pressed={v === tab}
            onClick={() => {
              setTab(v);
              job.clear();
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <Msg error>{job.error || detail.error?.message}</Msg>
      {job.stale && (
        <button
          type="button"
          disabled={job.busy}
          onClick={() =>
            void job.run(async () => {
              const result = await detail.refetch({ throwOnError: true });
              if (tab === "post" && result.data?.post)
                setPostDraft(result.data.post);
              if (tab === "discussion") setEditComment(null);
            })
          }
        >
          {t("Discard draft and reload", "Descartar rascunho e recarregar")}
        </button>
      )}
      <Msg>{job.note}</Msg>
      {tab === "post" && (
        <>
          <div className="ws-inline ws-mod-tools">
            {(p.pending || p.visibility === "pending") && (
              <button disabled={job.busy} onClick={() => doAction("approve")}>
                <Check size={14} />
                {t("Approve", "Aprovar")}
              </button>
            )}
            <button
              disabled={job.busy}
              aria-pressed={!!p.pinned}
              onClick={() => doAction(p.pinned ? "unpin" : "pin")}
            >
              <Pin size={14} />
              {p.pinned ? t("Unpin", "Desafixar") : t("Pin", "Fixar")}
            </button>
            <button
              disabled={job.busy}
              aria-pressed={!!p.locked}
              onClick={() => doAction(p.locked ? "unlock" : "lock")}
            >
              <LockKeyhole size={14} />
              {p.locked ? t("Unlock", "Desbloquear") : t("Lock", "Bloquear")}
            </button>
            <button
              disabled={job.busy}
              onClick={() =>
                doAction(
                  p.hidden || p.visibility === "hidden" ? "restore" : "hide",
                )
              }
            >
              {p.hidden || p.visibility === "hidden"
                ? t("Restore", "Restaurar")
                : t("Hide", "Ocultar")}
            </button>
          </div>
          <form
            onSubmit={onSubmit(
              () =>
                void job.run(
                  async () => {
                    await moderate("move", {
                      status_id: status,
                      ...(response !== null ? { body: response } : {}),
                      ...(announcement
                        ? {
                            update: {
                              title: updateTitle,
                              body: updateBody,
                              operation_id: operation,
                              post_ids: [p.id],
                            },
                          }
                        : {}),
                    });
                    setResponse(null);
                    setAnnouncement(false);
                    setOperation(crypto.randomUUID());
                  },
                  t("Status saved.", "Status salvo."),
                ),
            )}
          >
            <Field label={t("Status", "Status")}>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {data.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Team response", "Resposta da equipe")}>
              <textarea
                value={response ?? p.team_response ?? ""}
                maxLength={5000}
                onChange={(e) => setResponse(e.target.value)}
              />
            </Field>
            {canConfigure(role) && (
              <Toggle
                label={t(
                  "Publish an Update with this change",
                  "Publicar uma atualização com esta alteração",
                )}
                checked={announcement}
                onChange={setAnnouncement}
              />
            )}{" "}
            {announcement && (
              <>
                <Field label={t("Update title", "Título da atualização")}>
                  <input
                    required
                    value={updateTitle}
                    onChange={(e) => setUpdateTitle(e.target.value)}
                  />
                </Field>
                <Field label={t("Announcement", "Anúncio")}>
                  <textarea
                    required
                    maxLength={10000}
                    value={updateBody}
                    onChange={(e) => setUpdateBody(e.target.value)}
                  />
                </Field>
              </>
            )}
            <button className="ws-primary" disabled={job.busy}>
              {t("Save status and response", "Salvar status e resposta")}
            </button>
          </form>
          <details className="ws-disclosure">
            <summary>
              {t("Edit post", "Editar post")}
              <ChevronDown size={14} />
            </summary>
            <form
              onSubmit={onSubmit(() =>
                doAction("edit", {
                  title: postDraft.title,
                  body: postDraft.body ?? "",
                  revision: postDraft.revision,
                }),
              )}
            >
              <Field label={t("Title", "Título")}>
                <input
                  required
                  minLength={3}
                  maxLength={120}
                  value={postDraft.title}
                  onChange={(e) =>
                    setPostDraft({ ...postDraft, title: e.target.value })
                  }
                />
              </Field>
              <Field label={t("Details", "Detalhes")}>
                <textarea
                  maxLength={10000}
                  value={postDraft.body ?? ""}
                  onChange={(e) =>
                    setPostDraft({ ...postDraft, body: e.target.value })
                  }
                />
              </Field>
              <button disabled={job.busy}>
                {t("Save post", "Salvar post")}
              </button>
            </form>
            {detail.data?.post.media?.map((m) => (
              <div key={m.id} className="ws-info-row">
                <img
                  src={m.url}
                  alt={t("Post attachment", "Anexo do post")}
                  width={70}
                />
                <button
                  disabled={job.busy}
                  onClick={() => doAction("delete_image", { media_id: m.id })}
                >
                  {t("Remove attachment", "Remover anexo")}
                </button>
              </div>
            ))}
          </details>
        </>
      )}
      {tab === "discussion" && (
        <>
          {detail.isLoading && <Loading />}
          {detail.data?.comments.length === 0 && (
            <Empty icon={<MessageCircle />}>
              {t("No comments yet", "Nenhum comentário ainda")}
            </Empty>
          )}
          {detail.data?.comments.map((c) => (
            <div key={c.id} className="ws-comment">
              <strong>{c.author?.name || t("Anonymous", "Anônimo")}</strong>
              {c.id === editComment?.id ? (
                <textarea
                  aria-label={t("Comment text", "Texto do comentário")}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                />
              ) : (
                <p>{c.body || t("Removed comment", "Comentário removido")}</p>
              )}
              <div className="ws-inline">
                {editComment?.id === c.id ? (
                  <button
                    disabled={job.busy}
                    onClick={() =>
                      void job.run(async () => {
                        await moderate("edit_comment", {
                          comment_id: c.id,
                          revision: editComment.revision,
                          body: commentText,
                        });
                        setEditComment(null);
                      })
                    }
                  >
                    {t("Save", "Salvar")}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setEditComment(c);
                      setCommentText(c.body);
                    }}
                  >
                    {t("Edit", "Editar")}
                  </button>
                )}
                <button
                  disabled={job.busy}
                  onClick={() =>
                    doAction(
                      c.hidden || c.deleted
                        ? "restore_comment"
                        : "hide_comment",
                      { comment_id: c.id },
                    )
                  }
                >
                  {c.hidden || c.deleted
                    ? t("Restore", "Restaurar")
                    : t("Hide", "Ocultar")}
                </button>
              </div>
            </div>
          ))}
          <div className="ws-actions">
            {commentCursors.length > 1 && (
              <button
                onClick={() => setCommentCursors(commentCursors.slice(0, -1))}
              >
                {t("Previous", "Anterior")}
              </button>
            )}
            {detail.data?.next_cursor && (
              <button
                onClick={() =>
                  setCommentCursors([
                    ...commentCursors,
                    detail.data!.next_cursor!,
                  ])
                }
              >
                {t("Next", "Próxima")}
              </button>
            )}
          </div>
        </>
      )}
      {tab === "votes" && (
        <VoteAudit bid={data.board.id} postId={p.id} moderate={moderate} />
      )}
      {tab === "safety" && (
        <>
          <h3>{t("Merge duplicate", "Mesclar duplicata")}</h3>
          <p>
            {t(
              "Move comments and unique votes to the surviving post. The old link redirects there.",
              "Mova os comentários e votos únicos ao post de destino. O link antigo será redirecionado.",
            )}
          </p>
          <Field label={t("Find surviving post", "Buscar post de destino")}>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setTarget("");
              }}
            />
          </Field>
          <Field label={t("Destination post", "Post de destino")}>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t("Choose a post", "Escolher um post")}</option>
              {(candidates.data?.items || data.posts)
                .filter((row) => row.id !== p.id)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
            </select>
          </Field>
          <button
            disabled={!target || job.busy}
            onClick={() =>
              void job.run(async () => {
                if (
                  !confirm(
                    t(
                      "Merge this duplicate into the selected post?",
                      "Mesclar esta duplicata com o post selecionado?",
                    ),
                  )
                )
                  return;
                await write(path + "/moderate", "POST", {
                  action: "merge",
                  post_id: p.id,
                  target_id: target,
                });
                await refresh();
                close();
              })
            }
          >
            {t("Merge posts", "Mesclar posts")}
          </button>
          <hr />
          <h3>{t("Guest ban", "Banimento de visitante")}</h3>
          <Field label={t("Ban scope", "Abrangência do banimento")}>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="board">{t("This board", "Este quadro")}</option>
              {canConfigure(role) && (
                <option value="organization">
                  {t("Entire organization", "Toda a organização")}
                </option>
              )}
            </select>
          </Field>
          <Toggle
            label={t(
              "Include associated IP hash",
              "Incluir hash do IP associado",
            )}
            checked={ipBan}
            onChange={setIpBan}
          />
          <div className="ws-inline">
            {["ban", "unban"].map((action) => (
              <button
                key={action}
                disabled={!p.guest_id || job.busy}
                onClick={() =>
                  doAction(action, {
                    guest_id: p.guest_id,
                    scope,
                    ip_ban: ipBan,
                  })
                }
              >
                {action === "ban"
                  ? t("Ban author", "Banir autor")
                  : t("Lift ban", "Remover banimento")}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
export function Updates({
  data,
  editable,
  refresh,
}: {
  data: BoardData;
  editable: boolean;
  refresh: Refresh;
}) {
  const t = useT(),
    [form, setForm] = useState<Announcement | null>(null),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [op, setOp] = useState(() => crypto.randomUUID()),
    job = useJob(),
    path = boardPath(data.board.id);
  const matches = useQuery({
    queryKey: ["link-posts", data.board.id, query],
    queryFn: () =>
      get<List>(
        path + "/posts?" + new URLSearchParams({ q: query, visibility: "all" }),
      ),
    enabled: !!form,
  });
  function open(u?: Announcement) {
    setForm(u || { id: "", title: "", body: "", revision: 0 });
    setTitle(u?.title || "");
    setBody(u?.body || "");
    setIds(
      u?.post_ids ||
        u?.posts?.map((p) => p.id) ||
        u?.linked_posts?.map((p) => p.post_id || p.id) ||
        [],
    );
    setOp(crypto.randomUUID());
    setQuery("");
    job.clear();
  }
  return (
    <>
      {editable && (
        <button className="ws-primary" onClick={() => open()}>
          <Plus size={14} />
          {t("New Update", "Nova atualização")}
        </button>
      )}
      {!data.updates.length && (
        <Empty icon={<Mail />}>
          {t(
            "No published Updates yet",
            "Ainda não há atualizações publicadas",
          )}
        </Empty>
      )}
      {data.updates.map((u) => (
        <article className="ws-update" key={u.id}>
          <small>
            {(u.created_at || u.published_at) &&
              new Date((u.published_at || u.created_at)!).toLocaleDateString()}
          </small>
          <h3>{u.title}</h3>
          <p>{u.body}</p>
          {u.posts?.map((p) => (
            <span className="ws-chip" key={p.id}>
              {p.title} · {p.status_name}
            </span>
          ))}
          {editable && (
            <button onClick={() => open(u)}>{t("Edit", "Editar")}</button>
          )}
        </article>
      ))}
      {form && (
        <Modal
          title={
            form.id
              ? t("Edit Update", "Editar atualização")
              : t("Publish an Update", "Publicar atualização")
          }
          close={() => setForm(null)}
        >
          <form
            onSubmit={onSubmit(
              () =>
                void job.run(async () => {
                  if (!body.trim() || body.length > 10000)
                    throw Error(
                      t(
                        "Enter an announcement of up to 10,000 characters.",
                        "Informe um anúncio de até 10.000 caracteres.",
                      ),
                    );
                  await write(
                    path + "/updates" + (form.id ? "/" + form.id : ""),
                    form.id ? "PATCH" : "POST",
                    {
                      title,
                      body,
                      post_ids: ids,
                      operation_id: op,
                      ...(form.id ? { revision: form.revision } : {}),
                    },
                  );
                  await refresh();
                  setForm(null);
                }),
            )}
          >
            <Field label={t("Title", "Título")}>
              <input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <RichField
              label={t("Announcement", "Anúncio")}
              initial={form.body}
              onChange={setBody}
            />
            <Field
              label={t("Link posts", "Vincular posts")}
              hint={`${ids.length} / 10`}
            >
              <input
                type="search"
                placeholder={t("Search posts", "Buscar posts")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            <div className="ws-pick-list">
              {(matches.data?.items || data.posts).map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(p.id)}
                    disabled={!ids.includes(p.id) && ids.length >= 10}
                    onChange={(e) =>
                      setIds(
                        e.target.checked
                          ? [...ids, p.id]
                          : ids.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.title}
                </label>
              ))}
            </div>
            <Msg error>{job.error || matches.error?.message}</Msg>
            {job.stale && (
              <button
                type="button"
                disabled={job.busy}
                onClick={() =>
                  void job.run(async () => {
                    await refresh();
                    setForm(null);
                  })
                }
              >
                {t(
                  "Discard draft and reload",
                  "Descartar rascunho e recarregar",
                )}
              </button>
            )}
            <div className="ws-actions">
              {form.id && (
                <button
                  type="button"
                  className="ws-danger"
                  onClick={() =>
                    void job.run(async () => {
                      if (
                        !confirm(
                          t("Delete this Update?", "Excluir esta atualização?"),
                        )
                      )
                        return;
                      await write(path + "/updates/" + form.id, "DELETE", {
                        revision: form.revision,
                      });
                      await refresh();
                      setForm(null);
                    })
                  }
                >
                  {t("Delete", "Excluir")}
                </button>
              )}
              <button className="ws-primary" disabled={job.busy}>
                {form.id
                  ? t("Save changes", "Salvar alterações")
                  : t("Publish Update", "Publicar atualização")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
