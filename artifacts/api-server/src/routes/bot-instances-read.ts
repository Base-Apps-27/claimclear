import { Router, type IRouter } from "express";
import { gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { botInstancesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/", async (_req, res): Promise<void> => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const instances = await db.select().from(botInstancesTable)
    .where(gt(botInstancesTable.lastHeartbeat, fiveMinAgo));

  res.json(instances);
});

export default router;
