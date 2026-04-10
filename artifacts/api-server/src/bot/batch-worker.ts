import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { logger } from "../lib/logger";

const PORTAL_URL = "https://mastransportation.force.com/support";
const SESSION_DIR = path.resolve("bot-session");

let browsersInstalled = false;

function findPlaywrightJsCli(): string | null {
  const cwd = process.cwd();
  const jsCandidates = [
    path.resolve(cwd, "artifacts/api-server/node_modules/playwright/cli.js"),
    path.resolve(cwd, "artifacts/api-server/node_modules/playwright-core/cli.js"),
    path.resolve(cwd, "node_modules/playwright/cli.js"),
    path.resolve(cwd, "node_modules/playwright-core/cli.js"),
    path.join(__dirname, "../node_modules/playwright/cli.js"),
    path.join(__dirname, "../node_modules/playwright-core/cli.js"),
  ];
  for (const c of jsCandidates) {
    if (fs.existsSync(c)) {
      logger.info(`Found Playwright JS CLI at: ${c}`);
      return c;
    }
  }
  return null;
}

function findPlaywrightShellBin(): string | null {
  const cwd = process.cwd();
  const binCandidates = [
    path.resolve(cwd, "artifacts/api-server/node_modules/.bin/playwright"),
    path.resolve(cwd, "node_modules/.bin/playwright"),
  ];
  for (const c of binCandidates) {
    if (fs.existsSync(c)) {
      logger.info(`Found Playwright shell bin at: ${c}`);
      return c;
    }
  }
  return null;
}

