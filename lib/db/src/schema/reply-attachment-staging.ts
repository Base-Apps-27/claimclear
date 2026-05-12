import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Task #713 — staged uploads for outbound reply attachments.
 *
 * The composer stages each picked file via `PUT /reply-attachments/stage`,
 * which streams the bytes to object storage and returns an opaque
 * `stagedId`. The reply request then references that id, never the raw
 * storage key. This keeps the trust boundary on the server (no client
 * supplies object paths or content types we honor blindly) and lets the
 * 24-hour janitor purge unreferenced staging rows + their objects.
 */
export const replyAttachmentStagingTable = pgTable(
  "reply_attachment_staging",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email"),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    index("reply_attachment_staging_created_at_idx").on(table.createdAt),
    index("reply_attachment_staging_user_email_idx").on(table.userEmail),
  ],
);

export type ReplyAttachmentStaging = typeof replyAttachmentStagingTable.$inferSelect;
