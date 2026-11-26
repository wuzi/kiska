import { useState, type DragEvent } from "react";
import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Filter,
  Folder,
  FolderPlus,
  GripVertical,
  Layers3,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  boardPath,
  canConfigure,
  orgPath,
  type Board,
  type Folder as FolderType,
  type OrgData,
  type Role,
} from "./model";
import { Field, Modal, Msg, onSubmit, useJob, useT, write } from "./shared";
export function Home({
  data,
  role,
  refresh,
  openBoard,
}: {
  data: OrgData;
  role: Role;
  refresh: () => Promise<void>;
  openBoard: (b: Board) => void;
}) {
  const t = useT(),
    { organization: org, boards, folders } = data,
    admin = canConfigure(role),
    job = useJob();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [form, setForm] = useState<"board" | "folder" | null>(null),
    [selected, setSelected] = useState<Board | null>(null),
    [editFolder, setEditFolder] = useState<FolderType | null>(null),
    [name, setName] = useState(""),
    [folder, setFolder] = useState(""),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const shown = boards.filter(
    (b) =>
      b.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (filter === "closed"
        ? !!b.closed_at
        : !b.closed_at &&
          (filter === "all" ||
            (filter === "draft" ? !b.published : b.published))),
  );
  const path = orgPath(org.id);
  function start(kind: "board" | "folder", folderId = "") {
    setForm(kind);
    setName("");
    setFolder(folderId);
    setEditFolder(null);
    job.clear();
  }
  async function mutate(url: string, method: string, body?: unknown) {
    await write(url, method, body);
    await refresh();
  }
  function pin(b: Board, v: boolean) {
    void job.run(() => mutate(boardPath(b.id) + "/pin", "PUT", { pinned: v }));
  }
  function position(b: Board, folder_id: string | null, position: number) {
    void job.run(() =>
      mutate(boardPath(b.id) + "/position", "PATCH", { folder_id, position }),
    );
  }
  function drop(
    e: DragEvent,
    folderId: string | null,
    index: number,
    pinned = false,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const dragged = e.dataTransfer.getData("text/patchboard-folder");
    if (dragged) {
      const from = folders.find((f) => f.id === dragged),
        to = folders.find((f) => f.id === folderId);
      if (admin && from && to && from !== to)
        void job.run(() =>
          mutate(path + "/folders/" + from.id, "PATCH", {
            position: to.position,
          }),
        );
      return;
    }
    const b = boards.find(
      (x) => x.id === e.dataTransfer.getData("text/patchboard-board"),
    );
    if (!b) return;
    if (pinned) pin(b, true);
    else if (admin) position(b, folderId, index);
  }
  const sortBoard = (a: Board, b: Board) =>
    (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title);
  function group(
    id: string,
    label: string,
    items: Board[],
    pinned = false,
    folderItem?: FolderType,
  ) {
    const folded = collapsed.includes(id);
    return (
      <section
        key={id}
        className="ws-folder"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => drop(e, id === "root" ? null : id, items.length, pinned)}
      >
        <div
          className="ws-folder-head"
          draggable={!!folderItem && admin}
          onDragStart={(e) => {
            if (folderItem)
              e.dataTransfer.setData("text/patchboard-folder", folderItem.id);
          }}
        >
          <button
            className="ws-text"
            aria-expanded={!folded}
            onClick={() =>
              setCollapsed(
                folded ? collapsed.filter((v) => v !== id) : [...collapsed, id],
              )
            }
          >
            <ChevronDown className={folded ? "ws-folded" : ""} size={14} />
            {pinned ? <Pin size={15} /> : <Folder size={16} />}
            <strong>{label}</strong>
            <small>{items.length}</small>
          </button>
          {admin && !pinned && (
            <>
              <button
                className="ws-icon"
                aria-label={t("Add board to ", "Adicionar quadro a ") + label}
                onClick={() => start("board", id === "root" ? "" : id)}
              >
                <Plus size={15} />
              </button>
              {folderItem && (
                <button
                  className="ws-icon"
                  aria-label={t("Edit folder ", "Editar pasta ") + label}
                  onClick={() => {
                    setEditFolder(folderItem);
                    setForm("folder");
                    setName(folderItem.name);
                    job.clear();
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              )}
            </>
          )}
        </div>
        {!folded &&
          (items.length ? (
            items.sort(sortBoard).map((b, i) => (
              <div
                key={b.id}
                className="ws-board-row"
                draggable={!b.closed_at}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/patchboard-board", b.id);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, id === "root" ? null : id, i, pinned)}
              >
                <GripVertical className="ws-grip" size={14} />
                <button className="ws-board-link" onClick={() => openBoard(b)}>
                  <span className="ws-board-symbol">
                    {b.logo_id ? (
                      <img alt="" src={"/api/v1/media/" + b.logo_id} />
                    ) : (
                      <Layers3 size={18} />
                    )}
                  </span>
                  <strong>{b.title}</strong>
                </button>
                <small className="ws-row-state">
                  {b.closed_at
                    ? t("Closed", "Encerrado")
                    : b.suspended
                      ? t("Suspended", "Suspenso")
                      : !b.published
                        ? t("Draft", "Rascunho")
                        : null}
                </small>
                <span className="ws-row-count">
                  <MessageSquare size={13} />
                  {b.post_count ?? 0} {t("posts", "posts")}
                </span>
                <button
                  className="ws-icon"
                  aria-label={t("Board actions for ", "Ações para ") + b.title}
                  onClick={() => {
                    setSelected(b);
                    setFolder(b.folder_id || "");
                    job.clear();
                  }}
                >
                  <MoreHorizontal size={17} />
                </button>
              </div>
            ))
          ) : (
            <div className="ws-drop">
              {pinned
                ? t(
                    "Drop a board here to pin it",
                    "Solte um quadro aqui para fixá-lo",
                  )
                : query
                  ? t("No matching boards", "Nenhum quadro encontrado")
                  : t("No boards here yet", "Ainda não há quadros aqui")}
            </div>
          ))}
      </section>
    );
  }
  return (
    <section className="ws-page ws-home">
      <div className="ws-heading">
        <div>
          <h1>{t("Your boards", "Seus quadros")}</h1>
          <p>
            {t(
              "Drag boards and folders into the order you want.",
              "Arraste os quadros e pastas para organizá-los.",
            )}
          </p>
        </div>
        <div className="ws-tools">
          <label className="ws-search">
            <Search size={15} />
            <input
              aria-label={t("Search boards", "Buscar quadros")}
              placeholder={t("Search boards", "Buscar quadros")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="ws-filter">
            <Filter size={14} />
            <select
              aria-label={t("Filter boards", "Filtrar quadros")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {[
                ["all", t("Filter", "Filtrar")],
                ["published", t("Published", "Publicados")],
                ["draft", t("Drafts", "Rascunhos")],
                ["closed", t("Closed", "Encerrados")],
              ].map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {admin && (
            <>
              <button onClick={() => start("folder")}>
                <FolderPlus size={14} />
                {t("New folder", "Nova pasta")}
              </button>
              <button className="ws-primary" onClick={() => start("board")}>
                <Plus size={15} />
                {t("Create board", "Criar quadro")}
              </button>
            </>
          )}
        </div>
      </div>
      <Msg error>{!form && !selected && job.error}</Msg>
      {group(
        "pinned",
        t("Pinned", "Fixados"),
        shown.filter((b) => b.pinned),
        true,
      )}
      {group(
        "root",
        t("All boards", "Todos os quadros"),
        shown.filter((b) => !b.folder_id),
      )}
      {[...folders]
        .sort((a, b) => a.position - b.position)
        .map((f) =>
          group(
            f.id,
            f.name,
            shown.filter((b) => b.folder_id === f.id),
            false,
            f,
          ),
        )}
      {form && (
        <Modal
          close={() => setForm(null)}
          title={
            form === "board"
              ? t("Create board", "Criar quadro")
              : editFolder
                ? t("Edit folder", "Editar pasta")
                : t("New folder", "Nova pasta")
          }
        >
          <form
            onSubmit={onSubmit(
              () =>
                void job.run(async () => {
                  if (form === "folder") {
                    await mutate(
                      path +
                        "/folders" +
                        (editFolder ? "/" + editFolder.id : ""),
                      editFolder ? "PATCH" : "POST",
                      { name },
                    );
                    setForm(null);
                  } else {
                    const result = await write<{ board?: Board; id?: string }>(
                      path + "/boards",
                      "POST",
                      { title: name, folder_id: folder || null },
                    );
                    await refresh();
                    setForm(null);
                    const b =
                      result?.board ?? (result?.id ? { id: result.id } : null);
                    if (b) openBoard(b as Board);
                  }
                }),
            )}
          >
            <Field
              label={
                form === "board"
                  ? t("Board title", "Título do quadro")
                  : t("Folder name", "Nome da pasta")
              }
            >
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {form === "board" && (
              <Field label={t("Folder", "Pasta")}>
                <select
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                >
                  <option value="">
                    {t("All boards", "Todos os quadros")}
                  </option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Msg error>{job.error}</Msg>
            <div className="ws-actions">
              {editFolder && (
                <>
                  <button
                    type="button"
                    aria-label={t("Move folder up", "Mover pasta para cima")}
                    onClick={() =>
                      void job.run(async () => {
                        await mutate(
                          path + "/folders/" + editFolder.id,
                          "PATCH",
                          { position: Math.max(0, editFolder.position - 1) },
                        );
                        setForm(null);
                      })
                    }
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("Move folder down", "Mover pasta para baixo")}
                    onClick={() =>
                      void job.run(async () => {
                        await mutate(
                          path + "/folders/" + editFolder.id,
                          "PATCH",
                          { position: editFolder.position + 1 },
                        );
                        setForm(null);
                      })
                    }
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void job.run(async () => {
                        await mutate(
                          path + "/folders/" + editFolder.id,
                          "DELETE",
                        );
                        setForm(null);
                      })
                    }
                  >
                    <Trash2 size={14} />
                    {t("Remove folder", "Remover pasta")}
                  </button>
                </>
              )}
              <button className="ws-primary" disabled={job.busy}>
                {editFolder ? t("Save", "Salvar") : t("Create", "Criar")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal title={selected.title} close={() => setSelected(null)}>
          <div className="ws-stack">
            {!selected.closed_at && (
              <button
                onClick={() => {
                  setSelected(null);
                  openBoard(selected);
                }}
              >
                <Pencil size={15} />
                {t("Open board", "Abrir quadro")}
              </button>
            )}
            <button
              disabled={job.busy}
              onClick={() =>
                void job.run(async () => {
                  await mutate(boardPath(selected.id) + "/pin", "PUT", {
                    pinned: !selected.pinned,
                  });
                  setSelected(null);
                })
              }
            >
              {selected.pinned ? <PinOff size={15} /> : <Pin size={15} />}{" "}
              {selected.pinned
                ? t("Unpin board", "Desafixar quadro")
                : t("Pin board", "Fixar quadro")}
            </button>
            {admin && !selected.closed_at && (
              <>
                <Field label={t("Move to folder", "Mover para pasta")}>
                  <select
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                  >
                    <option value="">
                      {t("All boards", "Todos os quadros")}
                    </option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="ws-actions">
                  {[-1, 1].map((dir) => (
                    <button
                      key={dir}
                      disabled={job.busy}
                      onClick={() =>
                        void job.run(async () => {
                          await mutate(
                            boardPath(selected.id) + "/position",
                            "PATCH",
                            {
                              folder_id: selected.folder_id,
                              position: Math.max(
                                0,
                                (selected.position ?? 0) + dir,
                              ),
                            },
                          );
                          setSelected(null);
                        })
                      }
                    >
                      {dir < 0 ? (
                        <ArrowUp size={15} />
                      ) : (
                        <ArrowDown size={15} />
                      )}{" "}
                      {dir < 0
                        ? t("Move up", "Subir")
                        : t("Move down", "Descer")}
                    </button>
                  ))}
                  <button
                    disabled={job.busy || folder === (selected.folder_id || "")}
                    onClick={() =>
                      void job.run(async () => {
                        await mutate(
                          boardPath(selected.id) + "/position",
                          "PATCH",
                          {
                            folder_id: folder || null,
                            position: boards.length,
                          },
                        );
                        setSelected(null);
                      })
                    }
                  >
                    {t("Move", "Mover")}
                  </button>
                </div>
              </>
            )}
            {role === "owner" && (
              <button
                className="ws-danger"
                disabled={job.busy}
                onClick={() =>
                  void job.run(async () => {
                    if (
                      !selected.closed_at &&
                      !confirm(
                        t(
                          "Close this board? The owner can restore it for 30 days.",
                          "Encerrar o quadro? O proprietário pode restaurá-lo por 30 dias.",
                        ),
                      )
                    )
                      return;
                    await mutate(
                      boardPath(selected.id) +
                        (selected.closed_at ? "/restore" : "/close"),
                      "POST",
                    );
                    setSelected(null);
                  })
                }
              >
                {selected.closed_at ? (
                  <ArchiveRestore size={15} />
                ) : (
                  <Trash2 size={15} />
                )}{" "}
                {selected.closed_at
                  ? t("Restore board", "Restaurar quadro")
                  : t("Close board", "Encerrar quadro")}
              </button>
            )}
            <Msg error>{job.error}</Msg>
          </div>
        </Modal>
      )}
    </section>
  );
}
