import { Router, type IRouter } from "express";
import { addClaimClient, addGlobalClient } from "../lib/sse";

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

export default router;
