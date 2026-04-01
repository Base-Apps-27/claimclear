import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { file_url, duplicate_action } = await req.json();
  // duplicate_action: "skip" (default) or "update"
  const dupAction = duplicate_action || 'skip';

  if (!file_url) return Response.json({ error: 'file_url is required' }, { status: 400 });

  const extracted = await base44.integrations.Core.ExtractDataFromUploadedFile({
    file_url,
    json_schema: {
      type: 'object',
      description: 'A single claim row from the Job Claim Status report. Only extract rows where the first column (Conf #) is a numeric confirmation number.',
      properties: {
        conf_number: { type: 'string', description: 'Conf # - numeric confirmation number in first column (e.g. 14795240)' },
        date: { type: 'string', description: 'Date column - ISO format YYYY-MM-DD' },
        ref_number: { type: 'string', description: 'Ref # column' },
        client_number: { type: 'string', description: 'Client # column' },
        car_number: { type: 'string', description: 'Car # column' },
        error_details: { type: 'string', description: 'Details column - error description' },
        claim_status: { type: 'string', description: 'Status column - e.g. Attestation Error' },
        claim_amount: { type: 'number', description: 'Claim Amount column - dollar amount' }
      }
    }
  });

  if (extracted.status !== 'success') {
    return Response.json({ error: 'Failed to extract data', details: extracted.details }, { status: 400 });
  }

  let rows = [];
  if (Array.isArray(extracted.output)) {
    rows = extracted.output;
  } else if (extracted.output) {
    rows = [extracted.output];
  }

  const batchId = `import_${Date.now()}`;
  let created = 0;
  let skipped = 0;
  let updated = 0;
  const duplicates = [];

  for (const c of rows) {
    if (!c.conf_number) { skipped++; continue; }
    const confStr = String(c.conf_number).trim();
    if (!confStr || isNaN(Number(confStr))) { skipped++; continue; }

    const existing = await base44.entities.Claim.filter({ conf_number: confStr });

    if (existing && existing.length > 0) {
      if (dupAction === 'update') {
        // Update the existing claim with new data
        const updateData = {};
        if (c.date) updateData.date = c.date;
        if (c.ref_number) updateData.ref_number = c.ref_number;
        if (c.client_number) updateData.client_number = c.client_number;
        if (c.car_number) updateData.car_number = String(c.car_number);
        if (c.error_details) updateData.error_details = c.error_details;
        if (typeof c.claim_amount === 'number' || !isNaN(parseFloat(c.claim_amount))) {
          updateData.claim_amount = typeof c.claim_amount === 'number' ? c.claim_amount : parseFloat(c.claim_amount);
        }

        if (Object.keys(updateData).length > 0) {
          await base44.entities.Claim.update(existing[0].id, updateData);
          updated++;
        } else {
          skipped++;
        }
      } else {
        duplicates.push(confStr);
        skipped++;
      }
      continue;
    }

    await base44.entities.Claim.create({
      conf_number: confStr,
      date: c.date || null,
      ref_number: c.ref_number || '',
      client_number: c.client_number || '',
      car_number: String(c.car_number || ''),
      error_details: c.error_details || '',
      claim_amount: typeof c.claim_amount === 'number' ? c.claim_amount : parseFloat(c.claim_amount) || 0,
      status: 'New',
      outcome: 'Pending',
      import_batch: batchId
    });
    created++;
  }

  return Response.json({
    success: true,
    created,
    skipped,
    updated,
    duplicates,
    duplicate_count: duplicates.length,
    total: rows.length,
    batch_id: batchId
  });
});