import { createHash } from "node:crypto";
export const fixtureId = (kind, n) => {
  const hex = createHash("md5")
    .update("kiska-perf:" + kind + ":" + n)
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};
export const board = "/b/atlas-lab/community";
export const post =
  board + "/p/" + fixtureId("post", 1) + "-save-favorite-routes-offline";
export const workspace = "/app/orgs/" + fixtureId("org", 1);
export const editor = workspace + "/boards/" + fixtureId("board", 1);
export const profiles = {
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    cpu: 4,
    rtt: 150,
    down: 1.6,
    up: 0.75,
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    cpu: 1,
    rtt: 40,
    down: 10,
    up: 5,
  },
};
export async function configure(browser, origin, profile, session) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    locale: "en-US",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  if (session)
    await context.addCookies([
      {
        name: "pb_session",
        value: session,
        url: origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.rtt,
    downloadThroughput: (profile.down * 1e6) / 8,
    uploadThroughput: (profile.up * 1e6) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  return { context, page, cdp };
}
