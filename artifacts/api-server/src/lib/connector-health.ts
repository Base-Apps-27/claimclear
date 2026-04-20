import { db } from "@workspace/db";
import { connectorHealthTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export async function recordConnectorHealth(
  connectorName: string,
  status: HealthStatus,
  lastError?: string | null,
  metadata?: Record<string, unknown>,
): Promise<{ transitioned: boolean; previous: HealthStatus | null }> {
  let previous: HealthStatus | null = null;
  try {
    const [existing] = await db
      .select()
      .from(connectorHealthTable)
      .where(eq(connectorHealthTable.connectorName, connectorName));
    previous = (existing?.status as HealthStatus) ?? null;

    const values = {
      connectorName,
      status,
      lastCheckedAt: new Date(),
      lastError: lastError ?? null,
      metadata: metadata ?? null,
    };

    if (existing) {
      await db
        .update(connectorHealthTable)
        .set(values)
        .where(eq(connectorHealthTable.connectorName, connectorName));
    } else {
      await db.insert(connectorHealthTable).values(values);
    }

    const transitioned =
      previous != null && previous !== status &&
      ((previous === "healthy" && status !== "healthy") ||
        (previous !== "healthy" && status === "healthy"));

    if (previous === "healthy" && status !== "healthy") {
      try {
        await db.insert(auditLogsTable).values({
          action: "connector_unhealthy",
          details: `${connectorName} connector became ${status}${lastError ? `: ${lastError.slice(0, 200)}` : ""}`,
          metadata: { connectorName, status, lastError, previous },
          userEmail: "system",
          userName: "System Health",
        });
      } catch (e) {
        logger.warn({ err: e }, "Failed to write connector_unhealthy audit log");
      }
    }

    return { transitioned, previous };
  } catch (err) {
    logger.error({ err, connectorName }, "recordConnectorHealth failed");
    return { transitioned: false, previous };
  }
}

export async function getConnectorHealth(connectorName: string) {
  const [row] = await db
    .select()
    .from(connectorHealthTable)
    .where(eq(connectorHealthTable.connectorName, connectorName));
  return row ?? null;
}
