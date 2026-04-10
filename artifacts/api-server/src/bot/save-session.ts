import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const SESSION_DIR = path.resolve("bot-session");
const PORTAL_URL = process.env.MAS_PORTAL_URL || "https://mas.medicaidtransportation.com";

async function saveSession() {
  console.log("[SESSION] Starting interactive session saver...");
  console.log("[SESSION] A browser window will open. Log in to the portal manually.");
  console.log("[SESSION] After login, the session will be saved automatically.");

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox"],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(PORTAL_URL);

  console.log("[SESSION] Browser opened. Please log in to the portal...");
  console.log("[SESSION] Waiting for successful login (checking every 5 seconds)...");

  let loggedIn = false;
  let attempts = 0;
  const maxAttempts = 120;

  while (!loggedIn && attempts < maxAttempts) {
    await page.waitForTimeout(5000);
    attempts++;

    const url = page.url();
    const bodyText = await page.textContent("body").catch(() => "");

    const loginIndicators = ["Log In", "Sign In", "login", "signin"];
    const dashboardIndicators = ["Dashboard", "Welcome", "Submit", "New Request", "My Requests", "Account"];

    const onLoginPage = loginIndicators.some(ind =>
      url.toLowerCase().includes(ind.toLowerCase()) ||
      (bodyText?.includes(ind) && !dashboardIndicators.some(d => bodyText?.includes(d)))
    );

    const onDashboard = dashboardIndicators.some(ind => bodyText?.includes(ind));

    if (onDashboard && !onLoginPage) {
      loggedIn = true;
      console.log("[SESSION] Login detected! Saving session state...");
    } else {
      if (attempts % 6 === 0) {
        console.log(`[SESSION] Still waiting for login... (${attempts * 5}s elapsed)`);
      }
    }
  }

  if (loggedIn) {
    const statePath = path.join(SESSION_DIR, "state.json");
    await context.storageState({ path: statePath });
    console.log(`[SESSION] Session saved to ${statePath}`);
    console.log("[SESSION] You can now start the bot and it will use this session.");
  } else {
    console.log("[SESSION] Timed out waiting for login. Please try again.");
  }

  await browser.close();
  process.exit(loggedIn ? 0 : 1);
}

saveSession().catch(err => {
  console.error("[SESSION] Error:", err);
  process.exit(1);
});
