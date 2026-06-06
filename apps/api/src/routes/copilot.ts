/**
 * /api/copilot — Vega Copilot conversations + chat jobs.
 *
 * Contract (consumed by apps/web/src/components/copilot/copilot-page.tsx):
 *   GET    /api/copilot/conversations            -> CopilotConversationSummary[]   (auth)
 *   POST   /api/copilot/conversations            -> CopilotConversationSummary      (auth)
 *   GET    /api/copilot/conversations/:id         -> CopilotConversationDetail       (auth)
 *   DELETE /api/copilot/conversations/:id         -> { ok: true }                    (auth)
 *   POST   /api/copilot/chat/jobs                -> CopilotChatJobCreateResponse    (auth)
 *   GET    /api/copilot/chat/jobs/:id             -> CopilotChatJobStatusResponse    (auth)
 *
 * Conversations are persisted as trivial stubs (an empty thread + optimistic
 * user turns) so the history panel and conversation switching work end-to-end.
 *
 * The chat *answer* requires the Anthropic tool-calling loop (account-context
 * reads + SoSoValue/SoDEX tools), which is P1-E and NOT wired here. We do NOT
 * fabricate an assistant reply: every chat job resolves to an honest
 * `status: "failed"` with a clear `errorDetail`. The frontend surfaces that
 * string verbatim and drops the optimistic user bubble (copilot-page.tsx:388).
 *
 * The schema has no copilot_conversations / copilot_jobs tables (and this agent
 * must not edit schema.ts), so conversations + jobs live in a per-isolate
 * in-memory store. That is enough to make the UI flows real within a session;
 * cross-isolate durability lands with the LLM wiring in P1-E.
 */
import { Hono } from "hono";

import type { AppEnv } from "../app";
import { getAddress, normalizeAddress, requireAuth } from "../auth";

const r = new Hono<AppEnv>();

// --- Honest placeholder for the not-yet-wired LLM loop -----------------------
const COPILOT_LLM_PLACEHOLDER = "Copilot LLM wiring is P1-E";

// --- Response shapes (mirror copilot-page.tsx exactly) -----------------------
type ChatRole = "user" | "assistant";

type CopilotMessage = {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls?: {
    tool: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    resultPreview: string;
  }[];
  followUps?: string[];
  provider?: string | null;
  createdAt?: string;
};

type CopilotConversationSummary = {
  id: string;
  title: string;
  walletAddress: string;
  messageCount: number;
  lastMessagePreview: string;
  createdAt: string;
  updatedAt: string;
  latestMessageAt: string;
};

type CopilotConversationDetail = CopilotConversationSummary & {
  summaryMessageCount: number;
  summaryText: string;
  messages: CopilotMessage[];
};

type StoredConversation = CopilotConversationDetail;

type JobStatus = "queued" | "running" | "completed" | "failed";

type StoredJob = {
  id: string;
  ownerAddress: string;
  conversationId: string | null;
  status: JobStatus;
  errorDetail: string | null;
};

// --- Per-isolate in-memory stores (keyed by lowercased owner address) --------
const conversationStore = new Map<string, Map<string, StoredConversation>>();
const jobStore = new Map<string, StoredJob>();

function ownerConversations(owner: string): Map<string, StoredConversation> {
  let bucket = conversationStore.get(owner);
  if (!bucket) {
    bucket = new Map<string, StoredConversation>();
    conversationStore.set(owner, bucket);
  }
  return bucket;
}

function summarize(conversation: StoredConversation): CopilotConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    walletAddress: conversation.walletAddress,
    messageCount: conversation.messageCount,
    lastMessagePreview: conversation.lastMessagePreview,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    latestMessageAt: conversation.latestMessageAt,
  };
}

function titleFromContent(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New conversation";
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

function newConversation(owner: string, walletAddress: string): StoredConversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    walletAddress,
    messageCount: 0,
    lastMessagePreview: "",
    createdAt: now,
    updatedAt: now,
    latestMessageAt: now,
    summaryMessageCount: 0,
    summaryText: "",
    messages: [],
  };
}

// ---------------------------------------------------------------------------
// GET /conversations — list the caller's saved conversation summaries.
// Sorted newest-first (the panel renders them in array order).
// ---------------------------------------------------------------------------
r.get("/conversations", requireAuth, (c) => {
  const owner = getAddress(c);
  const bucket = ownerConversations(owner);
  const summaries = Array.from(bucket.values())
    .sort((a, b) => b.latestMessageAt.localeCompare(a.latestMessageAt))
    .map(summarize);
  return c.json(summaries);
});

