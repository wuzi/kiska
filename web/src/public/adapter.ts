import { api, json } from "../api/client";
import {
  publicPath,
  type Adapter,
  type Board,
  type BoardData,
  type Detail,
  type Post,
} from "./types";

export function liveAdapter(board: Board): Adapter {
  const base = "/api/v1" + publicPath(board);
  const postUrl = (id: string) => base + "/posts/" + encodeURIComponent(id);
  const commentUrl = (id: string) =>
    base + "/comments/" + encodeURIComponent(id);
  return {
    board: (filters, locale, cursor, signal) => {
      const params = new URLSearchParams({
        view: filters.view,
        sort: filters.sort,
        locale,
      });
      for (const [key, value] of Object.entries({
        q: filters.q,
        status: filters.status.join(","),
        tag: filters.tag.join(","),
        cursor,
      })) {
        if (value) params.set(key, value);
      }
      return api<BoardData>(base + "?" + params, { signal });
    },
    updates: (locale, cursor, signal) =>
      api(base + "/updates?" + new URLSearchParams({ locale, cursor }), {
        signal,
      }),
    detail: async (id, locale, cursor, signal) => {
      const query =
        "?" + new URLSearchParams({ locale, ...(cursor ? { cursor } : {}) });
      let result = await api<Detail | { redirect_id: string }>(
        postUrl(id) + query,
        { signal },
      );
      const seen = new Set([id]);
      while ("redirect_id" in result) {
        if (seen.has(result.redirect_id) || seen.size > 25)
          throw new Error("Invalid post redirect");
        seen.add(result.redirect_id);
        result = await api<Detail | { redirect_id: string }>(
          postUrl(result.redirect_id) + query,
          { signal },
        );
      }
      return result;
    },
    suggestions: async (q, locale, signal) => {
      const result = await api<{ posts: Post[] }>(
        base + "/suggestions?" + new URLSearchParams({ q, locale }),
        { signal },
      );
      return result.posts;
    },
    vote: (id, desired) =>
      json(postUrl(id) + "/vote", desired ? "PUT" : "DELETE"),
    writePost: (payload, id) =>
      json(id ? postUrl(id) : base + "/posts", id ? "PATCH" : "POST", payload),
    removePost: (id) => json(postUrl(id), "DELETE"),
    comment: (id, body, parent_id, edit, guest_name) =>
      json(
        edit ? commentUrl(edit) : postUrl(id) + "/comments",
        edit ? "PATCH" : "POST",
        { body, parent_id, guest_name },
      ),
    removeComment: (id) => json(commentUrl(id), "DELETE"),
    like: (id, desired) =>
      json(commentUrl(id) + "/like", desired ? "PUT" : "DELETE"),
    guest: () => api(base + "/guest"),
    rename: (name) => json(base + "/guest", "PATCH", { name }),
    recovery: () => json(base + "/guest/recovery", "POST"),
    recover: (token) => json(base + "/guest/recover", "POST", { token }),
    subscribe: (email, locale) =>
      json(base + "/subscribe", "POST", { email, locale }),
    upload: (file) =>
      api(
        "/api/v1/boards/" + encodeURIComponent(board.id) + "/media?kind=post",
        {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        },
      ),
    release: (id) => json("/api/v1/media/" + encodeURIComponent(id), "DELETE"),
  };
}
