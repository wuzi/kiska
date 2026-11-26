import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Search,
  ShieldCheck,
} from "lucide-react";
import { formatBytes } from "./model";
import {
  Empty,
  Field,
  Loading,
  Modal,
  Msg,
  get,
  onSubmit,
  useJob,
  useT,
  write,
} from "./shared";
type Target = {
  id: string;
  name?: string;
  title?: string;
  suspended?: boolean;
  closed_at?: string;
  media_bytes?: number;
  media_limit?: number;
  board_limit?: number;
  seat_limit?: number;
  org_limit?: number;
};
type Audit = {
  id: string;
  actor: string;
  target_id: string;
  target_type: string;
  action: string;
  reason: string;
  created_at: string;
  change?: Record<string, unknown>;
};
type OperatorData = {
  organizations: Target[];
  boards: Target[];
  audit: Audit[];
  defaults?: Target;
  next_cursor?: number | null;
};
export function Operator() {
  const t = useT(),
    [kind, setKind] = useState("organization"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Target | null>(null),
    [action, setAction] = useState("limits"),
    [limits, setLimits] = useState<Record<string, number>>({}),
    [reason, setReason] = useState(""),
    job = useJob();
  const q = useQuery({
    queryKey: ["operator", kind, search, page],
    queryFn: () =>
      get<OperatorData>(
        "/operator?" +
          new URLSearchParams({ kind, q: search, cursor: String(page * 30) }),
      ),
  });
  const filtered =
    (kind === "organization" ? q.data?.organizations : q.data?.boards) ?? [];
  const audit = q.data?.audit ?? [];
  const len = kind === "audit" ? audit.length : filtered.length;
  const reset = (v: string) => {
    setKind(v);
    setSearch("");
    setPage(0);
  };
  function select(o: Target) {
    setSelected(o);
    setReason("");
    job.clear();
    setAction(
      kind === "board" ? (o.suspended ? "restore" : "suspend") : "limits",
    );
    setLimits(
      kind === "account"
        ? { org_limit: o.org_limit ?? 3 }
        : {
            board_limit: o.board_limit ?? 10,
            seat_limit: o.seat_limit ?? 10,
            media_limit: o.media_limit ?? 262144000,
            ...(kind === "platform" ? { org_limit: o.org_limit ?? 3 } : {}),
          },
    );
  }
  return (
    <section className="ws-page">
      <h1>{t("Instance operator", "Operador da instância")}</h1>
      <p>
        {t(
          "Inspect usage, adjust limits and manage public access.",
          "Consulte o uso, ajuste limites e gerencie o acesso público.",
        )}
      </p>
      <div className="ws-tabs">
        {[
          ["organization", t("Organizations", "Organizações")],
          ["board", t("Boards", "Quadros")],
          ["account", t("Accounts", "Contas")],
          ["platform", t("Platform defaults", "Limites padrão")],
          ["audit", t("Audit log", "Registro de auditoria")],
        ].map(([k, n]) => (
          <button key={k} aria-pressed={kind === k} onClick={() => reset(k)}>
            {n}
          </button>
        ))}
      </div>
      {q.isLoading && <Loading />}
      <Msg error>{q.error?.message}</Msg>
      {kind === "platform" ? (
        <section className="ws-section">
          <h2>
            {t("Default free allowances", "Limites padrão do plano gratuito")}
          </h2>
          <p>
            {t(
              "New accounts and organizations inherit these limits.",
              "Novas contas e organizações herdam estes limites.",
            )}
          </p>
          {q.data?.defaults && (
            <>
              <dl className="ws-platform-limits">
                {Object.entries(q.data.defaults)
                  .filter(([key]) => key.endsWith("_limit"))
                  .map(([key, n]) => (
                    <div key={key}>
                      <dt>
                        {
                          {
                            org_limit: t(
                              "Owned organizations",
                              "Organizações próprias",
                            ),
                            board_limit: t("Boards", "Quadros"),
                            seat_limit: t("Teammates", "Integrantes"),
                            media_limit: t(
                              "Media storage",
                              "Armazenamento de mídia",
                            ),
                          }[key]
                        }
                      </dt>
                      <dd>
                        {key === "media_limit"
                          ? formatBytes(Number(n))
                          : String(n)}
                      </dd>
                    </div>
                  ))}
              </dl>
              <button onClick={() => select(q.data!.defaults!)}>
                {t("Edit default limits", "Editar limites padrão")}
              </button>
            </>
          )}
        </section>
      ) : kind === "account" ? (
        <form
          className="ws-section"
          onSubmit={onSubmit(() => select({ id: search.trim() }))}
        >
          <Field label={t("Account ID", "ID da conta")}>
            <input
              required
              pattern="[0-9a-fA-F-]{36}"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <button>
            {t("Set ownership allowance", "Definir limite de organizações")}
          </button>
        </form>
      ) : (
        <>
          <label className="ws-search">
            <Search size={15} />
            <input
              placeholder={t("Search", "Buscar")}
              aria-label={t("Search resources", "Buscar recursos")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {kind === "audit"
            ? audit.map((a) => (
                <div className="ws-info-row" key={a.id}>
                  <Activity size={18} />
                  <div>
                    <strong>
                      {a.action} · {a.target_type}
                    </strong>
                    <p>{a.reason}</p>
                    {a.change && (
                      <details>
                        <summary>{t("Change", "Alteração")}</summary>
                        <pre>{JSON.stringify(a.change, null, 2)}</pre>
                      </details>
                    )}
                    <small>
                      {a.target_id} · {t("Actor", "Operador")} {a.actor} ·{" "}
                      {new Date(a.created_at).toLocaleString()}
                    </small>
                  </div>
                </div>
              ))
            : filtered.map((o) => (
                <div className="ws-info-row" key={o.id}>
                  <div>
                    <strong>{o.name || o.title}</strong>
                    <small>
                      {o.id}
                      {kind === "organization"
                        ? ` · ${formatBytes(o.media_bytes || 0)} / ${formatBytes(o.media_limit || 0)}`
                        : ""}
                    </small>
                  </div>
                  <span>
                    {o.suspended
                      ? t("Suspended", "Suspenso")
                      : o.closed_at
                        ? t("Closed", "Encerrado")
                        : t("Active", "Ativo")}
                  </span>
                  <button onClick={() => select(o)}>
                    {t("Manage", "Gerenciar")}
                  </button>
                </div>
              ))}
          {q.data && !len && (
            <Empty icon={<ShieldCheck />}>
              {t("No matching records", "Nenhum registro encontrado")}
            </Empty>
          )}
          <div className="ws-actions">
            {page > 0 && (
              <button onClick={() => setPage(page - 1)}>
                <ArrowLeft size={14} />
                {t("Previous", "Anterior")}
              </button>
            )}
            {q.data?.next_cursor != null && (
              <button onClick={() => setPage(page + 1)}>
                {t("Next", "Próxima")}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </>
      )}
      {selected && (
        <Modal
          title={
            selected.name ||
            selected.title ||
            (kind === "platform"
              ? t("Default limits", "Limites padrão")
              : t("Account allowance", "Limite da conta"))
          }
          close={() => setSelected(null)}
        >
          <form
            onSubmit={onSubmit(
              () =>
                void job.run(async () => {
                  await write("/operator/actions", "POST", {
                    target_type: kind,
                    target_id: selected.id,
                    action,
                    reason,
                    ...(action === "limits" ? { limits } : {}),
                  });
                  await q.refetch();
                  setSelected(null);
                }),
            )}
          >
            <Field label={t("Action", "Ação")}>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                {kind !== "board" && (
                  <option value="limits">
                    {t("Override limits", "Alterar limites")}
                  </option>
                )}
                {kind !== "account" && kind !== "platform" && (
                  <option value={selected.suspended ? "restore" : "suspend"}>
                    {selected.suspended
                      ? t("Restore public access", "Restaurar acesso público")
                      : t("Suspend public access", "Suspender acesso público")}
                  </option>
                )}
              </select>
            </Field>
            {action === "limits" &&
              Object.entries(limits).map(([key, value]) => (
                <Field
                  key={key}
                  label={
                    {
                      org_limit: t(
                        "Owned organizations",
                        "Organizações próprias",
                      ),
                      seat_limit: t("Teammates", "Integrantes"),
                      board_limit: t("Boards", "Quadros"),
                      media_limit: t(
                        "Media allowance in bytes",
                        "Limite de mídia em bytes",
                      ),
                    }[key] || key
                  }
                >
                  <input
                    type="number"
                    required
                    min={0}
                    step={1}
                    value={value}
                    onChange={(e) =>
                      setLimits({ ...limits, [key]: Number(e.target.value) })
                    }
                  />
                </Field>
              ))}
            <Field
              label={t("Reason for this change", "Motivo desta alteração")}
            >
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Msg error>{job.error}</Msg>
            <button
              disabled={job.busy || !reason.trim()}
              className="ws-primary"
            >
              {t("Apply change", "Aplicar alteração")}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
