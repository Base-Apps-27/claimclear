import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // Auth: require authenticated user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ACTION: Get pending submissions for the bot to process
    if (action === 'poll') {
      const pending = await base44.asServiceRole.entities.PortalSubmission.filter(
        { status: 'pending' }, '-created_date', 20
      );
      return Response.json({ submissions: pending });
    }

    // ACTION: Mark a submission as in_progress (bot is working on it)
    if (action === 'claim') {
      const { submission_id } = body;
      if (!submission_id) return Response.json({ error: 'submission_id required' }, { status: 400 });
      
      const updated = await base44.asServiceRole.entities.PortalSubmission.update(submission_id, {
        status: 'in_progress',
        attempts: (body.current_attempts || 0) + 1,
      });
      return Response.json({ success: true, submission: updated });
    }

    // ACTION: Report success — bot submitted to portal
    if (action === 'complete') {
      const { submission_id, portal_ticket_id } = body;
      if (!submission_id) return Response.json({ error: 'submission_id required' }, { status: 400 });

      const updated = await base44.asServiceRole.entities.PortalSubmission.update(submission_id, {
        status: 'submitted',
        portal_ticket_id: portal_ticket_id || '',
        submitted_at: new Date().toISOString(),
      });

      // Also update the claim status
      const submission = await base44.asServiceRole.entities.PortalSubmission.filter({ id: submission_id });
      if (submission.length > 0) {
        await base44.asServiceRole.entities.Claim.update(submission[0].claim_id, {
          status: 'Awaiting Response',
          dispute_email_sent: true,
          dispute_email_sent_at: new Date().toISOString(),
        });
        await base44.asServiceRole.entities.Note.create({
          claim_id: submission[0].claim_id,
          type: 'email_sent',
          content: `Portal ticket submitted successfully${portal_ticket_id ? ` — Ticket ID: ${portal_ticket_id}` : ''}`,
          author: 'Portal Bot',
        });
      }

      return Response.json({ success: true, submission: updated });
    }

    // ACTION: Report failure
    if (action === 'fail') {
      const { submission_id, error_message } = body;
      if (!submission_id) return Response.json({ error: 'submission_id required' }, { status: 400 });

      const updated = await base44.asServiceRole.entities.PortalSubmission.update(submission_id, {
        status: 'failed',
        error_message: error_message || 'Unknown error',
      });
      return Response.json({ success: true, submission: updated });
    }

    // ACTION: Create a new portal submission from a claim
    if (action === 'create') {
      const { claim_id, issue_type, subject, description_html, requester_email, transportation_provider_name, phone_number, invoice_number, gps_breadcrumbs_available, dispute_reason } = body;
      if (!claim_id) return Response.json({ error: 'claim_id required' }, { status: 400 });

      // Fetch claim data
      const claims = await base44.asServiceRole.entities.Claim.filter({ id: claim_id });
      if (claims.length === 0) return Response.json({ error: 'Claim not found' }, { status: 404 });
      const claim = claims[0];

      // Build attachment list from evidence files
      let attachmentUrls = [];
      try {
        if (claim.evidence_files) {
          const files = JSON.parse(claim.evidence_files);
          attachmentUrls = files.map(f => f.url || f).filter(Boolean);
        }
      } catch {}

      // Get workflow history
      let workflowHistory = '';
      try { workflowHistory = claim.workflow_progress || ''; } catch {}

      const submission = await base44.asServiceRole.entities.PortalSubmission.create({
        claim_id: claim.id,
        status: 'pending',
        issue_type: issue_type || '',
        subject: subject || `Dispute - ${claim.conf_number}`,
        requester_email: requester_email || '',
        transportation_provider_name: transportation_provider_name || '',
        phone_number: phone_number || '',
        invoice_number: invoice_number || claim.ref_number || '',
        gps_breadcrumbs_available: gps_breadcrumbs_available || '',
        description_html: description_html || '',
        attachment_urls: JSON.stringify(attachmentUrls),
        conf_number: claim.conf_number || '',
        service_date: claim.date || '',
        ref_number: claim.ref_number || '',
        client_number: claim.client_number || '',
        car_number: claim.car_number || '',
        claim_amount: claim.claim_amount || 0,
        error_type_name: claim.error_type_name || '',
        error_details: claim.error_details || '',
        dispute_reason: dispute_reason || '',
        evidence_notes: claim.evidence_notes || '',
        evidence_files: claim.evidence_files || '[]',
        workflow_history: workflowHistory,
        attempts: 0,
      });

      // Update claim status
      await base44.asServiceRole.entities.Claim.update(claim.id, {
        status: 'Generating Email', // Reuse this status for "submission queued"
      });

      return Response.json({ success: true, submission });
    }

    // ACTION: List all submissions with optional status filter
    if (action === 'list') {
      const { status: filterStatus } = body;
      const filter = filterStatus ? { status: filterStatus } : {};
      const submissions = await base44.asServiceRole.entities.PortalSubmission.filter(filter, '-created_date', 100);
      return Response.json({ submissions });
    }

    return Response.json({ error: 'Unknown action. Use: poll, claim, complete, fail, create, list' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});