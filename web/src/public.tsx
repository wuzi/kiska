import { createRoot } from "react-dom/client";
import { BoardPresentation } from "./public/BoardPresentation";
import { api } from "./api/client";
import { getLocale, translator } from "./public/i18n";
import type { BoardData } from "./public/types";

declare global {
  interface Window {
    __PATCHBOARD__?: BoardData;
  }
}
const container =
  document.getElementById("root") || document.getElementById("app");
async function start() {
  if (!container) return;
  const boardPath = location.pathname.match(/^\/b\/[^/]+\/[^/]+/)?.[0];
  const data =
    window.__PATCHBOARD__ ??
    (boardPath
      ? await api<BoardData>("/api/v1" + boardPath + location.search)
      : null);
  if (!data) throw new Error(translator(getLocale())("unavailable"));
  createRoot(container).render(<BoardPresentation data={data} />);
}
void start().catch((e) => {
  if (container && !container.textContent?.trim())
    container.textContent =
      e instanceof Error ? e.message : translator(getLocale())("unavailable");
});
