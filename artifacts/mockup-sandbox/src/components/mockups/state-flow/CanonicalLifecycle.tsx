import { useEffect, useRef, useState } from "react";

const MERMAID_SOURCE = `stateDiagram-v2
    direction LR

    [*] --> pre_submit : invoice imported

    state pre_submit
    pre_submit : pre-submit\\nphase = triage / ready_to_submit\\nstatus ∈ {New, Needs Evidence, Processed}

    state in_flight
    in_flight : in-flight\\nphase = submitted\\nstatus ∈ {Portal Queued, Generating Email, Awaiting Response}

    state response_pending
    response_pending : response-pending\\nphase = response_received / reviewed\\nstatus ∈ {Ready to Review, Needs Review}

    state mas_action
    mas_action : mas-action-required\\nphase = awaiting_reattestation\\nstatus = MAS Eligible

    state awaiting_payout
    awaiting_payout : awaiting-payout (transient)\\nreattestCompletedAt set\\nphase ≠ closed

    state on_hold
    on_hold : on-hold\\nstatus = On Hold

    state closed
    closed : closed\\nphase = closed\\nstatus ∈ {Resolved, Denied, Withdrawn, Expired}

    pre_submit --> in_flight : Submit dispute
    in_flight --> response_pending : Payor reply matched
    response_pending --> mas_action : Mark MAS Eligible
    pre_submit --> mas_action : Mark MAS Eligible (bridge)
    mas_action --> awaiting_payout : POST /reattest/complete
    awaiting_payout --> closed : phase = closed
    response_pending --> closed : Resolve / Deny / Withdraw
    mas_action --> closed : Resolve (Approved)
    pre_submit --> closed : Withdraw / Expire / Non-issue
    in_flight --> closed : Withdraw
    pre_submit --> on_hold : POST /hold
    response_pending --> on_hold : POST /hold
    on_hold --> pre_submit : DELETE /hold
`;

// Action gates table — same content as docs/architecture/invoice-lifecycle-flow.md §3.
// Kept inline here so the canvas view doesn't need to fetch the markdown file.
const GATES: Array<{
  action: string;
  endpoint: string;
  gate: string;
  clientPredicate: string;
}> = [
  {
    action: "Submit dispute",
    endpoint: "POST /portal-submissions",
    gate: "All disputable legs isLegResolved + group in pre-submit",
    clientPredicate: "InvoiceGroupSubmissionGauntlet (same isLegResolved)",
  },
  {
    action: "Place on hold",
    endpoint: "POST /invoice-groups/:id/hold",
    gate: "status ∈ allowed-from-list in VALID_GROUP_STATUS_TRANSITIONS",
    clientPredicate: "Bridge UI hides button when status not in list",
  },
  {
    action: "Remove hold",
    endpoint: "DELETE /invoice-groups/:id/hold",
    gate: "status = On Hold (resumes to holdPendingFrom)",
    clientPredicate: "Hidden when status ≠ On Hold",
  },
  {
    action: "Mark MAS Eligible",
    endpoint: "POST /invoice-groups/:id/mark-mas-eligible",
    gate: "status ∈ {New, Needs Review, Awaiting Response}",
    clientPredicate: "Bridge UI hides if already MAS Eligible",
  },
  {
    action: 'Mark "wait for payor again"',
    endpoint: "POST /invoice-groups/:id/awaiting-payor-again",
    gate: "status = Needs Review AND ≥1 inbound portal_responses",
    clientPredicate: "isAwaitingPayorAgain (whats-next-derivation)",
  },
  {
    action: "Bulk-queue re-attest",
    endpoint: "POST /invoice-groups/:id/reattest/queue",
    gate: "(macro=response-pending AND status=Needs Review) OR macro=mas-action-required",
    clientPredicate: "canQueueOrCompleteReattest — must mirror server",
  },
  {
    action: "Complete re-attest",
    endpoint: "POST /invoice-groups/:id/reattest/complete",
    gate: "macro=mas-action-required AND all MAS cancels complete",
    clientPredicate: "canQueueOrCompleteReattest (same as queue)",
  },
  {
    action: "Close (Resolved/Denied/Withdrawn/Expired)",
    endpoint: "PATCH /invoice-groups/:id/status",
    gate: "status ∈ allowed-from-list, no held legs, no in-flight submissions",
    clientPredicate: "ClosureLauncher hides invalid destinations",
  },
];

function MermaidPanel() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        interface MermaidApi {
          initialize: (cfg: Record<string, unknown>) => void;
          render: (id: string, src: string) => Promise<{ svg: string }>;
        }
        const mod = (await import(
          /* @vite-ignore */ "https://esm.sh/mermaid@10.9.1?bundle" as string
        )) as { default?: MermaidApi } & MermaidApi;
        const mermaid: MermaidApi = mod.default ?? mod;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
          themeVariables: { fontSize: "14px" },
        });
        const { svg } = await mermaid.render(
          "canonical-lifecycle",
          MERMAID_SOURCE,
        );
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <pre style={{ color: "crimson", padding: 16, fontFamily: "system-ui" }}>
        Failed to render Mermaid diagram: {error}
      </pre>
    );
  }
  return <div ref={ref} style={{ width: "100%", overflow: "auto" }} />;
}

export default function CanonicalLifecycle() {
  return (
    <div
      style={{
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 24,
        background: "white",
        minHeight: "100vh",
        color: "#0f172a",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            marginBottom: 4,
            letterSpacing: "-0.01em",
          }}
        >
          Invoice lifecycle — canonical state map
        </h1>
        <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
          Source of truth at <code>docs/architecture/invoice-lifecycle-flow.md</code>.
          Every operator action below is checked against the server gate listed in
          the right-hand column. Drift here is the bug class the audit CLI
          (<code>audit-state-divergence.ts</code>) is designed to catch.
        </p>
      </header>

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          background: "#f8fafc",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>
          1 · Phase model
        </h2>
        <MermaidPanel />
      </section>

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>
          2 · Operator action gates
        </h2>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "#475569" }}>
              <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Action</th>
              <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Endpoint</th>
              <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Server gate</th>
              <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Client predicate</th>
            </tr>
          </thead>
          <tbody>
            {GATES.map((g) => (
              <tr key={g.action} style={{ verticalAlign: "top" }}>
                <td style={{ padding: "8px", borderBottom: "1px solid #f1f5f9", fontWeight: 500 }}>
                  {g.action}
                </td>
                <td
                  style={{
                    padding: "8px",
                    borderBottom: "1px solid #f1f5f9",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    color: "#334155",
                  }}
                >
                  {g.endpoint}
                </td>
                <td style={{ padding: "8px", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}>
                  {g.gate}
                </td>
                <td style={{ padding: "8px", borderBottom: "1px solid #f1f5f9", color: "#475569" }}>
                  {g.clientPredicate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
