import {
  lazy,
  memo,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Columns3,
  Eye,
  FolderOpen,
  Link2,
  List,
  MessageSquare,
  Monitor,
  Newspaper,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Share2,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError } from "../api/client";
import { theme } from "../public/ui";
import type { BoardData as PublicData } from "../public/types";
import {
  apiPath,
  boardPath,
  canConfigure,
  makeDraft,
  publicPath,
  safeWebUrl,
  type BoardData,
  type Draft,
  type Org,
  type Post,
} from "./model";
import {
  Empty,
  Field,
  Loading,
  LocaleContext,
  Modal,
  Msg,
  get,
  onSubmit,
  useJob,
  useT,
  write,
} from "./shared";
import { RichField } from "./RichField";
import { BoardSettings, Customize } from "./Settings";
import { ModeratePost, Queue, Updates } from "./Moderation";
const PreviewBoard = lazy(() =>
  import("../public/BoardPresentation").then((m) => ({
    default: m.BoardPresentation,
  })),
);
type Panel = "settings" | "customize" | "details" | "moderation";
type Asset = "logo" | "cover";
type LocalAsset = { file: File; url: string; staged?: string };
function BoardDetails({
  draft,
  change,
  assets,
  selectAsset,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  assets: Partial<Record<Asset, LocalAsset>>;
  selectAsset: (kind: Asset, f: File | null) => void;
}) {
  const t = useT();
  return (
    <>
      <Field label={t("Board title", "Título do quadro")}>
        <input
          maxLength={80}
          required
          value={draft.title}
          onChange={(e) => change({ ...draft, title: e.target.value })}
        />
      </Field>
      <Field label={t("Description", "Descrição")}>
        <textarea
          maxLength={500}
          rows={4}
          value={draft.description}
          onChange={(e) => change({ ...draft, description: e.target.value })}
        />
      </Field>
      <Field label={t("Board URL slug", "Slug do quadro")}>
        <input
          value={draft.slug}
          maxLength={100}
          onChange={(e) => change({ ...draft, slug: e.target.value })}
        />
      </Field>
      {(["logo", "cover"] as const).map((k) => (
        <div className="ws-asset" key={k}>
          <Field
            label={
              k === "logo"
                ? t("Board logo", "Logo do quadro")
                : t("Board cover", "Capa do quadro")
            }
          >
            <input
              type="file"
              accept="image/png,image/webp,image/jpeg"
              onChange={(e) => {
                if (e.target.files?.[0]) selectAsset(k, e.target.files[0]);
                e.target.value = "";
              }}
            />
          </Field>
          {(assets[k] || draft[`${k}_id`]) && (
            <div className="ws-inline">
              <img
                width={48}
                height={40}
                src={assets[k]?.url || apiPath("/media/" + draft[`${k}_id`])}
                alt=""
              />
              <button onClick={() => selectAsset(k, null)}>
                <Trash2 size={14} />
                {t("Remove", "Remover")}
              </button>
            </div>
          )}
        </div>
      ))}
      <h3>{t("Board links", "Links do quadro")}</h3>
      {draft.settings.links.map((l, i) => (
        <div key={i} className="ws-category">
          {(["label", "url"] as const).map((field) => (
            <Field
              key={field}
              label={
                field === "label" ? t("Link label", "Nome do link") : "URL"
              }
            >
              <input
                type={field === "url" ? "url" : "text"}
                value={l[field]}
                onChange={(e) =>
                  change({
                    ...draft,
                    settings: {
                      ...draft.settings,
                      links: draft.settings.links.map((link, n) =>
                        n === i ? { ...link, [field]: e.target.value } : link,
                      ),
                    },
                  })
                }
              />
            </Field>
          ))}
          <button
            onClick={() =>
              change({
                ...draft,
                settings: {
                  ...draft.settings,
                  links: draft.settings.links.filter((_, n) => n !== i),
                },
              })
            }
          >
            {t("Remove link", "Remover link")}
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          change({
            ...draft,
            settings: {
              ...draft.settings,
              links: [...draft.settings.links, { label: "", url: "" }],
            },
          })
        }
      >
        <Plus size={14} />
        {t("Add link", "Adicionar link")}
      </button>
    </>
  );
}
function NewPost({
  data,
  status,
  close,
  refresh,
}: {
  data: BoardData;
  status: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const t = useT(),
    job = useJob(),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [dest, setDest] = useState(status),
    [tag, setTag] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [fileError, setFileError] = useState(""),
    staged = useRef(new Map<File, string>());
  return (
    <Modal
      title={t("Add a post", "Adicionar post")}
      close={() => {
        if (!job.busy) close();
      }}
    >
      <form
        onSubmit={onSubmit(
          () =>
            void job.run(async () => {
              if (body.length > 10000)
                throw Error(
                  t(
                    "Details exceed 10,000 characters.",
                    "O texto excede 10.000 caracteres.",
                  ),
                );
              for (const file of files) {
                if (!staged.current.has(file)) {
                  const media = await api<{ id: string }>(
                    apiPath(boardPath(data.board.id) + "/media?kind=post"),
                    {
                      method: "POST",
                      body: file,
                      headers: { "Content-Type": file.type },
                    },
                  );
                  staged.current.set(file, media.id);
                }
              }
              await write(boardPath(data.board.id) + "/posts", "POST", {
                title,
                body,
                status_id: dest,
                tag_id: tag || null,
                media_ids: files.map((f) => staged.current.get(f)),
              });
              await refresh();
              close();
            }),
        )}
      >
        <Field label={t("Title", "Título")}>
          <input
            required
            minLength={3}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <RichField label={t("Details", "Detalhes")} onChange={setBody} />
        <div className="ws-inline">
          <Field label="Status">
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              {data.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Tag", "Etiqueta")}>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">{t("No tag", "Sem etiqueta")}</option>
              {data.tags.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label={t("Images", "Imagens")}
          hint={t("Up to 4 images · 5 MiB each", "Até 4 imagens · 5 MiB cada")}
        >
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            disabled={job.busy}
            onChange={(e) => {
              const next = [...files, ...Array.from(e.target.files || [])];
              e.target.value = "";
              if (
                next.length > 4 ||
                next.some(
                  (f) =>
                    f.size > 5 * 1024 * 1024 ||
                    !["image/png", "image/jpeg", "image/webp"].includes(f.type),
                )
              ) {
                setFileError(
                  t(
                    "Choose up to four PNG, JPEG or WebP images, each under 5 MiB.",
                    "Escolha até quatro imagens PNG, JPEG ou WebP de no máximo 5 MiB cada.",
                  ),
                );
                return;
              }
              setFiles(next);
              setFileError("");
            }}
          />
        </Field>
        {files.map((f, i) => (
          <div className="ws-info-row" key={i}>
            <span>{f.name}</span>
            <button
              type="button"
              disabled={job.busy}
              onClick={() => setFiles(files.filter((_, n) => n !== i))}
            >
              {t("Remove", "Remover")}
            </button>
          </div>
        ))}
        <Msg error>{fileError || job.error}</Msg>
        <div className="ws-actions">
          <button className="ws-primary" disabled={job.busy}>
            {t("Publish post", "Publicar post")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Preview({ data, close }: { data: PublicData; close: () => void }) {
  const t = useT(),
    locale = useContext(LocaleContext),
    [device, setDevice] = useState("desktop"),
    [reset, setReset] = useState(0);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]'))
        close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);
  return (
    <div className="ws-preview">
      <header>
        <button onClick={close}>
          <ArrowLeft size={16} />
          {t("Back to editor", "Voltar ao editor")}
        </button>
        <div
          className="ws-device"
          role="group"
          aria-label={t("Preview device", "Dispositivo de prévia")}
        >
          {[
            ["desktop", Monitor, t("Desktop", "Desktop")],
            ["tablet", Tablet, t("Tablet", "Tablet")],
            ["phone", Smartphone, t("Phone", "Celular")],
          ].map(([id, Icon, label]) => {
            const I = Icon as typeof Monitor;
            return (
              <button
                key={String(id)}
                aria-label={String(label)}
                title={String(label)}
                aria-pressed={device === id}
                onClick={() => setDevice(String(id))}
              >
                <I size={17} />
              </button>
            );
          })}
        </div>
        <button onClick={() => setReset((v) => v + 1)}>
          <RotateCcw size={15} />
          {t("Start over", "Recomeçar")}
        </button>
      </header>
      <div className="ws-sim-notice">
        <Eye size={14} />
        {t(
          "Preview simulation · Changes here affect only this preview.",
          "Simulação de prévia · As alterações afetam apenas esta prévia.",
        )}
      </div>
      <div className={"ws-device-frame ws-" + device}>
        <Suspense fallback={<Loading />}>
          <PreviewBoard data={data} locale={locale} preview key={reset} />
        </Suspense>
      </div>
    </div>
  );
}
function rebase(base: unknown, local: unknown, remote: unknown): unknown {
  if (JSON.stringify(base) === JSON.stringify(local)) return remote;
  if (
    base &&
    local &&
    remote &&
    [base, local, remote].every(
      (v) => typeof v === "object" && !Array.isArray(v),
    )
  ) {
    const b = base as Record<string, unknown>,
      l = local as Record<string, unknown>,
      r = remote as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys({ ...r, ...l }).map((k) => [k, rebase(b[k], l[k], r[k])]),
    );
  }
  return local;
}
export function Editor({
  id,
  org,
  sidebar,
  home,
  refreshOrg,
}: {
  id: string;
  org: Org;
  sidebar: () => void;
  home: () => void;
  refreshOrg: () => Promise<void>;
}) {
  const locale = useContext(LocaleContext),
    q = useQuery({
      queryKey: ["editor", org.id, id, locale],
      queryFn: () => get<BoardData>(boardPath(id) + "?locale=" + locale),
    });
  if (!q.data || q.isError)
    return q.isError ? <Msg error>{q.error.message}</Msg> : <Loading />;
  return (
    <BoardEditor
      data={q.data}
      org={org}
      sidebar={sidebar}
      home={home}
      refreshOrg={refreshOrg}
      refresh={async () => {
        const r = await q.refetch({ throwOnError: true });
        return r.data!;
      }}
    />
  );
}
function BoardEditor({
  data,
  org,
  sidebar,
  home,
  refresh,
  refreshOrg,
}: {
  data: BoardData;
  org: Org;
  sidebar: () => void;
  home: () => void;
  refresh: () => Promise<BoardData>;
  refreshOrg: () => Promise<void>;
}) {
  const t = useT(),
    admin = canConfigure(org.role),
    job = useJob(),
    client = useQueryClient(),
    [panel, setPanel] = useState<Panel | null>(null),
    [simulation, setSimulation] = useState<PublicData | null>(null),
    [share, setShare] = useState(false),
    [copied, setCopied] = useState(false),
    [editing, setEditing] = useState<Post | null>(null),
    [compose, setCompose] = useState<string | null>(null),
    [local, setLocal] = useState<Draft | null>(null),
    [assets, setAssets] = useState<Partial<Record<Asset, LocalAsset>>>({}),
    [conflict, setConflict] = useState<BoardData | null>(null),
    [assetError, setAssetError] = useState(""),
    [view, setView] = useState<string>(
      () => data.settings?.opening_view || "list",
    );
  const base = useRef<Draft | null>(null),
    allUrls = useRef(new Set<string>()),
    trigger = useRef<HTMLElement | null>(null);
  const [applied, setApplied] = useState<Draft | null>(null);
  const current = useMemo(() => makeDraft(data), [data]),
    draft = local || current,
    visual = local ? applied || base.current || current : current,
    dirty = local !== null || Object.keys(assets).length > 0;
  useEffect(
    () => () => {
      for (const url of allUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change(d: Draft) {
    if (!base.current) base.current = current;
    setLocal(d);
    const field = document.activeElement;
    const typing =
      field instanceof HTMLTextAreaElement ||
      (field instanceof HTMLInputElement &&
        ["text", "url", "search"].includes(field.type));
    if (!typing) setApplied(d);
    job.clear();
  }
  const makeView = (d: Draft): PublicData => ({
    board: {
      ...data.board,
      ...d,
      logo_url:
        assets.logo?.url || (d.logo_id ? apiPath("/media/" + d.logo_id) : null),
      cover_url:
        assets.cover?.url ||
        (d.cover_id ? apiPath("/media/" + d.cover_id) : null),
    },
    statuses: d.statuses,
    tags: d.tags,
    posts: data.posts.filter(
      (p) => !p.visibility || p.visibility === "published",
    ),
    updates: data.updates.map((u) => ({
      ...u,
      posts: u.posts?.map((p) => ({
        ...p,
        status_name: p.status_name || "",
        status_color: p.color || "#777777",
      })),
    })),
  });
  function pick(k: Asset, f: File | null) {
    if (
      f &&
      (!["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
        f.size > 5 * 1024 * 1024)
    ) {
      setAssetError(
        t(
          "Choose a PNG, JPEG or WebP up to 5 MiB.",
          "Escolha uma imagem PNG, JPEG ou WebP de até 5 MiB.",
        ),
      );
      return;
    }
    setAssetError("");
    const a = { ...assets };
    if (a[k]) {
      URL.revokeObjectURL(a[k]!.url);
      allUrls.current.delete(a[k]!.url);
    }
    delete a[k];
    if (f) {
      const url = URL.createObjectURL(f);
      allUrls.current.add(url);
      a[k] = { file: f, url };
    }
    setAssets(a);
    change({ ...draft, [`${k}_id`]: null });
  }
  async function refreshAll() {
    await Promise.all([
      refresh(),
      client.invalidateQueries({ queryKey: ["queue", data.board.id] }),
      refreshOrg(),
    ]);
  }
  async function save() {
    const next = { ...draft };
    if (!next.title.trim())
      throw Error(t("Enter a board title.", "Informe um título."));
    for (const k of ["logo", "cover"] as const) {
      const f = assets[k];
      if (f) {
        if (!f.staged) {
          const result = await api<{ id: string }>(
            apiPath(boardPath(data.board.id) + "/media?kind=" + k),
            {
              method: "POST",
              body: f.file,
              headers: { "Content-Type": f.file.type },
            },
          );
          f.staged = result.id;
        }
        next[`${k}_id`] = f.staged;
      }
    }
    try {
      await write(boardPath(data.board.id), "PUT", next);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.code === "stale_revision"
      )
        setConflict(await refresh());
      throw err;
    }
    await refreshAll();
    setLocal(null);
    setAssets({});
    base.current = null;
    setApplied(null);
    setConflict(null);
  }
  function show(p: Panel) {
    trigger.current = document.activeElement as HTMLElement;
    setApplied(draft);
    setPanel((current) => (current === p ? null : p));
  }
  function closePanel() {
    setApplied(draft);
    setPanel(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  const sections: Record<Panel, string> = {
    settings: t("Settings", "Configurações"),
    customize: t("Customize", "Personalizar"),
    details: t("Board details", "Detalhes do quadro"),
    moderation: t("Moderation", "Moderação"),
  };
  const boardUrl = new URL(publicPath(data.board, org), location.origin).href;
  const tools = (
    <>
      <button
        onClick={() => show("moderation")}
        aria-pressed={panel === "moderation"}
        title={sections.moderation}
      >
        <ShieldCheck size={16} />
        <span>{sections.moderation}</span>
      </button>
      {admin && (
        <>
          <button
            onClick={() => show("settings")}
            aria-pressed={panel === "settings"}
            title={sections.settings}
          >
            <Settings2 size={16} />
            <span>{sections.settings}</span>
          </button>
          <button
            onClick={() => show("customize")}
            aria-pressed={panel === "customize"}
            title={sections.customize}
          >
            <Palette size={16} />
            <span>{sections.customize}</span>
          </button>
        </>
      )}
      <button
        title={t("Preview", "Prévia")}
        onClick={() => {
          trigger.current = document.activeElement as HTMLElement;
          setSimulation(makeView(draft));
        }}
      >
        <Eye size={16} />
        <span>{t("Preview", "Prévia")}</span>
      </button>
      {dirty && admin && (
        <button
          className="ws-save"
          disabled={job.busy}
          onClick={() =>
            void job.run(save, t("Changes saved.", "Alterações salvas."))
          }
        >
          <Save size={15} />
          {t("Save", "Salvar")}
        </button>
      )}
      <button
        className="ws-primary"
        onClick={() => {
          setShare(true);
          setCopied(false);
          job.clear();
        }}
      >
        <Share2 size={15} />
        {t("Share", "Compartilhar")}
      </button>
    </>
  );
  return (
    <div className="ws-editor">
      <div className="ws-editor-main">
        <header className="ws-topbar">
          <button
            className="ws-icon"
            aria-label={t("Toggle sidebar", "Alternar barra lateral")}
            onClick={sidebar}
          >
            <PanelLeft size={17} />
          </button>
          <button className="ws-crumb" onClick={home}>
            <FolderOpen size={15} />
            {t("Boards", "Quadros")}
          </button>
          <ChevronRight size={12} />
          <span className="ws-crumb-current">{data.board.title}</span>
          <div className="ws-toolbar">{tools}</div>
        </header>
        <Msg error>{!share && !conflict && job.error}</Msg>
        <Msg>{!share && job.note}</Msg>
        {conflict && (
          <div role="alert" className="ws-conflict">
            <strong>
              {t(
                "Another teammate saved changes. Your draft is intact.",
                "Outra pessoa salvou alterações. Seu rascunho foi preservado.",
              )}
            </strong>
            <p>
              {t(
                "Reapply your edited fields to the latest version, review them and save again. Your version takes precedence where both changed.",
                "Reaplique os campos editados na versão atual, revise e salve. Em conflitos, prevalecem as suas alterações.",
              )}
            </p>
            <button
              onClick={() => {
                const latest = makeDraft(conflict);
                const next = rebase(
                  base.current || current,
                  draft,
                  latest,
                ) as Draft;
                base.current = latest;
                setLocal({ ...next, revision: latest.revision });
                setConflict(null);
                job.clear();
              }}
            >
              {t("Reapply my edits", "Reaplicar minhas alterações")}
            </button>
            <button
              onClick={() => {
                setLocal(null);
                base.current = null;
                setAssets({});
                setConflict(null);
                job.clear();
              }}
            >
              {t("Use saved version", "Usar versão salva")}
            </button>
          </div>
        )}
        <Canvas
          data={data}
          draft={visual}
          assets={assets}
          admin={admin}
          view={view}
          setView={setView}
          openDetails={() => show("details")}
          openSettings={() => show("settings")}
          selectPost={setEditing}
          newPost={setCompose}
          refresh={refreshAll}
        />
      </div>
      {panel && (
        <aside className="ws-inspector" aria-label={sections[panel]}>
          <header>
            <h2>{sections[panel]}</h2>
            <button
              className="ws-icon"
              aria-label={t("Close panel", "Fechar painel")}
              onClick={closePanel}
            >
              <X size={16} />
            </button>
          </header>
          <fieldset
            disabled={job.busy}
            className="ws-panel-inner"
            onBlurCapture={() => setApplied(draft)}
          >
            {panel === "settings" ? (
              <BoardSettings
                boardId={data.board.id}
                draft={draft}
                change={change}
                owner={org.role === "owner"}
                posts={data.posts}
              />
            ) : panel === "customize" ? (
              <Customize draft={draft} change={change} />
            ) : panel === "details" ? (
              <>
                <BoardDetails
                  draft={draft}
                  change={change}
                  assets={assets}
                  selectAsset={pick}
                />
                <Msg error>{assetError}</Msg>
              </>
            ) : (
              <Queue data={data} edit={setEditing} />
            )}
          </fieldset>
          {dirty && panel !== "moderation" && (
            <footer>
              <button
                disabled={job.busy}
                onClick={() => {
                  setLocal(null);
                  setAssets({});
                  base.current = null;
                  job.clear();
                }}
              >
                {t("Discard", "Descartar")}
              </button>
              <button
                className="ws-primary"
                disabled={job.busy}
                onClick={() =>
                  void job.run(save, t("Changes saved.", "Alterações salvas."))
                }
              >
                {t("Save changes", "Salvar alterações")}
              </button>
            </footer>
          )}
        </aside>
      )}
      {share && (
        <Modal
          title={t("Share board", "Compartilhar quadro")}
          close={() => setShare(false)}
        >
          {data.board.published ? (
            <>
              <p>
                {t(
                  "Anyone with this link can visit your published board.",
                  "Qualquer pessoa com este link pode visitar seu quadro publicado.",
                )}
              </p>
              <Field label={t("Published URL", "URL publicada")}>
                <input
                  readOnly
                  value={boardUrl}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
              <div className="ws-actions">
                <a
                  className="ws-link-btn"
                  href={boardUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Visit board", "Visitar quadro")}
                </a>
                <button
                  className="ws-primary"
                  onClick={() =>
                    void job.run(async () => {
                      await navigator.clipboard.writeText(boardUrl);
                      setCopied(true);
                    })
                  }
                >
                  {copied ? <Check size={15} /> : <Clipboard size={15} />}{" "}
                  {copied
                    ? t("Copied", "Copiado")
                    : t("Copy link", "Copiar link")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                {admin
                  ? t(
                      "Publish your board to create its public link.",
                      "Publique seu quadro para disponibilizar o link público.",
                    )
                  : t(
                      "An admin can publish this board.",
                      "Um administrador pode publicar este quadro.",
                    )}
              </p>
              {admin && (
                <button
                  className="ws-primary"
                  disabled={job.busy}
                  onClick={() =>
                    void job.run(async () => {
                      if (dirty) await save();
                      await write(
                        boardPath(data.board.id) + "/publish",
                        "POST",
                      );
                      await refreshAll();
                    })
                  }
                >
                  {job.busy
                    ? t("Publishing…", "Publicando…")
                    : dirty
                      ? t("Save and publish", "Salvar e publicar")
                      : t("Publish board", "Publicar quadro")}
                </button>
              )}
            </>
          )}
          <Msg error>{job.error}</Msg>
        </Modal>
      )}
      {simulation && (
        <Preview
          data={simulation}
          close={() => {
            setSimulation(null);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
        />
      )}
      {editing && (
        <ModeratePost
          key={editing.id}
          post={editing}
          data={data}
          role={org.role}
          refresh={refreshAll}
          close={() => setEditing(null)}
        />
      )}{" "}
      {compose !== null && (
        <NewPost
          data={data}
          status={compose}
          close={() => setCompose(null)}
          refresh={refreshAll}
        />
      )}
    </div>
  );
}
type Page = { items: Post[]; next_cursor?: string | number | null };
type Column = {
  status_id: string;
  posts: Post[];
  next_cursor?: string | number | null;
  total: number;
};
function CanvasFeed({
  initial,
  bid,
  status,
  draw,
  sort,
}: {
  initial: Page;
  bid: string;
  status?: string;
  sort: string;
  draw: (p: Post) => React.ReactNode;
}) {
  const t = useT(),
    [pages, setPages] = useState([""]),
    cursor = pages.at(-1) || "";
  const q = useQuery({
    queryKey: ["canvas-feed", bid, status, sort, cursor],
    enabled: !!cursor,
    queryFn: () =>
      get<Page>(
        boardPath(bid) +
          "/posts?" +
          new URLSearchParams({ status: status || "", cursor, sort }),
      ),
  });
  const page = cursor ? q.data : initial;
  return (
    <>
      <Msg error>{q.error?.message}</Msg>
      {q.isFetching && cursor && <Loading />}
      {page?.items.map((p) => (
        <div key={p.id}>{draw(p)}</div>
      ))}
      {!page?.items.length && !cursor && (
        <small className="ws-empty-inline">
          {t("No posts yet", "Ainda não há posts")}
        </small>
      )}
      <div className="ws-feed-pages">
        {pages.length > 1 && (
          <button onClick={() => setPages(pages.slice(0, -1))}>
            {t("Previous", "Anterior")}
          </button>
        )}
        {page?.next_cursor != null && (
          <button
            onClick={() => setPages([...pages, String(page.next_cursor)])}
          >
            {t("More posts", "Mais posts")}
          </button>
        )}
      </div>
    </>
  );
}
const Canvas = memo(
  function Canvas({
    data,
    draft,
    assets,
    admin,
    view,
    setView,
    openDetails,
    openSettings,
    selectPost,
    newPost,
    refresh,
  }: {
    data: BoardData;
    draft: Draft;
    assets: Partial<Record<Asset, LocalAsset>>;
    admin: boolean;
    view: string;
    setView: (v: string) => void;
    openDetails: () => void;
    openSettings: () => void;
    selectPost: (p: Post) => void;
    newPost: (status: string) => void;
    refresh: () => Promise<void>;
  }) {
    const t = useT(),
      job = useJob(),
      [moving, setMoving] = useState<{ p: Post; to: string } | null>(null),
      src = (k: Asset) =>
        assets[k]?.url ||
        (draft[`${k}_id`] ? apiPath("/media/" + draft[`${k}_id`]) : undefined),
      settings = draft.settings,
      actualView =
        view === "roadmap" && !settings.roadmap_visible ? "list" : view;
    const columns = (data as BoardData & { columns?: Column[] }).columns || [],
      initialDefault =
        data.statuses.find((s) => s.is_default)?.id ||
        data.statuses[0]?.id ||
        "",
      statusOptions = draft.statuses.filter((s) => s.on_roadmap !== false);
    const card = (p: Post) => {
      const tag = draft.tags.find((v) => v.id === p.tag_id),
        s = draft.statuses.find((v) => v.id === p.status_id);
      return (
        <button
          className={
            "ws-post-card " + (actualView === "list" ? "ws-post-row" : "")
          }
          draggable={!moving}
          onDragStart={(e) =>
            e.dataTransfer.setData(
              "text/kiska-post",
              JSON.stringify({ id: p.id, from: p.status_id }),
            )
          }
          onClick={() => selectPost(p)}
        >
          <strong>{p.title}</strong>
          {settings.board_fields.body &&
            settings.density !== "compact" &&
            (p.excerpt || p.body) && <span>{p.excerpt || p.body}</span>}
          <div className="ws-post-meta">
            {actualView === "list" && s && (
              <small>
                <i style={{ background: s.color }} />
                {s.name}
              </small>
            )}
            {tag && settings.board_fields.tag && <small>{tag.name}</small>}
            {settings.board_fields.votes && (
              <small>
                <ChevronUp size={13} />
                {p.votes ?? p.vote_count ?? 0}
              </small>
            )}
            {settings.board_fields.comments && (
              <small>
                <MessageSquare size={12} />
                {p.comment_count ?? 0}
              </small>
            )}
            {p.visibility === "pending" && (
              <small>{t("Pending", "Pendente")}</small>
            )}
          </div>
        </button>
      );
    };
    async function move(id: string, to: string, from: string) {
      if (to === from || moving) return;
      const p = [...data.posts, ...columns.flatMap((c) => c.posts)].find(
        (x) => x.id === id,
      );
      if (p) setMoving({ p, to });
      try {
        await write(boardPath(data.board.id) + "/moderate", "POST", {
          action: "move",
          post_id: id,
          status_id: to,
          revision: p?.revision,
        });
      } finally {
        try {
          await refresh();
        } finally {
          setMoving(null);
        }
      }
    }
    return (
      <div className="ws-canvas" style={theme(draft.appearance)}>
        {src("cover") && <img className="ws-cover" src={src("cover")} alt="" />}
        <div className="ws-canvas-content">
          <div className="ws-board-heading">
            {src("logo") && (
              <img className="ws-branding-logo" src={src("logo")} alt="" />
            )}
            <div className="ws-inline">
              <span className="ws-board-status">
                <span
                  className={
                    data.board.published ? "ws-live-dot" : "ws-draft-dot"
                  }
                />
                {data.board.published
                  ? t("Published board", "Quadro publicado")
                  : t("Draft board", "Quadro em rascunho")}
              </span>
              {admin && (
                <button className="ws-text ws-subtle" onClick={openDetails}>
                  <Pencil size={13} />
                  {t("Edit details", "Editar detalhes")}
                </button>
              )}
            </div>
            <h1>{draft.title}</h1>
            {draft.description && <p>{draft.description}</p>}
            {settings.links.map((l, i) =>
              safeWebUrl(l.url) ? (
                <a
                  key={i}
                  className="ws-board-ext"
                  href={safeWebUrl(l.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Link2 size={13} />
                  {l.label || l.url}
                </a>
              ) : null,
            )}
            <div className="ws-board-nav">
              <div className="ws-tabs">
                {[
                  ["list", List, t("List", "Lista")],
                  ...(settings.roadmap_visible
                    ? [["roadmap", Columns3, "Roadmap"]]
                    : []),
                  ["updates", Newspaper, t("Updates", "Atualizações")],
                ].map(([v, Icon, n]) => {
                  const I = Icon as typeof List;
                  return (
                    <button
                      key={String(v)}
                      aria-pressed={actualView === v}
                      onClick={() => setView(String(v))}
                    >
                      <I size={15} />
                      {String(n)}
                    </button>
                  );
                })}
              </div>
              {actualView !== "updates" && (
                <button onClick={() => newPost(initialDefault)}>
                  <Plus size={15} />
                  {t("Add post", "Adicionar post")}
                </button>
              )}
            </div>
          </div>
          <Msg error>{job.error}</Msg>
          {actualView === "roadmap" ? (
            <div className="ws-roadmap">
              {statusOptions.map((s) => {
                const c = columns.find((c) => c.status_id === s.id),
                  list = (
                    c?.posts || data.posts.filter((p) => p.status_id === s.id)
                  ).filter((p) => !moving || p.id !== moving.p.id);
                if (moving?.to === s.id)
                  list.unshift({ ...moving.p, status_id: s.id });
                const live = data.statuses.some((x) => x.id === s.id);
                return (
                  <section
                    className="ws-column"
                    key={s.id}
                    onDragOver={(e) => {
                      if (live) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const raw = e.dataTransfer.getData(
                        "text/kiska-post",
                      );
                      if (!raw || !live) return;
                      try {
                        const v = JSON.parse(raw);
                        void job.run(() => move(v.id, s.id, v.from));
                      } catch {
                        /* Another application supplied this drag. */
                      }
                    }}
                  >
                    <header>
                      <i style={{ background: s.color }} />
                      <strong>{s.name}</strong>
                      <small>{c?.total ?? list.length}</small>
                      {live && (
                        <button
                          aria-label={
                            t("Add post to ", "Adicionar post em ") + s.name
                          }
                          onClick={() => newPost(s.id)}
                        >
                          <Plus size={15} />
                        </button>
                      )}
                    </header>
                    <CanvasFeed
                      bid={data.board.id}
                      status={s.id}
                      sort="top"
                      initial={{ items: list, next_cursor: c?.next_cursor }}
                      draw={card}
                    />
                    {live && (
                      <button
                        className="ws-add-card"
                        onClick={() => newPost(s.id)}
                      >
                        <Plus size={14} />
                        {t("Add a post", "Adicionar post")}
                      </button>
                    )}
                  </section>
                );
              })}
              {admin && (
                <button
                  className="ws-add-column"
                  onClick={openSettings}
                  aria-label={t("Edit columns", "Editar colunas")}
                >
                  <Settings2 size={15} />
                </button>
              )}
            </div>
          ) : actualView === "updates" ? (
            <section className="ws-canvas-list">
              <Updates data={data} editable={admin} refresh={refresh} />
            </section>
          ) : (
            <section className="ws-canvas-list">
              {!data.posts.length ? (
                <Empty icon={<MessageSquare />}>
                  {t("No feedback yet", "Ainda não há feedback")}
                </Empty>
              ) : (
                <CanvasFeed
                  bid={data.board.id}
                  sort={settings.sort}
                  initial={{
                    items: data.posts,
                    next_cursor: (data as BoardData & { next_cursor?: string })
                      .next_cursor,
                  }}
                  draw={card}
                />
              )}
            </section>
          )}
        </div>
      </div>
    );
  },
  (a, b) =>
    a.data === b.data &&
    a.draft === b.draft &&
    a.assets === b.assets &&
    a.admin === b.admin &&
    a.view === b.view,
);
