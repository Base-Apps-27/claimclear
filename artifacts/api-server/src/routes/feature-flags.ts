import { Router, type IRouter } from "express";
import { PER_INVOICE_TRANSITION_ENABLED } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

// Thin endpoint that mirrors `lib/db/src/feature-flags.ts` to the UI.
// The frontend gates the per-leg verdict picker and MAS Action surface on
// the same env var the server reads, so a single source of truth keeps the
// rollout consistent across surfaces.
const router: IRouter = Router();

router.get("/feature-flags", asyncHandler(async (_req, res): Promise<void> => {
  res.json({ perInvoiceTransitionEnabled: PER_INVOICE_TRANSITION_ENABLED });
}));

export default router;
