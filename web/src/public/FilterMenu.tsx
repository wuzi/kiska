import { useId, useLayoutEffect, useRef, useState } from "react";
import { ListFilter, RotateCcw, Tag, X } from "lucide-react";
import { useBoard } from "./context";
import { labelName } from "./i18n";
import { PagedList } from "./ui";
import type { Filters, Label, Sort } from "./types";

export const sortOptions: Sort[] = ["trending", "top", "new", "manual"];
type Group = "tag" | "status";
interface Props {
  filters: Filters;
  update: (change: Partial<Filters>) => void;
}

function choices(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

function Checklist({
  items,
  selected,
  title,
  change,
}: {
  items: Label[];
  selected: string[];
  title: string;
  change: (value: string[]) => void;
}) {
  const { locale } = useBoard();
  return (
    <PagedList
      items={items}
      label={title}
      estimate={35}
      render={(item) => (
        <label className="pb-filter-option">
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            onChange={() => change(choices(selected, item.id))}
          />
          {labelName(item, locale)}
        </label>
      )}
    />
  );
}

export function FilterMenu({ filters, update }: Props) {
  const { data, t } = useBoard();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const count = filters.status.length + filters.tag.length;
  const tags =
    data.board.settings?.board_fields?.tag === false ? [] : data.tags;
  const statuses = data.statuses.filter(
    (s) => filters.view !== "roadmap" || s.on_roadmap !== false,
  );

  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const button = trigger.current,
      menu = popup.current;
    const board = button.closest(".pb-board")!;
    function position() {
      const anchor = button.getBoundingClientRect(),
        bounds = board.getBoundingClientRect();
      const left = Math.max(bounds.left, 0) + 8,
        right =
          Math.min(bounds.right, document.documentElement.clientWidth) - 8;
      const width = Math.min(292, right - left);
      menu.style.width = width + "px";
      menu.style.left =
        Math.max(left, Math.min(right, anchor.right) - width) + "px";
      const below = window.innerHeight - anchor.bottom - 12,
        above = anchor.top - 12;
      const flip = below < 280 && above > below;
      menu.style.maxHeight = Math.max(90, flip ? above : below) + "px";
      menu.style.top = flip ? "auto" : anchor.bottom + 5 + "px";
      menu.style.bottom = flip
        ? window.innerHeight - anchor.top + 5 + "px"
        : "auto";
    }
    position();
    menu
      .querySelector<HTMLElement>("input, summary, select")
      ?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("filters")}
        title={t("filters")}
        className="pb-icon pb-filter-trigger"
        data-active={!!count}
      >
        <ListFilter size={17} />
        {count > 0 && <span aria-hidden="true">{count}</span>}
      </button>
      <div
        id={id}
        ref={popup}
        popover="auto"
        role="dialog"
        aria-label={t("filters")}
        className="pb-filter-menu"
        onToggle={(event) =>
          setOpen(event.currentTarget.matches(":popover-open"))
        }
      >
        {open && (
          <>
            <header>
              <ListFilter size={18} />
              <div>
                <strong>{t("filters")}</strong>
                <small>{t("filterHint")}</small>
              </div>
            </header>
            <div className="pb-filter-options">
              {tags.length > 0 && (
                <section>
                  <h3>
                    <Tag size={14} />
                    {t("tagGroup")} <span>{tags.length}</span>
                  </h3>
                  <Checklist
                    items={tags}
                    title={t("tagGroup")}
                    selected={filters.tag}
                    change={(tag) => update({ tag })}
                  />
                </section>
              )}
              <details open={tags.length ? undefined : true}>
                <summary>
                  {t("statusGroup")} <span>{statuses.length}</span>
                </summary>
                <Checklist
                  items={statuses}
                  title={t("statusGroup")}
                  selected={filters.status}
                  change={(status) => update({ status })}
                />
              </details>
              {filters.view === "list" && (
                <label className="pb-filter-sort">
                  {t("sort")}
                  <select
                    value={filters.sort}
                    onChange={(e) => update({ sort: e.target.value as Sort })}
                  >
                    {sortOptions.map((sort) => (
                      <option key={sort} value={sort}>
                        {t(sort)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <footer>
              <button
                type="button"
                disabled={!count}
                onClick={() => update({ status: [], tag: [] })}
              >
                <RotateCcw size={14} />
                {t("clear")}
              </button>
            </footer>
          </>
        )}
      </div>
    </>
  );
}

export function ActiveFilters({ filters, update }: Props) {
  const { data, t, locale } = useBoard();
  if (!filters.tag.length && !filters.status.length) return null;
  const groups: [Group, Label[]][] = [
    ["tag", data.tags],
    ["status", data.statuses],
  ];
  return (
    <div className="pb-filter-chips" role="group" aria-label={t("filters")}>
      {groups.flatMap(([group, items]) =>
        filters[group].map((id) => {
          const item = items.find((i) => i.id === id);
          const name = item ? labelName(item, locale) : t(group);
          return (
            <button
              type="button"
              key={group + id}
              aria-label={t("removeFilter") + " · " + name}
              onClick={() => update({ [group]: choices(filters[group], id) })}
            >
              {name}
              <X size={12} />
            </button>
          );
        }),
      )}
      <button
        type="button"
        className="pb-filter-clear"
        onClick={() => update({ tag: [], status: [] })}
      >
        {t("clear")}
      </button>
    </div>
  );
}
