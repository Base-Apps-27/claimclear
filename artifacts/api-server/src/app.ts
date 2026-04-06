import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
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
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
  : [/^https?:\/\/localhost(:\d+)?$/, /\.replit\.dev$/, /\.repl\.co$/, /\.replit\.app$/];

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (typeof CORS_ORIGINS[0] === "string") {
      return callback(null, (CORS_ORIGINS as string[]).includes(origin));
    }
    const allowed = (CORS_ORIGINS as RegExp[]).some(r => r.test(origin));
    return callback(null, allowed);
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

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
