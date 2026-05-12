import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAuthOrBot } from "../middlewares/requireBotToken";
import healthRouter from "./health";
import authRouter from "./auth";
import claimsRouter from "./claims";
import notesRouter from "./notes";
import auditLogsRouter from "./audit-logs";
import errorTypesRouter from "./error-types";
import importRouter from "./import";
import errorDetailMappingsRouter from "./error-detail-mappings";
import portalSubmissionsRouter from "./portal-submissions";
import presenceRouter from "./presence";
import claimEventsRouter from "./claim-events";
import dashboardRouter from "./dashboard";
import dailyBriefRouter from "./daily-brief";
import aiEmailRouter from "./ai-email";
import sopAnalyzerRouter from "./sop-analyzer";
import anthropicRouter from "./anthropic";
import storageRouter from "./storage";
import evidenceTypesRouter from "./evidence-types";
import claimEvidenceRouter from "./claim-evidence";
import appSettingsRouter from "./app-settings";
import batchJobsRouter from "./batch-jobs";
import responseTrackerRouter, { checkEmailRouter, recordPortalRouter } from "./response-tracker";
import invoiceGroupsRouter from "./invoice-groups";
import withdrawalsRouter from "./withdrawals";
import adminRouter from "./admin";
import systemHealthRouter from "./system-health";
import aiCalibrationRouter from "./ai-calibration";
import searchRouter from "./search";
import tourRouter from "./tour";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

// requireAuthOrBot is still used by daily-brief / check-email so scheduled
// cron-driven HTTP calls (which go through localhost with a bot token) work.
router.use("/daily-brief", requireAuthOrBot, dailyBriefRouter);
router.use(requireAuthOrBot, checkEmailRouter);
// Portal-side response ingestion (Task #725). Bot-token authed so the
// portal_response_sync cron and the one-shot backfill CLI can POST
// scraped tickets through the same code path operators see.
router.use(requireAuthOrBot, recordPortalRouter);

router.use(requireAuth);

router.use(storageRouter);
router.use(claimEventsRouter);
router.use(claimEvidenceRouter);
router.use(claimsRouter);
router.use(notesRouter);
router.use(auditLogsRouter);
router.use(errorTypesRouter);
router.use(importRouter);
router.use(errorDetailMappingsRouter);
// Mount batch-jobs BEFORE portal-submissions so the more-specific
// /portal-submissions/batch-* routes win over /portal-submissions/:id.
router.use(batchJobsRouter);
router.use(portalSubmissionsRouter);
router.use(presenceRouter);
router.use(dashboardRouter);
router.use(aiEmailRouter);
router.use(sopAnalyzerRouter);
router.use(appSettingsRouter);
router.use(responseTrackerRouter);
router.use(invoiceGroupsRouter);
router.use(withdrawalsRouter);
router.use(adminRouter);
router.use(systemHealthRouter);
router.use(aiCalibrationRouter);
router.use(searchRouter);
router.use(tourRouter);
router.use("/anthropic/conversations", anthropicRouter);

export default router;
