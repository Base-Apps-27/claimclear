import type { GroupConversation, GroupEmailMessage } from "./group-communication-thread";
import type { ResponseBannerData } from "./response-received-banner";
import type { LegMention } from "./leg-communication-mentions";

const MOCK_MESSAGES: GroupEmailMessage[] = [
  {
    id: "m1",
    direction: "inbound",
    senderName: "Modivcare Portal",
    senderEmail: "claims-noreply@modivcare.com",
    subject: "Denial — Invoice dispute",
    bodyHtml:
      "<p>Invoice denied in full.</p><p><strong>Reason:</strong> PCS not on file for any of the four legs covered by this invoice.</p><p>Appeal must include:</p><ul><li>Current PCS document</li><li>Reattestation form</li></ul><p>Deadline: <em>14 days from this notice.</em></p>",
    bodyPreview:
      "Invoice denied in full. Reason: PCS not on file for any of the four legs covered by this invoice.",
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
      "<p>Acknowledged. PCS is on file through 04/30/26 and will be re-attached.</p><p>Reattestation form pending — will follow up by EOW.</p><p><strong>Note:</strong> Legs 2 and 3 had a documented driver reroute; attaching driver note as well.</p>",
    bodyPreview:
      "Acknowledged. PCS is on file through 04/30/26 and will be re-attached.",
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
      "<p>Thank you. Please confirm PCS is valid for date of service 03/30/26 and provide signed reattestation form.</p><blockquote><p>Awaiting reattestation; appeal cannot be processed without it.</p></blockquote>",
    bodyPreview:
      "Thank you. Please confirm PCS is valid for date of service 03/30/26 and provide signed reattestation form.",
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
      "<p>PCS confirmed active through 04/30/26 — uploading signed copy now.</p><p>Reattestation in process; <strong>ETA Apr 30.</strong></p>",
    bodyPreview:
      "PCS confirmed active through 04/30/26 — uploading signed copy now.",
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
      "<p>Reattestation still pending.</p><p><strong>Reminder:</strong> appeal window expires <em>Apr 30 at 23:59.</em></p>",
    bodyPreview:
      "Reattestation still pending. Reminder: appeal window expires Apr 30 at 23:59.",
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
