import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { getAiCalibration } from "../lib/ai-calibration";

// Thin HTTP wrapper around `getAiCalibration()` so the verdict picker can
// render the "AI agreed with operator on N of last M verdicts" line per
// error type. Cached client-side for the page lifetime via React Query.
const router: IRouter = Router();

router.get("/ai-calibration", asyncHandler(async (req, res): Promise<void> => {
  const errorTypeId = typeof req.query.errorTypeId === "string"
    ? req.query.errorTypeId.trim()
    : "";
  if (!errorTypeId) {
    res.status(400).json({ error: "errorTypeId query parameter is required" });
    return;
  }

  let windowDays: number | undefined;
  if (req.query.windowDays !== undefined) {
    const raw = Number(req.query.windowDays);
    if (!Number.isFinite(raw) || raw < 1 || raw > 365) {
      res.status(400).json({ error: "windowDays must be an integer between 1 and 365" });
      return;
    }
    windowDays = Math.floor(raw);
  }

  const stats = await getAiCalibration({ errorTypeId, windowDays });
  res.json(stats);
}));

export default router;
