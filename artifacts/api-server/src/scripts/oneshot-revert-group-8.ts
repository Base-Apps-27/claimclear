import { transitionGroupStatus } from "../lib/group-transitions";

const RESPONSE_ID = 2;
const GROUP_ID = 8;

async function main() {
  const reason = `Retro reclassification of response #${RESPONSE_ID} — confirmation email mislabelled by legacy keyword classifier; reverting status set by email_response_matcher`;
  const actor = { userEmail: "system", userName: "Confirmation-Email Backfill" };

  console.log(
    `[oneshot] Reverting group#${GROUP_ID} Needs Review → Awaiting Response (orphan from 2026-04-30 crashed --apply on response#${RESPONSE_ID}).`,
  );

  await transitionGroupStatus({
    groupId: GROUP_ID,
    newStatus: "Awaiting Response",
    source: "reclassify_confirmation_emails_backfill",
    reason,
    actor,
    systemOverride: true,
  });

  console.log(`[oneshot] Done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
