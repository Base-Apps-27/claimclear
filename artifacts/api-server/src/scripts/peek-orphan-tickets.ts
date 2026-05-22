import { portalBrowserGate } from "../lib/portal-browser-gate.js";
import { readPortalTicket } from "../bot/portal-reader.js";

const TARGETS = ["92002", "91984", "91986", "92003", "91979", "91769"];

async function main() {
  const outcome = await portalBrowserGate.run("script:peek-orphan-tickets", async () => {
    for (const id of TARGETS) {
      try {
        const r = await readPortalTicket(id);
        console.log("\n=== ticket " + id + " ===");
        console.log("subject:", r.subject);
        console.log("status:", r.status);
        console.log("messages:", r.messages.length);
        for (let i = 0; i < r.messages.length; i++) {
          const m = r.messages[i];
          const body = (m.bodyText || "").replace(/\s+/g, " ").trim();
          console.log(
            `  [${i}] ${m.author || "?"} @ ${m.timestamp || "?"}: ${body.slice(0, 400)}${body.length > 400 ? "…" : ""}`,
          );
        }
      } catch (e) {
        console.log("ticket " + id + " FAILED:", (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  });
  if (outcome.kind === "skipped") {
    console.error("gate busy:", outcome.reason);
    process.exit(3);
  }
  await outcome.result;
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
