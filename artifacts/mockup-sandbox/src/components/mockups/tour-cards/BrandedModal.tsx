import React from "react";
import { ArrowRight } from "lucide-react";

export function BrandedModal() {
  return (
    <div className="min-h-screen w-full bg-[#F4F6F9] relative flex items-center justify-center font-sans overflow-hidden">
      {/* Background hint (Faded dashboard) */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-25 flex flex-col gap-6 p-8">
        {/* Fake Header */}
        <div className="h-12 w-full bg-white border-b border-[#E2E8F0] rounded-sm shadow-sm flex items-center px-4">
          <div className="h-4 w-32 bg-slate-200 rounded" />
        </div>
        
        {/* Fake KPI Cards */}
        <div className="flex gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 h-32 bg-white border border-[#E2E8F0] rounded-md shadow-sm p-4 flex flex-col justify-between">
              <div className="h-3 w-16 bg-slate-200 rounded" />
              <div className="h-8 w-24 bg-slate-300 rounded" />
            </div>
          ))}
        </div>

        {/* Fake Table */}
        <div className="flex-1 bg-white border border-[#E2E8F0] rounded-md shadow-sm p-6 flex flex-col gap-4">
          <div className="h-6 w-48 bg-slate-200 rounded" />
          <div className="space-y-3 mt-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-10 w-full bg-slate-50 rounded" />
            ))}
          </div>
        </div>
      </div>

      {/* Modal Container */}
      <div className="relative z-10 w-[600px] max-w-[90vw] bg-white rounded-xl shadow-[0_12px_32px_-12px_rgba(27,42,74,0.15)] border border-[#E2E8F0] overflow-hidden flex flex-col">
        
        {/* Slim Navy Header Band */}
        <div 
          className="h-10 px-5 flex items-center justify-between text-white text-xs font-medium tracking-wide"
          style={{ backgroundColor: "#1B2A4A" }}
        >
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-white/20 rounded-sm" />
            <span className="font-semibold tracking-wider uppercase">ClaimClear</span>
          </div>
          <div className="text-white/70 uppercase tracking-widest text-[10px]">
            Onboarding tour
          </div>
        </div>

        {/* Content Body */}
        <div className="p-8 pb-6 flex flex-col gap-5">
          {/* Step Badge */}
          <div>
            <span 
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border"
              style={{ color: "#1B2A4A", borderColor: "rgba(27,42,74,0.2)", backgroundColor: "rgba(27,42,74,0.03)" }}
            >
              Step 4 of 5 — Process orientation
            </span>
          </div>

          {/* Title & Copy */}
          <div className="space-y-3">
            <h2 className="text-[26px] font-semibold leading-tight text-[#0F172A]">
              Submit the dispute
            </h2>
            <p className="text-[15px] leading-relaxed text-[#475569] max-w-[60ch]">
              Once fact-finding produces clean evidence, submit the dispute to MAS — either through the payor portal or by email, depending on what each invoice requires. The app routes you to the right channel.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 pt-4 flex flex-col gap-6">
          {/* Progress Indicator */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 h-1.5 w-full max-w-[200px]">
              {[1, 2, 3, 4, 5].map((step) => (
                <div 
                  key={step} 
                  className="flex-1 rounded-full"
                  style={{ 
                    backgroundColor: step <= 4 ? "#1B2A4A" : "#E2E8F0" 
                  }}
                />
              ))}
            </div>
            <div className="text-[11px] text-[#475569] font-medium uppercase tracking-wider">
              (4 of 14 total)
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
            <button className="text-sm font-medium text-[#475569] hover:text-[#0F172A] transition-colors">
              Skip tour
            </button>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-sm font-medium text-[#475569] hover:text-[#0F172A] transition-colors rounded-md hover:bg-slate-50">
                Back
              </button>
              <button 
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-md shadow-sm transition-colors hover:opacity-90 focus:ring-2 focus:ring-offset-2"
                style={{ backgroundColor: "#1B2A4A", "--tw-ring-color": "#1B2A4A" } as React.CSSProperties}
              >
                <span>Next</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
