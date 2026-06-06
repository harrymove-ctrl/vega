/**
 * /api/auth — signed-challenge auth (foundational; not a placeholder stub).
 *
 *   GET  /api/auth/nonce?address=0x..  -> { address, nonce, message, expiresAt }
 *   POST /api/auth/verify { address, signature } -> { address, token, expiresAt }
 *
 * The frontend signs `message` with personal_sign, posts the signature back,
 * and stores `token` as the bearer for every authed call.
 */
import { Hono } from "hono";

import type { AppEnv } from "../app";
import { getDb } from "../db/client";
import { issueNonce, mintSession, verifyChallenge } from "../auth";

const r = new Hono<AppEnv>();

r.get("/nonce", async (c) => {
  const address = c.req.query("address");
  if (!address) return c.json({ detail: "address is required" }, 400);
  const db = getDb(c.env);
  const issued = await issueNonce(db, address);
  return c.json(issued);
});

r.post("/verify", async (c) => {
  let body: { address?: string; signature?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }
  const { address, signature } = body;
  if (!address || !signature) {
    return c.json({ detail: "address and signature are required" }, 400);
  }
  const db = getDb(c.env);
  const ok = await verifyChallenge(db, address, signature);
  if (!ok) return c.json({ detail: "Signature verification failed" }, 401);

  const token = await mintSession(address, c.env.AUTH_SECRET);
  // claims.exp is encoded in the token; recompute for the response convenience.
  return c.json({ address: address.toLowerCase(), token });
});

export { r as authRouter };
