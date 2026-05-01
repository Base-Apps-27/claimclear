import type { GroupConversation, GroupEmailMessage } from "./group-communication-thread";
import type { ResponseBannerData } from "./response-received-banner";
import type { LegMention } from "./leg-communication-mentions";

// Per Task #262 the message body renders the full text with no inner
// cap or "Show full message" toggle. The mocks therefore carry realistic
// multi-paragraph bodies (matching what Microsoft Graph delivers in
// production) so the page looks correct in mock mode.
const MOCK_MESSAGES: GroupEmailMessage[] = [
  {
    id: "m1",
    direction: "inbound",
    senderName: "Modivcare Portal",
    senderEmail: "claims-noreply@modivcare.com",
    subject: "Denial — Invoice dispute",
    bodyHtml:
      "<p>Hello,</p><p>This notice confirms that <strong>Invoice INV-2026-0418-RBN has been denied in full.</strong> All four legs covered by this invoice have been reviewed and rejected for the same reason.</p><p><strong>Reason for denial:</strong> Personal Care Services (PCS) authorization was not on file for the member on the dates of service. Without an active PCS record, transportation reimbursement cannot be released.</p><p>If you believe this denial was issued in error, you may file an appeal. <strong>The appeal package must include all of the following:</strong></p><ul><li>A current, signed PCS document covering each date of service.</li><li>A completed reattestation form, signed by both the requesting agency and the member.</li><li>Driver/dispatch notes for any leg where the route deviated from the originally scheduled trip.</li></ul><p><em>Deadline: appeals must be received within 14 days of this notice. Late submissions will be rejected without further review.</em></p><p>If you have questions about the appeal process, refer to Section 4.2 of the provider manual or reply to this email and a claims specialist will follow up.</p><p>Regards,<br/>Modivcare Claims Review</p>",
    bodyPreview:
      "Hello,\n\nThis notice confirms that Invoice INV-2026-0418-RBN has been denied in full. All four legs covered by this invoice have been reviewed and rejected for the same reason.\n\nReason for denial: Personal Care Services (PCS) authorization was not on file for the member on the dates of service. Without an active PCS record, transportation reimbursement cannot be released.\n\nIf you believe this denial was issued in error, you may file an appeal. The appeal package must include all of the following:\n  - A current, signed PCS document covering each date of service.\n  - A completed reattestation form, signed by both the requesting agency and the member.\n  - Driver/dispatch notes for any leg where the route deviated from the originally scheduled trip.\n\nDeadline: appeals must be received within 14 days of this notice. Late submissions will be rejected without further review.\n\nIf you have questions about the appeal process, refer to Section 4.2 of the provider manual or reply to this email and a claims specialist will follow up.\n\nRegards,\nModivcare Claims Review",
    timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    attachments: ["denial_notice.pdf"],
    mentionedLegIds: [],
  },
  {
    id: "m2",
    direction: "outbound",
    senderName: "Danny K.",
    senderEmail: "danny@claimclear.io",
    subject: "Re: Denial — Invoice dispute",
    bodyHtml:
      "<p>Hi team,</p><p>Acknowledging receipt of the denial. We disagree with the determination on PCS grounds and will be filing a formal appeal within the 14-day window.</p><p><strong>What we're attaching now:</strong></p><ul><li>The current PCS document — active through 04/30/26 — covering all four legs of this invoice.</li><li>Driver notes for legs 2 and 3, which document a dispatcher-approved reroute around a road closure on Maple Ave.</li></ul><p>The signed reattestation form is in progress with the requesting agency. We expect to forward it by end of week — I'll send it as a follow-up so it lands inside the same conversation thread.</p><p>Please confirm receipt of this message and let us know if anything further is needed before the deadline.</p><p>Thanks,<br/>Danny</p>",
    bodyPreview:
      "Hi team,\n\nAcknowledging receipt of the denial. We disagree with the determination on PCS grounds and will be filing a formal appeal within the 14-day window.\n\nWhat we're attaching now:\n  - The current PCS document — active through 04/30/26 — covering all four legs of this invoice.\n  - Driver notes for legs 2 and 3, which document a dispatcher-approved reroute around a road closure on Maple Ave.\n\nThe signed reattestation form is in progress with the requesting agency. We expect to forward it by end of week — I'll send it as a follow-up so it lands inside the same conversation thread.\n\nPlease confirm receipt of this message and let us know if anything further is needed before the deadline.\n\nThanks,\nDanny",
    timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    attachments: ["PCS_Robinson_2026.pdf", "driver_note_reroute.png"],
    mentionedLegIds: [],
  },
  {
    id: "m3",
    direction: "inbound",
    senderName: "Modivcare Portal",
    senderEmail: "claims-noreply@modivcare.com",
    subject: "Request additional documentation",
    bodyHtml:
      "<p>Hello,</p><p>Thank you for the materials submitted on 04/26. The PCS document and driver notes have been received and uploaded to the appeal file.</p><p>Before we can move this appeal forward, we need two clarifications:</p><ol><li>Please confirm that the attached PCS is valid for the specific date of service <strong>03/30/26</strong>. The document we received references a coverage window that begins 03/15/26 — we want to make sure no gap was created by the recent reauthorization.</li><li>The signed reattestation form is still outstanding. Per policy, the appeal cannot be processed without it. If the requesting agency needs a fresh template, one is attached to the original denial notice.</li></ol><blockquote><p>Reminder: the original 14-day appeal window remains in effect. Awaiting reattestation; appeal cannot be processed without it.</p></blockquote><p>Reply with the requested confirmation and document at your earliest convenience and we'll move the file into review.</p><p>Regards,<br/>Modivcare Claims Review</p>",
    bodyPreview:
      "Hello,\n\nThank you for the materials submitted on 04/26. The PCS document and driver notes have been received and uploaded to the appeal file.\n\nBefore we can move this appeal forward, we need two clarifications:\n\n1. Please confirm that the attached PCS is valid for the specific date of service 03/30/26. The document we received references a coverage window that begins 03/15/26 — we want to make sure no gap was created by the recent reauthorization.\n2. The signed reattestation form is still outstanding. Per policy, the appeal cannot be processed without it. If the requesting agency needs a fresh template, one is attached to the original denial notice.\n\n> Reminder: the original 14-day appeal window remains in effect. Awaiting reattestation; appeal cannot be processed without it.\n\nReply with the requested confirmation and document at your earliest convenience and we'll move the file into review.\n\nRegards,\nModivcare Claims Review",
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    attachments: [],
    mentionedLegIds: [],
  },
  {
    id: "m4",
    direction: "outbound",
    senderName: "Danny K.",
    senderEmail: "danny@claimclear.io",
    subject: "Re: Request additional documentation",
    bodyHtml:
      "<p>Hi,</p><p>Thanks for the quick turn. Confirming both items below.</p><p><strong>1. PCS coverage for 03/30/26:</strong> The PCS document we attached is the current authorization, active <em>04/01/26 through 04/30/26</em>. The previous PCS that covered 03/30/26 has been re-uploaded and is attached to this reply (see <code>PCS_Robinson_2026_signed.pdf</code>). Both documents together cover the full date range under appeal.</p><p><strong>2. Reattestation form:</strong> Signed by the requesting agency and the member. Currently in routing for our internal counter-signature; <strong>ETA 04/30 EOD.</strong> I'll forward as soon as it's back, but I wanted to send the PCS clarification now so it doesn't gate the rest of the file.</p><p>Let me know if anything else is blocking review and I'll prioritize.</p><p>Thanks,<br/>Danny</p>",
    bodyPreview:
      "Hi,\n\nThanks for the quick turn. Confirming both items below.\n\n1. PCS coverage for 03/30/26: The PCS document we attached is the current authorization, active 04/01/26 through 04/30/26. The previous PCS that covered 03/30/26 has been re-uploaded and is attached to this reply (see PCS_Robinson_2026_signed.pdf). Both documents together cover the full date range under appeal.\n\n2. Reattestation form: Signed by the requesting agency and the member. Currently in routing for our internal counter-signature; ETA 04/30 EOD. I'll forward as soon as it's back, but I wanted to send the PCS clarification now so it doesn't gate the rest of the file.\n\nLet me know if anything else is blocking review and I'll prioritize.\n\nThanks,\nDanny",
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
    attachments: ["PCS_Robinson_2026_signed.pdf"],
    mentionedLegIds: [],
  },
  {
    id: "m5",
    direction: "inbound",
    senderName: "Modivcare Portal",
    senderEmail: "claims-noreply@modivcare.com",
    subject: "Reattestation reminder",
    bodyHtml:
      "<p>Hello,</p><p>This is an automated reminder that the reattestation form for the above appeal is still outstanding in our system.</p><p><strong>Status summary:</strong></p><ul><li>PCS documentation — received and verified.</li><li>Driver notes — received.</li><li>Reattestation form — <em>outstanding.</em></li></ul><p><strong>Important deadline:</strong> the appeal window expires on <em>04/30 at 23:59 ET.</em> If the signed reattestation form is not received before then, the appeal will close automatically and the original denial will stand. We will not be able to reopen the file after the cutoff.</p><p>If the form has already been sent, please ignore this notice. Otherwise, reply to this thread with the signed PDF attached and we'll process the appeal as soon as it lands.</p><p>Regards,<br/>Modivcare Claims Review</p>",
    bodyPreview:
      "Hello,\n\nThis is an automated reminder that the reattestation form for the above appeal is still outstanding in our system.\n\nStatus summary:\n  - PCS documentation — received and verified.\n  - Driver notes — received.\n  - Reattestation form — outstanding.\n\nImportant deadline: the appeal window expires on 04/30 at 23:59 ET. If the signed reattestation form is not received before then, the appeal will close automatically and the original denial will stand. We will not be able to reopen the file after the cutoff.\n\nIf the form has already been sent, please ignore this notice. Otherwise, reply to this thread with the signed PDF attached and we'll process the appeal as soon as it lands.\n\nRegards,\nModivcare Claims Review",
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    attachments: [],
    mentionedLegIds: [],
    unread: true,
  },
];

