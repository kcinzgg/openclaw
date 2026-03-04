import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuUserToken } from "./types.js";

const TOKEN_DIR = path.join(os.homedir(), ".openclaw", "credentials");

function tokenPath(accountId: string, userId: string): string {
  const safeAccount = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(TOKEN_DIR, `feishu-user-token-${safeAccount}-${safeUser}.json`);
}

// ── Auth URL ──

// Scopes required by user_access_token APIs used in OpenClaw Feishu tools.
// Only request scopes that are actively used; add more as tools grow.
const DEFAULT_OAUTH_SCOPES = ["task:task:read", "task:task:write"];

export function buildAuthUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
  domain?: string;
  scopes?: string[];
}): string {
  const base = params.domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  const scopes = params.scopes ?? DEFAULT_OAUTH_SCOPES;
  const qs = new URLSearchParams({
    redirect_uri: params.redirectUri,
    app_id: params.appId,
    state: params.state,
    scope: scopes.join(" "),
  });
  return `${base}/open-apis/authen/v1/authorize?${qs}`;
}

// ── Code → Token exchange ──

type OidcTokenResponse = {
  code?: number;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    open_id?: string;
    token_type?: string;
  };
  msg?: string;
};

export async function exchangeCodeForToken(
  client: Lark.Client,
  code: string,
): Promise<FeishuUserToken> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK OIDC access token API
  const res = (await (client as any).authen.oidcAccessToken.create({
    data: { grant_type: "authorization_code", code },
  })) as OidcTokenResponse;

  if (res.code !== 0 || !res.data?.access_token) {
    throw new Error(`Feishu OAuth token exchange failed: ${res.msg ?? `code=${res.code}`}`);
  }

  const now = Date.now();
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token ?? "",
    expiresAt: now + (res.data.expires_in ?? 7200) * 1000,
    openId: res.data.open_id ?? "",
    obtainedAt: now,
  };
}

// ── Refresh ──

type OidcRefreshResponse = OidcTokenResponse;

export async function refreshUserToken(
  client: Lark.Client,
  refreshToken: string,
): Promise<FeishuUserToken> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK OIDC refresh API
  const res = (await (client as any).authen.oidcRefreshAccessToken.create({
    data: { grant_type: "refresh_token", refresh_token: refreshToken },
  })) as OidcRefreshResponse;

  if (res.code !== 0 || !res.data?.access_token) {
    throw new Error(`Feishu OAuth token refresh failed: ${res.msg ?? `code=${res.code}`}`);
  }

  const now = Date.now();
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token ?? refreshToken,
    expiresAt: now + (res.data.expires_in ?? 7200) * 1000,
    openId: res.data.open_id ?? "",
    obtainedAt: now,
  };
}

// ── Persistence ──

export function persistUserToken(accountId: string, userId: string, token: FeishuUserToken): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenPath(accountId, userId), JSON.stringify(token, null, 2), {
    mode: 0o600,
  });
}

export function loadUserToken(accountId: string, userId: string): FeishuUserToken | null {
  const p = tokenPath(accountId, userId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    if (typeof raw.accessToken !== "string" || typeof raw.refreshToken !== "string") {
      return null;
    }
    return raw as unknown as FeishuUserToken;
  } catch {
    return null;
  }
}

export function deleteUserToken(accountId: string, userId: string): void {
  const p = tokenPath(accountId, userId);
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

// ── High-level: get a valid user_access_token (refresh if needed) ──

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function getUserAccessToken(
  client: Lark.Client,
  accountId: string,
  userId: string,
): Promise<string | null> {
  let token = loadUserToken(accountId, userId);

  // Fallback: if exact userId match not found, try any token for this account.
  // Handles cases where the tool context userId differs from the OAuth userId
  // (e.g., "owner" fallback vs actual open_id, or user_id vs open_id format).
  let effectiveUserId = userId;
  if (!token) {
    const fallbackResult = findAnyTokenForAccount(accountId);
    if (fallbackResult) {
      token = fallbackResult.token;
      effectiveUserId = fallbackResult.userId;
    }
  }
  if (!token) return null;

  if (Date.now() < token.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    return token.accessToken;
  }

  // Token expired or about to expire — try refresh
  if (!token.refreshToken) return null;
  try {
    token = await refreshUserToken(client, token.refreshToken);
    persistUserToken(accountId, effectiveUserId, token);
    return token.accessToken;
  } catch {
    // Refresh failed (refresh_token expired after ~30 days)
    deleteUserToken(accountId, effectiveUserId);
    return null;
  }
}

/** Scan credentials dir for any valid token file matching this account. */
function findAnyTokenForAccount(
  accountId: string,
): { token: FeishuUserToken; userId: string } | null {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = `feishu-user-token-${safeAccountId}-`;
  try {
    if (!fs.existsSync(TOKEN_DIR)) return null;
    const files = fs.readdirSync(TOKEN_DIR);
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith(".json")) continue;
      const foundUserId = file.slice(prefix.length, -5);
      if (!foundUserId) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(TOKEN_DIR, file), "utf-8")) as Record<
          string,
          unknown
        >;
        if (typeof raw.accessToken === "string" && typeof raw.refreshToken === "string") {
          return { token: raw as unknown as FeishuUserToken, userId: foundUserId };
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore scan errors
  }
  return null;
}

// ── Pending auth state (persisted to disk so it survives gateway restarts) ──

type PendingAuthEntry = { accountId: string; userId: string; createdAt: number };
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
const PENDING_AUTH_FILE = path.join(TOKEN_DIR, "feishu-pending-oauth.json");

function loadPendingAuths(): Map<string, PendingAuthEntry> {
  try {
    if (!fs.existsSync(PENDING_AUTH_FILE)) return new Map();
    const raw = JSON.parse(fs.readFileSync(PENDING_AUTH_FILE, "utf-8")) as Record<
      string,
      PendingAuthEntry
    >;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function savePendingAuths(map: Map<string, PendingAuthEntry>): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PENDING_AUTH_FILE, JSON.stringify(Object.fromEntries(map), null, 2), {
    mode: 0o600,
  });
}

export function createPendingAuth(accountId: string, userId: string): string {
  const pending = loadPendingAuths();
  const now = Date.now();
  // Clean stale entries
  for (const [key, val] of pending) {
    if (now - val.createdAt > PENDING_AUTH_TTL_MS) pending.delete(key);
  }
  const state = crypto.randomBytes(16).toString("hex");
  pending.set(state, { accountId, userId, createdAt: now });
  savePendingAuths(pending);
  return state;
}

export function consumePendingAuth(state: string): { accountId: string; userId: string } | null {
  const pending = loadPendingAuths();
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  savePendingAuths(pending);
  if (Date.now() - entry.createdAt > PENDING_AUTH_TTL_MS) return null;
  return { accountId: entry.accountId, userId: entry.userId };
}
