import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  FolderOpen,
  Home as HomeIcon,
  Layers3,
  LayoutGrid,
  PanelLeft,
  Pin,
  Plus,
  ShieldCheck,
  Users,
  UserRound,
} from "lucide-react";
import { getLocale } from "./public/i18n";
import {
  apiPath,
  orgPath,
  safeWebUrl,
  type Board,
  type Locale,
  type Me,
  type Org,
  type OrgData,
} from "./workspace/model";
import {
  Brand,
  Field,
  Lang,
  Loading,
  LocaleContext,
  Modal,
  Msg,
  get,
  onSubmit,
  useJob,
  useT,
  write,
} from "./workspace/shared";
import { Auth } from "./workspace/Auth";
import { Home } from "./workspace/Home";
import { Account, Team } from "./workspace/Account";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "./workspace/workspace.css";
const Editor = lazy(() =>
  import("./workspace/Editor").then((m) => ({ default: m.Editor })),
);
const Operator = lazy(() =>
  import("./workspace/Operator").then((m) => ({ default: m.Operator })),
);
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    },
    mutations: { retry: false },
  },
});
function usePath() {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const listen = () => setPath(location.pathname + location.search);
    window.addEventListener("popstate", listen);
    return () => window.removeEventListener("popstate", listen);
  }, []);
  function go(newPath: string) {
    history.pushState({}, "", newPath);
    setPath(newPath);
  }
  return { path, go };
}
async function meData(): Promise<Me> {
  const data = await get<Me>("/me");
  if (data.user) {
    const u = data.user as typeof data.user & { name?: string };
    u.display_name = u.display_name || u.name || u.email;
  }
  return data;
}
async function orgData(o: string) {
  const data = await get<OrgData>(orgPath(o));
  data.members = data.members.map((m) => ({
    ...m,
    display_name:
      m.display_name || (m as typeof m & { name?: string }).name || m.email,
  }));
  return data;
}
function Workspace() {
  const [locale, setLocale] = useState<Locale>(() => getLocale());
  useEffect(() => {
    document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
  }, [locale]);
  function language(v: Locale) {
    document.cookie =
      "pb_lang=" + v + "; Path=/; Max-Age=31536000; SameSite=Lax";
    setLocale(v);
  }
  return (
    <LocaleContext.Provider value={locale}>
      <main className="ws-root">
        <Application locale={locale} language={language} />
      </main>
    </LocaleContext.Provider>
  );
}
function Application({
  locale,
  language,
}: {
  locale: Locale;
  language: (v: Locale) => void;
}) {
  const me = useQuery({ queryKey: ["me"], queryFn: meData }),
    r = usePath();
  if (me.isError && !me.data)
    return (
      <div className="ws-auth-box">
        <Brand />
        <Msg error>{me.error.message}</Msg>
        <button onClick={() => void me.refetch()}>Retry</button>
      </div>
    );
  if (!me.data) return <Loading />;
  if (!me.data.user || new URLSearchParams(r.path.split("?")[1]).has("flow"))
    return (
      <Auth
        signedIn={!!me.data.user}
        locale={locale}
        onLocale={language}
        onDone={async () => {
          await me.refetch();
          r.go("/app");
        }}
      />
    );
  return (
    <Shell
      key={me.data.user.id}
      me={me.data}
      path={r.path}
      go={r.go}
      locale={locale}
      language={language}
      refreshMe={async () => {
        await me.refetch({ throwOnError: true });
      }}
    />
  );
}
function Shell({
  me,
  path,
  go,
  locale,
  language,
  refreshMe,
}: {
  me: Me;
  path: string;
  go: (p: string) => void;
  locale: Locale;
  language: (v: Locale) => void;
  refreshMe: () => Promise<void>;
}) {
  const t = useT(),
    user = me.user!,
    job = useJob(),
    client = useQueryClient(),
    parts = path.split("?")[0].split("/").filter(Boolean),
    orgRoute = parts[1] === "orgs" ? parts[2] : null,
    org =
      me.organizations.find((o) => o.id === orgRoute) ||
      me.organizations.find(
        (o) => o.id === localStorage.getItem("pb-org-" + user.id),
      ) ||
      me.organizations[0],
    base = org ? "/app/orgs/" + org.id : "/app",
    view = parts.includes("operator")
      ? "operator"
      : parts.includes("account")
        ? "account"
        : parts.includes("team")
          ? "team"
          : parts.includes("boards")
            ? "board"
            : "home",
    bid = parts[parts.indexOf("boards") + 1];
  const q = useQuery({
      queryKey: ["organization", user.id, org?.id],
      queryFn: () => orgData(org!.id),
      enabled: !!org && !org.closed_at && !org.suspended,
    }),
    data = q.data;
  const [rail, setRail] = useState(() => window.innerWidth > 840),
    [switcher, setSwitcher] = useState(false),
    [newOrg, setNewOrg] = useState(false),
    [orgName, setOrgName] = useState(""),
    [folded, setFolded] = useState<string[]>([]);
  useEffect(() => {
    const media = matchMedia("(max-width: 840px)");
    const change = () => setRail(!media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  function visit(p: string) {
    go(p);
    setSwitcher(false);
    if (window.innerWidth <= 840) setRail(false);
  }
  function choose(o: Org) {
    localStorage.setItem("pb-org-" + user.id, o.id);
    visit("/app/orgs/" + o.id);
  }
  async function refresh() {
    await Promise.all([
      refreshMe(),
      ...(org && !org.closed_at && !org.suspended ? [q.refetch()] : []),
    ]);
  }
  async function logout() {
    await write("/auth/logout", "POST");
    client.clear();
    location.assign("/app");
  }
  function addOrg() {
    job.clear();
    setSwitcher(false);
    setNewOrg(true);
    setOrgName("");
  }
  const nav = (
    name: string,
    url: string,
    Icon: typeof HomeIcon,
    active: boolean,
  ) => (
    <a
      href={url}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        visit(url);
      }}
    >
      <Icon size={16} />
      {name}
    </a>
  );
  function boardLink(b: Board) {
    return (
      <a
        key={b.id}
        href={base + "/boards/" + b.id}
        className="ws-rail-board"
        aria-current={bid === b.id && view === "board" ? "page" : undefined}
        onClick={(e) => {
          e.preventDefault();
          visit(base + "/boards/" + b.id);
        }}
      >
        <span className="ws-rail-board-icon">
          {b.logo_id ? (
            <img src={apiPath("/media/" + b.logo_id)} alt="" />
          ) : (
            <Layers3 size={13} />
          )}
        </span>
        {b.title}
      </a>
    );
  }
  return (
    <div className={"ws-layout" + (rail ? " ws-rail-open" : "")}>
      {rail && (
        <>
          <button
            className="ws-mobile-shade"
            aria-label={t("Close navigation", "Fechar navegação")}
            onClick={() => setRail(false)}
          />
          <aside className="ws-rail">
            <div className="ws-org-wrap">
              <button
                className="ws-org-switch"
                onClick={() => setSwitcher(!switcher)}
                aria-expanded={switcher}
              >
                <span className="ws-avatar">
                  {(org?.name || user.display_name || "P")[0]}
                </span>
                <strong>{org?.name || user.display_name}</strong>
                <ChevronsUpDown size={14} />
              </button>
              {switcher && (
                <div className="ws-org-menu">
                  {me.organizations.map((o) => (
                    <button key={o.id} onClick={() => choose(o)}>
                      <span>{o.name}</span>
                      <small>{o.role}</small>
                    </button>
                  ))}
                  <button onClick={addOrg}>
                    <Plus size={14} />
                    {t("New organization", "Nova organização")}
                  </button>
                </div>
              )}
            </div>
            <nav className="ws-navigation">
              {nav(t("Home", "Início"), base, HomeIcon, view === "home")}
              {nav(
                t("Account", "Conta"),
                base + "/account",
                UserRound,
                view === "account",
              )}
              {org &&
                nav(
                  t("Team", "Equipe"),
                  base + "/team",
                  Users,
                  view === "team",
                )}
              {me.operator &&
                nav(
                  t("Operator", "Operador"),
                  "/app/operator",
                  ShieldCheck,
                  view === "operator",
                )}
            </nav>
            {data && (
              <div className="ws-rail-lists">
                <h3>
                  <Pin size={13} />
                  {t("Pinned", "Fixados")}
                </h3>
                {data.boards
                  .filter((b) => b.pinned && !b.closed_at)
                  .map(boardLink)}
                {!data.boards.some((b) => b.pinned && !b.closed_at) && (
                  <div
                    className="ws-pin-tip"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData(
                        "text/patchboard-board",
                      );
                      if (data.boards.some((b) => b.id === id))
                        void job.run(async () => {
                          await write("/boards/" + id + "/pin", "PUT", {
                            pinned: true,
                          });
                          await refresh();
                        });
                    }}
                  >
                    {t(
                      "Drop a board here to pin it",
                      "Solte um quadro para fixá-lo",
                    )}
                  </div>
                )}
                <h3>
                  <LayoutGrid size={14} />
                  {t("All boards", "Todos os quadros")}
                </h3>
                {[
                  { id: "", name: t("My boards", "Meus quadros") },
                  ...data.folders,
                ].map((f) => (
                  <div key={f.id}>
                    <button
                      className="ws-rail-folder"
                      aria-expanded={!folded.includes(f.id)}
                      onClick={() =>
                        setFolded(
                          folded.includes(f.id)
                            ? folded.filter((id) => id !== f.id)
                            : [...folded, f.id],
                        )
                      }
                    >
                      <ChevronDown
                        size={13}
                        className={folded.includes(f.id) ? "ws-folded" : ""}
                      />
                      <FolderOpen size={14} />
                      {f.name}
                    </button>
                    {!folded.includes(f.id) &&
                      data.boards
                        .filter(
                          (b) => (b.folder_id || "") === f.id && !b.closed_at,
                        )
                        .map(boardLink)}
                  </div>
                ))}
              </div>
            )}
            <div className="ws-rail-foot">
              <a
                className="ws-plan"
                href={base + "/account"}
                onClick={(e) => {
                  e.preventDefault();
                  visit(base + "/account");
                }}
              >
                <Layers3 size={15} />
                {t("Free plan", "Plano gratuito")}
                <ChevronRight size={14} />
              </a>
              {safeWebUrl(me.support_url) && (
                <a
                  href={safeWebUrl(me.support_url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <CircleHelp size={14} />
                  {t("Help and support", "Ajuda e suporte")}
                </a>
              )}
              <Lang locale={locale} onChange={language} />
              <Brand />
            </div>
          </aside>
        </>
      )}
      <div className="ws-surface">
        {view !== "board" && (
          <header className="ws-topbar">
            <button
              className="ws-icon"
              onClick={() => setRail(!rail)}
              aria-label={t("Toggle sidebar", "Alternar barra lateral")}
            >
              <PanelLeft size={17} />
            </button>
            <Layers3 size={17} />
            {view !== "home" && (
              <>
                <ChevronRight size={13} />
                <span>
                  {view === "account"
                    ? t("Account", "Conta")
                    : view === "team"
                      ? t("Team", "Equipe")
                      : t("Operator", "Operador")}
                </span>
              </>
            )}
          </header>
        )}
        <Suspense fallback={<Loading />}>
          {view === "account" &&
          org &&
          !org.closed_at &&
          !org.suspended &&
          !data ? (
            q.isError ? (
              <Msg error>{q.error.message}</Msg>
            ) : (
              <Loading />
            )
          ) : view === "account" ? (
            <Account
              key={org?.id || "personal"}
              me={me}
              data={data}
              logout={logout}
              refresh={refresh}
            />
          ) : view === "operator" && me.operator ? (
            <Operator />
          ) : !org ? (
            <section className="ws-page ws-onboard">
              <span className="ws-onboard-icon">
                <Layers3 size={32} />
              </span>
              <h1>{t("Create your workspace", "Crie seu espaço")}</h1>
              <p>
                {user.verified
                  ? t(
                      "Start with an organization. Your team and boards will live here.",
                      "Comece com uma organização. Sua equipe e seus quadros ficarão aqui.",
                    )
                  : t(
                      "Verify your login email to create your first organization.",
                      "Verifique seu e-mail de acesso para criar sua primeira organização.",
                    )}
              </p>
              {user.verified && (
                <button className="ws-primary" onClick={addOrg}>
                  <Plus size={15} />
                  {t("Create organization", "Criar organização")}
                </button>
              )}
            </section>
          ) : org.closed_at || org.suspended ? (
            <section className="ws-page ws-narrow">
              <h1>{org.name}</h1>
              <p>
                {org.suspended
                  ? t(
                      "This organization is suspended.",
                      "Esta organização está suspensa.",
                    )
                  : t(
                      "This organization is closed.",
                      "Esta organização está encerrada.",
                    )}
              </p>
              {org.closed_at && org.role === "owner" && (
                <button
                  disabled={job.busy}
                  onClick={() =>
                    void job.run(async () => {
                      await write(orgPath(org.id) + "/restore", "POST");
                      await refreshMe();
                    })
                  }
                >
                  <ArchiveRestore size={15} />
                  {t("Restore organization", "Restaurar organização")}
                </button>
              )}
              <Msg error>{job.error}</Msg>
            </section>
          ) : q.isError ? (
            <Msg error>{q.error.message}</Msg>
          ) : !data ? (
            <Loading />
          ) : view === "board" &&
            bid &&
            !data.boards.some((b) => b.id === bid) ? (
            <Msg error>
              {t(
                "Board unavailable in this organization.",
                "Quadro indisponível nesta organização.",
              )}
            </Msg>
          ) : view === "board" && bid ? (
            <Editor
              key={org.id + bid}
              id={bid}
              org={org}
              home={() => visit(base)}
              sidebar={() => setRail(!rail)}
              refreshOrg={refresh}
            />
          ) : view === "team" ? (
            <Team
              key={org.id}
              data={data}
              org={org}
              userId={user.id}
              refresh={refresh}
            />
          ) : (
            <Home
              key={org.id}
              data={data}
              role={org.role}
              refresh={refresh}
              openBoard={(b) => visit(base + "/boards/" + b.id)}
            />
          )}
        </Suspense>
      </div>
      {newOrg && (
        <Modal
          title={t("Create organization", "Criar organização")}
          close={() => setNewOrg(false)}
        >
          <form
            onSubmit={onSubmit(
              () =>
                void job.run(async () => {
                  const result = await write<Org>("/organizations", "POST", {
                    name: orgName,
                  });
                  await refreshMe();
                  setNewOrg(false);
                  choose(result);
                }),
            )}
          >
            <Field label={t("Organization name", "Nome da organização")}>
              <input
                required
                maxLength={80}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </Field>
            <Msg error>{job.error}</Msg>
            <button
              className="ws-primary"
              disabled={job.busy || !user.verified}
            >
              {t("Create organization", "Criar organização")}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
const root = document.getElementById("root") || document.getElementById("app");
if (root)
  createRoot(root).render(
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>,
  );
