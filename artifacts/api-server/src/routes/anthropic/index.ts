import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../../lib/asyncHandler";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.createdAt));
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res): Promise<void> => {
  const { title } = req.body;
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const [conversation] = await db
    .insert(conversations)
    .values({ title })
    .returning();
  res.status(201).json(conversation);
}));

router.get("/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  res.json({ ...conversation, messages: msgs });
}));

router.delete("/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await db
    .delete(conversations)
    .where(eq(conversations.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.sendStatus(204);
}));

router.get("/:id/messages", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  res.json(msgs);
}));

router.post("/:id/messages", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const [userMessage] = await db
    .insert(messages)
    .values({ conversationId: id, role: "user", content })
    .returning();

  const existingMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  const chatMessages = existingMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullResponse += event.delta.text;
        res.write(
          `data: ${JSON.stringify({ content: event.delta.text })}\n\n`,
        );
      }
    }

    await db
      .insert(messages)
      .values({ conversationId: id, role: "assistant", content: fullResponse });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "AI request failed";
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}));

export default router;
