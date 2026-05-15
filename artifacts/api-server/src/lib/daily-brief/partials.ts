// Tiny formatting + HTML partials shared by the daily and weekly
// brief renderers. No SQL, no aggregation — pure presentation.
//
// CRITICAL: the money helpers in this file format an already-canonical
// dollar string from /dashboard/summary or /dashboard/insights. They do
// NOT apply the vendor-prepay (× 1.7) multiplier — the aggregator
// already bakes that into `*Exposure` / `recoveredAmount` etc., and a
// second multiplication here would double-inflate.

export function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Format a dollar string emitted by the dashboard aggregator. Inputs are
// either a canonical "1234.56" string, a null (amounts hidden), or a
// number. We never multiply.
export function money(raw: string | number | null | undefined): string {
  if (raw == null) return "—";
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function moneyPrecise(raw: string | number | null | undefined): string {
  if (raw == null) return "—";
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format a percentage value emitted by the dashboard aggregator.
// IMPORTANT: the canonical aggregator (routes/dashboard.ts) already
// returns recoveryRate as a whole-number percent (e.g. 42 means 42%,
// computed as Math.round(recovered/disputed*100)). This formatter
// must NOT multiply again — it just rounds and appends "%". Callers
// holding a 0–1 fraction must convert (×100) before calling this.
export function pct(raw: number | string | null | undefined): string {
  if (raw == null) return "—";
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

export function deltaArrow(curr: number, prior: number): { arrow: string; color: string; label: string } {
  if (prior === 0 && curr === 0) return { arrow: "→", color: "#666", label: "no change" };
  if (prior === 0) return { arrow: "▲", color: "#137a3f", label: "new" };
  const pctChange = (curr - prior) / Math.abs(prior);
  if (Math.abs(pctChange) < 0.01) return { arrow: "→", color: "#666", label: "flat" };
  if (pctChange > 0) return { arrow: "▲", color: "#137a3f", label: `+${Math.round(pctChange * 100)}%` };
  return { arrow: "▼", color: "#a4262c", label: `${Math.round(pctChange * 100)}%` };
}

export interface KpiTile {
  label: string;
  value: string;
  hint?: string;
  emphasis?: "default" | "warn" | "good";
}

// Renders a row of KPI tiles. Inline styles only (email-safe).
export function kpiStrip(tiles: KpiTile[]): string {
  const cells = tiles
    .map((t) => {
      const accent =
        t.emphasis === "warn"
          ? "#a4262c"
          : t.emphasis === "good"
          ? "#137a3f"
          : "#1a1a1a";
      return `
        <td style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;vertical-align:top;width:${Math.floor(100 / tiles.length)}%;">
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${escapeHtml(t.label)}</div>
          <div style="font-size:22px;font-weight:600;color:${accent};line-height:1.2;">${escapeHtml(t.value)}</div>
          ${t.hint ? `<div style="font-size:11px;color:#888;margin-top:4px;">${escapeHtml(t.hint)}</div>` : ""}
        </td>
      `;
    })
    .join('<td style="width:8px;"></td>');
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;margin:16px 0;"><tr>${cells}</tr></table>`;
}

export function sectionHeader(title: string, subtitle?: string): string {
  return `
    <div style="margin:24px 0 8px;">
      <h2 style="font-size:14px;color:#1a1a1a;margin:0;text-transform:uppercase;letter-spacing:.05em;">${escapeHtml(title)}</h2>
      ${subtitle ? `<div style="font-size:12px;color:#666;margin-top:2px;">${escapeHtml(subtitle)}</div>` : ""}
    </div>
  `;
}

export interface SimpleRow {
  cells: string[];
  href?: string | null;
}

export function simpleTable(headers: string[], rows: SimpleRow[]): string {
  if (rows.length === 0) {
    return `<div style="font-size:13px;color:#888;padding:8px 0;">Nothing to show.</div>`;
  }
  const head = headers
    .map(
      (h) =>
        `<th style="text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.04em;padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(h)}</th>`,
    )
    .join("");
  const body = rows
    .map((r) => {
      const cells = r.cells
        .map(
          (c, i) =>
            `<td style="font-size:13px;color:#1a1a1a;padding:8px 10px;border-bottom:1px solid #f1f1f1;${i === 0 ? "" : "color:#444;"}">${c}</td>`,
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:8px 0;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// Wins hero — green celebratory block placed at the very top of the
// daily brief and weekly digest so the operator opens the email on a
// success summary instead of a problem list. All values come verbatim
// from the canonical aggregator — no additional math, no multiplier.
// `cadenceLabel` distinguishes "Yesterday" (daily brief) from
// "This week" (weekly digest); the rest of the copy is identical so
// the two surfaces feel like one celebration system.
export interface WinsHeroInput {
  cadenceLabel: string; // e.g. "This week so far" or "Yesterday"
  approvedCount: number;
  partiallyApprovedCount: number;
  recoveredAmount: string | number | null | undefined;
  confirmedAmount?: string | number | null | undefined;
  netChange?: string | number | null | undefined;
  recoveryRate?: number | null | undefined;
}

export function winsHero(input: WinsHeroInput): string {
  const wins = input.approvedCount + input.partiallyApprovedCount;
  const recoveredNum =
    input.recoveredAmount == null
      ? 0
      : typeof input.recoveredAmount === "number"
      ? input.recoveredAmount
      : parseFloat(input.recoveredAmount) || 0;
  const netChangeNum =
    input.netChange == null
      ? null
      : typeof input.netChange === "number"
      ? input.netChange
      : parseFloat(input.netChange);
  // No wins AND no recovered $ → render a friendly "still hunting"
  // line instead of an empty green block, so the celebration is honest.
  if (wins === 0 && recoveredNum <= 0) {
    return `
      <div style="border:1px solid #d1fae5;background:#ecfdf5;border-radius:8px;padding:14px 16px;margin:16px 0;">
        <div style="font-size:11px;color:#047857;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">${escapeHtml(input.cadenceLabel)} · wins</div>
        <div style="font-size:15px;color:#065f46;margin-top:6px;line-height:1.5;">
          No new approvals to celebrate yet — let's go land some today.
        </div>
      </div>
    `;
  }
  const headlineParts: string[] = [];
  if (wins > 0) {
    const winsLabel = wins === 1 ? "invoice approved" : "invoices approved";
    headlineParts.push(`<strong>${wins}</strong> ${winsLabel}`);
  }
  if (recoveredNum > 0) {
    headlineParts.push(`<strong>${escapeHtml(money(recoveredNum))}</strong> recovered`);
  }
  if (
    input.recoveryRate != null &&
    Number.isFinite(input.recoveryRate) &&
    (wins > 0 || recoveredNum > 0)
  ) {
    headlineParts.push(`<strong>${escapeHtml(pct(input.recoveryRate))}</strong> recovery rate`);
  }
  const subParts: string[] = [];
  if (input.partiallyApprovedCount > 0 && input.approvedCount > 0) {
    subParts.push(
      `${input.approvedCount} fully approved · ${input.partiallyApprovedCount} partially`,
    );
  }
  if (input.confirmedAmount != null) {
    const confirmedNum =
      typeof input.confirmedAmount === "number"
        ? input.confirmedAmount
        : parseFloat(input.confirmedAmount) || 0;
    if (confirmedNum > 0) {
      subParts.push(`${money(confirmedNum)} re-attested by payor`);
    }
  }
  if (netChangeNum != null && Number.isFinite(netChangeNum) && netChangeNum !== 0) {
    const sign = netChangeNum > 0 ? "▲" : "▼";
    const color = netChangeNum > 0 ? "#047857" : "#a16207";
    subParts.push(
      `<span style="color:${color};font-weight:600;">${sign} ${escapeHtml(money(Math.abs(netChangeNum)))}</span> vs prior period`,
    );
  }
  return `
    <div style="border:1px solid #a7f3d0;background:linear-gradient(180deg,#ecfdf5 0%,#f0fdf4 100%);border-radius:8px;padding:16px 18px;margin:16px 0;">
      <div style="font-size:11px;color:#047857;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">${escapeHtml(input.cadenceLabel)} · wins</div>
      <div style="font-size:18px;color:#065f46;margin-top:6px;line-height:1.5;">
        ${headlineParts.join(' <span style="color:#10b981;">·</span> ')}
      </div>
      ${subParts.length > 0 ? `<div style="font-size:12px;color:#047857;margin-top:6px;line-height:1.5;">${subParts.join(' · ')}</div>` : ""}
    </div>
  `;
}

export function paragraph(text: string): string {
  return `<p style="font-size:13px;color:#444;margin:8px 0;line-height:1.5;">${escapeHtml(text)}</p>`;
}