async function ensureBrowsersInstalled(): Promise<void> {
  if (browsersInstalled) return;
  try {
    const execPath = chromium.executablePath();
    if (fs.existsSync(execPath)) {
      browsersInstalled = true;
      logger.info(`Chromium already installed at: ${execPath}`);
      return;
    }
  } catch {}

  logger.info("Playwright browsers not found, installing chromium...");

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const envPrefix = browsersPath ? `PLAYWRIGHT_BROWSERS_PATH=${browsersPath} ` : "";

  const commands: string[] = [];

  const jsCli = findPlaywrightJsCli();
  if (jsCli) {
    commands.push(`${envPrefix}node ${jsCli} install chromium --with-deps`);
    commands.push(`${envPrefix}node ${jsCli} install chromium`);
  }

  const shellBin = findPlaywrightShellBin();
  if (shellBin) {
    commands.push(`${envPrefix}${shellBin} install chromium --with-deps`);
    commands.push(`${envPrefix}${shellBin} install chromium`);
  }

  commands.push(`${envPrefix}npx playwright install chromium`);

  for (const cmd of commands) {
    try {
      logger.info(`Trying: ${cmd}`);
      execSync(cmd, { timeout: 180000, stdio: "pipe", cwd: process.cwd() });
      try {
        const execPath = chromium.executablePath();
        if (fs.existsSync(execPath)) {
          browsersInstalled = true;
          logger.info(`Playwright chromium installed successfully at: ${execPath}`);
          return;
        }
      } catch {}
      logger.warn("Command succeeded but chromium executable not found at expected path");
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

async function downloadToTemp(url: string, index: number): Promise<string> {
  const ext = path.extname(new URL(url).pathname) || ".png";
  const tmpFile = path.join(os.tmpdir(), `evidence-${Date.now()}-${index}${ext}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const fileStream = fs.createWriteStream(tmpFile);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);
  return tmpFile;
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
  const downloadedFiles: string[] = [];

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

    const isGpsIssue = sub.issueType === "GPS Control Deviation";

    const issueTypeSelect = await page.$('select[name="issue_type"], #issue_type, [data-field="issue_type"]');
    if (issueTypeSelect && sub.issueType) {
      await issueTypeSelect.selectOption(sub.issueType);
      await page.waitForTimeout(2000);
      logger.info({ submissionId: sub.id, issueType: sub.issueType, isGpsIssue }, "Batch worker: issue type selected, waiting for conditional fields");
    }

    const subjectInput = await page.$('input[name="subject"], #subject, [data-field="subject"]');
    if (subjectInput && sub.subject) await subjectInput.fill(sub.subject);

    const emailInput = await page.$('input[name="requester_email"], input[name="email"], #email');
    if (emailInput && sub.requesterEmail) await emailInput.fill(sub.requesterEmail);

    const providerInput = await page.$('input[name="transportation_provider"], input[name="provider"]');
    if (providerInput && sub.transportationProviderName) await providerInput.fill(sub.transportationProviderName);

    const phoneInput = await page.$('input[name="phone"], input[type="tel"]');
    if (phoneInput && sub.phoneNumber) await phoneInput.fill(sub.phoneNumber);

    if (isGpsIssue) {
      const invoiceInput = await page.$('input[name="invoice"], input[name="invoice_number"]');
      if (invoiceInput && sub.invoiceNumber) {
        await invoiceInput.fill(sub.invoiceNumber);
        logger.info({ submissionId: sub.id }, "Batch worker: invoice number filled (GPS issue)");
      } else if (!invoiceInput) {
        logger.warn({ submissionId: sub.id }, "Batch worker: invoice number field not found for GPS issue — portal may not have rendered conditional fields");
      }

      const gpsSelect = await page.$('select[name="gps_breadcrumbs"], #gps_breadcrumbs');
      if (gpsSelect && sub.gpsBreadcrumbsAvailable) {
        await gpsSelect.selectOption(sub.gpsBreadcrumbsAvailable);
        logger.info({ submissionId: sub.id, value: sub.gpsBreadcrumbsAvailable }, "Batch worker: GPS breadcrumbs answered");
      } else if (!gpsSelect) {
        logger.warn({ submissionId: sub.id }, "Batch worker: GPS breadcrumbs field not found for GPS issue");
      }
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
          }, sub.descriptionHtml || buildDescription(sub));
        }
      }
    } else {
      const descTextarea = await page.$('textarea[name="description"], #description, [data-field="description"]');
      if (descTextarea) await descTextarea.fill(sub.descriptionHtml || buildDescription(sub));
    }

    logger.info({ submissionId: sub.id }, "Batch worker: form fields populated");

    const hasEvidence = sub.attachmentUrls && sub.attachmentUrls.length > 0;

    if (hasEvidence) {
      logger.info({ submissionId: sub.id, count: sub.attachmentUrls.length }, "Batch worker: downloading evidence files for upload");

      const failedDownloads: string[] = [];
      for (let i = 0; i < sub.attachmentUrls.length; i++) {
        let downloaded = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const tmpPath = await downloadToTemp(sub.attachmentUrls[i], i);
            downloadedFiles.push(tmpPath);
            logger.info({ submissionId: sub.id, file: tmpPath }, `Downloaded evidence file ${i + 1}/${sub.attachmentUrls.length}`);
            downloaded = true;
            break;
          } catch (err) {
            logger.warn({ submissionId: sub.id, url: sub.attachmentUrls[i], attempt, err: err instanceof Error ? err.message : String(err) }, "Evidence download attempt failed");
            if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
        if (!downloaded) failedDownloads.push(sub.attachmentUrls[i]);
      }

      if (failedDownloads.length > 0) {
        throw new Error(`Evidence download failed for ${failedDownloads.length} file(s) — cannot submit without evidence. URLs: ${failedDownloads.join(", ")}`);
      }

      let attached = false;
      const attachmentBtn = await page.$('button:has-text("Attachment"), a:has-text("Attachment"), button:has-text("Attach"), input[type="file"]');

      if (attachmentBtn) {
        const tagName = await attachmentBtn.evaluate(el => el.tagName.toLowerCase());

        if (tagName === "input") {
          await attachmentBtn.setInputFiles(downloadedFiles);
          attached = true;
          logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via input");
        } else {
          for (const filePath of downloadedFiles) {
            const [fileChooser] = await Promise.all([
              page.waitForEvent("filechooser", { timeout: 15000 }),
              attachmentBtn.click(),
            ]);
            await fileChooser.setFiles(filePath);
            await page.waitForTimeout(2000);
            logger.info({ submissionId: sub.id, file: filePath }, "Batch worker: file attached via chooser");
          }
          attached = true;
        }
      } else {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(downloadedFiles);
          attached = true;
          logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via hidden input");
        }
      }

      if (!attached) {
        throw new Error("Evidence upload failed — no attachment element found on portal page. Cannot submit without evidence.");
      }

      await page.waitForTimeout(1000);
      logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: all evidence files attached successfully");
    }

    const cleanupTempFiles = () => {
      for (const f of downloadedFiles) {
        try { fs.unlinkSync(f); } catch {}
      }
    };

    if (dryRun) {
      const screenshotPath = path.join(SESSION_DIR, `dry-run-${sub.id}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await context.storageState({ path: statePath });
      await page.close();
      await browser.close();
      cleanupTempFiles();
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
      cleanupTempFiles();
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

    for (const f of downloadedFiles) {
      try { fs.unlinkSync(f); } catch {}
    }

    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}
