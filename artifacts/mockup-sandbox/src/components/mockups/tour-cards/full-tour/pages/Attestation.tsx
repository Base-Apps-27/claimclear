import React from "react";
import { ExternalLink } from "lucide-react";
import { T } from "../tokens";

const ROWS = [
  { id: "G-4118", trips: 4, owed: "$612.40",  age: "1d" },
  { id: "G-4126", trips: 2, owed: "$284.00",  age: "1d" },
  { id: "G-4131", trips: 7, owed: "$1,094.20", age: "2d" },
  { id: "G-4145", trips: 3, owed: "$372.80",  age: "2d" },
  { id: "G-4150", trips: 1, owed: "$148.00",  age: "3d" },
  { id: "G-4163", trips: 5, owed: "$711.50",  age: "3d" },
  { id: "G-4172", trips: 2, owed: "$298.40",  age: "4d" },
];

export function Attestation() {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>
            Attestation Queue
          </h1>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            7 groups owed off-system · $3,521 in flight
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ backgroundColor: T.AMBER_BG, border: `1px solid ${T.AMBER_BD}` }}>
          <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: T.AMBER_FG }} />
          <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.AMBER_FG }}>Owed off-system: 7</span>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col" style={{ borderColor: T.HAIRLINE }}>
        <div className="grid grid-cols-[100px_80px_120px_80px_1fr_120px] gap-3 px-3 py-2 border-b text-[10px] uppercase tracking-wider font-semibold" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50, color: T.SLATE_MUTED }}>
          <span>Group</span><span>Trips</span><span>Owed</span><span>Age</span><span>Status</span><span></span>
        </div>
        <div className="overflow-hidden flex-1">
          {ROWS.map((r) => (
            <div key={r.id} className="grid grid-cols-[100px_80px_120px_80px_1fr_120px] gap-3 px-3 py-2 border-b items-center" style={{ borderColor: T.HAIRLINE }}>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.NAVY }}>{r.id}</span>
              <span className="text-[12px] tabular-nums" style={{ color: T.SLATE_TEXT }}>{r.trips}</span>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.AMBER_FG }}>{r.owed}</span>
              <span className="text-[11px] tabular-nums" style={{ color: T.SLATE_MUTED }}>{r.age}</span>
              <span className="inline-flex items-center gap-1.5 self-start text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded w-fit" style={{ backgroundColor: T.AMBER_BG, color: T.AMBER_FG, border: `1px solid ${T.AMBER_BD}` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: T.AMBER_FG }} /> Approved · awaiting attestation
              </span>
              <button className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-white flex items-center gap-1.5 justify-center" style={{ backgroundColor: T.NAVY }}>
                <ExternalLink className="w-3 h-3" /> Attest
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
