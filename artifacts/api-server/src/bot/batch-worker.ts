/// <reference lib="dom" />
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

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

function isObjectStorageUrl(url: string): boolean {
  return typeof url === "string" && url.startsWith("/objects/");
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function downloadToTemp(url: string, index: number, label?: string): Promise<string> {
  logger.info({ url, index, label }, "downloadToTemp: starting download");

  if (!isObjectStorageUrl(url)) {
    throw new Error(`Evidence URL rejected — only application storage paths (/objects/...) are permitted: ${url}`);
  }

  try {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const storage = new ObjectStorageService();
    const result = await storage.downloadObjectToTemp(url, index, label);
    logger.info({ url, tmpPath: result }, "downloadToTemp: downloaded from object storage");
    return result;
  } catch (objErr) {
    const objErrMsg = objErr instanceof Error ? objErr.message : String(objErr);
    logger.warn({ url, err: objErrMsg }, "downloadToTemp: object storage download failed, trying HTTP fallback via /api/storage/objects/ route");
    const apiBase = `http://localhost:${process.env.PORT || 8080}`;
    const storagePath = url.replace(/^\/objects\//, "/api/storage/objects/");
    const httpUrl = `${apiBase}${storagePath}`;
    try {
      const lastPart = url.split("/").pop() || "";
      const dotIdx = lastPart.lastIndexOf(".");
      const ext = dotIdx > 0 ? "." + lastPart.substring(dotIdx + 1) : ".png";
      const baseName = label ? `${label}-evidence-${index + 1}` : `evidence-${Date.now()}-${index}`;
      const tmpFile = path.join(os.tmpdir(), `${baseName}${ext}`);
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      const response = await fetch(httpUrl, { signal: controller.signal });
      clearTimeout(timeoutHandle);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP fallback ${httpUrl} returned ${response.status}`);
      }
      const fileStream = fs.createWriteStream(tmpFile);
      let bytesWritten = 0;
      const readable = Readable.fromWeb(response.body as any);
      readable.on("data", (chunk: Buffer) => {
        bytesWritten += chunk.length;
        if (bytesWritten > MAX_ATTACHMENT_BYTES) {
          readable.destroy(new Error(`Evidence file exceeds ${MAX_ATTACHMENT_BYTES} byte size limit`));
        }
      });
      await pipeline(readable, fileStream);
      const fileSize = fs.statSync(tmpFile).size;
      logger.info({ url, httpUrl, tmpPath: tmpFile, fileSize }, "downloadToTemp: downloaded via HTTP fallback");
      return tmpFile;
    } catch (httpErr) {
      throw new Error(`Evidence download failed for ${url}: GCS error: ${objErrMsg}, HTTP fallback error: ${httpErr instanceof Error ? httpErr.message : String(httpErr)}`);
    }
  }
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

async function fillChoicesDropdown(page: any, selectSelector: string, value: string, submissionId: number): Promise<boolean> {
  const el = await page.$(selectSelector);
  if (!el) return false;

  const isVisible = await el.isVisible().catch(() => false);
  if (isVisible) {
    try {
      await el.selectOption(value);
      logger.info({ submissionId }, "fillChoicesDropdown: used native selectOption (visible)");
      return true;
    } catch {}
  }

  // Choices.js initialized this select and stashed its instance on the element
  // as `select.choicesInstance`. Calling `setChoiceByValue` updates both the
  // underlying <select> AND the visible widget UI in a single call — this is
  // what we need for fields like GPS Breadcrumbs Available where Choices.js
  // has stripped the options off the underlying <select> and is rendering
  // them out of its own internal store.
  const choicesApiResult = await page.evaluate(({ sel, val }: { sel: string; val: string }) => {
    const select = document.querySelector(sel) as (HTMLSelectElement & { choicesInstance?: any }) | null;
    if (!select) return "not_found";
    if (!select.choicesInstance || typeof select.choicesInstance.setChoiceByValue !== "function") {
      return "no_instance";
    }
    try {
      select.choicesInstance.setChoiceByValue(val);
      return select.value === val ? "ok" : `mismatch:${select.value}`;
    } catch (err) {
      return `error:${err instanceof Error ? err.message : String(err)}`;
    }
  }, { sel: selectSelector, val: value });

  if (choicesApiResult === "ok") {
    logger.info({ submissionId, value }, "fillChoicesDropdown: set via Choices.js setChoiceByValue API");
    return true;
  }
  if (choicesApiResult !== "no_instance" && choicesApiResult !== "not_found") {
    logger.warn({ submissionId, value, choicesApiResult }, "fillChoicesDropdown: Choices.js API call did not stick — trying widget click");
  }

  const choicesContainer = await page.evaluateHandle((sel: string) => {
    const select = document.querySelector(sel);
    if (!select) return null;
    // Walk past `select` itself — Choices.js adds `choices` to the underlying
    // <select>, so a plain `closest(".choices")` returns the select element
    // and never reaches the real `<div class="choices">` wrapper one level up.
    return select.parentElement?.closest("div.choices") || null;
  }, selectSelector);

  const isChoicesWidget = await choicesContainer.evaluate((el: Element | null) => !!el).catch(() => false);

  if (isChoicesWidget) {
    const innerBtn = await (choicesContainer as any).$(".choices__inner");
    if (innerBtn) {
      await innerBtn.click();
      await page.waitForTimeout(300);

      const optionItem = await (choicesContainer as any).$(`.choices__item[data-value="${value}"]`);
      if (optionItem) {
        await optionItem.click();
        logger.info({ submissionId, value }, "fillChoicesDropdown: selected via Choices.js widget click");
        return true;
      }

      const allItems = await (choicesContainer as any).$$(".choices__item--choice");
      for (const item of allItems) {
        const text = await item.textContent();
        if (text?.trim() === value) {
          await item.click();
          logger.info({ submissionId, value }, "fillChoicesDropdown: selected via Choices.js text match");
          return true;
        }
      }

      logger.warn({ submissionId, value }, "fillChoicesDropdown: Choices.js dropdown opened but option not found");
    }
  }

  const jsResult = await page.evaluate(({ sel, val }: { sel: string; val: string }) => {
    const select = document.querySelector(sel) as HTMLSelectElement | null;
    if (!select) return "not_found";
    for (const opt of Array.from(select.options)) {
      if (opt.value === val || opt.text.trim() === val) {
        select.value = opt.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.dispatchEvent(new Event("input", { bubbles: true }));
        return select.value;
      }
    }
    return "no_match";
  }, { sel: selectSelector, val: value });

  if (jsResult && jsResult !== "not_found" && jsResult !== "no_match") {
    logger.info({ submissionId, value, jsResult }, "fillChoicesDropdown: set via JS on hidden select");
    return true;
  }

  logger.warn({ submissionId, value, jsResult }, "fillChoicesDropdown: all methods failed");
  return false;
}

export const FRESHDESK_ISSUE_TYPE_MAP: Record<string, string> = {
  "GPS Control Deviation": "gps_control_deviation",
  "Other Issue or Question": "other_issue_or_question",
  "Custom Payment Request": "custom_payment_request",
  "MAS Trips App Issue": "mas_trips_app_issue",
  "Vehicle, Driver, or TPP": "vehicle,_driver,_or_tpp",
  "Zip Code Block": "zip_code_block",
  "Trip Correction": "trip_correction",
  "Trip Concern": "trip_concern",
};

/**
 * Navigate to a Freshdesk ticket form using a wait strategy that tolerates
 * the portal's long-polling scripts: `domcontentloaded` instead of
 * `networkidle`, plus an explicit selector wait for the form being attached.
 * On a thrown timeout we retry once — the second attempt usually succeeds
 * once slow assets are cached. */
async function gotoTicketForm(page: any, url: string, submissionId: number): Promise<void> {
  const FORM_SELECTOR = "#new_helpdesk_ticket";
  const NAV_TIMEOUT = 60_000;
  const SELECTOR_TIMEOUT = 30_000;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await page.waitForSelector(FORM_SELECTOR, { state: "attached", timeout: SELECTOR_TIMEOUT });
      if (attempt > 1) {
        logger.info({ submissionId, url, attempt }, "gotoTicketForm: succeeded on retry");
      }
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        logger.warn({ submissionId, url, err: errMsg }, "gotoTicketForm: first attempt timed out, retrying once");
        continue;
      }
      throw new Error(`Ticket form did not load at ${url} after 2 attempts: ${errMsg}`);
    }
  }
}

/**
 * Navigate to the Freshdesk `/support/login` page using the same resilience
 * strategy as `gotoTicketForm`: `domcontentloaded` instead of `networkidle`
 * (the portal's long-poll scripts never let `networkidle` settle), an explicit
 * wait for the password input to confirm the login form actually rendered, a
 * 60s total budget, and one soft retry on timeout. The portal exhibits a
 * recurring midnight slowdown that previously timed out the 30s `networkidle`
 * wait; this helper is what unblocks attempts during that window. */
async function gotoLoginPage(page: any, url: string, submissionId: number): Promise<void> {
  const PASSWORD_SELECTOR = 'input[name="user[password]"], input[name="helpdesk_user[password]"], input[type="password"], #user_password';
  const NAV_TIMEOUT = 60_000;
  const SELECTOR_TIMEOUT = 30_000;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await page.waitForSelector(PASSWORD_SELECTOR, { state: "attached", timeout: SELECTOR_TIMEOUT });
      if (attempt > 1) {
        logger.info({ submissionId, url, attempt }, "gotoLoginPage: succeeded on retry");
      }
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        logger.warn({ submissionId, url, err: errMsg }, "gotoLoginPage: first attempt timed out, retrying once");
        continue;
      }
      throw new Error(`Login page did not load at ${url} after 2 attempts: ${errMsg}`);
    }
  }
}

/**
 * After clicking the login submit button, wait for the post-login navigation
 * to settle. Uses `domcontentloaded` (not `networkidle`) so the portal's
 * background long-poll scripts don't keep us blocked indefinitely. Caller is
 * responsible for verifying we're actually logged in (e.g. checking that the
 * password input is no longer visible). */
async function waitForLoginRedirect(page: any, submissionId: number): Promise<void> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ submissionId, err: errMsg }, "waitForLoginRedirect: domcontentloaded timed out; continuing — caller will verify login state");
  }
}

/**
 * After a portal-induced reload (e.g. the form-type dropdown change), wait
 * for the ticket form to be attached again. Mirrors `gotoTicketForm`'s
 * resilience: avoids `networkidle` (the portal's long-poll never satisfies it),
 * uses a 60s total budget split across an attached-selector wait, and on
 * timeout does one soft retry by reloading the page (the URL still encodes the
 * newly-selected form type) and waiting for the selector again. */
async function waitForTicketFormReload(page: any, submissionId: number): Promise<void> {
  const FORM_SELECTOR = "#new_helpdesk_ticket";
  const FIRST_WAIT_MS = 30_000;
  const RELOAD_TIMEOUT_MS = 60_000;
  const RETRY_WAIT_MS = 30_000;

  try {
    await page.waitForSelector(FORM_SELECTOR, { state: "attached", timeout: FIRST_WAIT_MS });
    return;
  } catch (firstErr) {
    const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    logger.warn({ submissionId, err: firstMsg }, "waitForTicketFormReload: form not re-attached within 30s, soft-retrying via page.reload");
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: RELOAD_TIMEOUT_MS });
      await page.waitForSelector(FORM_SELECTOR, { state: "attached", timeout: RETRY_WAIT_MS });
      logger.info({ submissionId }, "waitForTicketFormReload: succeeded after soft retry");
      return;
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(`Ticket form did not re-attach after dropdown change (after 1 soft retry): ${retryMsg}`);
    }
  }
}

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
      await gotoLoginPage(page, `${PORTAL_URL}/support/login`, sub.id);
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
          await waitForLoginRedirect(page, sub.id);
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
    await gotoTicketForm(page, ticketUrl, sub.id);
    await page.waitForTimeout(2000);

    const loginLink = await page.$('a[href*="login"], a:has-text("Login"), a:has-text("Log in"), a:has-text("Sign in")');
    if (loginLink) {
      logger.info({ submissionId: sub.id }, "Batch worker: session expired, re-logging in");
      if (!MAS_USERNAME || !MAS_PASSWORD) {
        throw new Error("Portal login required — MAS_PORTAL_USERNAME and MAS_PORTAL_PASSWORD must be configured");
      }
      await loginLink.click();
      try {
        await page.waitForSelector(
          'input[name="user[password]"], input[name="helpdesk_user[password]"], input[type="password"], #user_password',
          { state: "attached", timeout: 30_000 },
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ submissionId: sub.id, err: errMsg }, "Re-login: password input did not attach in 30s after clicking login link; falling back to direct goto");
        await gotoLoginPage(page, `${PORTAL_URL}/support/login`, sub.id);
      }
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
          await waitForLoginRedirect(page, sub.id);
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

      await gotoTicketForm(page, ticketUrl, sub.id);
      await page.waitForTimeout(2000);
    }

    const formDropdown = await page.$("#helpdesk_ticket_forms_dropdown");
    if (formDropdown) {
      const selectedValue = await page.evaluate(() => {
        const sel = document.querySelector("#helpdesk_ticket_forms_dropdown") as HTMLSelectElement | null;
        return sel?.value || "";
      });
      logger.info({ submissionId: sub.id, selectedValue, expected: ticketFormSlug }, "Batch worker: ticket form dropdown value");
      if (selectedValue !== ticketFormSlug) {
        await fillChoicesDropdown(page, "#helpdesk_ticket_forms_dropdown", ticketFormSlug, sub.id);
        await waitForTicketFormReload(page, sub.id);
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
      const gpsValue = ["Yes", "No", "Unknown"].includes(sub.gpsBreadcrumbsAvailable) ? sub.gpsBreadcrumbsAvailable : "";
      if (gpsValue) {
        const gpsSelector = "#helpdesk_ticket_custom_field_cf_gps_breadcrumbs_available_4128361";
        const filled = await fillChoicesDropdown(page, gpsSelector, gpsValue, sub.id);
        if (filled) {
          logger.info({ submissionId: sub.id, value: gpsValue }, "Batch worker: filled GPS Breadcrumbs");
        } else {
          logger.warn({ submissionId: sub.id }, "Batch worker: GPS Breadcrumbs field not found or could not be set");
        }
      } else {
        logger.warn({ submissionId: sub.id, value: sub.gpsBreadcrumbsAvailable }, "Batch worker: GPS Breadcrumbs value missing or invalid");
      }
    }

    const rawDescriptionHtml = sub.descriptionHtml || buildDescription(sub);
    const descriptionPlainText = htmlToPlainText(rawDescriptionHtml);
    const richEditorFrame = await page.$('#helpdesk_ticket_ticket_body_attributes_description_html');
    if (richEditorFrame) {
      const isVisible = await richEditorFrame.isVisible();
      if (isVisible) {
        await richEditorFrame.fill(descriptionPlainText);
        logger.info({ submissionId: sub.id }, "Batch worker: filled Description via textarea");
      } else {
        const froalaEditor = await page.$('.fr-element.fr-view');
        if (froalaEditor) {
          await froalaEditor.click();
          await froalaEditor.evaluate((el: Element, text: string) => {
            el.textContent = text;
          }, descriptionPlainText);
          logger.info({ submissionId: sub.id }, "Batch worker: filled Description via Froala editor");
        } else {
          const contentEditable = await page.$('[contenteditable="true"]');
          if (contentEditable) {
            await contentEditable.click();
            await contentEditable.evaluate((el: Element, text: string) => {
              el.textContent = text;
            }, descriptionPlainText);
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
            const fileLabel = `claim-${sub.confNumber}`;
            const tmpPath = await downloadToTemp(sub.attachmentUrls[i], i, fileLabel);
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
        await page.waitForTimeout(2000);
        attached = true;
        logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via #upload_file (triggers Freshdesk JS handler)");
      } else if (filesListInput) {
        await filesListInput.setInputFiles(downloadedFiles);
        attached = true;
        logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via #files_list fallback");
      } else {
        const anyFileInput = await page.$('input[type="file"]');
        if (anyFileInput) {
          await anyFileInput.setInputFiles(downloadedFiles);
          attached = true;
          logger.info({ submissionId: sub.id, count: downloadedFiles.length }, "Batch worker: files attached via generic file input fallback");
        }
      }

      if (!attached) {
        throw new Error("Evidence upload failed — no attachment element found on portal page. Cannot submit without evidence.");
      }

      const attachmentVerification = await page.evaluate(() => {
        const attachList = document.querySelector('#attachments_list');
        const childCount = attachList?.children?.length || 0;
        const fileNames = Array.from(attachList?.querySelectorAll('.file-name') || []).map(el => el.textContent?.trim() || '');
        const filesListCount = (document.querySelector('#files_list') as HTMLInputElement)?.files?.length || 0;
        return { childCount, fileNames, filesListCount };
      }).catch(() => ({ childCount: 0, fileNames: [] as string[], filesListCount: 0 }));
      logger.info({ submissionId: sub.id, verification: JSON.stringify(attachmentVerification), expectedCount: downloadedFiles.length }, "Batch worker: attachment verification");
      if (attachmentVerification.childCount <= 0 && attachmentVerification.filesListCount <= 0) {
        throw new Error("Evidence upload failed — files were set but Freshdesk did not register them. No attachments visible in form.");
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
