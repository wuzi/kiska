import {
  cloneElement,
  isValidElement,
  useId,
  createContext,
  useContext,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, LoaderCircle, Layers3 } from "lucide-react";
import { api, json, ApiError } from "../api/client";
import { apiPath, errorText, type Locale, type T } from "./model";
export const LocaleContext = createContext<Locale>("en");
export const useT = (): T => {
  const lang = useContext(LocaleContext);
  return (en, pt) => (lang === "pt" ? pt : en);
};
export const get = <T,>(path: string) => api<T>(apiPath(path));
export const write = <T,>(path: string, method: string, body?: unknown) =>
  json<T>(apiPath(path), method, body);
export const Brand = () => (
  <span className="ws-brand">
    <span>
      <Layers3 size={18} />
    </span>
    PatchBoard
  </span>
);
export function Msg({
  error,
  children,
}: {
  error?: boolean;
  children?: ReactNode;
}) {
  return children ? (
    <div
      className={error ? "ws-error" : "ws-message"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  ) : null;
}
export function Loading() {
  const t = useT();
  return (
    <div className="ws-loading" role="status">
      <LoaderCircle size={17} className="ws-spin" />
      {t("Loading…", "Carregando…")}
    </div>
  );
}
export function useJob() {
  const t = useT();
  const [stale, setStale] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  async function run(action: () => Promise<void>, success?: string) {
    if (busy) return;
    setBusy(true);
    setStale(false);
    setError("");
    setNote("");
    try {
      await action();
      if (success) setNote(success);
    } catch (e) {
      const outdated =
        e instanceof ApiError &&
        e.status === 409 &&
        e.code === "stale_revision";
      setStale(outdated);
      setError(
        outdated
          ? t(
              "Another teammate saved changes. Your draft is intact.",
              "Outra pessoa salvou alterações. Seu rascunho foi preservado.",
            )
          : errorText(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    stale,
    error,
    note,
    run,
    clear: () => {
      setStale(false);
      setError("");
      setNote("");
    },
  };
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const t = useT(),
    [origin] = useState(() => document.activeElement as HTMLElement | null);
  return (
    <Dialog.Root
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ws-modal-shade" />
        <Dialog.Content
          className={"ws-modal" + (wide ? " ws-modal-wide" : "")}
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            if (origin?.isConnected) {
              e.preventDefault();
              origin.focus();
            }
          }}
        >
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="ws-icon" aria-label={t("Close", "Fechar")}>
              <X size={18} />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="ws-field">
      <label htmlFor={id}>{label}</label>
      {hint && <small id={id + "-hint"}>{hint}</small>}
      {isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
        ? cloneElement(children, {
            id,
            "aria-describedby": hint ? id + "-hint" : undefined,
          })
        : children}
    </div>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="ws-toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function onSubmit(action: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    action();
  };
}
export function Empty({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ws-empty">
      {icon}
      <span>{children}</span>
    </div>
  );
}
export function Lang({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (l: Locale) => void;
}) {
  return (
    <select
      aria-label="Language / Idioma"
      value={locale}
      onChange={(e) => onChange(e.target.value as Locale)}
    >
      <option value="en">English</option>
      <option value="pt">Português</option>
    </select>
  );
}
