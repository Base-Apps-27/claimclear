import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { logger } from "../lib/logger";

const PORTAL_URL = process.env.MAS_PORTAL_URL || "https://tpissues.medanswering.com";
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
  if (url.startsWith("/objects/")) {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const storage = new ObjectStorageService();
    return storage.downloadObjectToTemp(url, index);
  }

  if (fs.existsSync(url)) {
    return url;
  }

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

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol')) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function buildDescription(sub: PortalSubmission): string {
  const raw = sub.descriptionHtml?.trim()
    ? sub.descriptionHtml
    : `Dispute for Confirmation Number: ${sub.confNumber || "N/A"}
Service Date: ${sub.serviceDate || "N/A"}
Reference Number: ${sub.refNumber || "N/A"}
Client Number: ${sub.clientNumber || "N/A"}
Car Number: ${sub.carNumber || "N/A"}
Claim Amount: $${sub.claimAmount || "0.00"}
Error Type: ${sub.errorTypeName || "N/A"}
Error Details: ${sub.errorDetails || "N/A"}

Dispute Reason: ${sub.disputeReason || "N/A"}

Evidence Notes: ${sub.evidenceNotes || "N/A"}`;

  return markdownToHtml(raw);
}

const FRESHDESK_ISSUE_TYPE_MAP: Record<string, string> = {
  "GPS Control Deviation": "gps_control_deviation",
  "Other Issue or Question": "other_issue_or_question",
  "Custom Payment Request": "custom_payment_request",
  "MAS Trips App Issue": "mas_trips_app_issue",
  "Vehicle, Driver, or TPP": "vehicle,_driver,_or_tpp",
  "Zip Code Block": "zip_code_block",
  "Trip Correction": "trip_correction",
  "Trip Concern": "trip_concern",
};

