/**
 * Signed-challenge auth for Vega (replaces the spoofable `Bearer wagmi:<addr>`).
 *
 * Flow (contract §3):
 *   1. GET  /api/auth/nonce?address=  -> issueNonce(db, address)
 *   2. client personal_signs the message `Vega auth: <nonce>`
 *   3. POST /api/auth/verify {address, signature} -> verifyChallenge(...) then mintSession(address)
 *   4. every write goes through requireAuth, which calls verifySession(token) and
 *      sets c.var.address. Handlers read it with getAddress(c) — never from a header.
 *
 * Signatures are verified with viem (isomorphic). Session tokens are HMAC-SHA256
 * over `<address>.<exp>` using crypto.subtle + AUTH_SECRET.
 */
import { verifyMessage } from "viem";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import { authNonces } from "../db/schema";
import { getDb } from "../db/client";
import type { Env } from "../index";

// Hono variable map: requireAuth populates `address`.
export type AuthVariables = { address: `0x${string}` };

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function authMessage(nonce: string): string {
  return `Vega auth: ${nonce}`;
}

export function normalizeAddress(address: string): `0x${string}` {
  return address.trim().toLowerCase() as `0x${string}`;
}

// --- nonce issuance -------------------------------------------------------

export async function issueNonce(db: ReturnType<typeof getDb>, address: string) {
  const addr = normalizeAddress(address);
  const nonce = crypto.randomUUID();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  await db
    .insert(authNonces)
    .values({ address: addr, nonce, expiresAt })
    .onConflictDoUpdate({
      target: authNonces.address,
      set: { nonce, expiresAt },
    });
  return { address: addr, nonce, message: authMessage(nonce), expiresAt };
}

// --- challenge verification ----------------------------------------------

export async function verifyChallenge(
  db: ReturnType<typeof getDb>,
  address: string,
  signature: string,
): Promise<boolean> {
  const addr = normalizeAddress(address);
  const row = await db.query.authNonces.findFirst({
    where: eq(authNonces.address, addr),
  });
  if (!row) return false;
  if (row.expiresAt < Date.now()) return false;

  // viem throws (not returns false) on a malformed signature — e.g. wrong
  // length / non-hex. Treat any throw as a failed challenge so a garbage
  // signature yields a clean 401 instead of an unhandled 500.
  let valid = false;
  try {
    valid = await verifyMessage({
      address: addr,
      message: authMessage(row.nonce),
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return false;

  // single-use: burn the nonce on success
  await db.delete(authNonces).where(eq(authNonces.address, addr));
  return true;
}

// --- HMAC session tokens (crypto.subtle) ---------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Mint a token of the form `<base64url(payload)>.<base64url(hmac)>`. */
export async function mintSession(
  address: string,
  secret: string,
  ttlMs: number = SESSION_TTL_MS,
): Promise<string> {
  const addr = normalizeAddress(address);
  const exp = Date.now() + ttlMs;
  const payload = `${addr}.${exp}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return `${bytesToBase64Url(new TextEncoder().encode(payload))}.${bytesToBase64Url(sig)}`;
}

export type SessionClaims = { address: `0x${string}`; exp: number };

/** Verify a token's HMAC + expiry. Returns claims or null. */
export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let payload: string;
  try {
    payload = new TextDecoder().decode(base64UrlToBytes(payloadB64));
  } catch {
    return null;
  }

  const key = await hmacKey(secret);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  let provided: Uint8Array;
  try {
    provided = base64UrlToBytes(sigB64);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, provided)) return null;

  const dot = payload.lastIndexOf(".");
  if (dot < 0) return null;
  const address = payload.slice(0, dot) as `0x${string}`;
  const exp = Number(payload.slice(dot + 1));
  if (!Number.isFinite(exp) || exp < Date.now()) return null;

  return { address, exp };
}

// --- Hono middleware ------------------------------------------------------

function bearerToken(c: Context): string | null {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

/**
 * Gate any write endpoint with this. On success c.var.address is the verified
 * caller; on failure it short-circuits with 401.
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}> = async (c, next) => {
  const token = bearerToken(c);
  if (!token) return c.json({ detail: "Missing bearer token" }, 401);
  const claims = await verifySession(token, c.env.AUTH_SECRET);
  if (!claims) return c.json({ detail: "Invalid or expired session" }, 401);
  c.set("address", normalizeAddress(claims.address));
  await next();
};

/**
 * Read the verified caller address inside an auth-gated handler.
 *
 * Generic over the full Hono env so it accepts a router's
 * `Context<AppEnv>` (= `{ Bindings: Env; Variables: AuthVariables }`)
 * as well as the bare `{ Variables: AuthVariables }` shape — Hono's
 * `Context` is invariant in its env, so a non-generic narrow parameter
 * would reject the wider router context.
 */
export function getAddress<E extends { Variables: AuthVariables }>(
  c: Context<E>,
): `0x${string}` {
  return c.get("address");
}
