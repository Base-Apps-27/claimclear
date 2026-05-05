import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { getTourSampleIds } from "../lib/tour-sample";

const router: IRouter = Router();

// GET /tour/sample — returns the {groupId, claimId, responseId} trio
// for the global tour-sample invoice group + claim + portal_response
// seeded by migrations 0029 and 0030. The tour controller fetches this
// at startup so step 14 (responses 3-card walk) and steps 18 (group
// detail) and 20 (claim detail) can navigate to real pages with real
// `data-tour="..."` anchors instead of falling back to centered modals
// on the list pages.
//
// Any id may be `null` in environments where the migrations have not
// run yet — the tour controller treats that as "use the modal
// fallback for this step" so the rest of the tour still works.
router.get("/tour/sample", asyncHandler(async (_req, res): Promise<void> => {
  const { groupId, claimId, responseId } = await getTourSampleIds();
  res.json({ groupId, claimId, responseId });
}));

export default router;
