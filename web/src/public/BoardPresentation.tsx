import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  UserRound,
  Bell,
  Languages,
  Columns3,
  Newspaper,
  Menu,
  Search,
  Plus,
  LayoutList,
  X,
} from "lucide-react";
import { ApiError } from "../api/client";
import { PublicBoardContext } from "./context";
import { liveAdapter } from "./adapter";
import { previewAdapter } from "./preview";
import { translator, getLocale } from "./i18n";
import {
  publicPath,
  postPath,
  type Adapter,
  type BoardData,
  type ColumnPage,
  type Detail,
  type Filters,
  type Locale,
  type Post,
  type Sort,
  type View,
} from "./types";
import { theme, safeLink, ErrorBox, PagedList } from "./ui";
import { PostCard, Roadmap, Updates, Empty, eligibleStatuses } from "./views";
import { FilterMenu, ActiveFilters, sortOptions } from "./FilterMenu";
import { PostDetail } from "./PostDetail";
import { GuestProfile, Subscribe } from "./dialogs";
import PostComposer from "./composer/PostComposer";
import "./public.css";

interface Props {
  data: BoardData;
  locale?: Locale;
  preview?: boolean;
}
const SEARCH_DEBOUNCE_MS = 80;
export function BoardPresentation(props: Props) {
  return (
    <ScopedBoard key={props.data.board.id + "-" + !!props.preview} {...props} />
  );
}
function ScopedBoard({ data, locale, preview = false }: Props) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 0,
            staleTime: 15000,
            refetchInterval: preview ? false : 30000,
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: true,
          },
          mutations: { retry: 0 },
        },
      }),
  );
  const adapter = useMemo(
    () => (preview ? previewAdapter(data) : liveAdapter(data.board)),
    [preview, data.board.id, data.board.slug, data.board.org_slug],
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
      if ("dispose" in adapter)
        (adapter as ReturnType<typeof previewAdapter>).dispose();
    },
    [adapter, client],
  );
  return (
    <QueryClientProvider client={client}>
      <BoardApp
        initial={data}
        preview={preview}
        adapter={adapter}
        initialLocale={locale}
      />
    </QueryClientProvider>
  );
}
function filtersFrom(data: BoardData, preview: boolean): Filters {
  const params = preview
    ? new URLSearchParams()
    : new URLSearchParams(location.search);
  const s = data.board.settings ?? {};
  const wanted = params.get("view") || s.opening_view || "list";
  const view =
    wanted === "roadmap" && s.roadmap_visible !== false
      ? "roadmap"
      : wanted === "updates"
        ? "updates"
        : "list";
  const sort = params.get("sort") as Sort;
  return {
    view,
    sort: sortOptions.includes(sort) ? sort : s.sort || "trending",
    q: params.get("q") || "",
    status: [...new Set(params.get("status")?.split(",").filter(Boolean))],
    tag: [...new Set(params.get("tag")?.split(",").filter(Boolean))],
  };
}
function postInUrl() {
  const segment = location.pathname.match(/\/p\/([^/]+)/)?.[1];
  return (
    segment?.match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|$)/i,
    )?.[1] ?? segment
  );
}
function saveToUrl(
  board: BoardData["board"],
  filters: Filters,
  replace = false,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value.length)
      params.set(key, Array.isArray(value) ? value.join(",") : value);
  history[replace ? "replaceState" : "pushState"](
    { pbBoard: board.id },
    "",
    publicPath(board) + "?" + params,
  );
}
type Page = BoardData | ColumnPage | Detail;
export function patchVote(
  page: Page,
  id: string,
  voted: boolean,
  votes: number,
): Page {
  const patch = (post: Post) =>
    post.id === id ? { ...post, voted, votes } : post;
  if ("post" in page) return { ...page, post: patch(page.post) };
  return {
    ...page,
    posts: page.posts.map(patch),
    ...("columns" in page && page.columns
      ? {
          columns: page.columns.map((c) => ({
            ...c,
            posts: c.posts.map(patch),
          })),
        }
      : {}),
  };
}
function BoardApp({
  initial,
  adapter,
  preview,
  initialLocale,
}: {
  initial: BoardData;
  adapter: Adapter;
  preview: boolean;
  initialLocale?: Locale;
}) {
  const client = useQueryClient();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [locale, setLocale] = useState<Locale>(
    () => initialLocale ?? getLocale(initial.locale),
  );
  const t = useMemo(() => translator(locale), [locale]);
  const startFilters = useMemo(() => filtersFrom(initial, preview), []);
  const [filters, setFilters] = useState(startFilters);
  const [showSearch, setShowSearch] = useState(!!filters.q);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const [details, setDetails] = useState<Post | null>(() => {
    if (preview) return null;
    const id = postInUrl();
    return id
      ? (initial.detail?.post ??
          initial.posts.find((p) => p.id === id) ?? {
            id,
            title: "",
            status_id: "",
          })
      : null;
  });
  const trigger = useRef<HTMLElement | null>(null);
  const [composer, setComposer] = useState<{
    status?: string;
    post?: Post;
  } | null>(null);
  const [panel, setPanel] = useState<"guest" | "subscribe" | null>(null);
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  }, []);
  const bootLocale = useRef(locale).current;
  const feed = useInfiniteQuery({
    queryKey: ["board", locale, filters] as const,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      if (filters.view === "updates" && pageParam) {
        const page = await adapter.updates(locale, pageParam, signal);
        return {
          ...initial,
          filters,
          posts: [],
          updates: page.updates,
          updates_next_cursor: page.next_cursor,
        };
      }
      // Roadmap columns must keep using the query that produced their first page.
      return {
        ...(await adapter.board(filters, locale, pageParam, signal)),
        filters,
      };
    },
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === locale &&
      previousQuery.queryKey[2].view === filters.view
        ? previous
        : undefined,
    ...(filters === startFilters && locale === bootLocale
      ? { initialData: { pages: [{ ...initial, filters }], pageParams: [""] } }
      : {}),
    getNextPageParam: (p) => {
      const cursor =
        filters.view === "updates" ? p.updates_next_cursor : p.next_cursor;
      return cursor == null ? undefined : String(cursor);
    },
  });
  const pages = feed.data?.pages ?? [];
  const page = pages[0] ?? initial;
  const data = preview
    ? {
        ...page,
        board: initial.board,
        statuses: initial.statuses,
        tags: initial.tags,
      }
    : page;
  const rows = pages.flatMap((p) => p.posts);
  const hasSelections = filters.tag.length > 0 || filters.status.length > 0;
  const filtered = hasSelections || !!filters.q;
  const board = data.board;
  const settings = board.settings ?? {};
  const refresh = useCallback(() => client.invalidateQueries(), [client]);
  const updateFilters = useCallback(
    (value: Partial<Filters>, replace = false) => {
      clearTimeout(searchTimer.current);
      const next = {
        ...filters,
        q: searchInput.current?.value ?? filters.q,
        ...value,
      };
      if (searchInput.current && searchInput.current.value !== next.q)
        searchInput.current.value = next.q;
      setFilters(next);
      if (!preview) saveToUrl(board, next, replace);
    },
    [filters, preview, board],
  );
  function searchChanged(q: string) {
    clearTimeout(searchTimer.current);
    if (q === filters.q) return;
    if (!q) updateFilters({ q }, true);
    else
      searchTimer.current = setTimeout(
        () => updateFilters({ q }, true),
        SEARCH_DEBOUNCE_MS,
      );
  }
  function flushSearch() {
    const draft = searchInput.current?.value;
    if (draft !== undefined && draft !== filters.q)
      updateFilters({ q: draft }, true);
  }
  useEffect(() => {
    if (preview) return;
    const onPop = () => {
      const id = postInUrl();
      const next = filtersFrom(initial, false);
      setFilters(next);
      clearTimeout(searchTimer.current);
      if (searchInput.current) searchInput.current.value = next.q;
      if (next.q) setShowSearch(true);
      setComposer(null);
      setPanel(null);
      setDetails(
        id
          ? (client.getQueryData<InfiniteData<Detail>>(["detail", locale, id])
              ?.pages[0]?.post ??
              rows.find((p) => p.id === id) ?? { id, title: "", status_id: "" })
          : null,
      );
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [preview, initial, rows, client, locale]);
  useEffect(() => {
    if (preview) return;
    const fragment = new URLSearchParams(location.hash.slice(1));
    const recovery = fragment.get("recover") || fragment.get("token");
    if (recovery) {
      if (!initial.authenticated) {
        setToken(recovery);
        setPanel("guest");
      }
      history.replaceState(
        history.state,
        "",
        location.pathname + location.search,
      );
    }
  }, [preview, initial.authenticated]);
  function openPost(p: Post) {
    trigger.current = document.activeElement as HTMLElement;
    flushSearch();
    if (!preview)
      history.pushState(
        { pbDetail: true, board: board.id },
        "",
        postPath(board, p) + location.search,
      );
    setDetails(p);
  }
  function closePost() {
    if (
      !preview &&
      history.state?.pbDetail &&
      history.state?.board === board.id
    ) {
      history.back();
    } else {
      if (!preview) saveToUrl(board, filters, true);
      setDetails(null);
    }
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected)
        trigger.current.focus({ preventScroll: true });
      else
        root
          ?.querySelector<HTMLElement>("[data-view-heading]")
          ?.focus({ preventScroll: true });
    });
  }
  function changeLocale() {
    const next = locale === "pt" ? "en" : "pt";
    if (!preview) {
      document.cookie =
        "pb_lang=" + next + "; Path=/; Max-Age=31536000; SameSite=Lax";
      document.documentElement.lang = next === "pt" ? "pt-BR" : "en";
    }
    setLocale(next);
  }
  const pending = useRef(new Set<string>());
  const [, updatePending] = useState(0);
  const writeVote = (id: string, voted: boolean, votes: number) => {
    client.setQueriesData<InfiniteData<Page>>(
      {
        predicate: (q) =>
          ["board", "column", "detail"].includes(String(q.queryKey[0])),
      },
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => patchVote(p, id, voted, votes)),
            }
          : old,
    );
    setDetails((prev) => (prev?.id === id ? { ...prev, votes, voted } : prev));
  };
  const change = useMutation({
    mutationFn: ({ post, desired }: { post: Post; desired: boolean }) =>
      adapter.vote(post.id, desired),
    onMutate: async ({ post, desired }) => {
      await client.cancelQueries({
        predicate: (q) =>
          ["board", "column", "detail"].includes(String(q.queryKey[0])),
      });
      writeVote(
        post.id,
        desired,
        Math.max(0, (post.votes ?? 0) + (desired ? 1 : -1)),
      );
    },
    onSuccess: (result, { post }) => {
      if (
        result &&
        typeof result === "object" &&
        "voted" in result &&
        typeof result.voted === "boolean" &&
        "votes" in result &&
        typeof result.votes === "number"
      ) {
        writeVote(post.id, result.voted, result.votes);
      }
    },
    onError: async (_error, { post }) => {
      try {
        const current = (await adapter.detail(post.id, locale)).post;
        writeVote(post.id, !!current.voted, current.votes ?? 0);
      } catch {
        writeVote(post.id, !!post.voted, post.votes ?? 0);
      }
      notify(t("failedVote"));
    },
    onSettled: async (_data, _error, { post }) => {
      pending.current.delete(post.id);
      updatePending((n) => n + 1);
      if (!pending.current.size)
        await client.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === "board" ||
            q.queryKey[0] === "column" ||
            q.queryKey[0] === "detail",
        });
    },
  });
  const toggleVote = (post: Post) => {
    if (pending.current.has(post.id)) return;
    pending.current.add(post.id);
    updatePending((n) => n + 1);
    change.mutate({ post, desired: !post.voted });
  };
  const openComposer = (status?: string, post?: Post) =>
    setComposer({ status, post });
  const views: [View, typeof LayoutList][] = [
    ["list", LayoutList],
    ...(settings.roadmap_visible !== false
      ? [["roadmap", Columns3] as [View, typeof LayoutList]]
      : []),
    ["updates", Newspaper],
  ];
  const status = eligibleStatuses(data);
  const cover =
    board.cover_url ||
    (board.cover_id
      ? "/api/v1/media/" + encodeURIComponent(board.cover_id)
      : null);
  const logo =
    board.logo_url ||
    (board.logo_id
      ? "/api/v1/media/" + encodeURIComponent(board.logo_id)
      : null);
  const links = (settings.links ?? []).filter((l) => safeLink(l.url));
  if (
    feed.error instanceof ApiError &&
    [403, 404, 410].includes(feed.error.status)
  )
    return (
      <main className="pb-board">
        <div className="pb-container">
          <h1>{t("unavailable")}</h1>
        </div>
      </main>
    );
  return (
    <PublicBoardContext.Provider
      value={{
        data,
        adapter,
        locale,
        t,
        preview,
        root,
        notify,
        refresh,
        openPost,
        openComposer,
        toggleVote,
        voting: (id) => pending.current.has(id),
      }}
    >
      <div
        ref={setRoot}
        data-view={filters.view}
        className={
          "pb-board" +
          (preview ? " pb-preview" : "") +
          (settings.density === "compact" ? " pb-compact" : "")
        }
        style={theme(board.appearance)}
        lang={locale === "pt" ? "pt-BR" : "en"}
      >
        <div className="pb-container">
          <header className="pb-hero">
            {cover && <img className="pb-cover" src={cover} alt="" />}
            <div className="pb-hero-body">
              {logo && <img className="pb-logo" src={logo} alt="" />}
              <div className="pb-hero-title">
                <h1>{board.title}</h1>
                {board.description && <p>{board.description}</p>}
              </div>
              {links.length > 0 && (
                <div className="pb-board-links">
                  <button
                    aria-label={t("link")}
                    aria-expanded={showLinks}
                    title={t("link")}
                    className="pb-icon pb-links-toggle"
                    onClick={() => setShowLinks(!showLinks)}
                  >
                    <Menu size={18} />
                  </button>
                  <div
                    className={
                      showLinks ? "pb-links-list pb-open" : "pb-links-list"
                    }
                  >
                    {links.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noreferrer">
                        {l.label || new URL(l.url).hostname}
                        <ArrowUpRight size={14} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </header>
          <div className="pb-navrow">
            <nav aria-label={t("feedback")} className="pb-tabs">
              {views.map(([v, Icon]) => (
                <button
                  key={v}
                  data-view-heading={filters.view === v ? "" : undefined}
                  aria-current={filters.view === v ? "page" : undefined}
                  onClick={() => updateFilters({ view: v })}
                >
                  <Icon size={17} />
                  {t(v)}
                </button>
              ))}
            </nav>
            <div className="pb-board-actions">
              {filters.view !== "updates" && (
                <>
                  <button
                    className="pb-icon"
                    ref={searchToggle}
                    aria-label={t("search")}
                    title={t("search")}
                    aria-expanded={showSearch}
                    data-active={!!filters.q}
                    onClick={() => {
                      if (showSearch) flushSearch();
                      setShowSearch(!showSearch);
                      if (!showSearch)
                        requestAnimationFrame(() =>
                          searchInput.current?.focus(),
                        );
                    }}
                  >
                    <Search size={17} />
                  </button>
                  <FilterMenu filters={filters} update={updateFilters} />
                </>
              )}
              {status.length > 0 && (
                <button
                  className="pb-icon"
                  aria-label={settings.button_text || t("newPost")}
                  title={settings.button_text || t("newPost")}
                  onClick={() => openComposer()}
                >
                  <Plus size={18} />
                </button>
              )}
              <button
                aria-label={t("language")}
                title={t("language")}
                className="pb-language"
                onClick={changeLocale}
              >
                <Languages size={16} />
                {locale === "pt" ? "PT" : "EN"}
              </button>
              <button
                className="pb-icon"
                aria-label={t("subscribe")}
                title={t("subscribe")}
                onClick={() => setPanel("subscribe")}
              >
                <Bell size={18} />
              </button>
              {data.authenticated && !preview ? (
                <a
                  className="pb-icon"
                  href="/app/account"
                  aria-label={t("account")}
                  title={t("account")}
                >
                  <UserRound size={18} />
                </a>
              ) : (
                <button
                  className="pb-icon"
                  aria-label={t("profile")}
                  title={t("profile")}
                  onClick={() => setPanel("guest")}
                >
                  <UserRound size={18} />
                </button>
              )}
            </div>
          </div>
          <main
            className="pb-content"
            aria-busy={feed.isPlaceholderData}
            aria-label={t(
              filters.view === "list" ? "allFeedback" : filters.view,
            )}
          >
            {filters.view !== "updates" && showSearch && (
              <div className="pb-toolbar">
                <label className="pb-search">
                  <Search size={17} />
                  <input
                    ref={searchInput}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        flushSearch();
                        setShowSearch(false);
                        searchToggle.current?.focus();
                      }
                    }}
                    type="search"
                    defaultValue={filters.q}
                    aria-label={t("search")}
                    placeholder={t("search")}
                    onChange={(e) => searchChanged(e.currentTarget.value)}
                  />
                </label>
              </div>
            )}
            {filters.view !== "updates" && (
              <ActiveFilters filters={filters} update={updateFilters} />
            )}
            {feed.error && (
              <>
                <ErrorBox error={feed.error} />
                <button
                  className="pb-neutral"
                  onClick={() => void feed.refetch()}
                >
                  {t("retry")}
                </button>
              </>
            )}
            {feed.isPending ? (
              <p className="pb-help" role="status">
                {t("loading")}
              </p>
            ) : !feed.data ? null : filters.view === "updates" ? (
              <Updates rows={pages.flatMap((p) => p.updates ?? [])} />
            ) : filters.view === "roadmap" ? (
              <Roadmap data={data} filters={feed.data.pages[0].filters} />
            ) : rows.length ? (
              <PagedList
                label={t("feedback")}
                items={rows}
                render={(p) => <PostCard post={p} />}
                estimate={118}
              />
            ) : (
              <>
                <Empty
                  title={t(filtered ? "searchEmpty" : "emptyBoard")}
                  detail={t(filtered ? "emptySearch" : "emptyHelp")}
                />
                {filters.q && !hasSelections && (
                  <button
                    className="pb-more"
                    onClick={() =>
                      updateFilters({ q: "", tag: [], status: [] })
                    }
                  >
                    {t("clear")}
                  </button>
                )}
              </>
            )}
            {filters.view !== "roadmap" && feed.hasNextPage && (
              <button
                className="pb-more"
                disabled={feed.isPlaceholderData || feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {t("loadMore")}
              </button>
            )}
          </main>
        </div>
        {details && (
          <PostDetail
            key={details.id}
            known={details}
            onClose={closePost}
            restoreFocus={restoreFocus}
          />
        )}
        {composer && (
          <PostComposer
            original={composer.post}
            statusId={composer.status}
            onClose={() => setComposer(null)}
          />
        )}
        {panel === "subscribe" && <Subscribe onClose={() => setPanel(null)} />}
        {panel === "guest" && (preview || !data.authenticated) && (
          <GuestProfile
            onClose={() => {
              setPanel(null);
              setToken("");
            }}
            initialToken={token}
          />
        )}
        <div
          className={"pb-toast" + (notice ? " pb-visible" : "")}
          role="status"
        >
          {notice}
          {notice && (
            <button aria-label={t("close")} onClick={() => setNotice("")}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    </PublicBoardContext.Provider>
  );
}
