import { chromium, type Browser, type BrowserContext } from "playwright";
import path from "path";
import fs from "fs";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8080/api";
const PORTAL_URL = process.env.MAS_PORTAL_URL || "https://mastransportation.force.com/support";
const SESSION_DIR = path.resolve("bot-session");
const MAS_USERNAME = process.env.MAS_PORTAL_USERNAME || "";
const MAS_PASSWORD = process.env.MAS_PORTAL_PASSWORD || "";
const BOT_NAME = process.env.BOT_NAME || `bot-${process.pid}`;
const BOT_TOKEN: string = process.env.BOT_SERVICE_TOKEN || "";
if (!BOT_TOKEN) {
  console.error("[BOT] FATAL: BOT_SERVICE_TOKEN environment variable is required");
  process.exit(1);
}
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "30000", 10);
const EMPTY_QUEUE_BACKOFF = parseInt(process.env.EMPTY_QUEUE_BACKOFF || "300000", 10);
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 5000;

let botInstanceId: number | null = null;
let browser: Browser | null = null;
let running = true;

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

async function apiWithRetry(endpoint: string, opts: RequestInit = {}, retries = MAX_RETRIES): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await api(endpoint, opts);
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = RETRY_BACKOFF_MS * attempt;
      console.warn(`[BOT] API call failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}

async function registerBot(): Promise<number> {
  const result = await apiWithRetry("/bot/instances", {
    method: "POST",
    body: JSON.stringify({ name: BOT_NAME }),
  }) as { id: number };
  console.log(`[BOT] Registered as instance ${result.id} (${BOT_NAME})`);
  return result.id;
}

async function heartbeat() {
  if (!botInstanceId) return;
  try {
    await api(`/bot/instances/${botInstanceId}/heartbeat`, { method: "POST" });
  } catch (err) {
    console.warn(`[BOT] Heartbeat failed:`, err);
  }
}

async function pollForWork(): Promise<PortalSubmission[]> {
  return apiWithRetry("/bot/portal-submissions/poll", {
    method: "POST",
    body: JSON.stringify({ botInstanceId }),
  }) as Promise<PortalSubmission[]>;
}

async function claimSubmission(id: number): Promise<PortalSubmission> {
  return api(`/bot/portal-submissions/${id}/claim`, {
    method: "POST",
    body: JSON.stringify({ botInstanceId }),
  }) as Promise<PortalSubmission>;
}

async function completeSubmission(id: number, portalTicketId: string, screenshotPath?: string | null, pageHtmlPath?: string | null) {
  return api(`/bot/portal-submissions/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ portalTicketId, botInstanceId, screenshotPath, pageHtmlPath }),
  });
}

async function failSubmission(id: number, errorMessage: string, screenshotPath?: string | null, pageHtmlPath?: string | null) {
  return api(`/bot/portal-submissions/${id}/fail`, {
    method: "POST",
    body: JSON.stringify({ errorMessage, botInstanceId, screenshotPath, pageHtmlPath }),
  });
}

async function saveScreenshot(page: { screenshot: (opts: { path: string; fullPage: boolean }) => Promise<Buffer> }, subId: number): Promise<string | null> {
  try {
    const screenshotPath = path.join(SESSION_DIR, `error-${subId}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[BOT] Error screenshot saved to ${screenshotPath}`);
    return screenshotPath;
  } catch (screenshotErr) {
    console.warn(`[BOT] Failed to save error screenshot:`, screenshotErr);
    return null;
  }
}

async function savePageHtml(page: { content: () => Promise<string> }, subId: number): Promise<string | null> {
  try {
    const htmlPath = path.join(SESSION_DIR, `error-${subId}-${Date.now()}.html`);
    const html = await page.content();
    fs.writeFileSync(htmlPath, html);
    console.log(`[BOT] Error page HTML saved to ${htmlPath}`);
    return htmlPath;
  } catch (htmlErr) {
    console.warn(`[BOT] Failed to save error page HTML:`, htmlErr);
    return null;
  }
}

const ALLOWED_ATTACHMENT_DOMAINS = (process.env.ALLOWED_ATTACHMENT_DOMAINS || "").split(",").map(d => d.trim()).filter(Boolean);

function isAllowedAttachmentUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") return false;
    if (hostname.startsWith("10.") || hostname.startsWith("172.") || hostname.startsWith("192.168.")) return false;
    if (hostname.endsWith(".internal") || hostname.endsWith(".local")) return false;
    if (hostname === "169.254.169.254" || hostname.startsWith("169.254.")) return false;
    if (ALLOWED_ATTACHMENT_DOMAINS.length > 0) {
      return ALLOWED_ATTACHMENT_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    }
    return true;
  } catch {
    return false;
  }
}

