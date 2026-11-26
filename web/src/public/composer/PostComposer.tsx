import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { useBoard } from "../context";
import { eligibleStatuses } from "../views";
import { ErrorBox, GuestNameField, Modal, SelectLabel } from "../ui";

import { postPath, type Media, type Post } from "../types";

export const Editor = lazy(() => import("./RichEditor"));
export default function PostComposer({
  statusId,
  original,
  onClose,
}: {
  statusId?: string;
  original?: Post;
  onClose: () => void;
}) {
  const { data, adapter, t, locale, refresh, notify, preview } = useBoard();
  const statuses = eligibleStatuses(data);
  const settings = data.board.settings ?? {};
  const fields = settings.form_fields ?? {};
  const [title, setTitle] = useState(original?.title ?? "");
  const [body, setBody] = useState(original?.body ?? "");
  const [status, setStatus] = useState(
    original?.status_id ??
      statusId ??
      (statuses.find((s) => s.is_default || s.default_status) ?? statuses[0])
        ?.id ??
      "",
  );
  const [guestName, setGuestName] = useState<string>();
  const [tag, setTag] = useState(original?.tag_id ?? "");
  const [media, setMedia] = useState<Media[]>(original?.media ?? []);
  const staged = useRef(new Set<string>());
  const committed = useRef(false);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(title.trim()), 250);
    return () => clearTimeout(timer);
  }, [title]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!committed.current)
        for (const id of staged.current)
          void adapter.release(id).catch(() => {});
    };
  }, [adapter]);
  const suggestions = useQuery({
    queryKey: ["similar", locale, search],
    queryFn: ({ signal }) => adapter.suggestions(search, locale, signal),
    enabled: !original && search.length >= 3,
    staleTime: 10_000,
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (title.trim().length < 3 || title.trim().length > 120)
        throw new Error(t("invalidTitle"));
      if (body.length > 10000) throw new Error(t("bodyLimit"));
      return adapter.writePost(
        {
          title: title.trim(),
          guest_name: guestName,
          body,
          status_id: status,
          tag_id: tag || null,
          media_ids: media.map((m) => m.id),
        },
        original?.id,
      );
    },
    onSuccess: async () => {
      committed.current = true;
      await refresh();
      notify(t(original ? "saved" : "posted"));
      onClose();
    },
  });
  async function upload(files: File[]) {
    setFailure(null);
    if (
      files.length + media.length > 4 ||
      files.some((f) => f.size > 5 * 1024 * 1024)
    ) {
      setFailure(new Error(t("fileLimit")));
      return;
    }
    if (
      files.some(
        (f) => !["image/png", "image/jpeg", "image/webp"].includes(f.type),
      )
    ) {
      setFailure(new Error(t("invalidImage")));
      return;
    }
    setWorking(true);
    try {
      for (const file of files) {
        const item = await adapter.upload(file);
        if (!mounted.current) {
          await adapter.release(item.id);
          break;
        }
        staged.current.add(item.id);
        setMedia((m) => [...m, item]);
      }
    } catch (e) {
      setFailure(e);
    } finally {
      setWorking(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <Modal
      title={t(original ? "editPost" : "newPost")}
      onClose={() => {
        if (!submit.isPending) onClose();
      }}
      wide
    >
      <form
        className="pb-form pb-modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <label>
          {t("title")}
          <input
            name="title"
            autoFocus
            required
            maxLength={120}
            minLength={3}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {!original && search.length >= 3 && !!suggestions.data?.length && (
          <aside className="pb-similar">
            <strong>{t("similar")}</strong>
            {suggestions.data.slice(0, 5).map((p) =>
              preview ? (
                <details key={p.id}>
                  <summary>{p.title}</summary>
                  <p>{p.excerpt || p.body}</p>
                </details>
              ) : (
                <a
                  key={p.id}
                  href={postPath(data.board, p)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.title}
                </a>
              ),
            )}
          </aside>
        )}
        {fields.body !== false && (
          <div className="pb-form-field">
            <span>
              {t("description")} <small>({t("optional")})</small>
            </span>
            <Suspense
              fallback={
                <div className="pb-editor-placeholder">{t("loading")}</div>
              }
            >
              <Editor
                label={t("description")}
                initial={body}
                onChange={setBody}
              />
            </Suspense>
          </div>
        )}
        <div className="pb-form-grid">
          {!original && statuses.length > 1 && (
            <div className="pb-form-field">
              <span>{t("status")}</span>
              <SelectLabel
                label={t("status")}
                empty={t("status")}
                value={status}
                items={statuses}
                allowEmpty={false}
                onChange={setStatus}
              />
            </div>
          )}
          {fields.tag !== false && data.tags.length > 0 && (
            <div className="pb-form-field">
              <span>{t("tag")}</span>
              <SelectLabel
                value={tag}
                items={data.tags}
                onChange={setTag}
                label={t("tag")}
                empty={t("noTag")}
              />
            </div>
          )}
        </div>
        {fields.images !== false && settings.guest_uploads !== false && (
          <div className="pb-form-field">
            <span>
              {t("attachment")} <small>({t("optional")})</small>
            </span>
            <div className="pb-thumbs">
              {media.map((m) => (
                <div key={m.id}>
                  <img src={m.url} alt={t("attachment")} />
                  <button
                    className="pb-icon"
                    type="button"
                    aria-label={t("removeImage")}
                    onClick={() => {
                      setMedia((prev) => prev.filter((i) => i.id !== m.id));
                      if (staged.current.delete(m.id))
                        void adapter.release(m.id).catch(setFailure);
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <input
              ref={input}
              type="file"
              className="pb-sr"
              tabIndex={-1}
              accept="image/jpeg,image/png,image/webp"
              multiple
              aria-label={t("upload")}
              onChange={(e) => void upload(Array.from(e.target.files ?? []))}
            />
            {media.length < 4 && (
              <button
                type="button"
                className="pb-upload"
                disabled={working}
                onClick={() => input.current?.click()}
              >
                <ImagePlus size={17} />
                {working ? t("loading") : t("upload")}{" "}
                <small>{media.length}/4</small>
              </button>
            )}
          </div>
        )}
        {!original &&
          fields.author !== false &&
          (preview || !data.authenticated) && (
            <GuestNameField value={guestName} onChange={setGuestName} />
          )}
        <ErrorBox error={failure || submit.error} />
        <div className="pb-form-actions">
          <button
            className="pb-neutral"
            type="button"
            disabled={submit.isPending}
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button className="pb-primary" disabled={submit.isPending || working}>
            {t(original ? "save" : "submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
