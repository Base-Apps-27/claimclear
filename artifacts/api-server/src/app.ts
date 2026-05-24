import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { authMiddleware } from "./middlewares/authMiddleware";
import { verifyBotToken } from "./lib/bot-token";
import { SESSION_COOKIE } from "./lib/auth";
import router from "./routes";
import { serveObjectEntity } from "./routes/storage";
import { requireAuth } from "./middlewares/requireAuth";
import { portalOnlyGuard } from "./middlewares/portalOnlyGuard";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const CORS_ORIGINS: string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
  : [];

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (CORS_ORIGINS.length > 0 && CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    if (CORS_ORIGINS.length === 0 && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
}));

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfOriginCheck(req: Request, res: Response, next: NextFunction) {
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  if (verifyBotToken(req.headers["x-bot-token"])) {
    next();
    return;
  }

  if (!req.cookies?.[SESSION_COOKIE]) {
    next();
    return;
  }

  const requestOrigin = req.headers["origin"] as string | undefined;
  const referer = req.headers["referer"] as string | undefined;

  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers["host"] || "";
  const serverOrigin = `${proto}://${host}`;

  function isAllowedOrigin(candidate: string): boolean {
    if (candidate === serverOrigin) return true;
    if (CORS_ORIGINS.length > 0) {
      return CORS_ORIGINS.includes(candidate);
    }
    return /^https?:\/\/localhost(:\d+)?$/.test(candidate);
  }

  if (requestOrigin) {
    if (!isAllowedOrigin(requestOrigin)) {
      res.status(403).json({ error: "Cross-origin request blocked" });
      return;
    }
    next();
    return;
  }

  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (!isAllowedOrigin(refererOrigin)) {
        res.status(403).json({ error: "Cross-origin request blocked" });
        return;
      }
      next();
      return;
    } catch {
      res.status(403).json({ error: "Cross-origin request blocked" });
      return;
    }
  }

  res.status(403).json({ error: "Cross-origin request blocked" });
}

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(csrfOriginCheck);
app.use(authMiddleware);

// Top-level alias so links built from the canonical evidence path
// (claim_evidence.imageUrl = `/objects/...`) reach the storage handler
// instead of falling through to the SPA fallback. Task #656.
app.get("/objects/*path", requireAuth, serveObjectEntity);

app.use("/api", portalOnlyGuard, router);

const clientDistPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "claimclear",
  "dist",
  "public",
);

const trainingGuideDistPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "training-guide",
  "dist",
  "public",
);

app.use("/training-guide", express.static(trainingGuideDistPath));
app.get("/training-guide/{*splat}", (_req, res) => {
  res.sendFile(path.join(trainingGuideDistPath, "index.html"));
});

app.use(express.static(clientDistPath));

app.get("/{*splat}", (_req, res, next) => {
  if (_req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.use(
  (
    err: Error,
    _req: import("express").Request,
    res: import("express").Response,
    _next: import("express").NextFunction,
  ) => {
    logger.error(err, "Unhandled route error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default app;