export function getMockConversations(
  legIds: { id: number; label: string }[],
): GroupConversation[] {
  const messages = MOCK_MESSAGES.map((m, i) => ({
    ...m,
    mentionedLegIds: i === 0 ? legIds : legIds.slice(0, Math.min(3, legIds.length)),
  }));
  return [
    {
      conversationId: "conv-mock-1",
      subject: "Re: Invoice dispute — denial appeal",
      status: "awaiting_their_reply" as const,
      lastActivityAt: messages[messages.length - 1].timestamp,
      messages,
    },
  ];
}

export function getMockBannerData(): ResponseBannerData | null {
  const lastMsg = MOCK_MESSAGES[MOCK_MESSAGES.length - 1];
  if (!lastMsg.unread) return null;
  return {
    senderName: lastMsg.senderName,
    subject: lastMsg.subject,
    preview: lastMsg.bodyPreview,
    timestamp: lastMsg.timestamp,
    threadAnchorId: "invoice-thread",
  };
}

export function getMockLegMentions(legLabel: string): LegMention[] {
  return [
    {
      id: "lm1",
      direction: "inbound",
      senderName: "Modivcare Portal",
      timestamp: MOCK_MESSAGES[0].timestamp,
      preview: "Invoice denial covers this leg (PCS not on file).",
    },
    {
      id: "lm2",
      direction: "outbound",
      senderName: "Danny K.",
      timestamp: MOCK_MESSAGES[1].timestamp,
      preview: "Documented driver reroute attached for this leg.",
    },
    {
      id: "lm3",
      direction: "inbound",
      senderName: "Modivcare Portal",
      timestamp: MOCK_MESSAGES[2].timestamp,
      preview:
        "Confirm PCS valid for DOS 03/30/26 — appeal blocked until reattestation.",
    },
  ];
}
