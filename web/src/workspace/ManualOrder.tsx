import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronsUp } from "lucide-react";
import { boardPath, moveItem, type Post } from "./model";
import { Field, Msg, get, useT } from "./shared";
export function ManualOrder({
  boardId,
  posts,
  order,
  change,
}: {
  boardId: string;
  posts: Post[];
  order: string[];
  change: (order: string[]) => void;
}) {
  const t = useT(),
    [opened, setOpened] = useState(false),
    [page, setPage] = useState(0),
    [query, setQuery] = useState(""),
    [known, setKnown] = useState<Record<string, string>>({});
  const result = useQuery({
    queryKey: ["manual-order", boardId, page, query],
    enabled: opened,
    queryFn: () =>
      get<{ items: Post[]; next_cursor?: number | null }>(
        boardPath(boardId) +
          "/posts?" +
          new URLSearchParams({
            sort: "manual",
            q: query,
            cursor: String(page * 30),
          }),
      ),
  });
  const pageItems = result.data?.items ?? (query || page ? [] : posts),
    ids = [
      ...new Set([
        ...order,
        ...posts.map((p) => p.id),
        ...Object.keys(known),
        ...pageItems.map((p) => p.id),
      ]),
    ];
  const names = {
    ...Object.fromEntries([...posts, ...pageItems].map((p) => [p.id, p.title])),
    ...known,
  };
  const visible = query
    ? pageItems.map((p) => p.id)
    : ids.slice(page * 30, page * 30 + 30);
  function commit(next: string[]) {
    setKnown(names);
    change(next);
  }
  return (
    <details open={opened} onToggle={(e) => setOpened(e.currentTarget.open)}>
      <summary>{t("Order posts", "Ordenar posts")}</summary>
      {opened && (
        <>
          <Field
            label={t("Find a post to position", "Buscar post para posicionar")}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </Field>
          <Msg error>{result.error?.message}</Msg>
          {visible.map((id) => {
            const i = ids.indexOf(id),
              name = names[id] || id;
            return (
              <div className="ws-order-row" key={id}>
                <span>{name}</span>
                <button
                  aria-label={t("Move to front ", "Mover ao início ") + name}
                  onClick={() => commit([id, ...ids.filter((v) => v !== id)])}
                >
                  <ChevronsUp size={13} />
                </button>
                <button
                  aria-label={t("Move up ", "Subir ") + name}
                  disabled={i <= 0}
                  onClick={() => commit(moveItem(ids, i, -1))}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  aria-label={t("Move down ", "Descer ") + name}
                  disabled={i === ids.length - 1}
                  onClick={() => commit(moveItem(ids, i, 1))}
                >
                  <ArrowDown size={13} />
                </button>
              </div>
            );
          })}
          <div className="ws-inline">
            {page > 0 && (
              <button onClick={() => setPage(page - 1)}>
                {t("Previous", "Anterior")}
              </button>
            )}
            {(result.data?.next_cursor != null ||
              (ids.length > (page + 1) * 30 && !query)) && (
              <button
                onClick={() => {
                  if (!query) setKnown(names);
                  setPage(page + 1);
                }}
              >
                {t("Next", "Próxima")}
              </button>
            )}
          </div>
        </>
      )}
    </details>
  );
}
