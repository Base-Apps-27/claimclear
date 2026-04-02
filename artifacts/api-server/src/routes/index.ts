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
import portalSubmissionsRouter from "./portal-submissions";
import botPortalRouter from "./bot-portal";
import botInstancesRouter from "./bot-instances";
import botInstancesReadRouter from "./bot-instances-read";
import presenceRouter from "./presence";
import dashboardRouter from "./dashboard";
import dailyBriefRouter from "./daily-brief";
import aiEmailRouter from "./ai-email";
import sopAnalyzerRouter from "./sop-analyzer";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

router.use("/bot/portal-submissions", requireBotToken, botPortalRouter);
router.use("/bot/instances", requireBotToken, botInstancesRouter);

router.use("/daily-brief", requireAuthOrBot, dailyBriefRouter);

router.use(requireAuth);

router.use("/bot-instances", botInstancesReadRouter);
router.use(claimsRouter);
router.use(notesRouter);
router.use(auditLogsRouter);
router.use(errorTypesRouter);
router.use(importRouter);
router.use(portalSubmissionsRouter);
router.use(presenceRouter);
router.use(dashboardRouter);
router.use(aiEmailRouter);
router.use(sopAnalyzerRouter);

export default router;