export async function runBatchWorker(sub: PortalSubmission, dryRun = false): Promise<{ ticketId?: string; screenshotPath?: string }> {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  await ensureBrowsersInstalled();

  const MAS_USERNAME = process.env.MAS_PORTAL_USERNAME || "";
  const MAS_PASSWORD = process.env.MAS_PORTAL_PASSWORD || "";

  logger.info({ submissionId: sub.id, dryRun }, "Batch worker: launching browser");

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
    const ticketFormSlug = FRESHDESK_ISSUE_TYPE_MAP[sub.issueType] || FRESHDESK_ISSUE_TYPE_MAP["Other Issue or Question"];
    const ticketUrl = `${PORTAL_URL}/support/tickets/new?ticket_form=${ticketFormSlug}`;

    const needsLogin = !fs.existsSync(statePath);
    if (needsLogin) {
      if (!MAS_USERNAME || !MAS_PASSWORD) {
        throw new Error("Portal login required — MAS_PORTAL_USERNAME and MAS_PORTAL_PASSWORD must be configured");
      }

      logger.info({ submissionId: sub.id }, "Batch worker: no saved session, logging in first");
      await page.goto(`${PORTAL_URL}/support/login`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(2000);

      const emailInput = await page.$('input[name="user[email]"], input[name="helpdesk_user[email]"], input[type="email"], #user_email');
      const passwordInput = await page.$('input[name="user[password]"], input[name="helpdesk_user[password]"], input[type="password"], #user_password');

      if (emailInput && passwordInput) {
        await emailInput.fill(MAS_USERNAME);
        await passwordInput.fill(MAS_PASSWORD);
        await page.waitForTimeout(500);

        const submitBtn = await page.$('button[type="submit"], input[type="submit"], input[name="commit"]');
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForLoadState("networkidle", { timeout: 15000 });
          await page.waitForTimeout(3000);
        }

        const stillOnLogin = await page.$('input[type="password"]:visible');
        if (stillOnLogin) {
          throw new Error("Portal login failed — check credentials");
        }

        logger.info({ submissionId: sub.id }, "Batch worker: login successful, saving session");
        await context.storageState({ path: statePath });
      } else {
        throw new Error("Portal login form not recognized — could not find email/password inputs");
      }
    }

    logger.info({ submissionId: sub.id, ticketUrl }, "Batch worker: navigating to ticket form (authenticated)");
    await page.goto(ticketUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const loginLink = await page.$('a[href*="login"], a:has-text("Login"), a:has-text("Log in"), a:has-text("Sign in")');
    if (loginLink) {
      logger.info({ submissionId: sub.id }, "Batch worker: session expired, re-logging in");
      if (!MAS_USERNAME || !MAS_PASSWORD) {
        throw new Error("Portal login required — MAS_PORTAL_USERNAME and MAS_PORTAL_PASSWORD must be configured");
      }
      await loginLink.click();
      await page.waitForLoadState("networkidle", { timeout: 15000 });
      await page.waitForTimeout(2000);

      const emailInput = await page.$('input[name="user[email]"], input[name="helpdesk_user[email]"], input[type="email"], #user_email');
      const passwordInput = await page.$('input[name="user[password]"], input[name="helpdesk_user[password]"], input[type="password"], #user_password');

      if (emailInput && passwordInput) {
        await emailInput.fill(MAS_USERNAME);
        await passwordInput.fill(MAS_PASSWORD);
        await page.waitForTimeout(500);
        const submitBtn = await page.$('button[type="submit"], input[type="submit"], input[name="commit"]');
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForLoadState("networkidle", { timeout: 15000 });
          await page.waitForTimeout(3000);
        }
        const stillOnLogin = await page.$('input[type="password"]:visible');
        if (stillOnLogin) {
          throw new Error("Portal login failed — check credentials");
        }
        logger.info({ submissionId: sub.id }, "Batch worker: re-login successful");
        await context.storageState({ path: statePath });
      } else {
        throw new Error("Portal login form not recognized on re-login");
      }

      await page.goto(ticketUrl, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    const formDropdown = await page.$("#helpdesk_ticket_forms_dropdown");
    if (formDropdown) {
      const selectedValue = await formDropdown.inputValue();
      logger.info({ submissionId: sub.id, selectedValue, expected: ticketFormSlug }, "Batch worker: ticket form dropdown value");
      if (selectedValue !== ticketFormSlug) {
        await formDropdown.selectOption(ticketFormSlug);
        await page.waitForLoadState("networkidle", { timeout: 15000 });
        await page.waitForTimeout(2000);
        logger.info({ submissionId: sub.id }, "Batch worker: ticket form changed, page reloaded");
      }
    }

    const mainForm = await page.$("#new_helpdesk_ticket");
    if (!mainForm) {
      throw new Error("Freshdesk ticket form (#new_helpdesk_ticket) not found — portal page may not have loaded correctly");
    }
    logger.info({
      submissionId: sub.id,
      issueType: sub.issueType,
      subject: sub.subject?.substring(0, 50),
      email: sub.requesterEmail,
      tpName: sub.transportationProviderName,
      phone: sub.phoneNumber,
      invoice: sub.invoiceNumber,
      hasDescription: !!sub.descriptionHtml,
      attachmentCount: sub.attachmentUrls?.length || 0,
    }, "Batch worker: ticket form found, filling fields with submission data");

    const isGpsIssue = sub.issueType === "GPS Control Deviation";

    if (sub.subject) {
      const el = await page.$("#helpdesk_ticket_subject");
      if (el) {
        await el.fill(sub.subject);
        logger.info({ submissionId: sub.id }, "Batch worker: filled Subject");
      } else {
        logger.warn({ submissionId: sub.id }, "Batch worker: Subject field not found");
      }
    }

    if (sub.requesterEmail) {
      const el = await page.$("#helpdesk_ticket_email");
      if (el) {
        await el.fill(sub.requesterEmail);
        logger.info({ submissionId: sub.id }, "Batch worker: filled Email");
      } else {
        logger.warn({ submissionId: sub.id }, "Batch worker: Email field not found");
      }
    }

    if (sub.transportationProviderName) {
      const el = await page.$("#helpdesk_ticket_custom_field_cf_tp_name_4128361");
      if (el) {
        await el.fill(sub.transportationProviderName);
        logger.info({ submissionId: sub.id }, "Batch worker: filled TP Name");
      } else {
        logger.warn({ submissionId: sub.id }, "Batch worker: TP Name field not found");
      }
    }

    if (sub.phoneNumber) {
      const el = await page.$("#helpdesk_ticket_custom_field_cf_phone_number_4128361");
      if (el) {
        await el.fill(sub.phoneNumber);
        logger.info({ submissionId: sub.id }, "Batch worker: filled Phone");
      } else {
        logger.warn({ submissionId: sub.id }, "Batch worker: Phone field not found");
      }
    }

    if (sub.invoiceNumber) {
      const el = await page.$("#helpdesk_ticket_custom_field_cf_invoice_number_4128361");
      if (el) {
        await el.fill(sub.invoiceNumber);
        logger.info({ submissionId: sub.id }, "Batch worker: filled Invoice Number");
      } else {
        logger.warn({ submissionId: sub.id }, "Batch worker: Invoice Number field not found");
      }
    }

    if (isGpsIssue) {
      const el = await page.$("#helpdesk_ticket_custom_field_cf_gps_breadcrumbs_available_4128361");
      if (el) {
        const gpsValue = ["Yes", "No", "Unknown"].includes(sub.gpsBreadcrumbsAvailable) ? sub.gpsBreadcrumbsAvailable : "";
        if (gpsValue) {
          await el.selectOption(gpsValue);
          logger.info({ submissionId: sub.id, value: gpsValue }, "Batch worker: filled GPS Breadcrumbs");
        } else {
          logger.warn({ submissionId: sub.id, value: sub.gpsBreadcrumbsAvailable }, "Batch worker: GPS Breadcrumbs value missing or invalid");
        }
      } else {
        logger.warn({ submissionId: sub.id }, "Batch worker: GPS Breadcrumbs field not found");
      }
    }

    const descriptionText = sub.descriptionHtml || buildDescription(sub);
    const richEditorFrame = await page.$('#helpdesk_ticket_ticket_body_attributes_description_html');
    if (richEditorFrame) {
      const isVisible = await richEditorFrame.isVisible();
      if (isVisible) {
        await richEditorFrame.fill(descriptionText);
        logger.info({ submissionId: sub.id }, "Batch worker: filled Description via textarea");
      } else {
        const froalaEditor = await page.$('.fr-element.fr-view');
        if (froalaEditor) {
          await froalaEditor.click();
          await froalaEditor.evaluate((el, text) => {
            el.innerHTML = `<p>${text.replace(/\n/g, '</p><p>')}</p>`;
          }, descriptionText);
          logger.info({ submissionId: sub.id }, "Batch worker: filled Description via Froala editor");
        } else {
          const contentEditable = await page.$('[contenteditable="true"]');
          if (contentEditable) {
            await contentEditable.click();
            await contentEditable.evaluate((el, text) => {
              el.innerHTML = `<p>${text.replace(/\n/g, '</p><p>')}</p>`;
            }, descriptionText);
            logger.info({ submissionId: sub.id }, "Batch worker: filled Description via contenteditable");
          } else {
            logger.warn({ submissionId: sub.id }, "Batch worker: Description field hidden and no rich editor found");
          }
        }
      }
    } else {
      logger.warn({ submissionId: sub.id }, "Batch worker: Description textarea not found at all");
    }

    const allInputs = await page.$$eval("input:not([type='hidden']), select, textarea", (elements) => {
      return elements
        .filter((el) => (el as any).value)
        .map((el) => ({
          id: el.id || "",
          name: (el as any).name || "",
          value: ((el as any).value || "").substring(0, 80),
        }));
    });
    logger.info({ submissionId: sub.id, filledFields: JSON.stringify(allInputs) }, "Batch worker: form fields populated");

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
      const freshdeskFileInput = await page.$('#upload_file');
      const filesListInput = await page.$('#files_list');

      if (freshdeskFileInput) {
        await freshdeskFileInput.setInputFiles(downloadedFiles);
        attached = true;
        logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via Freshdesk #upload_file input");
      } else if (filesListInput) {
        await filesListInput.setInputFiles(downloadedFiles);
        attached = true;
        logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via Freshdesk #files_list input");
      } else {
        const anyFileInput = await page.$('input[type="file"]');
        if (anyFileInput) {
          await anyFileInput.setInputFiles(downloadedFiles);
          attached = true;
          logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via fallback file input");
        }
      }

      if (!attached) {
        throw new Error("Evidence upload failed — no attachment element found on portal page. Cannot submit without evidence.");
      }

      const attachedFileCount = await page.$$eval('input[type="file"]', (inputs) => {
        return inputs.reduce((count, input) => {
          const files = (input as HTMLInputElement).files;
          return count + (files ? files.length : 0);
        }, 0);
      }).catch(() => 0);
      if (attachedFileCount <= 0) {
        throw new Error("Evidence upload failed — no files were attached to the portal form.");
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

    const submitButton = await page.$('button.new-ticket-submit-button[type="submit"]')
      || await page.$('#new_helpdesk_ticket button[type="submit"]')
      || await page.$('button[type="submit"]');
    if (submitButton) {
      await submitButton.click();
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(5000);

      const currentUrl = page.url();
      const confirmationText = await page.textContent("body");
      const ticketMatch = confirmationText?.match(/ticket\s*(?:#|number|id|:)?\s*(\d+)/i)
        || currentUrl.match(/tickets\/(\d+)/);
      const ticketId = ticketMatch ? ticketMatch[1] : `portal-${Date.now()}`;

      await context.storageState({ path: statePath });
      await page.close();
      await browser.close();
      cleanupTempFiles();
      logger.info({ submissionId: sub.id, ticketId }, "Batch worker: submission completed");
      return { ticketId };
    } else {
      throw new Error("Submit button not found on Freshdesk portal page");
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
