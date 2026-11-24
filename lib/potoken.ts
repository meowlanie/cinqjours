/**
 * Web PoToken minting for YouTube caption tracks gated by `exp=xpe`.
 *
 * YouTube now answers 200 with an empty body on gated caption URLs unless a
 * proof-of-origin token is supplied as `&pot=<token>&c=WEB`. The token comes
 * from BotGuard's browser attestation. bgutils-js runs the challenge VM, and
 * jsdom supplies the browser globals it expects on the server.
 *
 * A mint costs ~1s, so the minter is cached and reused for every video until
 * 80% of the token's TTL (one hour when YouTube does not report one).
 */

export type PotFetch = (url: string, init?: RequestInit) => Promise<Response>;

type WebPoSignalOutput = Parameters<
  typeof import("bgutils-js/webpo").WebPoMinter.create
>[1];

type MinterState = {
  minter: import("bgutils-js/webpo").WebPoMinter;
  client: import("bgutils-js/botguard").BotGuardClient;
  expiresAt: number;
};

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const TTL_REFRESH_RATIO = 0.8;

let state: MinterState | null = null;
let refreshLock: Promise<MinterState> | null = null;
let domReady = false;
let failureStreak = 0;
let retryAfter = 0;

/** BotGuard's VM looks for browser globals on the global object. */
async function ensureDom(): Promise<void> {
  if (domReady) return;
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.location = dom.window.location;
  g.origin = dom.window.origin;
  // Node 21+ exposes a different global navigator; BotGuard needs jsdom's.
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: dom.window.navigator,
      configurable: true,
    });
  } catch {
    /* keep the existing navigator if the global is non-configurable */
  }
  domReady = true;
}

async function createMinter(fetchFn: PotFetch): Promise<MinterState> {
  await ensureDom();
  const { BotGuardClient, getChallenge } = await import("bgutils-js/botguard");
  const challenge = await getChallenge({
    requestKey: REQUEST_KEY,
    fetchFunction: fetchFn as typeof fetch,
  });

  let interpreter = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!interpreter && challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue) {
    const raw = challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    const url = raw.startsWith("//") ? `https:${raw}` : raw;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`BotGuard interpreter HTTP ${res.status}`);
    interpreter = await res.text();
  }
  if (!interpreter) throw new Error("BotGuard challenge had no interpreter");

  // The VM registers itself on globalThis when evaluated. Keep it there: the
  // minter closes over the running VM, so shutting it down breaks all mints.
  new Function(interpreter)();

  const client = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  });
  const webPoSignalOutput: WebPoSignalOutput = [];
  const botguardResponse = await client.snapshot({ webPoSignalOutput });

  const { buildURL, getHeaders } = await import("bgutils-js/utils");
  const res = await fetchFn(buildURL("GenerateIT", false), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });
  if (!res.ok) throw new Error(`GenerateIT HTTP ${res.status}`);
  const data = (await res.json()) as [string?, number?, number?, unknown?];
  const integrityToken = data[0];
  if (!integrityToken) throw new Error("GenerateIT returned no integrity token");
  const ttlSeconds = typeof data[1] === "number" && data[1] > 0 ? data[1] : 3600;

  const { WebPoMinter } = await import("bgutils-js/webpo");
  const minter = await WebPoMinter.create(
    { integrityToken, estimatedTtlSecs: ttlSeconds },
    webPoSignalOutput
  );
  return {
    minter,
    client,
    expiresAt: Date.now() + ttlSeconds * 1000 * TTL_REFRESH_RATIO,
  };
}

async function refreshMinterState(fetchFn: PotFetch, forceRefresh: boolean): Promise<MinterState> {
  if (!forceRefresh && state && state.expiresAt > Date.now()) return state;
  if (!forceRefresh && Date.now() < retryAfter) {
    throw new Error("PoToken indisponible temporairement.");
  }

  const previous = state;
  state = null;
  if (previous) void previous.client.shutdown().catch(() => {});
  try {
    const next = await createMinter(fetchFn);
    state = next;
    failureStreak = 0;
    retryAfter = 0;
    return next;
  } catch (err) {
    failureStreak += 1;
    retryAfter = Date.now() + Math.min(30_000 * 2 ** (failureStreak - 1), 900_000);
    throw err;
  }
}

/** Serialize refreshes so concurrent calls cannot discard a minter just created. */
async function ensureMinterState(fetchFn: PotFetch, forceRefresh: boolean): Promise<MinterState> {
  if (refreshLock) return refreshLock;
  refreshLock = refreshMinterState(fetchFn, forceRefresh).finally(() => {
    refreshLock = null;
  });
  return refreshLock;
}

/** Mint a PoToken bound to this video (captions use the video ID, not visitorData). */
export async function mintPoToken(
  videoId: string,
  fetchFn: PotFetch,
  forceRefresh = false
): Promise<string> {
  const current = await ensureMinterState(fetchFn, forceRefresh);
  return current.minter.mintAsWebsafeString(videoId);
}
