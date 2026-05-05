import React from "react";

export function OverviewMap() {
  const steps = [
    {
      title: "Upload the transactions",
      body: "Start by importing the rides that weren't attestable at attestation time. These are rides we now want to attest, but to do that we first have to ask MAS to make a change on the invoice. Every dispute starts its life as a transaction in this upload.",
    },
    {
      title: "Understand what's wrong with each invoice",
      body: "For every invoice, figure out what specifically MAS got wrong (or what's missing) and what evidence we'd need to prove it. This is the difference between a dispute that lands and one that gets denied: the right ask, paired with the right proof.",
    },
    {
      title: "Gather the evidence",
      body: "Use the Queue or the invoice page to kick off our fact-finding process. That process pulls together the documents, GPS, signatures, and notes that back up the change we're asking MAS to make.",
    },
    {
      title: "Submit the dispute",
      body: "Once fact-finding produces clean evidence, submit the dispute to MAS — either through the payor portal or by email, depending on what each invoice requires. The app routes you to the right channel.",
    },
    {
      title: "Read the response and decide, right then",
      body: "When MAS responds, it lands on the Responses page. The decision happens in that moment: read it back, and either (a) re-attest the ride right there if you have the authority and the response is clean, or (b) queue it at the station for a billing supervisor to process. Either way the call is made when you read the response — nothing sits unowned.",
    },
  ];

  return (
    <div className="min-h-screen w-full bg-[#F4F6F9] relative flex items-center justify-center p-4 sm:p-8 font-sans">
      {/* Abstract Dashboard Background Hint */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
        <div className="absolute top-0 left-0 right-0 h-14 bg-white border-b border-slate-200 flex items-center px-6">
          <div className="w-32 h-4 bg-slate-200 rounded"></div>
          <div className="ml-auto flex gap-4">
            <div className="w-8 h-8 bg-slate-200 rounded-full"></div>
            <div className="w-8 h-8 bg-slate-200 rounded-full"></div>
          </div>
        </div>
        <div className="absolute top-14 left-0 bottom-0 w-64 bg-white border-r border-slate-200 p-6 flex flex-col gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="w-full h-8 bg-slate-100 rounded"></div>
          ))}
        </div>
        <div className="absolute top-14 left-64 right-0 bottom-0 p-8 flex flex-col gap-6">
          <div className="flex gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex-1 h-32 bg-white rounded-xl border border-slate-200"></div>
            ))}
          </div>
          <div className="flex-1 bg-white rounded-xl border border-slate-200"></div>
        </div>
      </div>

      {/* Dimming overlay */}
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px] pointer-events-none"></div>

      {/* Tour Card */}
      <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 sm:p-10">
          <div className="max-w-2xl mx-auto">
            
            {/* Welcome Section */}
            <div className="mb-12 text-center">
              <h1 className="text-3xl font-semibold text-[#0F172A] tracking-tight mb-4">
                Welcome to ClaimClear
              </h1>
              <p className="text-[#475569] leading-relaxed text-lg">
                Every claim that lands in ClaimClear is one our automated attestation
                system already tried — and rejected. The auto-system couldn't safely attest
                it, so it kicked the ride to us to work by hand. ClaimClear is the playbook
                for that hand-work: a single repeatable process that turns those rejected
                rides into rides we can attest, and the revenue that comes with them. Before
                we tour the screens, let's anchor on the five steps you'll repeat for every
                batch. About three minutes, no clicks required — just hit Next.
              </p>
            </div>

            {/* Roadmap */}
            <div className="relative">
              {/* Vertical connector line */}
              <div className="absolute left-[1.125rem] top-4 bottom-8 w-px bg-slate-200" />
              
              <div className="flex flex-col gap-10">
                {steps.map((step, index) => (
                  <div key={index} className="relative flex gap-6 items-start">
                    {/* Numbered Node */}
                    <div 
                      className="relative z-10 flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium shadow-sm ring-4 ring-white"
                      style={{ backgroundColor: "#1B2A4A" }}
                    >
                      {index + 1}
                    </div>
                    
                    {/* Content */}
                    <div className="pt-1.5 flex-1">
                      <h3 className="text-base font-semibold text-[#0F172A] mb-2">
                        {step.title}
                      </h3>
                      <p className="text-sm text-[#475569] leading-relaxed">
                        {step.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-100 bg-slate-50/50 p-6 px-8 rounded-b-xl flex items-center justify-between flex-shrink-0">
          <div className="w-1/3 flex items-center">
            <span className="text-sm font-medium text-slate-500">Step 1 of 9</span>
          </div>
          
          <div className="w-1/3 flex justify-center">
            <button className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
              Skip tour
            </button>
          </div>
          
          <div className="w-1/3 flex justify-end">
            <button 
              className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium text-white rounded-lg shadow-sm hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1B2A4A]"
              style={{ backgroundColor: "#1B2A4A" }}
            >
              Begin walkthrough &rarr;
            </button>
          </div>
        </div>
        
      </div>
    </div>
  );
}
