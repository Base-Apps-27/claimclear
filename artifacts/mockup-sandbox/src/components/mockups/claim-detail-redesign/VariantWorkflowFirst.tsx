import React, { useState } from "react";
import "./_group.css";
import {
  AlertTriangle,
  TreeDeciduous,
  CheckCircle2,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Send,
  PauseCircle,
  Paperclip,
  Activity,
  Edit2,
  CircleDashed,
  MessageSquarePlus,
  Play,
  ShieldAlert,
  Info,
  XCircle,
} from "lucide-react";
import {
  claim,
  evidenceItems,
  auditLog,
  StatusPill,
  PresenceAvatars,
  validStatuses,
  InvoiceContextBar,
  Section,
} from "./_shared";

const stages = [
  { key: "triage", label: "Triage", desc: "Identify the error" },
  { key: "build", label: "Build Case", desc: "Gather evidence" },
  { key: "submit", label: "Submit", desc: "Send to payer" },
  { key: "await", label: "Await Response", desc: "Track payer reply" },
  { key: "resolve", label: "Resolve", desc: "Close the loop" },
];
const currentStage = "triage";

export function VariantWorkflowFirst() {
  const [overrideOpen, setOverrideOpen] = useState(true);
  const [activeOverride, setActiveOverride] = useState<string | null>(
    "Mark as Payer Denied",
  );
  const [pendingStatus, setPendingStatus] = useState<string>(claim.status);
  const statusDirty = pendingStatus !== claim.status;

  return (
    <div className="cc-scope p-6 space-y-5" style={{ width: "100%" }}>
      <InvoiceContextBar />

      {/* HEADER STRIP */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold mono">{claim.confNumber}</h2>
          <StatusPill status={claim.status} />
          <span className="cc-badge cc-badge-secondary">{claim.outcome}</span>
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars />
          <button className="cc-btn cc-btn-ghost">
            <Edit2 className="w-4 h-4" />
            Edit
          </button>
        </div>
      </div>

      {/* STAGE STEPPER */}
      <div className="cc-card overflow-hidden">
        <div className="flex">
          {stages.map((s, i) => {
            const idx = stages.findIndex((x) => x.key === currentStage);
            const state = i < idx ? "done" : i === idx ? "active" : "todo";
            return (
              <div
                key={s.key}
                className="flex-1 px-3 py-2.5 flex items-center gap-2.5 relative"
                style={{
                  background:
                    state === "active"
                      ? "var(--cc-blue-bg)"
                      : state === "done"
                        ? "var(--cc-card)"
                        : "var(--cc-muted)",
                  color:
                    state === "active"
                      ? "var(--cc-blue-fg)"
                      : state === "todo"
                        ? "var(--cc-muted-fg)"
                        : "var(--cc-fg)",
                  borderRight:
                    i < stages.length - 1
                      ? "1px solid var(--cc-border)"
                      : "none",
                }}
              >
                {state === "done" ? (
                  <CheckCircle2
                    className="w-4 h-4 flex-shrink-0"
                    style={{ color: "var(--cc-success)" }}
                  />
                ) : state === "active" ? (
                  <CircleDashed className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <div
                    className="w-4 h-4 rounded-full border flex-shrink-0"
                    style={{ borderColor: "var(--cc-border)" }}
                  />
                )}
                <div className="min-w-0">
                  <div
                    className="text-[10px] uppercase tracking-wide"
                    style={{ opacity: 0.65 }}
                  >
                    Step {i + 1}
                  </div>
                  <div className="text-xs font-semibold truncate">
                    {s.label}
                  </div>
                </div>
                {i < stages.length - 1 && (
                  <ChevronRight
                    className="w-3 h-3 absolute -right-1.5 top-1/2 -translate-y-1/2 z-10"
                    style={{
                      color: "var(--cc-muted-fg)",
                      background: "var(--cc-bg)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* MAIN COLUMN: Informational Only */}
        <div className="col-span-2 space-y-5">
          <Section title="Claim Details">
            <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
              <Field label="Conf #" value={claim.confNumber} mono />
              <Field label="Date" value={claim.date} />
              <Field label="Client #" value={claim.clientNumber} />
              <Field label="Car #" value={claim.carNumber} />
              <Field label="Amount" value={claim.claimAmount} />
              <Field label="Payor Email" value={claim.payorEmail} />

              <div className="col-span-2">
                <div
                  className="text-xs"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Ref #
                </div>
                <div className="mt-1 mono font-medium">{claim.refNumber}</div>
              </div>

              <div className="col-span-2">
                <div
                  className="text-xs"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Error Details
                </div>
                <div className="mt-1.5 mb-2">
                  <span
                    className="cc-badge"
                    style={{
                      background: "var(--cc-purple-bg)",
                      color: "var(--cc-purple-fg)",
                      border: "none",
                    }}
                  >
                    Multiple errors detected
                  </span>
                </div>
                <ul className="space-y-1">
                  {claim.errorDetails.split(";").map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span style={{ color: "var(--cc-muted-fg)" }}>
                        {i + 1}.
                      </span>
                      <span>{p.trim()}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="col-span-2">
                <div
                  className="text-xs"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Error Type
                </div>
                <div
                  className="mt-1.5 text-sm font-medium flex items-center gap-2"
                  style={{ color: "var(--cc-amber-fg)" }}
                >
                  <AlertTriangle className="w-4 h-4" /> Unassigned
                </div>
              </div>
            </div>
          </Section>

          <Section
            title={
              <>
                Dispute Workflow{" "}
                <span
                  className="text-xs font-normal ml-2"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Decision tree
                </span>
              </>
            }
            icon={<TreeDeciduous className="w-4 h-4" />}
          >
            <div
              className="rounded p-4"
              style={{
                background: "var(--cc-muted)",
                border: "1px solid var(--cc-border)",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="cc-badge cc-badge-secondary">Step 1</span>
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Identify the dispute path
                </span>
              </div>
              <div className="font-semibold text-base mb-4">
                What type of error is this?
              </div>

              {/* Branch answer choices: includes the rare exits IN-workflow */}
              <div className="space-y-2">
                <div
                  className="text-[10px] uppercase tracking-wide font-semibold mb-1"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Contestable error
                </div>
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium">
                  Mileage mismatch
                </div>
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium">
                  Outside authorization window
                </div>
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium">
                  Duplicate charge
                </div>

                <div
                  className="text-[10px] uppercase tracking-wide font-semibold mb-1 mt-3"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Not actually contestable
                </div>
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium flex items-center justify-between">
                  <div>
                    <div>Withdraw — Not Contestable</div>
                    <div
                      className="text-[11px] mt-0.5 font-normal"
                      style={{ color: "var(--cc-muted-fg)" }}
                    >
                      No clear path to recover the dollars
                    </div>
                  </div>
                  <ChevronRight
                    className="w-4 h-4"
                    style={{ color: "var(--cc-muted-fg)" }}
                  />
                </div>
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium flex items-center justify-between">
                  <div>
                    <div>Mark Non-Issue</div>
                    <div
                      className="text-[11px] mt-0.5 font-normal"
                      style={{ color: "var(--cc-muted-fg)" }}
                    >
                      No dispute necessary — flagged in error
                    </div>
                  </div>
                  <ChevronRight
                    className="w-4 h-4"
                    style={{ color: "var(--cc-muted-fg)" }}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section
            title={
              <>
                Evidence{" "}
                <span className="cc-badge cc-badge-secondary ml-2">
                  {evidenceItems.length}
                </span>
              </>
            }
            icon={<Paperclip className="w-4 h-4" />}
          >
            <div className="space-y-2">
              {evidenceItems.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded p-3 text-sm flex items-start justify-between"
                  style={{
                    background: "var(--cc-bg)",
                    border: "1px solid var(--cc-border)",
                  }}
                >
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      <CheckCircle2
                        className="w-4 h-4"
                        style={{ color: "var(--cc-success)" }}
                      />{" "}
                      {ev.type}
                    </div>
                    <div
                      className="text-xs mt-1"
                      style={{ color: "var(--cc-muted-fg)" }}
                    >
                      {ev.note}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--cc-muted-fg)" }}
                    >
                      by {ev.by} · {ev.at}
                    </span>
                  </div>
                </div>
              ))}
              {evidenceItems.length === 0 && (
                <div
                  className="text-sm text-center py-4"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  No evidence collected yet.
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* RIGHT RAIL: Workflow-First Hierarchy */}
        <div className="col-span-1 space-y-5">
          {/* PRIMARY CTA */}
          <div
            className="cc-card overflow-hidden"
            style={{ position: "sticky", top: "1.25rem" }}
          >
            <div
              className="p-5"
              style={{
                background: "var(--cc-blue-bg)",
                borderBottom: "1px solid var(--cc-blue-border)",
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className="text-xs uppercase font-bold tracking-wider"
                  style={{ color: "var(--cc-blue-fg)" }}
                >
                  Recommended Next
                </div>
                <div
                  className="text-[10px] font-semibold"
                  style={{ color: "var(--cc-blue-fg)", opacity: 0.7 }}
                >
                  STEP 1 OF 5
                </div>
              </div>
              <button className="cc-btn cc-btn-primary w-full justify-center text-base py-2.5 shadow-sm">
                <Play className="w-4 h-4 mr-1" /> Triage this claim
              </button>
              <div
                className="text-xs text-center mt-3"
                style={{ color: "var(--cc-blue-fg)", opacity: 0.8 }}
              >
                Confirm dispute reason and prepare the case
              </div>
            </div>
          </div>

          {/* META-ACTIONS: three quiet, equal-weight cards */}
          <div className="space-y-2">
            <div
              className="text-[10px] uppercase font-semibold tracking-wide px-1"
              style={{ color: "var(--cc-muted-fg)" }}
            >
              While you're here
            </div>
            <MetaActionCard
              icon={<MessageSquarePlus className="w-4 h-4" />}
              label="Add note"
              desc="Leave context for teammates without changing claim state."
            />
            <MetaActionCard
              icon={<PauseCircle className="w-4 h-4" />}
              label="Place on hold"
              desc="Pause the workflow while you wait on info from the driver or member."
            />
            <MetaActionCard
              icon={<Edit2 className="w-4 h-4" />}
              label="Edit details"
              desc="Fix typos in conf #, ref #, amount, or payor email."
            />
          </div>

          {/* OVERRIDE WORKFLOW DISCLOSURE */}
          <div
            className="cc-card overflow-hidden"
            style={{ borderColor: "var(--cc-amber-border)" }}
          >
            <button
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold transition-colors"
              onClick={() => setOverrideOpen(!overrideOpen)}
              style={{
                background: overrideOpen
                  ? "var(--cc-amber-bg)"
                  : "var(--cc-card)",
                color: "var(--cc-amber-fg)",
                borderBottom: overrideOpen
                  ? "1px solid var(--cc-amber-border)"
                  : "none",
              }}
            >
              <span className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                Override workflow
              </span>
              {overrideOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {overrideOpen && (
              <div className="p-4 space-y-4">
                {/* Preamble */}
                <div
                  className="rounded p-3 flex gap-2 text-xs"
                  style={{
                    background: "var(--cc-amber-bg)",
                    border: "1px solid var(--cc-amber-border)",
                    color: "var(--cc-amber-fg)",
                  }}
                >
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    These actions skip the dispute workflow. Use them only when
                    the workflow can't reach the right outcome.
                  </div>
                </div>

                {/* Manual status */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div
                      className="text-[10px] uppercase font-semibold tracking-wide"
                      style={{ color: "var(--cc-muted-fg)" }}
                    >
                      Manual status
                    </div>
                    {statusDirty && (
                      <span
                        className="cc-badge"
                        style={{
                          background: "var(--cc-card)",
                          color: "var(--cc-amber-fg)",
                          border: "1px solid var(--cc-amber-border)",
                        }}
                      >
                        Reason required
                      </span>
                    )}
                  </div>
                  <div
                    className="rounded transition-all"
                    style={{
                      border: statusDirty
                        ? "1px solid var(--cc-amber-border)"
                        : "1px solid transparent",
                      background: statusDirty
                        ? "var(--cc-amber-bg)"
                        : "transparent",
                    }}
                  >
                    <div className="p-2">
                      <select
                        className="cc-select w-full text-sm font-medium"
                        value={pendingStatus}
                        onChange={(e) => setPendingStatus(e.target.value)}
                      >
                        {validStatuses.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    {statusDirty && (
                      <div className="px-2.5 pb-2.5 pt-0 space-y-2">
                        <div
                          className="text-[11px]"
                          style={{ color: "var(--cc-muted-fg)" }}
                        >
                          Changing from{" "}
                          <span className="font-semibold">
                            {claim.status}
                          </span>{" "}
                          →{" "}
                          <span
                            className="font-semibold"
                            style={{ color: "var(--cc-amber-fg)" }}
                          >
                            {pendingStatus}
                          </span>
                        </div>
                        <label
                          className="text-[11px] font-semibold flex items-center gap-1.5"
                          style={{ color: "var(--cc-amber-fg)" }}
                        >
                          <ShieldAlert className="w-3 h-3" />
                          Why are you overriding the workflow?
                        </label>
                        <textarea
                          className="cc-input text-xs"
                          rows={2}
                          placeholder="Required — this lands in the audit log alongside your name."
                        />
                        <div className="flex items-center justify-between gap-2">
                          <button
                            className="cc-btn cc-btn-sm cc-btn-ghost"
                            onClick={() => setPendingStatus(claim.status)}
                          >
                            <XCircle className="w-3 h-3" /> Cancel
                          </button>
                          <button
                            className="cc-btn cc-btn-sm"
                            style={{
                              background: "var(--cc-amber-fg)",
                              color: "white",
                              borderColor: "var(--cc-amber-fg)",
                            }}
                          >
                            Confirm override
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Manual outcomes */}
                <div className="space-y-1.5">
                  <div
                    className="text-[10px] uppercase font-semibold tracking-wide"
                    style={{ color: "var(--cc-muted-fg)" }}
                  >
                    Manual outcome
                  </div>
                  <div className="space-y-1.5">
                    <OverrideRow
                      label="Mark as Approved"
                      tone="success"
                      active={activeOverride === "Mark as Approved"}
                      onSelect={() => setActiveOverride("Mark as Approved")}
                    />
                    <OverrideRow
                      label="Mark as Partially Approved"
                      tone="success"
                      active={activeOverride === "Mark as Partially Approved"}
                      onSelect={() =>
                        setActiveOverride("Mark as Partially Approved")
                      }
                    />
                    <OverrideRow
                      label="Mark as Payer Denied"
                      tone="danger"
                      active={activeOverride === "Mark as Payer Denied"}
                      onSelect={() => setActiveOverride("Mark as Payer Denied")}
                      reasonInput
                    />
                  </div>
                </div>

                {/* Withdraw / Non-issue */}
                <div className="space-y-1.5">
                  <div
                    className="text-[10px] uppercase font-semibold tracking-wide"
                    style={{ color: "var(--cc-muted-fg)" }}
                  >
                    Close without disputing
                  </div>
                  <div className="space-y-1.5">
                    <OverrideRow
                      label="Withdraw — Not Contestable"
                      desc="No clear path to recover the dollars"
                      active={
                        activeOverride === "Withdraw — Not Contestable"
                      }
                      onSelect={() =>
                        setActiveOverride("Withdraw — Not Contestable")
                      }
                    />
                    <OverrideRow
                      label="Withdraw — Accepted Loss"
                      desc="Business decision to accept"
                      active={activeOverride === "Withdraw — Accepted Loss"}
                      onSelect={() =>
                        setActiveOverride("Withdraw — Accepted Loss")
                      }
                    />
                    <OverrideRow
                      label="Mark Non-Issue"
                      desc="No dispute necessary"
                      active={activeOverride === "Mark Non-Issue"}
                      onSelect={() => setActiveOverride("Mark Non-Issue")}
                    />
                  </div>
                </div>

                {/* Manual queue for portal */}
                <div className="space-y-1.5">
                  <div
                    className="text-[10px] uppercase font-semibold tracking-wide"
                    style={{ color: "var(--cc-muted-fg)" }}
                  >
                    Submission
                  </div>
                  <OverrideRow
                    icon={<Send className="w-3.5 h-3.5" />}
                    label="Queue for portal"
                    desc="Force a portal submission outside the normal flow"
                    active={activeOverride === "Queue for portal"}
                    onSelect={() => setActiveOverride("Queue for portal")}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Activity Feed (read-only) */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Activity Feed
            </div>
            <div className="space-y-4">
              {auditLog.slice(0, 4).map((log) => (
                <div key={log.id} className="relative pl-4">
                  <div
                    className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--cc-border)" }}
                  />
                  <div className="text-sm font-medium leading-tight">
                    {log.action}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "var(--cc-muted-fg)" }}
                  >
                    {log.actor} · {log.at}
                  </div>
                </div>
              ))}
              <button
                className="text-xs font-medium w-full text-center py-1 hover:underline"
                style={{ color: "var(--cc-primary)" }}
              >
                View all activity
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
        {label}
      </div>
      <div className={`text-sm mt-0.5 font-medium ${mono ? "mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function MetaActionCard({
  icon,
  label,
  desc,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <button className="cc-card w-full p-3 text-left flex gap-3 items-start hover:bg-[var(--cc-muted)] transition-colors">
      <div
        className="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center"
        style={{
          background: "var(--cc-muted)",
          color: "var(--cc-fg)",
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">{label}</div>
        <div
          className="text-xs mt-0.5 leading-snug"
          style={{ color: "var(--cc-muted-fg)" }}
        >
          {desc}
        </div>
      </div>
    </button>
  );
}

function OverrideRow({
  icon,
  label,
  desc,
  tone,
  active,
  reasonInput,
  onSelect,
}: {
  icon?: React.ReactNode;
  label: string;
  desc?: string;
  tone?: "success" | "danger";
  active?: boolean;
  reasonInput?: boolean;
  onSelect?: () => void;
}) {
  const labelColor =
    tone === "success"
      ? "var(--cc-success)"
      : tone === "danger"
        ? "var(--cc-red-fg)"
        : "var(--cc-fg)";

  return (
    <div
      className="rounded transition-all"
      style={{
        border: active
          ? "1px solid var(--cc-amber-border)"
          : "1px solid transparent",
        background: active ? "var(--cc-amber-bg)" : "transparent",
      }}
    >
      <button
        onClick={onSelect}
        className="w-full text-left px-2.5 py-2 rounded hover:bg-white flex items-start gap-2"
      >
        {icon && (
          <span
            className="mt-0.5 flex-shrink-0"
            style={{ color: "var(--cc-muted-fg)" }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium" style={{ color: labelColor }}>
            {label}
          </div>
          {desc && (
            <div
              className="text-[11px] mt-0.5"
              style={{ color: "var(--cc-muted-fg)" }}
            >
              {desc}
            </div>
          )}
        </div>
        {active && reasonInput && (
          <span
            className="cc-badge"
            style={{
              background: "var(--cc-card)",
              color: "var(--cc-amber-fg)",
              border: "1px solid var(--cc-amber-border)",
            }}
          >
            Reason required
          </span>
        )}
      </button>

      {active && (
        <div className="px-2.5 pb-2.5 pt-0 space-y-2">
          <label
            className="text-[11px] font-semibold flex items-center gap-1.5"
            style={{ color: "var(--cc-amber-fg)" }}
          >
            <ShieldAlert className="w-3 h-3" />
            Why are you overriding the workflow?
          </label>
          <textarea
            className="cc-input text-xs"
            rows={2}
            placeholder="Required — this lands in the audit log alongside your name."
            defaultValue={
              label === "Mark as Payer Denied"
                ? "MAS adjudicator denial received via email; no further appeal possible per rate code R-12."
                : ""
            }
          />
          <div className="flex items-center justify-between gap-2">
            <button
              className="cc-btn cc-btn-sm cc-btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onSelect && onSelect();
              }}
            >
              <XCircle className="w-3 h-3" /> Cancel
            </button>
            <button
              className="cc-btn cc-btn-sm"
              style={{
                background: "var(--cc-amber-fg)",
                color: "white",
                borderColor: "var(--cc-amber-fg)",
              }}
            >
              Confirm override
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
