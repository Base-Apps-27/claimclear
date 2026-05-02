import { Router, type IRouter } from "express";
import { addClaimClient, addGlobalClient, addGroupClient, addGlobalGroupClient, addGlobalSystemClient } from "../lib/sse";

const router: IRouter = Router();

router.get("/claims/:id/events", (req, res) => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const claimId = parseInt(raw, 10);
  if (isNaN(claimId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const userEmail = req.user?.email ?? null;
  const cleanup = addClaimClient(claimId, res, userEmail);

  req.on("close", cleanup);
});

router.get("/claims/events", (req, res) => {
  const userEmail = req.user?.email ?? null;
  const cleanup = addGlobalClient(res, userEmail);

  req.on("close", cleanup);
});

router.get("/invoice-groups/:id/events", (req, res) => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const groupId = parseInt(raw, 10);
  if (isNaN(groupId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userEmail = req.user?.email ?? null;
  const cleanup = addGroupClient(groupId, res, userEmail);
  req.on("close", cleanup);
});

router.get("/invoice-groups/events", (req, res) => {
  const userEmail = req.user?.email ?? null;
  const cleanup = addGlobalGroupClient(res, userEmail);
  req.on("close", cleanup);
});

// App-wide system announcements (Task #313). One open EventSource per
// authenticated tab; carries the day-complete celebration trigger today
// and is the natural channel for any future cross-resource broadcast.
router.get("/system-events", (req, res) => {
  const userEmail = req.user?.email ?? null;
  const cleanup = addGlobalSystemClient(res, userEmail);
  req.on("close", cleanup);
});

export default router;
