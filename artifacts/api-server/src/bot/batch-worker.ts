import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const SUBMISSION_ID = parseInt(process.env.BATCH_SUBMISSION_ID || "0", 10);
const API_BASE = process.env.API_BASE_URL || "http://localhost:8080/api";
const PORTAL_URL = process.env.MAS_PORTAL_URL || "https://mastransportation.force.com/support";
const SESSION_DIR = path.resolve("bot-session");
const MAS_USERNAME = process.env.MAS_PORTAL_USERNAME || "";
const MAS_PASSWORD = process.env.MAS_PORTAL_PASSWORD || "";
const BOT_TOKEN = process.env.BOT_SERVICE_TOKEN || "";
const BOT_DRY_RUN = process.env.BOT_DRY_RUN === "true";

if (!SUBMISSION_ID) {
  console.error("[BATCH-WORKER] BATCH_SUBMISSION_ID is required");
  process.exit(1);
}

interface PortalSubmission {
  id: number;
  confNumber: string;
  serviceDate: string;
  refNumber: string;
  clientNumber: string;
  carNumber: string;
  claimAmount: string | null;
  errorTypeName: string;
  errorDetails: string;
  issueType: string;
  subject: string;
  requesterEmail: string;
  transportationProviderName: string;
  phoneNumber: string;
  invoiceNumber: string;
  gpsBreadcrumbsAvailable: string;
  descriptionHtml: string;
  disputeReason: string;
  evidenceNotes: string;
  attachmentUrls: string[];
}

