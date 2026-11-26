import { ManualOrder } from "./ManualOrder";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Palette,
  Plus,
  Trash2,
} from "lucide-react";
import {
  defaultAppearance,
  moveItem,
  type Appearance,
  type Category,
  type Draft,
  type Post,
  type Settings,
} from "./model";
import { Field, Toggle, useT } from "./shared";

export type EditProps = { draft: Draft; change: (value: Draft) => void };
const optionLabels: Record<string, [string, string]> = {
  list: ["List", "Lista"],
  roadmap: ["Roadmap", "Roadmap"],
  roomy: ["Roomy", "Espaçoso"],
  compact: ["Compact", "Compacto"],
  trending: ["Trending", "Em alta"],
  top: ["Top voted", "Mais votados"],
  new: ["Newest", "Recentes"],
  manual: ["Manual", "Manual"],
  small: ["Small", "Pequeno"],
  medium: ["Medium", "Médio"],
  large: ["Large", "Grande"],
  narrow: ["Narrow", "Estreito"],
  wide: ["Wide", "Largo"],
  short: ["Short", "Baixa"],
  tall: ["Tall", "Alta"],
  circle: ["Circle", "Círculo"],
  rounded: ["Rounded", "Arredondado"],
  square: ["Square", "Quadrado"],
  outline: ["Outline", "Contorno"],
  filled: ["Filled", "Preenchido"],
  pill: ["Pill", "Pílula"],
};
function Choices({
  label,
  value,
  choices,
  choose,
}: {
  label: string;
  value: string;
  choices: string[];
  choose: (s: string) => void;
}) {
  const t = useT();
  return (
    <div className="ws-setting">
      <strong>{label}</strong>
      <div role="group" aria-label={label} className="ws-choices">
        {choices.map((c) => (
          <button key={c} aria-pressed={value === c} onClick={() => choose(c)}>
            {optionLabels[c] ? t(...optionLabels[c]) : c}
          </button>
        ))}
      </div>
    </div>
  );
}
function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ws-setting-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
export function Customize({ draft, change }: EditProps) {
  const t = useT(),
    a = draft.appearance;
  const set = (k: keyof Appearance, v: string) =>
    change({ ...draft, appearance: { ...a, [k]: v } });
  const sizes = ["small", "medium", "large"],
    shapes = ["square", "rounded", "pill"];
  const controls = (entries: [keyof Appearance, string, string[]][]) =>
    entries.map(([key, label, values]) => (
      <Choices
        key={key}
        label={label}
        value={a[key]}
        choices={values}
        choose={(x) => set(key, x)}
      />
    ));
  return (
    <>
      <button
        className="ws-text ws-reset"
        onClick={() =>
          change({ ...draft, appearance: { ...defaultAppearance } })
        }
      >
        {t("Reset appearance", "Restaurar aparência")}
      </button>
      <Group title={t("Colors", "Cores")}>
        {(
          [
            ["background", t("Background", "Fundo")],
            ["text", t("Text", "Texto")],
            ["accent", t("Accent", "Destaque")],
            ["button", t("Button", "Botão")],
          ] as [keyof Appearance, string][]
        ).map(([k, l]) => (
          <label className="ws-color" key={k}>
            <span>
              <Palette size={14} />
              {l}
            </span>
            <span>
              <input
                type="color"
                aria-label={l}
                value={a[k]}
                onChange={(e) => set(k, e.target.value)}
              />
              <code>{a[k].toUpperCase()}</code>
            </span>
          </label>
        ))}
      </Group>
      <Group title={t("Text", "Texto")}>
        <Field label={t("Font", "Fonte")}>
          <select value={a.font} onChange={(e) => set("font", e.target.value)}>
            {["Poppins", "Arial", "Georgia", "system-ui", "monospace"].map(
              (f) => (
                <option key={f}>{f}</option>
              ),
            )}
          </select>
        </Field>
        {controls([["text_size", t("Text size", "Tamanho do texto"), sizes]])}
      </Group>
      <Group title={t("Layout", "Layout")}>
        {controls([
          [
            "page_width",
            t("Page width", "Largura da página"),
            ["narrow", "medium", "wide"],
          ],
          [
            "cover_height",
            t("Cover height", "Altura da capa"),
            ["short", "medium", "tall"],
          ],
          ["logo_size", t("Logo size", "Tamanho do logo"), sizes],
          [
            "logo_shape",
            t("Logo shape", "Formato do logo"),
            ["circle", "rounded", "square"],
          ],
        ])}
      </Group>
      <Group title={t("Inputs", "Campos")}>
        {controls([
          [
            "input_style",
            t("Input style", "Estilo do campo"),
            ["outline", "filled"],
          ],
          ["input_size", t("Input size", "Tamanho do campo"), sizes],
          ["input_shape", t("Input corners", "Cantos do campo"), shapes],
        ])}
      </Group>
      <Group title={t("Buttons", "Botões")}>
        {controls([
          ["button_size", t("Button size", "Tamanho do botão"), sizes],
          ["button_shape", t("Button corners", "Cantos do botão"), shapes],
        ])}
      </Group>
    </>
  );
}
function Categories({
  draft,
  change,
  kind,
}: EditProps & { kind: "statuses" | "tags" }) {
  const t = useT(),
    rows = draft[kind],
    status = kind === "statuses";
  const [remove, setRemove] = useState(""),
    [target, setTarget] = useState("");
  const title = status ? t("Statuses", "Status") : t("Tags", "Etiquetas");
  function update(items: Category[]) {
    change({ ...draft, [kind]: items.map((s, i) => ({ ...s, position: i })) });
  }
  function modify(id: string, next: Partial<Category>) {
    update(rows.map((s) => (s.id === id ? { ...s, ...next } : s)));
  }
  return (
    <details className="ws-disclosure">
      <summary>
        {title}
        <ChevronDown size={14} />
      </summary>
      {rows.map((s, i) => (
        <div className="ws-category" key={s.id}>
          <div className="ws-inline">
            <input
              type="color"
              aria-label={t("Color for ", "Cor de ") + s.name}
              value={s.color}
              onChange={(e) => modify(s.id, { color: e.target.value })}
            />
            <input
              aria-label={t("Label", "Rótulo")}
              value={s.name}
              maxLength={60}
              onChange={(e) =>
                modify(s.id, { name: e.target.value, preset: null })
              }
            />
          </div>
          <div className="ws-mini-tools">
            {status && (
              <label>
                <input
                  type="radio"
                  name="ws-default-status"
                  checked={!!s.is_default}
                  onChange={() =>
                    update(
                      rows.map((row) => ({
                        ...row,
                        is_default: row.id === s.id,
                      })),
                    )
                  }
                />
                {t("Default", "Padrão")}
              </label>
            )}
            <button
              disabled={i === 0}
              aria-label={t("Move up ", "Subir ") + s.name}
              onClick={() => update(moveItem(rows, i, -1))}
            >
              <ArrowUp size={13} />
            </button>
            <button
              disabled={i === rows.length - 1}
              aria-label={t("Move down ", "Descer ") + s.name}
              onClick={() => update(moveItem(rows, i, 1))}
            >
              <ArrowDown size={13} />
            </button>
            <button
              disabled={status && !!s.is_default}
              aria-label={t("Remove ", "Remover ") + s.name}
              onClick={() => {
                if (status) {
                  setRemove(s.id);
                  setTarget(rows.find((r) => r.id !== s.id)?.id || "");
                } else update(rows.filter((r) => r.id !== s.id));
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
          {status && (
            <div className="ws-mini-tools">
              <label>
                <input
                  type="checkbox"
                  checked={s.on_roadmap !== false}
                  onChange={(e) =>
                    modify(s.id, { on_roadmap: e.target.checked })
                  }
                />
                Roadmap
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!s.visitor_allowed}
                  onChange={(e) =>
                    modify(s.id, { visitor_allowed: e.target.checked })
                  }
                />
                {t("Visitor submissions", "Posts de visitantes")}
              </label>
            </div>
          )}
          {remove === s.id && (
            <div>
              <Field
                label={t(
                  "Reassign existing posts to",
                  "Reatribuir posts existentes a",
                )}
              >
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {rows
                    .filter((r) => r.id !== s.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </Field>
              <button
                disabled={!target}
                onClick={() => {
                  change({
                    ...draft,
                    statuses: rows
                      .filter((r) => r.id !== s.id)
                      .map((r, position) => ({ ...r, position })),
                    reassignments: { ...draft.reassignments, [s.id]: target },
                  });
                  setRemove("");
                }}
              >
                {t("Reassign and remove", "Reatribuir e remover")}
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        onClick={() =>
          update([
            ...rows,
            {
              id: crypto.randomUUID(),
              name: status
                ? t("New status", "Novo status")
                : t("New tag", "Nova etiqueta"),
              color: status ? "#7a8493" : "#62839a",
              position: rows.length,
              is_default: status && !rows.length,
              on_roadmap: true,
              visitor_allowed: false,
            },
          ])
        }
      >
        <Plus size={14} />
        {status
          ? t("Add status", "Adicionar status")
          : t("Add tag", "Adicionar etiqueta")}
      </button>
    </details>
  );
}
export function BoardSettings({
  draft,
  change,
  owner,
  posts,
  boardId,
}: EditProps & { owner: boolean; posts: Post[]; boardId: string }) {
  const t = useT(),
    s = draft.settings;
  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    change({ ...draft, settings: { ...s, [k]: v } });
  }
  const names: Record<string, string> = {
    body: t("Details", "Detalhes"),
    tag: t("Tag", "Etiqueta"),
    images: t("Images", "Imagens"),
    author: t("Author", "Autor"),
    votes: t("Votes", "Votos"),
    comments: t("Comments", "Comentários"),
  };
  return (
    <>
      <Group title={t("Board", "Quadro")}>
        <Choices
          label={t("Opens on", "Visão inicial")}
          value={s.opening_view}
          choices={["list", ...(s.roadmap_visible ? ["roadmap"] : [])]}
          choose={(v) => set("opening_view", v as Settings["opening_view"])}
        />
        <Choices
          label={t("List rows", "Linhas da lista")}
          value={s.density}
          choices={["roomy", "compact"]}
          choose={(v) => set("density", v as Settings["density"])}
        />
        <Field label={t("Order", "Ordenação")}>
          <select
            value={s.sort}
            onChange={(e) => set("sort", e.target.value as Settings["sort"])}
          >
            {["trending", "top", "new", "manual"].map((k) => (
              <option value={k} key={k}>
                {t(...optionLabels[k])}
              </option>
            ))}
          </select>
        </Field>
        {s.sort === "manual" && (
          <ManualOrder
            boardId={boardId}
            posts={posts}
            order={s.manual_order}
            change={(ids) => set("manual_order", ids)}
          />
        )}
        <Toggle
          label={t("Show roadmap", "Exibir roadmap")}
          checked={s.roadmap_visible}
          onChange={(v) =>
            change({
              ...draft,
              settings: {
                ...s,
                roadmap_visible: v,
                opening_view: v ? s.opening_view : "list",
              },
            })
          }
        />
        <Categories draft={draft} change={change} kind="statuses" />
        <Categories draft={draft} change={change} kind="tags" />
      </Group>
      <Group title={t("Posts", "Posts")}>
        <Toggle
          label={t("Allow visitor posts", "Permitir posts de visitantes")}
          checked={s.public_posting}
          onChange={(v) => set("public_posting", v)}
        />
        <Field label={t("Submission button text", "Texto do botão de envio")}>
          <input
            value={s.button_text}
            placeholder={t("Add a post", "Adicionar post")}
            maxLength={60}
            onChange={(e) => set("button_text", e.target.value)}
          />
        </Field>
        <Toggle
          label={t("Review before publishing", "Revisar antes de publicar")}
          checked={s.require_approval}
          onChange={(v) => set("require_approval", v)}
        />
        <Toggle
          label={t("Voting", "Votação")}
          checked={s.voting_enabled}
          onChange={(v) => set("voting_enabled", v)}
        />
        <Toggle
          label={t("Guest image uploads", "Envio de imagens por visitantes")}
          checked={s.guest_uploads}
          onChange={(v) => set("guest_uploads", v)}
        />
      </Group>
      <Group title={t("Post fields", "Campos do post")}>
        <table className="ws-fields-grid">
          <thead>
            <tr>
              <th>{t("Field", "Campo")}</th>
              <th>{t("Board", "Quadro")}</th>
              <th>{t("Form", "Formulário")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>{t("Title", "Título")}</th>
              <td>✓</td>
              <td>✓</td>
            </tr>
            {Object.entries(names).map(([key, n]) => (
              <tr key={key}>
                <th>{n}</th>
                {(["board_fields", "form_fields"] as const).map((group) => (
                  <td key={group}>
                    {key in s[group] ? (
                      <input
                        type="checkbox"
                        aria-label={`${n} (${group === "board_fields" ? t("Board", "Quadro") : t("Form", "Formulário")})`}
                        checked={s[group][key]}
                        onChange={(e) =>
                          set(group, { ...s[group], [key]: e.target.checked })
                        }
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Group>
      {owner && (
        <Group title={t("Discovery", "Descoberta")}>
          <Toggle
            label={t("Search engine indexing", "Indexação por buscadores")}
            checked={s.indexing}
            onChange={(v) => set("indexing", v)}
          />
        </Group>
      )}
    </>
  );
}
