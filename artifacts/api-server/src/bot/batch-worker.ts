import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { logger } from "../lib/logger";

const PORTAL_URL = "https://mastransportation.force.com/support";
const SESSION_DIR = path.resolve("bot-session");

let browsersInstalled = false;

function findPlaywrightCli(): string {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "node_modules/.bin/playwright"),
    path.resolve(cwd, "artifacts/api-server/node_modules/.bin/playwright"),
    path.resolve(cwd, "node_modules/playwright-core/cli.js"),
    path.resolve(cwd, "artifacts/api-server/node_modules/playwright-core/cli.js"),
    path.resolve(cwd, "node_modules/playwright/cli.js"),
    path.resolve(cwd, "artifacts/api-server/node_modules/playwright/cli.js"),
    path.join(__dirname, "../node_modules/.bin/playwright"),
    path.join(__dirname, "../node_modules/playwright-core/cli.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      logger.info(`Found Playwright CLI at: ${c}`);
      return c;
    }
  }
  return "playwright";
}

async function ensureBrowsersInstalled(): Promise<void> {
  if (browsersInstalled) return;
  try {
    const execPath = chromium.executablePath();
    if (fs.existsSync(execPath)) {
      browsersInstalled = true;
      return;
    }
  } catch {}

  logger.info("Playwright browsers not found, installing chromium...");
  const cli = findPlaywrightCli();
  const commands = [
    `node ${cli} install chromium --with-deps`,
    `node ${cli} install chromium`,
    `pnpm exec playwright install chromium`,
  ];

  for (const cmd of commands) {
    try {
      logger.info(`Trying: ${cmd}`);
      execSync(cmd, { timeout: 180000, stdio: "pipe", cwd: path.resolve("../../") });
      const execPath = chromium.executablePath();
      if (fs.existsSync(execPath)) {
        browsersInstalled = true;
        logger.info("Playwright chromium installed successfully");
        return;
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, `Command failed: ${cmd}`);
    }
  }

  throw new Error("Playwright browser installation failed. The bot cannot run without a browser. Tried multiple installation methods.");
}

export interface PortalSubmission {
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

export async function runBatchWorker(sub: PortalSubmission, dryRun = false): Promise<{ ticketId?: string; screenshotPath?: string }> {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  await ensureBrowsersInstalled();

  const MAS_USERNAME = process.env.MAS_PORTAL_USERNAME || "";
  const MAS_PASSWORD = process.env.MAS_PORTAL_PASSWORD || "";

  logger.info({ submissionId: sub.id }, "Batch worker: launching browser");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let context;
  const statePath = path.join(SESSION_DIR, "state.json");
  if (fs.existsSync(statePath)) {
    context = await browser.newContext({ storageState: statePath });
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

      logger.info({ submissionId: sub.id }, "Batch worker: login required");
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

    logger.info({ submissionId: sub.id }, "Batch worker: form fields populated");

    if (dryRun) {
      const screenshotPath = path.join(SESSION_DIR, `dry-run-${sub.id}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await context.storageState({ path: statePath });
      await page.close();
      await browser.close();
      logger.info({ submissionId: sub.id }, "Batch worker: dry run completed");
      return { screenshotPath };
    }

    const submitButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
    if (submitButton) {
      await submitButton.click();
      await page.waitForTimeout(5000);

      const confirmationText = await page.textContent("body");
      const ticketMatch = confirmationText?.match(/(?:ticket|request|case|confirmation)\s*(?:#|number|id)?\s*[:.]?\s*(\w+)/i);
      const ticketId = ticketMatch ? ticketMatch[1] : `portal-${Date.now()}`;

      await context.storageState({ path: statePath });
      await page.close();
      await browser.close();
      logger.info({ submissionId: sub.id, ticketId }, "Batch worker: submission completed");
      return { ticketId };
    } else {
      throw new Error("Submit button not found on portal page");
    }
  } catch (error) {
    try {
      const screenshotPath = path.join(SESSION_DIR, `error-${sub.id}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {}

    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}
