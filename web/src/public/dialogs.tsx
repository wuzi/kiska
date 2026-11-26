import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Copy, KeyRound } from "lucide-react";
import { useBoard } from "./context";
import { Avatar, ErrorBox, Modal } from "./ui";

export function Subscribe({ onClose }: { onClose: () => void }) {
  const { adapter, locale, t } = useBoard();
  const [email, setEmail] = useState("");
  const mutation = useMutation({
    mutationFn: () => adapter.subscribe(email, locale),
  });
  return (
    <Modal title={t("subscribe")} onClose={onClose}>
      <form
        className="pb-modal-body pb-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        {mutation.isSuccess ? (
          <p className="pb-success">
            <Check size={18} />
            {t("confirmEmail")}
          </p>
        ) : (
          <>
            <p className="pb-help">{t("subscribeHelp")}</p>
            <label>
              {t("email")}
              <input
                autoFocus
                autoComplete="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <ErrorBox error={mutation.error} />
            <button disabled={mutation.isPending} className="pb-primary">
              <Bell size={16} />
              {t("confirm")}
            </button>
          </>
        )}
      </form>
    </Modal>
  );
}
export function GuestProfile({
  onClose,
  initialToken = "",
}: {
  onClose: () => void;
  initialToken?: string;
}) {
  const { adapter, t, notify, preview } = useBoard();
  const client = useQueryClient();
  const guest = useQuery({
    queryKey: ["guest"],
    queryFn: () => adapter.guest(),
  });
  const [changedName, setChangedName] = useState<string | null>(null);
  const [token, setToken] = useState(initialToken);
  const [showRecover, setShowRecover] = useState(!!initialToken);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const restore = useMutation({
    mutationFn: () => adapter.recover(token.trim()),
    onSuccess: async () => {
      setChangedName(null);
      setToken("");
      setShowRecover(false);
      setCode("");
      if (!preview) {
        // The bootstrap and every cached page were personalized to the previous guest.
        location.reload();
        return;
      }
      await client.invalidateQueries();
      notify(t("recovered"));
      onClose();
    },
  });
  const rename = useMutation({
    mutationFn: () => adapter.rename(changedName ?? guest.data?.name ?? ""),
    onSuccess: async () => {
      await client.invalidateQueries();
      setChangedName(null);
      notify(t("saved"));
    },
  });
  const recovery = useMutation({
    mutationFn: () => adapter.recovery(),
    onSuccess: (r) => {
      setCode(r.token);
      setCopied(false);
    },
  });
  return (
    <Modal title={t("profile")} onClose={onClose}>
      <div className="pb-modal-body pb-form">
        <div className="pb-profile-line">
          <Avatar guest={guest.data ?? undefined} size={44} />
          <p>{t("profileHelp")}</p>
        </div>
        <form
          className="pb-form"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <label>
            {t("displayName")}
            <input
              maxLength={40}
              value={changedName ?? guest.data?.name ?? ""}
              placeholder={t("anonymous")}
              onChange={(e) => setChangedName(e.target.value)}
            />
          </label>
          <button
            className="pb-primary"
            disabled={rename.isPending || changedName === null}
          >
            {t("save")}
          </button>
        </form>
        <div className="pb-divider" />
        <h3>{t("recovery")}</h3>
        <p className="pb-help">{t("recoveryHelp")}</p>
        <button
          type="button"
          className="pb-neutral"
          disabled={recovery.isPending}
          onClick={() => recovery.mutate()}
        >
          <KeyRound size={15} />
          {t("getRecovery")}
        </button>
        {code && (
          <div className="pb-code">
            <code>{code}</code>
            <button
              aria-label={t("copyCode")}
              className="pb-icon"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code);
                  setCopied(true);
                } catch {
                  const selection = window.getSelection();
                  const node = document.querySelector(".pb-code code");
                  if (node && selection) {
                    selection.selectAllChildren(node);
                  }
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        )}
        {showRecover ? (
          <form
            className="pb-form"
            onSubmit={(e) => {
              e.preventDefault();
              restore.mutate();
            }}
          >
            <label>
              {t("recoveryCode")}
              <input
                value={token}
                required
                autoComplete="off"
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <button className="pb-primary" disabled={restore.isPending}>
              {t("recover")}
            </button>
          </form>
        ) : (
          <button className="pb-link" onClick={() => setShowRecover(true)}>
            {t("recover")}
          </button>
        )}
        <ErrorBox
          error={guest.error || rename.error || restore.error || recovery.error}
        />
      </div>
    </Modal>
  );
}
