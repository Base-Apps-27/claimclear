import { Router, type IRouter } from "express";
import { eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { botInstancesTable } from "@workspace/db";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/", async (_req, res): Promise<void> => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const instances = await db.select().from(botInstancesTable)
    .where(gt(botInstancesTable.lastHeartbeat, fiveMinAgo));

  res.json(instances);
});

router.post("/", async (req, res): Promise<void> => {
  const { name } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [instance] = await db.insert(botInstancesTable).values({
    name,
    status: "running",
  }).returning();

  res.status(201).json(instance);
});

router.post("/:id/heartbeat", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [instance] = await db.update(botInstancesTable).set({
    lastHeartbeat: new Date(),
  }).where(eq(botInstancesTable.id, id)).returning();

  if (!instance) { res.status(404).json({ error: "Bot instance not found" }); return; }
  res.json(instance);
});

router.post("/:id/stop", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [instance] = await db.update(botInstancesTable).set({
    status: "stopped",
  }).where(eq(botInstancesTable.id, id)).returning();

  if (!instance) { res.status(404).json({ error: "Bot instance not found" }); return; }
  res.json(instance);
});

export default router;
