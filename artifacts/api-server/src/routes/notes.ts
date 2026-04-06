import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { notesTable, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/claims/:id/notes", asyncHandler(async (req, res): Promise<void> => {
  const claimId = parseId(req.params.id);
  if (isNaN(claimId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const notes = await db.select().from(notesTable)
    .where(eq(notesTable.claimId, claimId))
    .orderBy(desc(notesTable.createdAt));

  res.json(notes);
}));

router.post("/claims/:id/notes", asyncHandler(async (req, res): Promise<void> => {
  const claimId = parseId(req.params.id);
  if (isNaN(claimId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { content, type } = req.body;
  if (content == null) { res.status(400).json({ error: "content is required" }); return; }

  const author = req.user?.displayName || req.user?.email || "Unknown";

  const [note] = await db.insert(notesTable).values({
    claimId,
    content,
    type: type || "manual",
    author,
  }).returning();

  await db.insert(auditLogsTable).values({
    claimId,
    action: "note_added",
    details: `Note added by ${author}`,
    userEmail: req.user?.email || null,
    userName: author,
  });

  res.status(201).json(note);
}));

router.delete("/notes/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [note] = await db.select().from(notesTable).where(eq(notesTable.id, id));
  if (!note) { res.status(404).json({ error: "Note not found" }); return; }

  const userEmail = req.user?.email || "";
  const isOwner = note.author === req.user?.displayName || note.author === userEmail;
  const isAdmin = req.user?.role === "admin";
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: "You can only delete your own notes" });
    return;
  }

  await db.delete(notesTable).where(eq(notesTable.id, id));

  const author = req.user?.displayName || userEmail || "Unknown";
  await db.insert(auditLogsTable).values({
    claimId: note.claimId,
    action: "note_deleted",
    details: `Note deleted by ${author}`,
    userEmail: req.user?.email || null,
    userName: author,
  });

  res.sendStatus(204);
}));

export default router;
