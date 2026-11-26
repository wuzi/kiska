import { createContext, useContext } from "react";
import type { Adapter, BoardData, Locale, Post } from "./types";
import type { Translate } from "./i18n";

export interface PublicContext {
  data: BoardData;
  adapter: Adapter;
  locale: Locale;
  t: Translate;
  preview: boolean;
  root: HTMLElement | null;
  notify: (message: string) => void;
  refresh: () => Promise<unknown>;
  openPost: (p: Post) => void;
  openComposer: (status?: string, post?: Post) => void;
  toggleVote: (post: Post) => void;
  voting: (id: string) => boolean;
}
export const PublicBoardContext = createContext<PublicContext | null>(null);
export function useBoard() {
  const ctx = useContext(PublicBoardContext);
  if (!ctx) throw new Error("Public board context is missing");
  return ctx;
}
