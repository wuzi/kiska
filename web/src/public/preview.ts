import type { Adapter, BoardData, Comment, Guest, Media, Post } from "./types";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
export function previewAdapter(
  initial: BoardData,
): Adapter & { dispose(): void } {
  const byId = new Map<string, Post>();
  for (const p of [
    ...initial.posts,
    ...(initial.columns ?? []).flatMap((c) => c.posts),
  ])
    byId.set(p.id, structuredClone(p));
  const posts = [...byId.values()];
  const comments = new Map<string, Comment[]>();
  let guest: Guest = { name: "" };
  const media = new Map<string, Media>();
  const recoverToken = crypto.randomUUID();
  const find = (id: string) => {
    const item = posts.find((p) => p.id === id);
    if (!item) throw new Error("Post unavailable");
    return item;
  };
  const thread = (id: string) => {
    if (!comments.has(id)) comments.set(id, []);
    return comments.get(id)!;
  };
  const page = <T>(rows: T[], cursor?: string) => {
    const start = Number(cursor) || 0;
    return {
      items: rows.slice(start, start + 30),
      next_cursor: start + 30 < rows.length ? start + 30 : null,
    };
  };
  const commentById = (id: string) =>
    [...comments.values()].flat().find((c) => c.id === id);
  const fixed = <T>(value: T) => Promise.resolve(structuredClone(value));
  return {
    board: (f, _locale, cursor) => {
      const words = normalize(f.q).trim().split(/\s+/).filter(Boolean);
      const matches = posts.filter(
        (p) =>
          (!f.status || p.status_id === f.status) &&
          (!f.tag || p.tag_id === f.tag) &&
          words.every((word) =>
            normalize(p.title + " " + (p.body ?? ""))
              .split(/[^\p{L}\p{N}]+/u)
              .some((part) => part.startsWith(word)),
          ),
      );
      const order = initial.board.settings?.manual_order ?? [];
      const index = (id: string) =>
        order.includes(id) ? order.indexOf(id) : Infinity;
      matches.sort(
        (a, b) =>
          Number(!!b.pinned) - Number(!!a.pinned) ||
          (f.sort === "manual"
            ? index(a.id) - index(b.id)
            : f.sort === "new"
              ? 0
              : (f.sort === "trending"
                  ? (b.weekly_votes ?? 0) - (a.weekly_votes ?? 0)
                  : 0) || (b.votes ?? 0) - (a.votes ?? 0)) ||
          (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
          a.id.localeCompare(b.id),
      );
      const result = page(matches, cursor);
      const updates = page(initial.updates ?? []);
      return fixed({
        ...initial,
        updates: updates.items,
        updates_next_cursor: updates.next_cursor,
        posts: result.items,
        next_cursor: result.next_cursor,
        total: matches.length,
        columns: initial.statuses
          .filter((s) => s.on_roadmap !== false)
          .map((s) => {
            const col = matches.filter((p) => p.status_id === s.id);
            return {
              status_id: s.id,
              posts: col.slice(0, 30),
              total: col.length,
              next_cursor: col.length > 30 ? 30 : null,
            };
          }),
      });
    },
    updates: (_locale, cursor) => {
      const result = page(initial.updates ?? [], cursor);
      return fixed({ updates: result.items, next_cursor: result.next_cursor });
    },
    detail: (id, _locale, cursor) => {
      const result = page(thread(id), cursor);
      return fixed({
        post: find(id),
        comments: result.items,
        next_cursor: result.next_cursor,
      });
    },
    suggestions: (q) =>
      fixed(
        posts
          .filter((p) => normalize(p.title).includes(normalize(q)))
          .slice(0, 5),
      ),
    vote: (id, desired) => {
      const p = find(id);
      if (!!p.voted !== desired)
        p.votes = Math.max(0, (p.votes ?? 0) + (desired ? 1 : -1));
      p.voted = desired;
      return fixed(p);
    },
    writePost: (payload, id) => {
      const p: Post = id
        ? find(id)
        : {
            id: crypto.randomUUID(),
            title: "",
            status_id: payload.status_id,
            author: guest,
            can_edit: true,
            created_at: new Date().toISOString(),
            voted: false,
            votes: 0,
            comment_count: 0,
            pending: initial.board.settings?.require_approval,
          };
      Object.assign(p, payload, {
        body_html: undefined,
        media: payload.media_ids.flatMap(
          (id) => media.get(id) ?? p.media?.find((m) => m.id === id) ?? [],
        ),
      });
      if (!id) posts.unshift(p);
      return fixed(p);
    },
    removePost: (id) => {
      posts.splice(posts.indexOf(find(id)), 1);
      return fixed(null);
    },
    comment: (id, body, parent_id, edit) => {
      const p = find(id);
      if (edit) {
        const c = commentById(edit);
        if (c) Object.assign(c, { body, body_html: undefined });
      } else {
        thread(id).push({
          id: crypto.randomUUID(),
          body,
          parent_id,
          author: guest,
          can_edit: true,
          created_at: new Date().toISOString(),
        });
        p.comment_count = (p.comment_count ?? 0) + 1;
      }
      return fixed(null);
    },
    removeComment: (id) => {
      for (const [post, items] of comments) {
        const c = items.find((c) => c.id === id);
        if (c) {
          c.deleted = true;
          c.can_edit = false;
          c.body = "";
          find(post).comment_count = Math.max(
            0,
            (find(post).comment_count ?? 0) - 1,
          );
        }
      }
      return fixed(null);
    },
    like: (id, desired) => {
      const c = commentById(id);
      if (c && !!c.liked !== desired) {
        c.liked = desired;
        c.likes = (c.likes ?? 0) + (desired ? 1 : -1);
      }
      return fixed(null);
    },
    guest: () => fixed(guest),
    rename: (name) => {
      guest.name = name;
      return fixed(guest);
    },
    recovery: () => fixed({ token: recoverToken }),
    recover: async (token) => {
      if (token !== recoverToken) throw new Error("Invalid recovery code");
      return guest;
    },
    subscribe: () => fixed(null),
    upload: (file) => {
      const m = { id: crypto.randomUUID(), url: URL.createObjectURL(file) };
      media.set(m.id, m);
      return fixed(m);
    },
    release: (id) => {
      const m = media.get(id);
      if (m) URL.revokeObjectURL(m.url);
      media.delete(id);
      return fixed(null);
    },
    dispose: () => {
      for (const m of media.values()) URL.revokeObjectURL(m.url);
      media.clear();
    },
  };
}
