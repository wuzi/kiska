import { expect, type Page } from "@playwright/test";

// Count executions of the actual React component in the optimized browser bundle.
// Resolve its generated function from a rendered class name so this survives minification.
export async function profileComponent(page: Page, marker: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Debugger.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.startPreciseCoverage", {
    callCount: true,
    detailed: false,
  });
  return async (typeIntoPanel: () => Promise<void>) => {
    await page.waitForLoadState("networkidle");
    const before = await cdp.send("Profiler.takePreciseCoverage");
    let component: { scriptId: string; start: number } | undefined;
    for (const script of before.result.filter(
      (item) => item.url.includes("/assets/") && item.url.endsWith(".js"),
    )) {
      // A navigation can leave a previous document in the coverage snapshot after its
      // debugger scripts have been released. Only the current document can render.
      const source = await cdp
        .send("Debugger.getScriptSource", { scriptId: script.scriptId })
        .catch((error: Error) => {
          if (error.message.includes("No script for id")) return null;
          throw error;
        });
      if (!source) continue;
      const { scriptSource } = source;
      const offset = scriptSource.indexOf(marker);
      if (offset < 0) continue;
      const candidates = script.functions
        .map((fn) => fn.ranges[0])
        .filter(
          (r) => r.count > 0 && r.startOffset <= offset && r.endOffset > offset,
        )
        .sort(
          (a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset),
        );
      if (candidates.length && candidates[0].startOffset > 0) {
        component = {
          scriptId: script.scriptId,
          start: candidates[0].startOffset,
        };
        break;
      }
    }
    expect(
      component,
      "Component rendered before opening its form",
    ).toBeDefined();
    await typeIntoPanel();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const after = await cdp.send("Profiler.takePreciseCoverage");
    const script = after.result.find((s) => s.scriptId === component!.scriptId);
    const fn = script?.functions.find(
      (f) => f.ranges[0].startOffset === component!.start,
    );
    await cdp.detach();
    expect(
      fn?.ranges[0].count ?? 0,
      "Underlying component renders while typing",
    ).toBe(0);
  };
}