async function downloadAttachments(urls: string[]): Promise<string[]> {
  const downloadDir = path.join(SESSION_DIR, "attachments");
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const localPaths: string[] = [];
  for (const url of urls) {
    if (!isAllowedAttachmentUrl(url)) {
      console.warn(`[BOT] Rejected attachment URL (not allowed): ${url}`);
      continue;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[BOT] Failed to download attachment: ${url} (${response.status})`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const filename = `attachment-${Date.now()}-${path.basename(new URL(url).pathname) || "file"}`;
      const filePath = path.join(downloadDir, filename);
      fs.writeFileSync(filePath, buffer);
      localPaths.push(filePath);
      console.log(`[BOT] Downloaded attachment: ${filePath}`);
    } catch (err) {
      console.warn(`[BOT] Failed to download attachment ${url}:`, err);
    }
  }
  return localPaths;
}

async function launchBrowser(): Promise<BrowserContext> {
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  if (fs.existsSync(path.join(SESSION_DIR, "state.json"))) {
    console.log("[BOT] Loading saved session state...");
    return browser.newContext({
      storageState: path.join(SESSION_DIR, "state.json"),
    });
  }

  return browser.newContext();
}

async function processSubmission(context: BrowserContext, submission: PortalSubmission): Promise<void> {
  const page = await context.newPage();
  const subId = submission.id;

  try {
    console.log(`[BOT] Processing submission ${subId} (conf: ${submission.confNumber})`);

    await page.goto(PORTAL_URL, { waitUntil: "networkidle", timeout: 30000 });
    console.log(`[BOT] Navigated to portal`);

    await page.waitForTimeout(2000);

    const loginButton = await page.$('a:has-text("Log In"), button:has-text("Log In"), a:has-text("Sign In")');
    if (loginButton) {
      if (!MAS_USERNAME || !MAS_PASSWORD) {
        console.log("[BOT] Login required but MAS_PORTAL_USERNAME/MAS_PORTAL_PASSWORD not set.");
        await saveScreenshot(page, subId);
        await failSubmission(subId, "Portal login required - MAS_PORTAL_USERNAME and MAS_PORTAL_PASSWORD must be configured");
        await page.close();
        return;
      }

      console.log("[BOT] Login required - attempting automatic login...");
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
          console.log("[BOT] Login appears to have failed - credentials may be incorrect.");
          await saveScreenshot(page, subId);
          await failSubmission(subId, "Portal login failed - check MAS_PORTAL_USERNAME and MAS_PORTAL_PASSWORD");
          await page.close();
          return;
        }

        console.log("[BOT] Login successful, continuing with submission...");
      } else {
        console.log("[BOT] Could not locate login form fields.");
        await saveScreenshot(page, subId);
        await failSubmission(subId, "Portal login form not recognized - manual login may be required");
        await page.close();
        return;
      }
    }

    const newRequestLink = await page.$('a:has-text("Submit"), a:has-text("New Request"), a:has-text("Create")');
    if (newRequestLink) {
      await newRequestLink.click();
      await page.waitForTimeout(2000);
    }

    const issueTypeSelect = await page.$('select[name="issue_type"], #issue_type, [data-field="issue_type"]');
    if (issueTypeSelect && submission.issueType) {
      await issueTypeSelect.selectOption(submission.issueType);
      await page.waitForTimeout(500);
    }

    const subjectInput = await page.$('input[name="subject"], #subject, [data-field="subject"]');
    if (subjectInput && submission.subject) {
      await subjectInput.fill(submission.subject);
    }

    const emailInput = await page.$('input[name="requester_email"], input[name="email"], #email');
    if (emailInput && submission.requesterEmail) {
      await emailInput.fill(submission.requesterEmail);
    }

    const providerInput = await page.$('input[name="transportation_provider"], input[name="provider"]');
    if (providerInput && submission.transportationProviderName) {
      await providerInput.fill(submission.transportationProviderName);
    }

    const phoneInput = await page.$('input[name="phone"], input[type="tel"]');
    if (phoneInput && submission.phoneNumber) {
      await phoneInput.fill(submission.phoneNumber);
    }

    const invoiceInput = await page.$('input[name="invoice"], input[name="invoice_number"]');
    if (invoiceInput && submission.invoiceNumber) {
      await invoiceInput.fill(submission.invoiceNumber);
    }

    const gpsSelect = await page.$('select[name="gps_breadcrumbs"], #gps_breadcrumbs');
    if (gpsSelect && submission.gpsBreadcrumbsAvailable) {
      await gpsSelect.selectOption(submission.gpsBreadcrumbsAvailable);
    }

    const descriptionFrame = await page.$('iframe.wysiwyg, [data-field="description"] iframe');
    if (descriptionFrame) {
      const frame = await descriptionFrame.contentFrame();
      if (frame) {
        const body = await frame.$("body");
        if (body) {
          await body.click();
          await frame.evaluate((html: string) => {
            document.body.innerHTML = html;
          }, submission.descriptionHtml || buildDescription(submission));
        }
      }
    } else {
      const descTextarea = await page.$('textarea[name="description"], #description, [data-field="description"]');
      if (descTextarea) {
        await descTextarea.fill(submission.descriptionHtml || buildDescription(submission));
      }
    }

    if (submission.attachmentUrls && submission.attachmentUrls.length > 0) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        const localFiles = await downloadAttachments(submission.attachmentUrls);
        if (localFiles.length > 0) {
          await fileInput.setInputFiles(localFiles);
          console.log(`[BOT] Uploaded ${localFiles.length} attachment(s)`);
          await page.waitForTimeout(2000);
        }
      } else {
        console.log(`[BOT] No file input found on page; ${submission.attachmentUrls.length} attachments skipped`);
      }
    }

    console.log(`[BOT] Form fields populated`);

    const submitButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
    if (submitButton) {
      await submitButton.click();
      await page.waitForTimeout(5000);

      const confirmationText = await page.textContent("body");
      const ticketMatch = confirmationText?.match(/(?:ticket|request|case|confirmation)\s*(?:#|number|id)?\s*[:.]?\s*(\w+)/i);
      const ticketId = ticketMatch ? ticketMatch[1] : `portal-${Date.now()}`;

      console.log(`[BOT] Submission ${subId} completed with ticket ${ticketId}`);
      await completeSubmission(subId, ticketId);
    } else {
      throw new Error("Submit button not found on portal page");
    }

    await context.storageState({ path: path.join(SESSION_DIR, "state.json") });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[BOT] Submission ${subId} failed:`, errorMsg);

    const ssPath = await saveScreenshot(page, subId);
    const htmlPath = await savePageHtml(page, subId);
    await failSubmission(subId, errorMsg, ssPath, htmlPath);
  } finally {
    await page.close();
  }
}

