import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { getTourSampleIds } from "../lib/tour-sample";

const router: IRouter = Router();

// GET /tour/sample — returns the {groupId, claimId} pair for the global
// tour-sample invoice group + claim seeded by migration 0029. The tour
// controller fetches this at startup so steps 18 (group detail) and
// 20 (claim detail) can navigate to real detail pages with real
// `data-tour="..."` anchors instead of falling back to centered modals
// on the list pages.
//
// Both ids may be `null` in environments where the migration has not
// run yet — the tour controller treats that as "use the modal
// fallback for this step" so the rest of the tour still works.
router.get("/tour/sample", asyncHandler(async (_req, res): Promise<void> => {
  const { groupId, claimId } = await getTourSampleIds();
  res.json({ groupId, claimId });
}));

export default router;
