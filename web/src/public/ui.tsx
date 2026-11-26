import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronUp,
  Check,
  MessageCircle,
  UserRound,
  X,
  Search,
  Dot,
} from "lucide-react";
import { ApiError } from "../api/client";
import { useBoard } from "./context";
import { labelName, type Translate } from "./i18n";
import type { Appearance, Guest, Label, Post } from "./types";

export const safeLink = (url?: string) => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
};
export function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useBoard();
  if (!error) return null;
  const codes: Record<string, Parameters<Translate>[0]> = {
    invalid_title: "invalidTitle",
    invalid_body: "bodyLimit",
    invalid_email: "invalidEmail",
    forbidden: "permissionError",
    rate_limited: "rateError",
    "Organization media allowance reached": "mediaQuota",
    "Choose a PNG, JPEG, or WebP image": "invalidImage",
    "Choose up to four distinct images": "fileLimit",
  };
  const message =
    error instanceof ApiError && codes[error.code]
      ? t(codes[error.code])
      : errorText(error, t("failed"));
  return (
    <div role="alert" className="pb-error">
      {message}
      {error instanceof ApiError &&
        Object.entries(error.fields || {}).map(([k, v]) => (
          <div key={k}>
            {k} · {String(v)}
          </div>
        ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  focusBack,
  discussion = false,
  headerActions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  focusBack?: () => void;
  discussion?: boolean;
  headerActions?: ReactNode;
}) {
  const { root, t, preview } = useBoard();
  const opener = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal container={root}>
        <DialogPrimitive.Overlay
          className={"pb-overlay" + (preview ? " pb-embedded" : "")}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={
            "pb-modal" +
            (wide ? " pb-wide" : "") +
            (discussion ? " pb-post-modal" : "") +
            (preview ? " pb-embedded" : "")
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (focusBack) focusBack();
            else if (opener.current?.isConnected)
              opener.current.focus({ preventScroll: true });
          }}
        >
          <header className="pb-modal-header">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            {headerActions}
            <DialogPrimitive.Close aria-label={t("close")} className="pb-icon">
              <X size={20} />
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Chip({
  item,
  status = false,
}: {
  item: Label;
  status?: boolean;
}) {
  const { locale } = useBoard();
  return (
    <span
      className={status ? "pb-status" : "pb-chip"}
      style={{ "--pb-chip": item.color || "#79889a" } as CSSProperties}
    >
      {status && <i />}
      {labelName(item, locale)}
    </span>
  );
}
export function Avatar({ guest, size = 26 }: { guest?: Guest; size?: number }) {
  const { t } = useBoard();
  const name = guest?.name || t("anonymous");
  return guest?.avatar_url ? (
    <img
      className="pb-avatar"
      src={guest.avatar_url}
      width={size}
      height={size}
      alt={name}
      loading="lazy"
    />
  ) : (
    <span
      className="pb-avatar pb-avatar-placeholder"
      aria-label={name}
      style={{ width: size, height: size }}
    >
      <UserRound size={Math.round(size * 0.54)} />
    </span>
  );
}
export function AuthorBadge({ guest }: { guest?: Guest }) {
  const { t } = useBoard();
  if (guest?.staff) return <span className="pb-team">{t("team")}</span>;
  if (guest?.authenticated)
    return <span className="pb-team pb-account-badge">{t("signedIn")}</span>;
  return null;
}
export function GuestNameField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (name: string) => void;
}) {
  const { adapter, t } = useBoard();
  const guest = useQuery({
    queryKey: ["guest"],
    queryFn: () => adapter.guest(),
  });
  return (
    <div className="pb-guest-name">
      <Avatar guest={guest.data ?? undefined} size={24} />
      <input
        autoComplete="nickname"
        aria-label={t("guestName")}
        placeholder={t("guestName")}
        maxLength={40}
        value={value ?? guest.data?.name ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
export function Vote({ post }: { post: Post }) {
  const { t, toggleVote, voting, data } = useBoard();
  if (data.board.settings?.board_fields?.votes === false) return null;
  const enabled =
    data.board.settings?.voting_enabled !== false &&
    (!post.visibility || post.visibility === "published") &&
    !post.pending;
  return (
    <button
      className="pb-vote"
      type="button"
      aria-pressed={!!post.voted}
      disabled={!enabled || voting(post.id)}
      aria-label={(post.voted ? t("unvote") : t("vote")) + " · " + post.title}
      onClick={() => toggleVote(post)}
    >
      <ChevronUp size={17} strokeWidth={2.5} />
      <span>{post.votes ?? 0}</span>
    </button>
  );
}
export function CommentCount({ post }: { post: Post }) {
  const { t, data } = useBoard();
  return data.board.settings?.board_fields?.comments === false ? null : (
    <span className="pb-counter" title={t("comments")}>
      <MessageCircle size={14} />
      {post.comment_count ?? 0}
    </span>
  );
}
export function Body({ html, text }: { html?: string; text?: string }) {
  // Only the server supplies HTML. Local simulation and drafts are plain text.
  return html ? (
    <div className="pb-prose" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className="pb-prose pb-plaintext">{text}</div>
  );
}
export function PagedList<T extends { id: string }>({
  items,
  render,
  label,
  estimate = 100,
  scrollRef,
}: {
  items: T[];
  render: (v: T) => ReactNode;
  label: string;
  estimate?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(-1);
  const virtual = items.length > 60;
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const viewport = scrollRef?.current;
    const list = parent.current;
    if (!virtual || !viewport || !list) return;
    // Images and text above a thread can change its offset after the panel opens.
    const measureOffset = () =>
      setScrollMargin(
        list.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop,
      );
    measureOffset();
    const observer = new ResizeObserver(measureOffset);
    observer.observe(viewport);
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [virtual, scrollRef]);
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef?.current ?? parent.current,
    scrollMargin,
    estimateSize: () => estimate,
    overscan: 4,
    enabled: virtual,
    getItemKey: (i) => items[i].id,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focused >= 0 && focused < items.length && !indexes.includes(focused))
        return [...indexes, focused].sort((a, b) => a - b);
      return indexes;
    },
  });
  return (
    <div
      ref={parent}
      className={scrollRef ? "pb-paged" : "pb-paged pb-scroll-list"}
      role="list"
      aria-label={label}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setFocused(-1);
      }}
      onKeyDown={(ev) => {
        if (!virtual || !["ArrowDown", "ArrowUp"].includes(ev.key)) return;
        const next = Math.max(
          0,
          Math.min(
            items.length - 1,
            focused + (ev.key === "ArrowDown" ? 1 : -1),
          ),
        );
        ev.preventDefault();
        setFocused(next);
        rows.scrollToIndex(next);
        requestAnimationFrame(() =>
          parent.current
            ?.querySelector<HTMLElement>(
              '[data-index="' + next + '"] :is(a,button,input)',
            )
            ?.focus(),
        );
      }}
    >
      {virtual ? (
        <div
          className="pb-virtual-inner"
          style={{ height: rows.getTotalSize() }}
        >
          {rows.getVirtualItems().map((row) => (
            <div
              key={row.key}
              ref={rows.measureElement}
              data-index={row.index}
              className="pb-virtual-row"
              style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
              onFocus={() => setFocused(row.index)}
              role="listitem"
              aria-posinset={row.index + 1}
              aria-setsize={items.length}
            >
              {render(items[row.index])}
            </div>
          ))}
        </div>
      ) : (
        items.map((item) => (
          <div role="listitem" key={item.id}>
            {render(item)}
          </div>
        ))
      )}
    </div>
  );
}
export function SelectLabel({
  label,
  empty,
  allowEmpty = true,
  value,
  items,
  onChange,
}: {
  label: string;
  empty: string;
  allowEmpty?: boolean;
  value: string;
  items: Label[];
  onChange: (id: string) => void;
}) {
  const { locale, t } = useBoard();
  const id = useId();
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState("");
  if (items.length <= 60)
    return (
      <label className="pb-select">
        <span className="pb-sr">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {allowEmpty && <option value="">{empty}</option>}
          {items.map((i) => (
            <option value={i.id} key={i.id}>
              {labelName(i, locale)}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </label>
    );
  const current = items.find((i) => i.id === value);
  return (
    <>
      <button
        className="pb-neutral"
        type="button"
        aria-controls={id}
        aria-expanded={opened}
        onClick={() => setOpened(true)}
      >
        {current ? labelName(current, locale) : empty}
        <ChevronDown size={14} />
      </button>
      {opened && (
        <Modal title={label} onClose={() => setOpened(false)}>
          <div id={id} className="pb-modal-body">
            <label className="pb-search">
              <Search size={16} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t("search")}
              />
            </label>
            <PagedList
              items={[
                ...(allowEmpty ? [{ id: "", name: empty, color: "" }] : []),
                ...items.filter((i) =>
                  labelName(i, locale)
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                ),
              ]}
              label={label}
              estimate={36}
              render={(i) => (
                <button
                  className="pb-choice"
                  type="button"
                  onClick={() => {
                    onChange(i.id);
                    setOpened(false);
                    setQuery("");
                  }}
                >
                  {i.id === value ? <Check size={16} /> : <Dot size={16} />}{" "}
                  {labelName(i, locale)}
                </button>
              )}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
export function theme(a: Appearance = {}): CSSProperties {
  const size = (key: string | undefined, values: [string, string, string]) =>
    values[
      key === "small" || key === "short" || key === "narrow"
        ? 0
        : key === "large" || key === "tall" || key === "wide"
          ? 2
          : 1
    ];
  const radius = (shape?: string) =>
    shape === "square"
      ? "2px"
      : shape === "pill" || shape === "circle"
        ? "999px"
        : "10px";
  const color = (v: string | undefined, fallback: string) =>
    v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
  const button = color(a.button, "#2f7d4f");
  const contrast = (hex: string) => {
    const c = hex.slice(1);
    const full =
      c.length === 3
        ? c
            .split("")
            .map((n) => n + n)
            .join("")
        : c;
    const chan = [0, 2, 4].map((i) => {
      const v = parseInt(full.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return chan[0] * 0.2126 + chan[1] * 0.7152 + chan[2] * 0.0722 > 0.179
      ? "#10281e"
      : "#ffffff";
  };
  return {
    "--pb-bg": color(a.background, "#ffffff"),
    "--pb-text": color(a.text, "#262626"),
    "--pb-accent": color(a.accent, "#2f7d4f"),
    "--pb-button": button,
    "--pb-on-button": contrast(button),
    "--pb-font": a.font || "Poppins",
    "--pb-size": size(a.text_size, ["13px", "14px", "16px"]),
    "--pb-max": size(a.page_width, ["850px", "1140px", "1500px"]),
    "--pb-cover": size(a.cover_height, ["86px", "136px", "205px"]),
    "--pb-logo": size(a.logo_size, ["46px", "62px", "82px"]),
    "--pb-logo-radius": radius(a.logo_shape || "circle"),
    "--pb-input-bg": a.input_style === "filled" ? "#f0f3ee" : "#fff",
    "--pb-input-h": size(a.input_size, ["32px", "40px", "48px"]),
    "--pb-button-h": size(a.button_size, ["32px", "40px", "48px"]),
    "--pb-button-radius": radius(a.button_shape),
    "--pb-input-radius": radius(a.input_shape),
  } as CSSProperties;
}
