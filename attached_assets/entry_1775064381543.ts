import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

function daysRemaining(serviceDate) {
  if (!serviceDate) return null;
  const deadline = new Date(serviceDate);
  deadline.setDate(deadline.getDate() + 30);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  return Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get all open claims
    const allClaims = await base44.asServiceRole.entities.Claim.filter({});
    const openStatuses = ['New', 'Needs Evidence', 'Generating Email', 'Ready to Review', 'Awaiting Response', 'On Hold'];
    const openClaims = allClaims.filter(c => openStatuses.includes(c.status));

    // Find expiring claims (within 10 days of 30-day deadline)
    const expiring = openClaims
      .filter(c => c.date)
      .map(c => ({ ...c, _daysLeft: daysRemaining(c.date) }))
      .filter(c => c._daysLeft !== null && c._daysLeft <= 10)
      .sort((a, b) => a._daysLeft - b._daysLeft);

    const expired = expiring.filter(c => c._daysLeft <= 0);
    const soonExpiring = expiring.filter(c => c._daysLeft > 0 && c._daysLeft <= 7);

    // Find claims that received a response (parsed reply notes from last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const allNotes = await base44.asServiceRole.entities.Note.filter({});
    const recentReplies = allNotes.filter(n =>
      n.type === 'reply_parsed' && n.created_date > oneDayAgo
    );
    const claimIdsWithReplies = [...new Set(recentReplies.map(n => n.claim_id))];
    const claimsWithReplies = allClaims.filter(c => claimIdsWithReplies.includes(c.id));

    // Get all admin users to email
    const users = await base44.asServiceRole.entities.User.filter({});
    const activeUsers = users.filter(u => u.email);
    if (activeUsers.length === 0) {
      return Response.json({ sent: false, reason: 'No active users found' });
    }

    // Status breakdown
    const newClaims = openClaims.filter(c => c.status === 'New');
    const inProgressClaims = openClaims.filter(c => ['Needs Evidence', 'Generating Email', 'Ready to Review'].includes(c.status));
    const awaitingClaims = openClaims.filter(c => c.status === 'Awaiting Response');
    const onHoldClaims = openClaims.filter(c => c.status === 'On Hold');
    const totalOpenAmount = openClaims.reduce((s, c) => s + (c.claim_amount || 0), 0);

    // Build email
    const totalAtRisk = expiring.reduce((s, c) => s + (c.claim_amount || 0), 0);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a;">
        <div style="background: linear-gradient(135deg, #dc2626 0%, #ea580c 100%); padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">⚡ Daily Claims Brief</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 13px;">${today}</p>
        </div>
        <div style="background: #fff; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 12px 12px; padding: 24px 32px;">
    `;

    // Pipeline status overview
    html += `
      <h2 style="font-size: 15px; color: #374151; margin: 0 0 10px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">📊 Pipeline Overview</h2>
      <div style="display: flex; gap: 12px; margin-bottom: 24px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
        <div style="text-align: center; flex: 1;">
          <div style="font-size: 26px; font-weight: 700; color: #1f2937;">${openClaims.length}</div>
          <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Total Open</div>
        </div>
        <div style="text-align: center; flex: 1;">
          <div style="font-size: 26px; font-weight: 700; color: #3b82f6;">${newClaims.length}</div>
          <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">New</div>
        </div>
        <div style="text-align: center; flex: 1;">
          <div style="font-size: 26px; font-weight: 700; color: #8b5cf6;">${inProgressClaims.length}</div>
          <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">In Progress</div>
        </div>
        <div style="text-align: center; flex: 1;">
          <div style="font-size: 26px; font-weight: 700; color: #a855f7;">${awaitingClaims.length}</div>
          <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Awaiting Response</div>
        </div>
        <div style="text-align: center; flex: 1;">
          <div style="font-size: 26px; font-weight: 700; color: #f59e0b;">${onHoldClaims.length}</div>
          <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">On Hold</div>
        </div>
        <div style="text-align: center; flex: 1;">
          <div style="font-size: 26px; font-weight: 700; color: #059669;">$${totalOpenAmount.toFixed(2)}</div>
          <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Total Disputed</div>
        </div>
      </div>
    `;

    // Urgency summary bar (only if there's something urgent)
    if (expiring.length > 0 || claimsWithReplies.length > 0) {
      html += `
        <div style="display: flex; gap: 16px; margin-bottom: 24px; padding: 16px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
          <div style="text-align: center; flex: 1;">
            <div style="font-size: 28px; font-weight: 700; color: #dc2626;">${expired.length}</div>
            <div style="font-size: 11px; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">Expired</div>
          </div>
          <div style="text-align: center; flex: 1;">
            <div style="font-size: 28px; font-weight: 700; color: #ea580c;">${soonExpiring.length}</div>
            <div style="font-size: 11px; color: #9a3412; text-transform: uppercase; letter-spacing: 0.5px;">Expiring Soon</div>
          </div>
          <div style="text-align: center; flex: 1;">
            <div style="font-size: 28px; font-weight: 700; color: #b91c1c;">$${totalAtRisk.toFixed(2)}</div>
            <div style="font-size: 11px; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">At Risk</div>
          </div>
          <div style="text-align: center; flex: 1;">
            <div style="font-size: 28px; font-weight: 700; color: #2563eb;">${claimsWithReplies.length}</div>
            <div style="font-size: 11px; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px;">Replies</div>
          </div>
        </div>
      `;
    }

    // Expired claims
    if (expired.length > 0) {
      html += `<h2 style="font-size: 15px; color: #dc2626; margin: 20px 0 10px; border-bottom: 2px solid #fecaca; padding-bottom: 6px;">🔥 Expired Claims (${expired.length})</h2>`;
      html += `<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">
        <tr style="background: #fef2f2; text-align: left;">
          <th style="padding: 6px 8px; border-bottom: 1px solid #fecaca;">Conf #</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fecaca;">Service Date</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fecaca;">Days Over</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fecaca;">Amount</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fecaca;">Status</th>
        </tr>`;
      for (const c of expired.slice(0, 15)) {
        html += `<tr style="border-bottom: 1px solid #f5f5f5;">
          <td style="padding: 6px 8px; font-family: monospace; font-weight: 600;">${c.conf_number}</td>
          <td style="padding: 6px 8px;">${c.date}</td>
          <td style="padding: 6px 8px; color: #dc2626; font-weight: 700;">${Math.abs(c._daysLeft)}d overdue</td>
          <td style="padding: 6px 8px;">$${(c.claim_amount || 0).toFixed(2)}</td>
          <td style="padding: 6px 8px;">${c.status}</td>
        </tr>`;
      }
      html += `</table>`;
    }

    // Expiring soon
    if (soonExpiring.length > 0) {
      html += `<h2 style="font-size: 15px; color: #ea580c; margin: 20px 0 10px; border-bottom: 2px solid #fed7aa; padding-bottom: 6px;">⚠️ Expiring Within 7 Days (${soonExpiring.length})</h2>`;
      html += `<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">
        <tr style="background: #fff7ed; text-align: left;">
          <th style="padding: 6px 8px; border-bottom: 1px solid #fed7aa;">Conf #</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fed7aa;">Service Date</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fed7aa;">Days Left</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fed7aa;">Amount</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #fed7aa;">Status</th>
        </tr>`;
      for (const c of soonExpiring.slice(0, 15)) {
        html += `<tr style="border-bottom: 1px solid #f5f5f5;">
          <td style="padding: 6px 8px; font-family: monospace; font-weight: 600;">${c.conf_number}</td>
          <td style="padding: 6px 8px;">${c.date}</td>
          <td style="padding: 6px 8px; color: #ea580c; font-weight: 700;">${c._daysLeft}d</td>
          <td style="padding: 6px 8px;">$${(c.claim_amount || 0).toFixed(2)}</td>
          <td style="padding: 6px 8px;">${c.status}</td>
        </tr>`;
      }
      html += `</table>`;
    }

    // Claims with replies
    if (claimsWithReplies.length > 0) {
      html += `<h2 style="font-size: 15px; color: #2563eb; margin: 20px 0 10px; border-bottom: 2px solid #bfdbfe; padding-bottom: 6px;">📬 New Responses Received (${claimsWithReplies.length})</h2>`;
      html += `<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">
        <tr style="background: #eff6ff; text-align: left;">
          <th style="padding: 6px 8px; border-bottom: 1px solid #bfdbfe;">Conf #</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #bfdbfe;">Amount</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #bfdbfe;">Status</th>
          <th style="padding: 6px 8px; border-bottom: 1px solid #bfdbfe;">Outcome</th>
        </tr>`;
      for (const c of claimsWithReplies.slice(0, 15)) {
        html += `<tr style="border-bottom: 1px solid #f5f5f5;">
          <td style="padding: 6px 8px; font-family: monospace; font-weight: 600;">${c.conf_number}</td>
          <td style="padding: 6px 8px;">$${(c.claim_amount || 0).toFixed(2)}</td>
          <td style="padding: 6px 8px;">${c.status}</td>
          <td style="padding: 6px 8px;">${c.outcome || 'Pending'}</td>
        </tr>`;
      }
      html += `</table>`;
    }

    // Footer note
    if (expiring.length === 0 && claimsWithReplies.length === 0) {
      html += `
        <div style="margin-top: 16px; padding: 12px 16px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0; font-size: 13px; color: #166534;">
          ✅ No urgent expiration alerts or new replies today.
        </div>
      `;
    }

    html += `</div></div>`;

    // Send to all admins
    const sendResults = [];
    for (const user of activeUsers) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: user.email,
        subject: `⚡ Daily Claims Brief — ${openClaims.length} open, ${expired.length} expired, ${claimsWithReplies.length} replies`,
        body: html,
      });
      sendResults.push(user.email);
    }

    return Response.json({
      sent: true,
      recipients: sendResults,
      summary: {
        expired: expired.length,
        expiringSoon: soonExpiring.length,
        totalAtRisk,
        repliesReceived: claimsWithReplies.length,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});