// ---------------------------------------------------------------------------
// POST /conversations — create an empty conversation. Body: { walletAddress? }.
// Returns a CopilotConversationSummary (frontend checks `"id" in payload`).
// ---------------------------------------------------------------------------
r.post("/conversations", requireAuth, async (c) => {
  const owner = getAddress(c);
  let body: { walletAddress?: string | null } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const walletAddress = body.walletAddress
    ? normalizeAddress(body.walletAddress)
    : owner;
  const conversation = newConversation(owner, walletAddress);
  ownerConversations(owner).set(conversation.id, conversation);
  return c.json(summarize(conversation), 201);
});

// ---------------------------------------------------------------------------
// GET /conversations/:id — full conversation detail (messages + summary).
// Frontend requires `"messages" in payload`.
// ---------------------------------------------------------------------------
r.get("/conversations/:id", requireAuth, (c) => {
  const owner = getAddress(c);
  const id = c.req.param("id");
  const conversation = ownerConversations(owner).get(id);
  if (!conversation) {
    return c.json({ detail: "Conversation not found" }, 404);
  }
  return c.json(conversation satisfies CopilotConversationDetail);
});

// ---------------------------------------------------------------------------
// DELETE /conversations/:id — remove a conversation from history.
// ---------------------------------------------------------------------------
r.delete("/conversations/:id", requireAuth, (c) => {
  const owner = getAddress(c);
  const id = c.req.param("id");
  const bucket = ownerConversations(owner);
  if (!bucket.has(id)) {
    return c.json({ detail: "Conversation not found" }, 404);
  }
  bucket.delete(id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /chat/jobs — enqueue a chat turn. Body: { conversationId?, content, walletAddress? }.
// We record the user's turn on the conversation (creating one if needed) so the
// thread is real, then return a job id. The job resolves `failed` because the
// LLM loop (P1-E) is not wired — we never fabricate an assistant reply.
// ---------------------------------------------------------------------------
r.post("/chat/jobs", requireAuth, async (c) => {
  const owner = getAddress(c);
  let body: {
    conversationId?: string | null;
    content?: string;
    walletAddress?: string | null;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const content = (body.content ?? "").trim();
  if (!content) {
    return c.json({ detail: "content is required" }, 400);
  }

  const bucket = ownerConversations(owner);
  const walletAddress = body.walletAddress
    ? normalizeAddress(body.walletAddress)
    : owner;

  // Resolve (or create) the target conversation and append the user's turn.
  let conversation =
    (body.conversationId && bucket.get(body.conversationId)) || null;
  if (!conversation) {
    conversation = newConversation(owner, walletAddress);
    bucket.set(conversation.id, conversation);
  }

  const now = new Date().toISOString();
  const userMessage: CopilotMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: now,
  };
  conversation.messages.push(userMessage);
  conversation.messageCount = conversation.messages.length;
  conversation.lastMessagePreview = content;
  conversation.latestMessageAt = now;
  conversation.updatedAt = now;
  conversation.summaryMessageCount = conversation.messageCount;
  if (conversation.title === "New conversation") {
    conversation.title = titleFromContent(content);
  }

  // Honest placeholder: the assistant turn requires the P1-E LLM loop.
  const job: StoredJob = {
    id: crypto.randomUUID(),
    ownerAddress: owner,
    conversationId: conversation.id,
    status: "failed",
    errorDetail: COPILOT_LLM_PLACEHOLDER,
  };
  jobStore.set(job.id, job);

  return c.json(
    {
      id: job.id,
      status: job.status,
      conversationId: job.conversationId,
    },
    202,
  );
});

// ---------------------------------------------------------------------------
// GET /chat/jobs/:id — poll a chat job. Honest failed placeholder until P1-E.
// ---------------------------------------------------------------------------
r.get("/chat/jobs/:id", requireAuth, (c) => {
  const owner = getAddress(c);
  const id = c.req.param("id");
  const job = jobStore.get(id);
  if (!job || job.ownerAddress !== owner) {
    return c.json({ detail: "Job not found" }, 404);
  }
  return c.json({
    id: job.id,
    status: job.status,
    conversationId: job.conversationId,
    result: null,
    errorDetail: job.errorDetail ?? COPILOT_LLM_PLACEHOLDER,
  });
});

export { r as copilotRouter };
