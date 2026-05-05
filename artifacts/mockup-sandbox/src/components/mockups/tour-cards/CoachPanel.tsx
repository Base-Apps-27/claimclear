import React from "react";

export function CoachPanel() {
  return (
    <div className="w-full h-[100dvh] bg-[#F4F6F9] flex overflow-hidden font-sans text-[#0F172A]">
      {/* Background App Hint */}
      <div className="flex-1 flex p-4 gap-4 opacity-100">
        {/* Sidebar */}
        <div className="w-64 bg-white border border-[#E2E8F0] rounded-lg p-4 flex flex-col gap-3 shadow-sm shrink-0">
          <div className="h-6 w-32 bg-[#E2E8F0] rounded mb-4" />
          <div className="h-8 w-full bg-[#F4F6F9] rounded" />
          <div className="h-8 w-full bg-[#F4F6F9] rounded" />
          <div className="h-8 w-full bg-[#F4F6F9] rounded" />
          {/* Highlighted anchored element */}
          <div className="h-8 w-full bg-white rounded border-2 relative flex items-center px-3" style={{ borderColor: "#1B2A4A" }}>
             <div className="h-2 w-16 bg-[#1B2A4A] rounded opacity-80" />
             <div className="absolute -right-[18px] top-1/2 -translate-y-1/2 w-4 h-[2px] bg-[#1B2A4A]" />
          </div>
          <div className="h-8 w-full bg-[#F4F6F9] rounded" />
          <div className="h-8 w-full bg-[#F4F6F9] rounded" />
        </div>
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="h-14 bg-white border border-[#E2E8F0] rounded-lg shadow-sm shrink-0" />
          <div className="flex-1 bg-white border border-[#E2E8F0] rounded-lg shadow-sm p-6 flex flex-col gap-4">
            <div className="h-8 w-64 bg-[#E2E8F0] rounded mb-4" />
            <div className="h-20 w-full bg-[#F4F6F9] border border-[#E2E8F0] rounded" />
            <div className="h-20 w-full bg-[#F4F6F9] border border-[#E2E8F0] rounded" />
            <div className="h-20 w-full bg-[#F4F6F9] border border-[#E2E8F0] rounded" />
            <div className="h-20 w-full bg-[#F4F6F9] border border-[#E2E8F0] rounded" />
          </div>
        </div>
      </div>

      {/* Coach Panel */}
      <div 
        className="w-[420px] bg-white border-l border-[#E2E8F0] shadow-2xl flex flex-col h-full z-10 shrink-0"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex justify-between items-center shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#475569]">Onboarding tour</span>
          <button className="text-[#475569] hover:text-[#0F172A] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"></path>
              <path d="M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Step Rail - Horizontal variant as requested right at the top */}
          <div className="px-6 pt-8 pb-6 flex items-center justify-center">
            <div className="flex items-center w-full justify-between relative">
              {/* Connecting line background */}
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-[#F4F6F9] z-0" />
              {/* Active line connecting completed steps */}
              <div 
                className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] z-0 transition-all duration-500" 
                style={{ width: "30%", backgroundColor: "#1B2A4A" }} 
              />
              
              {/* Nodes */}
              {Array.from({ length: 14 }).map((_, i) => {
                const step = i + 1;
                const isCompleted = step < 5;
                const isCurrent = step === 5;
                const isPending = step > 5;
                
                return (
                  <div key={step} className="relative z-10 flex items-center justify-center bg-white px-0.5">
                    {isCompleted && (
                      <div className="w-2.5 h-2.5 rounded-full bg-[#1B2A4A]" />
                    )}
                    {isCurrent && (
                      <div className="relative flex items-center justify-center">
                        <div className="absolute w-5 h-5 rounded-full opacity-10 animate-pulse" style={{ backgroundColor: "#1B2A4A" }} />
                        <div className="w-3.5 h-3.5 rounded-full border-2 bg-white" style={{ borderColor: "#1B2A4A" }} />
                        <div className="absolute w-1.5 h-1.5 rounded-full bg-[#1B2A4A]" />
                      </div>
                    )}
                    {isPending && (
                      <div className="w-2 h-2 rounded-full border-[1.5px] bg-white border-[#E2E8F0]" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-6 pb-8 flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-medium text-[#0F172A] mb-4 leading-tight tracking-tight">
                Step 5 of 5 — Read the response and decide, right then
              </h2>
              <p className="text-[#475569] text-[15px] leading-relaxed">
                When MAS responds, it lands on the Responses page. The decision happens in that moment: read it back, and either (a) re-attest the ride right there if you have the authority and the response is clean, or (b) queue it at the station for a billing supervisor to process. Either way the call is made when you read the response — nothing sits unowned.
              </p>
            </div>

            {/* Context Hint */}
            <div className="bg-[#F4F6F9] rounded-md p-4 flex gap-3 items-start border border-[#E2E8F0]">
              <div className="mt-0.5 text-[#1B2A4A]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[#0F172A] mb-0.5">What you'll see in the app</p>
                <p className="text-[13px] text-[#475569] leading-snug">We're highlighting the Responses navigation entry on the left.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-5 border-t border-[#E2E8F0] shrink-0 bg-[#F8FAFC] flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <button className="flex-1 py-2.5 px-4 rounded-md border border-[#E2E8F0] bg-white text-[#0F172A] font-medium text-sm hover:bg-[#F4F6F9] transition-colors shadow-sm">
              Back
            </button>
            <button 
              className="flex-1 py-2.5 px-4 rounded-md text-white font-medium text-sm hover:opacity-90 transition-colors shadow-sm"
              style={{ backgroundColor: "#1B2A4A" }}
            >
              Next
            </button>
          </div>
          <div className="text-center pt-2">
            <button className="text-[13px] text-[#64748B] hover:text-[#0F172A] transition-colors underline decoration-[#CBD5E1] underline-offset-4">
              Skip tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
