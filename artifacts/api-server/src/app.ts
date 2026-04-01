import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const VITE_PORT = process.env.VITE_PORT || "25823";

if (process.env.NODE_ENV === "production") {
  const staticDir = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "claimclear",
    "dist",
    "public",
  );
  app.use(
    "/claimclear",
    express.static(staticDir),
    (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    },
  );
} else {
  app.use(
    "/claimclear",
    createProxyMiddleware({
      target: `http://localhost:${VITE_PORT}`,
      changeOrigin: true,
      ws: true,
      pathRewrite: (_path, req) => (req as unknown as { originalUrl: string }).originalUrl || _path,
      logger: {
        info: (msg: string) => logger.info(msg),
        warn: (msg: string) => logger.warn(msg),
        error: (msg: string) => logger.error(msg),
      },
    }),
  );
}

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
  : (process.env.NODE_ENV === "production" ? [] : [/^https?:\/\/localhost(:\d+)?$/, /\.replit\.dev$/, /\.repl\.co$/]);

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

export default app;
