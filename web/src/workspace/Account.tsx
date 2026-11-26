import { useState } from "react";
import {
  ArchiveRestore,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Mail,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  formatBytes,
  orgPath,
  safeWebUrl,
  type Me,
  type Member,
  type Org,
  type OrgData,
} from "./model";
import {
  Field,
  Modal,
  Msg,
  Toggle,
  onSubmit,
  useJob,
  useT,
  write,
} from "./shared";
export function Account({
  me,
  data,
  refresh,
  logout,
}: {
  me: Me;
  data?: OrgData;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const t = useT(),
    user = me.user!,
    job = useJob(),
    closeJob = useJob(),
    [name, setName] = useState(user.display_name),
    [email, setEmail] = useState(
      user.pending_notification_email || user.notification_email || "",
    ),
    [alerts, setAlerts] = useState(
      Boolean(
        (
          data?.members.find((m) => (m.user_id || m.id) === user.id) as
            (Member & { alerts?: boolean }) | undefined
        )?.alerts,
      ),
    ),
    [closing, setClosing] = useState(false),
    [closed, setClosed] = useState<string[]>([]),
    [consent, setConsent] = useState(false);
  const owned = me.organizations.filter(
      (o) => o.role === "owner" && !o.closed_at,
    ),
    usage = data?.usage;
  return (
    <section className="ws-page ws-narrow">
      <h1>{t("Profile", "Perfil")}</h1>
      <p>
        {t(
          "Manage your name, sign-in details and notifications.",
          "Gerencie seu nome, os dados de acesso e as notificações.",
        )}
      </p>
      <form
        className="ws-section"
        onSubmit={onSubmit(
          () =>
            void job.run(
              async () => {
                await write("/me", "PATCH", {
                  name,
                  ...(email !==
                    (user.pending_notification_email ||
                      user.notification_email ||
                      "") && email
                    ? { notification_email: email }
                    : {}),
                });
                if (data)
                  await write(
                    orgPath(data.organization.id) + "/members/" + user.id,
                    "PATCH",
                    { alerts },
                  );
                await refresh();
              },
              t("Changes saved.", "Alterações salvas."),
            ),
        )}
      >
        <Field
          label={t("Display name", "Nome de exibição")}
          hint={t(
            "The name shown on your account and team contributions.",
            "O nome exibido na conta e nas contribuições da equipe.",
          )}
        >
          <input
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="ws-info-row">
          <Mail size={17} />
          <div>
            <strong>{t("Login email", "E-mail de acesso")}</strong>
            <small>{user.email}</small>
          </div>
          <span className="ws-chip">
            {user.verified || user.email_verified
              ? t("Verified", "Verificado")
              : t("Unverified", "Não verificado")}
          </span>
        </div>
        <Field
          label={t("Notification email", "E-mail de notificações")}
          hint={t(
            "Verify this address to receive submission alerts.",
            "Verifique este endereço para receber alertas de novos posts.",
          )}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {user.pending_notification_email && (
          <small>
            {t("Verification pending for ", "Verificação pendente para ") +
              user.pending_notification_email}
          </small>
        )}
        {data && (
          <Toggle
            label={t("New submission alerts", "Alertas de novos posts")}
            hint={data.organization.name}
            checked={alerts}
            onChange={setAlerts}
          />
        )}
        <Msg error>{job.error}</Msg>
        <Msg>{job.note}</Msg>
        <div className="ws-actions">
          <button className="ws-primary" disabled={job.busy}>
            {t("Save changes", "Salvar alterações")}
          </button>
        </div>
      </form>
      <section className="ws-section">
        <h2>{t("Plan and usage", "Plano e uso")}</h2>
        <p>{data?.organization.name || t("Your account", "Sua conta")}</p>
        <div className="ws-info-row">
          <ShieldCheck size={19} />
          <div>
            <strong>{t("Your plan", "Seu plano")}</strong>
            <small>
              {t(
                "All board customization included.",
                "Toda a personalização dos quadros incluída.",
              )}
            </small>
          </div>
          <span className="ws-chip ws-mint">{t("Free", "Gratuito")}</span>
        </div>
        <div className="ws-usage">
          {[
            [
              t("Owned organizations", "Organizações próprias"),
              me.owned_count ?? owned.length,
              me.owned_limit ?? 3,
            ],
            ...(usage
              ? [
                  [
                    t("Boards", "Quadros"),
                    usage.board_count,
                    usage.board_limit,
                  ],
                  [
                    t("Teammates", "Integrantes"),
                    usage.seat_count,
                    usage.seat_limit,
                  ],
                  [
                    t("Media storage", "Armazenamento de mídia"),
                    usage.media_bytes,
                    usage.media_limit,
                  ],
                ]
              : []),
          ].map(([label, used, max], i) => (
            <div key={label}>
              <div>
                <strong>{label}</strong>
                <small>
                  {i === 3 ? formatBytes(Number(used)) : used} /{" "}
                  {i === 3 ? formatBytes(Number(max)) : max}
                </small>
              </div>
              <progress
                value={Number(used)}
                max={Math.max(Number(max), Number(used), 1)}
              />
            </div>
          ))}
        </div>
      </section>
      {(safeWebUrl(me.support_url) || safeWebUrl(me.policy_url)) && (
        <section className="ws-section">
          <h2>{t("Support", "Suporte")}</h2>
          <div className="ws-inline">
            {safeWebUrl(me.support_url) && (
              <a
                className="ws-link-btn"
                href={safeWebUrl(me.support_url)}
                target="_blank"
                rel="noreferrer"
              >
                <CircleHelp size={15} />
                {t("Help and support", "Ajuda e suporte")}
                <ExternalLink size={13} />
              </a>
            )}
            {safeWebUrl(me.policy_url) && (
              <a
                href={safeWebUrl(me.policy_url)}
                target="_blank"
                rel="noreferrer"
              >
                {t("Policies", "Políticas")}
              </a>
            )}
          </div>
        </section>
      )}
      <section className="ws-section">
        <h2>{t("Account access", "Acesso à conta")}</h2>
        <div className="ws-inline">
          <button onClick={() => void job.run(logout)}>
            {t("Sign out", "Sair")}
          </button>
          <button
            className="ws-danger"
            onClick={() => {
              setClosing(true);
              setClosed([]);
              setConsent(false);
              closeJob.clear();
            }}
          >
            <Trash2 size={15} />
            {t("Delete account", "Excluir conta")}
          </button>
        </div>
      </section>
      {closing && (
        <Modal
          title={t("Delete your account", "Excluir sua conta")}
          close={() => setClosing(false)}
        >
          <p>
            {t(
              "Transfer organizations from Team before deleting your account, or select each organization to close it. Closed organizations can be recovered for 30 days.",
              "Transfira suas organizações em Equipe antes de excluir a conta ou marque cada organização para encerrá-la. Organizações encerradas podem ser recuperadas por 30 dias.",
            )}
          </p>
          {owned.map((o) => (
            <Toggle
              key={o.id}
              label={t("Close ", "Encerrar ") + o.name}
              checked={closed.includes(o.id)}
              onChange={(v) =>
                setClosed(
                  v ? [...closed, o.id] : closed.filter((id) => id !== o.id),
                )
              }
            />
          ))}
          <Toggle
            label={t(
              "Delete my account and close the selected organizations",
              "Excluir minha conta e encerrar as organizações selecionadas",
            )}
            checked={consent}
            onChange={setConsent}
          />
          <Msg error>{closeJob.error}</Msg>
          <div className="ws-actions">
            <button
              className="ws-danger"
              disabled={
                !consent || closed.length !== owned.length || closeJob.busy
              }
              onClick={() =>
                void closeJob.run(async () => {
                  await write("/me", "DELETE", {
                    close_organization_ids: closed,
                  });
                  location.assign("/app");
                })
              }
            >
              {t("Confirm deletion", "Confirmar exclusão")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
export function Team({
  data,
  org,
  refresh,
  userId,
}: {
  data: OrgData;
  org: Org;
  refresh: () => Promise<void>;
  userId: string;
}) {
  const t = useT(),
    job = useJob(),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("moderator"),
    [member, setMember] = useState<Member | null>(null),
    [newRole, setNewRole] = useState("moderator");
  const path = orgPath(org.id),
    owner = org.role === "owner";
  async function change(url: string, method: string, body?: unknown) {
    await write(path + url, method, body);
    await refresh();
  }
  return (
    <section className="ws-page ws-narrow">
      <h1>{t("Team", "Equipe")}</h1>
      <p>{org.name}</p>
      {owner && !org.closed_at && (
        <form
          className="ws-section"
          onSubmit={onSubmit(
            () =>
              void job.run(
                async () => {
                  await change("/invitations", "POST", { email, role });
                  setEmail("");
                },
                t("Invitation sent.", "Convite enviado."),
              ),
          )}
        >
          <h2>{t("Invite a teammate", "Convidar integrante")}</h2>
          <div className="ws-inline">
            <Field label={t("Email address", "Endereço de e-mail")}>
              <input
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t("Role", "Função")}>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="moderator">{t("Moderator", "Moderador")}</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <button className="ws-primary" disabled={job.busy}>
              <Mail size={15} />
              {t("Invite", "Convidar")}
            </button>
          </div>
        </form>
      )}
      <Msg error>{!member && job.error}</Msg>
      <Msg>{job.note}</Msg>
      <section className="ws-section">
        <h2>{t("Members", "Integrantes")}</h2>
        {data.members.map((m) => (
          <div key={m.user_id || m.id} className="ws-info-row">
            <img
              className="ws-avatar"
              alt=""
              src={"/avatar/" + (m.user_id || m.id)}
              width={26}
              height={26}
            />
            <div>
              <strong>{m.display_name || m.email}</strong>
              <small>{m.email}</small>
            </div>
            <span className="ws-chip">{m.role}</span>
            {owner && m.role !== "owner" && (m.user_id || m.id) !== userId && (
              <button
                aria-label={t("Manage ", "Gerenciar ") + m.display_name}
                onClick={() => {
                  setMember(m);
                  setNewRole(m.role);
                  job.clear();
                }}
              >
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        ))}
      </section>
      {owner && (
        <section className="ws-section">
          <h2>{t("Organization recovery", "Recuperação da organização")}</h2>
          <p>
            {t(
              "Closure removes public access immediately. The owner has 30 days to restore it.",
              "O encerramento remove o acesso público imediatamente. O proprietário tem 30 dias para restaurá-lo.",
            )}
          </p>
          <button
            className={org.closed_at ? "" : "ws-danger"}
            disabled={job.busy}
            onClick={() =>
              void job.run(async () => {
                if (
                  org.closed_at ||
                  confirm(
                    t(
                      "Close this organization and take its boards offline?",
                      "Encerrar esta organização e retirar seus quadros do ar?",
                    ),
                  )
                )
                  await change(org.closed_at ? "/restore" : "/close", "POST");
              })
            }
          >
            {org.closed_at ? (
              <ArchiveRestore size={15} />
            ) : (
              <Trash2 size={15} />
            )}{" "}
            {org.closed_at
              ? t("Restore organization", "Restaurar organização")
              : t("Close organization", "Encerrar organização")}
          </button>
        </section>
      )}
      {member && (
        <Modal
          title={member.display_name || member.email}
          close={() => setMember(null)}
        >
          <Field label={t("Role", "Função")}>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="moderator">{t("Moderator", "Moderador")}</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <div className="ws-stack">
            <button
              className="ws-primary"
              disabled={job.busy}
              onClick={() =>
                void job.run(async () => {
                  await change(
                    "/members/" + (member.user_id || member.id),
                    "PATCH",
                    { role: newRole },
                  );
                  setMember(null);
                })
              }
            >
              {t("Save role", "Salvar função")}
            </button>
            <button
              disabled={job.busy}
              onClick={() =>
                void job.run(async () => {
                  if (
                    !confirm(
                      t(
                        "Transfer ownership to this teammate?",
                        "Transferir a propriedade a este integrante?",
                      ),
                    )
                  )
                    return;
                  await change("/transfer", "POST", {
                    user_id: member.user_id || member.id,
                  });
                  setMember(null);
                })
              }
            >
              {t("Transfer ownership", "Transferir propriedade")}
            </button>
            <button
              className="ws-danger"
              disabled={job.busy}
              onClick={() =>
                void job.run(async () => {
                  if (
                    !confirm(
                      t(
                        "Remove this teammate from the organization?",
                        "Remover este integrante da organização?",
                      ),
                    )
                  )
                    return;
                  await change(
                    "/members/" + (member.user_id || member.id),
                    "DELETE",
                  );
                  setMember(null);
                })
              }
            >
              {t("Remove member", "Remover integrante")}
            </button>
          </div>
          <Msg error>{job.error}</Msg>
        </Modal>
      )}
    </section>
  );
}
