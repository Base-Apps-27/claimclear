import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

const allowedKeys = [
  "default_dispute_instructions",
  "portal_provider_name",
  "portal_contact_email",
  "portal_contact_phone",
  "portal_default_gps_breadcrumbs",
] as const;
type AllowedKey = typeof allowedKeys[number];

function validateSettingsBody(body: unknown): { valid: true; data: Partial<Record<AllowedKey, string | null>> } | { valid: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, error: "Request body must be a JSON object" };
  }
  const data: Partial<Record<AllowedKey, string | null>> = {};
  const obj = body as Record<string, unknown>;
  for (const key of allowedKeys) {
    if (key in obj) {
      const val = obj[key];
      if (val !== null && typeof val !== "string") {
        return { valid: false, error: `"${key}" must be a string or null` };
      }
      data[key] = val as string | null;
    }
  }
  return { valid: true, data };
}

router.get("/app-settings", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string | null> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
}));

router.put("/app-settings", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const parsed = validateSettingsBody(req.body);
  if (!parsed.valid) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const body = parsed.data;

  for (const key of allowedKeys) {
    if (key in body) {
      const value = body[key] ?? null;
      const [existing] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
      if (existing) {
        await db.update(appSettingsTable).set({ value }).where(eq(appSettingsTable.key, key));
      } else {
        await db.insert(appSettingsTable).values({ key, value });
      }
    }
  }

  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string | null> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
}));

export default router;
