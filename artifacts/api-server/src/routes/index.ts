import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireBotToken, requireAuthOrBot } from "../middlewares/requireBotToken";
import healthRouter from "./health";
import authRouter from "./auth";
import claimsRouter from "./claims";
import notesRouter from "./notes";
import auditLogsRouter from "./audit-logs";
import errorTypesRouter from "./error-types";
import importRouter from "./import";
import errorDetailMappingsRouter from "./error-detail-mappings";
import portalSubmissionsRouter from "./portal-submissions";
import botPortalRouter from "./bot-portal";
import botInstancesRouter from "./bot-instances";
import botInstancesReadRouter from "./bot-instances-read";
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
import responseTrackerRouter from "./response-tracker";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

router.use("/bot/portal-submissions", requireBotToken, botPortalRouter);
router.use("/bot/instances", requireBotToken, botInstancesRouter);

router.use("/daily-brief", requireAuthOrBot, dailyBriefRouter);

router.use(requireAuth);

router.use(storageRouter);
router.use("/bot-instances", botInstancesReadRouter);
router.use(claimEventsRouter);
router.use(claimEvidenceRouter);
router.use(claimsRouter);
router.use(notesRouter);
router.use(auditLogsRouter);
router.use(errorTypesRouter);
router.use(importRouter);
router.use(errorDetailMappingsRouter);
router.use(portalSubmissionsRouter);
router.use(presenceRouter);
router.use(dashboardRouter);
router.use(aiEmailRouter);
router.use(sopAnalyzerRouter);
router.use(appSettingsRouter);
router.use(batchJobsRouter);
router.use(responseTrackerRouter);
router.use("/anthropic/conversations", anthropicRouter);

export default router;