async function api(endpoint: string, opts: RequestInit = {}): Promise<unknown> {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Bot-Token": BOT_TOKEN,
      ...(opts.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${opts.method || "GET"} ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function buildDescription(sub: PortalSubmission): string {
  if (sub.descriptionHtml?.trim()) return sub.descriptionHtml;

  return `Dispute for Confirmation Number: ${sub.confNumber || "N/A"}
Service Date: ${sub.serviceDate || "N/A"}
Reference Number: ${sub.refNumber || "N/A"}
Client Number: ${sub.clientNumber || "N/A"}
Car Number: ${sub.carNumber || "N/A"}
Claim Amount: $${sub.claimAmount || "0.00"}
Error Type: ${sub.errorTypeName || "N/A"}
Error Details: ${sub.errorDetails || "N/A"}

Dispute Reason: ${sub.disputeReason || "N/A"}

Evidence Notes: ${sub.evidenceNotes || "N/A"}`;
}

async function run() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  console.log(`[BATCH-WORKER] Processing submission ${SUBMISSION_ID}`);

  const sub = await api(`/bot/portal-submissions/${SUBMISSION_ID}/claim`, {
    method: "POST",
    body: JSON.stringify({ botInstanceId: null }),
  }) as PortalSubmission;

  if (!sub) {
    console.error("[BATCH-WORKER] Could not claim submission");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let context;
  if (fs.existsSync(path.join(SESSION_DIR, "state.json"))) {
    context = await browser.newContext({
      storageState: path.join(SESSION_DIR, "state.json"),
    });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();

  try {
    await page.goto(PORTAL_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const loginButton = await page.$('a:has-text("Log In"), button:has-text("Log In"), a:has-text("Sign In")');
    if (loginButton) {
      if (!MAS_USERNAME || !MAS_PASSWORD) {
        throw new Error("Portal login required - MAS_PORTAL_USERNAME and MAS_PORTAL_PASSWORD must be configured");
      }

      console.log("[BATCH-WORKER] Login required...");
      await loginButton.click();
      await page.waitForTimeout(2000);

      const usernameInput = await page.$('input[name="username"], input[name="email"], input[type="email"], #username, #email');
      const passwordInput = await page.$('input[name="password"], input[type="password"], #password');

      if (usernameInput && passwordInput) {
        await usernameInput.fill(MAS_USERNAME);
        await passwordInput.fill(MAS_PASSWORD);
        await page.waitForTimeout(500);

        const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Log In"), button:has-text("Sign In")');
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForTimeout(5000);
        }

        const stillOnLogin = await page.$('input[type="password"]');
        if (stillOnLogin) {
          throw new Error("Portal login failed - check credentials");
        }
      } else {
        throw new Error("Portal login form not recognized");
      }
    }

    const newRequestLink = await page.$('a:has-text("Submit"), a:has-text("New Request"), a:has-text("Create")');
    if (newRequestLink) {
      await newRequestLink.click();
      await page.waitForTimeout(2000);
    }

    const issueTypeSelect = await page.$('select[name="issue_type"], #issue_type, [data-field="issue_type"]');
    if (issueTypeSelect && sub.issueType) {
      await issueTypeSelect.selectOption(sub.issueType);
      await page.waitForTimeout(500);
    }

    const subjectInput = await page.$('input[name="subject"], #subject, [data-field="subject"]');
    if (subjectInput && sub.subject) await subjectInput.fill(sub.subject);

    const emailInput = await page.$('input[name="requester_email"], input[name="email"], #email');
    if (emailInput && sub.requesterEmail) await emailInput.fill(sub.requesterEmail);

    const providerInput = await page.$('input[name="transportation_provider"], input[name="provider"]');
    if (providerInput && sub.transportationProviderName) await providerInput.fill(sub.transportationProviderName);

    const phoneInput = await page.$('input[name="phone"], input[type="tel"]');
    if (phoneInput && sub.phoneNumber) await phoneInput.fill(sub.phoneNumber);

    const invoiceInput = await page.$('input[name="invoice"], input[name="invoice_number"]');
    if (invoiceInput && sub.invoiceNumber) await invoiceInput.fill(sub.invoiceNumber);

    const gpsSelect = await page.$('select[name="gps_breadcrumbs"], #gps_breadcrumbs');
    if (gpsSelect && sub.gpsBreadcrumbsAvailable) await gpsSelect.selectOption(sub.gpsBreadcrumbsAvailable);

    const descriptionFrame = await page.$('iframe.wysiwyg, [data-field="description"] iframe');
    if (descriptionFrame) {
      const frame = await descriptionFrame.contentFrame();
      if (frame) {
        const body = await frame.$("body");
        if (body) {
          await body.click();
          await frame.evaluate((html: string) => {
            document.body.innerHTML = html;
          }, sub.descriptionHtml || buildDescription(sub));
        }
      }
    } else {
      const descTextarea = await page.$('textarea[name="description"], #description, [data-field="description"]');
      if (descTextarea) await descTextarea.fill(sub.descriptionHtml || buildDescription(sub));
    }

    console.log("[BATCH-WORKER] Form fields populated");

    if (BOT_DRY_RUN) {
      const screenshotPath = path.join(SESSION_DIR, `dry-run-${SUBMISSION_ID}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await api(`/bot/portal-submissions/${SUBMISSION_ID}/complete-dry-run`, {
        method: "POST",
        body: JSON.stringify({ botInstanceId: null, screenshotPath }),
      });
      console.log("[BATCH-WORKER] Dry run completed");
    } else {
      const submitButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
      if (submitButton) {
        await submitButton.click();
        await page.waitForTimeout(5000);

        const confirmationText = await page.textContent("body");
        const ticketMatch = confirmationText?.match(/(?:ticket|request|case|confirmation)\s*(?:#|number|id)?\s*[:.]?\s*(\w+)/i);
        const ticketId = ticketMatch ? ticketMatch[1] : `portal-${Date.now()}`;

        await api(`/bot/portal-submissions/${SUBMISSION_ID}/complete`, {
          method: "POST",
          body: JSON.stringify({ portalTicketId: ticketId, botInstanceId: null }),
        });
        console.log(`[BATCH-WORKER] Submission completed with ticket ${ticketId}`);
      } else {
        throw new Error("Submit button not found on portal page");
      }
    }

    await context.storageState({ path: path.join(SESSION_DIR, "state.json") });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[BATCH-WORKER] Failed: ${errMsg}`);

    try {
      const screenshotPath = path.join(SESSION_DIR, `error-${SUBMISSION_ID}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {}

    await api(`/bot/portal-submissions/${SUBMISSION_ID}/fail`, {
      method: "POST",
      body: JSON.stringify({ errorMessage: errMsg, botInstanceId: null }),
    }).catch(() => {});

    await page.close();
    await browser.close();
    process.exit(1);
  }

  await page.close();
  await browser.close();
  console.log("[BATCH-WORKER] Done");
  process.exit(0);
}

run().catch(err => {
  console.error("[BATCH-WORKER] Fatal:", err);
  process.exit(1);
});
