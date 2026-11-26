import { describe, it, expect } from "vitest";
import { previewAdapter } from "./preview";
import { orderedComments } from "./PostDetail";
import { patchVote } from "./BoardPresentation";
import { labelName } from "./i18n";
import type { BoardData, Filters } from "./types";
const filters: Filters = {
  view: "list",
  sort: "trending",
  q: "",
  status: "",
  tag: "",
};
const board: BoardData = {
  board: { id: "board", slug: "ideas", org_slug: "community", title: "Ideas" },
  statuses: [{ id: "s", name: "Suggestions", color: "#888", is_default: true }],
  tags: [],
  posts: [
    { id: "a", title: "Offline maps", status_id: "s", votes: 24 },
    { id: "b", title: "Export a route", status_id: "s", votes: 2 },
  ],
};
describe("public feedback", () => {
  it("keeps a failed vote on one card independent of another accepted vote", () => {
    let updated = patchVote(board, "a", true, 25);
    updated = patchVote(updated, "b", true, 3);
    updated = patchVote(updated, "a", false, 24);
    expect(
      "posts" in updated && updated.posts.map((p) => [p.voted, p.votes]),
    ).toEqual([
      [false, 24],
      [true, 3],
    ]);
  });
  it("retains deleted parents only when they have visible replies", () => {
    expect(
      orderedComments([
        { id: "1", deleted: true },
        { id: "2", deleted: true },
        { id: "3", parent_id: "1" },
        { id: "4", parent_id: "2", deleted: true },
      ]).map((c) => c.id),
    ).toEqual(["1", "3"]);
  });
  it("keeps simulated writes and guest recovery private to each preview", async () => {
    const a = previewAdapter(board),
      b = previewAdapter(board);
    await a.vote("a", true);
    await a.rename("Nina");
    await a.comment("a", "Hello", null);
    const token = (await a.recovery()).token;
    expect((await a.detail("a", "en")).post.votes).toBe(25);
    expect((await b.detail("a", "en")).post.votes).toBe(24);
    expect((await a.detail("a", "en")).comments[0].author?.name).toBe("Nina");
    await expect(b.recover(token)).rejects.toThrow();
    expect(
      (await b.board({ ...filters, q: "off ma" }, "en")).posts.map((p) => p.id),
    ).toEqual(["a"]);
    expect(board.posts[0].votes).toBe(24);
    a.dispose();
    b.dispose();
  });
  it("translates the preset while preserving creator names", () => {
    expect(
      labelName(
        { id: "s", name: "Under review", preset: "Under review", color: "" },
        "pt",
      ),
    ).toBe("Em análise");
    expect(
      labelName({ id: "s", name: "Next patch", preset: null, color: "" }, "pt"),
    ).toBe("Next patch");
  });
});