function buildDescription(sub: PortalSubmission): string {
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

async function mainLoop() {
  console.log("[BOT] Starting portal submission bot...");
  console.log(`[BOT] Portal URL: ${PORTAL_URL}`);

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  botInstanceId = await registerBot();
  const context = await launchBrowser();

  const heartbeatInterval = setInterval(heartbeat, 15000);

  while (running) {
    try {
      const submissions = await pollForWork();

      if (submissions.length > 0) {
        console.log(`[BOT] Found ${submissions.length} pending submission(s)`);

        for (const sub of submissions) {
          if (!running) break;

          try {
            const claimed = await claimSubmission(sub.id);
            if (claimed) {
              try {
                await processSubmission(context, claimed);
              } catch (firstErr: unknown) {
                const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
                console.warn(`[BOT] Submission ${sub.id} failed on first attempt: ${firstMsg}. Retrying in 10s...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                try {
                  await processSubmission(context, claimed);
                } catch (retryErr: unknown) {
                  const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                  console.error(`[BOT] Submission ${sub.id} failed on retry: ${retryMsg}`);
                }
              }
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`[BOT] Could not claim submission ${sub.id}:`, errMsg);
          }
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      } else {
        console.log(`[BOT] Queue empty, backing off for ${EMPTY_QUEUE_BACKOFF / 1000}s`);
        await new Promise(resolve => setTimeout(resolve, EMPTY_QUEUE_BACKOFF));
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[BOT] Poll error:", errMsg);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  clearInterval(heartbeatInterval);
  if (browser) await browser.close();

  if (botInstanceId) {
    try {
      await api(`/bot/instances/${botInstanceId}/stop`, { method: "POST" });
    } catch (err) {
      console.warn("[BOT] Failed to stop bot instance:", err);
    }
  }

  console.log("[BOT] Bot stopped.");
}

process.on("SIGINT", () => {
  console.log("[BOT] Received SIGINT, shutting down...");
  running = false;
});

process.on("SIGTERM", () => {
  console.log("[BOT] Received SIGTERM, shutting down...");
  running = false;
});

mainLoop().catch(err => {
  console.error("[BOT] Fatal error:", err);
  process.exit(1);
});
