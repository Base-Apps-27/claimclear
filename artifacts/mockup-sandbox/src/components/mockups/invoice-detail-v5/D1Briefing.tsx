import "./_group.css";
import React, { useState } from "react";
import {
  ChevronLeft,
  ArrowRight,
  FileText,
  Upload,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pin,
  ShieldAlert,
  Play,
  FileQuestion,
  Info,
  ShieldCheck,
  Tag,
  Ban,
  Files
} from "lucide-react";

export default function D1Briefing() {
  const [expandedLeg, setExpandedLeg] = useState<string | null>("B");

  return (
    <div className="cc-scope min-h-screen pb-16">
      {/* 1. Top utility bar */}
      <div className="flex items-center px-6 py-3 border-b border-gray-200 bg-white sticky top-0 z-10 text-sm">
        <a href="#" className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors font-medium">
          <ChevronLeft className="w-4 h-4" />
          <span>Invoice groups</span>
        </a>
        <span className="mx-2 text-gray-300">/</span>
        <span className="font-semibold text-gray-900 mono">#INV-2026-1234</span>
      </div>

      <div className="max-w-5xl mx-auto px-6 mt-8 space-y-10">
        
        {/* 2. Header */}
        <div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 flex items-center gap-4">
                <span className="mono">#INV-2026-1234</span>
                <span className="cc-badge bg-blue-100 text-blue-800 border-blue-200 py-1 px-3 text-sm">Ready</span>
              </h1>
              <div className="mt-3 flex items-center gap-4 text-base text-gray-600 font-medium">
                <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-gray-400" /> Aetna</span>
                <span className="text-gray-300">•</span>
                <span>Member #88241</span>
                <span className="text-gray-300">•</span>
                <span>Billed Apr 10, 2026</span>
                <span className="text-gray-300">•</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" /> 14 days in queue</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Total Value</div>
              <div className="text-3xl font-black mono text-gray-900">$487.00</div>
            </div>
          </div>
        </div>

        {/* 3. Lifecycle Timeline */}
        <div className="cc-card p-6 bg-white shadow-sm border-gray-200">
          <div className="relative">
            <div className="absolute top-3 left-6 right-6 h-0.5 bg-gray-100"></div>
            <div className="absolute top-3 left-6 w-2/5 h-0.5 bg-blue-500"></div>
            
            <div className="flex justify-between relative z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center border-4 border-white outline outline-2 outline-blue-500">
                  <CheckCircle2 className="w-3 h-3" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold text-gray-900">Triage</div>
                  <div className="text-xs text-gray-500 font-medium mt-0.5">Apr 10</div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center border-4 border-white outline outline-2 outline-blue-500">
                  <CheckCircle2 className="w-3 h-3" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold text-gray-900">Evidence</div>
                  <div className="text-xs text-gray-500 font-medium mt-0.5">Apr 11</div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center border-4 border-white outline outline-2 outline-blue-500">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold text-blue-600">Ready</div>
                  <div className="text-xs text-blue-600 font-bold mt-0.5">Today</div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-gray-100 border-4 border-white flex items-center justify-center"></div>
                <div className="text-center opacity-50">
                  <div className="text-sm font-bold text-gray-500">Submitted</div>
                  <div className="text-xs text-gray-400 font-medium mt-0.5">Pending</div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-gray-100 border-4 border-white flex items-center justify-center"></div>
                <div className="text-center opacity-50">
                  <div className="text-sm font-bold text-gray-500">Awaiting</div>
                  <div className="text-xs text-gray-400 font-medium mt-0.5">Pending</div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-gray-100 border-4 border-white flex items-center justify-center"></div>
                <div className="text-center opacity-50">
                  <div className="text-sm font-bold text-gray-500">Resolved</div>
                  <div className="text-xs text-gray-400 font-medium mt-0.5">Pending</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4. "What's next" hero panel + 5. Global CTA */}
        <div className="rounded-xl bg-[#FFF9E6] border border-[#FDE68A] p-8 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[#B45309] font-bold text-sm uppercase tracking-wider mb-2">
              <AlertTriangle className="w-4 h-4" />
              What's Next
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 leading-tight">
              Ready to dispute. 2 of 3 legs fully evidenced.<br/>
              <span className="text-[#B45309]">Leg B blocked on auth-denial doc.</span>
            </h2>
          </div>
          <div className="flex-shrink-0 flex flex-col gap-2">
            <button className="cc-btn cc-btn-primary px-6 py-3 text-base shadow-md font-bold flex flex-col items-center justify-center">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 fill-current" />
                Open in queue
              </div>
              <div className="text-xs font-normal opacity-80 mt-1">Walk SOP & build submission</div>
            </button>
          </div>
        </div>

        {/* 6. Legs Table & Selected Panel */}
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Claim Legs <span className="text-sm font-medium bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full">3 Active</span>
          </h3>

          <div className="cc-card overflow-hidden bg-white shadow-sm">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-xs">
                  <th className="px-4 py-3">Leg</th>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3">Service Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">SOP Progress</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* Leg A */}
                <tr 
                  className={`hover:bg-gray-50 cursor-pointer transition-colors ${expandedLeg === 'A' ? 'bg-blue-50' : ''}`}
                  onClick={() => setExpandedLeg(expandedLeg === 'A' ? null : 'A')}
                >
                  <td className="px-4 py-4">
                    <div className="font-bold text-gray-900">Leg A</div>
                    <div className="text-xs text-gray-500 mono mt-0.5">TX-558820</div>
                  </td>
                  <td className="px-4 py-4 font-medium text-gray-700">Underpayment</td>
                  <td className="px-4 py-4 text-gray-500">Apr 10</td>
                  <td className="px-4 py-4 font-semibold mono">$42.00</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-900 font-medium">Q4/4</span>
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="text-xs text-gray-500 bg-gray-100 px-1.5 rounded">3/3 docs</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="cc-badge bg-blue-50 text-blue-700 border-blue-200">Ready</span>
                  </td>
                </tr>

                {/* Leg B */}
                <tr 
                  className={`cursor-pointer transition-colors ${expandedLeg === 'B' ? 'bg-blue-50 border-b-0' : 'hover:bg-gray-50'}`}
                  onClick={() => setExpandedLeg(expandedLeg === 'B' ? null : 'B')}
                >
                  <td className="px-4 py-4">
                    <div className="font-bold text-gray-900">Leg B</div>
                    <div className="text-xs text-blue-600 mono mt-0.5">TX-558821</div>
                  </td>
                  <td className="px-4 py-4 font-medium text-gray-900">Underpayment</td>
                  <td className="px-4 py-4 text-gray-700">Apr 12</td>
                  <td className="px-4 py-4 font-semibold mono text-gray-900">$58.00</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-900 font-medium">Q3/4</span>
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <span className="text-xs text-gray-500 bg-white/50 px-1.5 rounded">2/3 docs</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="cc-badge bg-amber-50 text-amber-700 border-amber-200">Needs review</span>
                  </td>
                </tr>
                
                {/* Leg B Focus Panel */}
                {expandedLeg === 'B' && (
                  <tr>
                    <td colSpan={6} className="p-0 border-x-0 border-b-2 border-b-blue-200">
                      <div className="bg-white border-x-2 border-blue-200 shadow-inner px-6 py-6">
                        
                        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
                          <div className="flex items-center gap-2">
                            <button className="cc-btn cc-btn-sm cc-btn-ghost text-gray-600"><Tag className="w-3 h-3"/> Reclassify</button>
                            <button className="cc-btn cc-btn-sm cc-btn-ghost text-gray-600"><Ban className="w-3 h-3"/> Exclude</button>
                            <button className="cc-btn cc-btn-sm cc-btn-ghost text-gray-600"><Files className="w-3 h-3"/> Mark sibling dup</button>
                            <button className="cc-btn cc-btn-sm cc-btn-ghost text-gray-600"><CheckCircle2 className="w-3 h-3"/> Handled offline</button>
                          </div>
                          <a href="/queue?invoice=1234" className="text-blue-600 hover:text-blue-800 font-bold text-sm flex items-center gap-1">
                            Walk this SOP in Queue <ArrowRight className="w-4 h-4" />
                          </a>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                          {/* SOP Transcript */}
                          <div>
                            <h4 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider flex items-center gap-2">
                              <FileQuestion className="w-4 h-4 text-gray-400" />
                              SOP Transcript
                            </h4>
                            <div className="space-y-3">
                              <div className="flex justify-between items-start text-sm">
                                <span className="text-gray-600">Q1 Submitted on time?</span>
                                <span className="font-semibold text-gray-900">Yes</span>
                              </div>
                              <div className="flex justify-between items-start text-sm">
                                <span className="text-gray-600">Q2 Remittance received?</span>
                                <span className="font-semibold text-gray-900">Yes</span>
                              </div>
                              <div className="flex justify-between items-start text-sm">
                                <span className="text-gray-600">Q3 Claim authorized?</span>
                                <span className="font-semibold text-gray-900">No</span>
                              </div>
                              <div className="bg-amber-50 -mx-3 px-3 py-2 rounded-md border border-amber-200 mt-2">
                                <div className="flex justify-between items-start text-sm">
                                  <span className="text-amber-700 font-medium">Q4 Appeal in 90 days?</span>
                                  <span className="font-bold text-amber-700">blocked</span>
                                </div>
                                <div className="text-xs text-amber-700/80 mt-1">need auth-denial doc</div>
                              </div>
                            </div>
                          </div>

                          {/* Evidence */}
                          <div>
                            <h4 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider flex items-center gap-2">
                              <FileText className="w-4 h-4 text-gray-400" />
                              Evidence Files
                            </h4>
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center justify-between p-2 rounded border border-gray-200 bg-gray-50 text-sm">
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-gray-400" />
                                  <span className="font-medium text-gray-900">claim.pdf</span>
                                  <span className="text-xs text-gray-500">84 KB</span>
                                  <span className="text-xs text-gray-400">Apr 13</span>
                                </div>
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              </div>
                              <div className="flex items-center justify-between p-2 rounded border border-gray-200 bg-gray-50 text-sm">
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-gray-400" />
                                  <span className="font-medium text-gray-900">remittance.pdf</span>
                                  <span className="text-xs text-gray-500">122 KB</span>
                                  <span className="text-xs text-gray-400">Apr 13</span>
                                </div>
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              </div>
                              <div className="flex items-center justify-between p-2 rounded border border-red-200 bg-red-50 text-sm">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4 text-red-500" />
                                  <span className="font-semibold text-red-700">auth_denial.png</span>
                                  <span className="text-xs text-red-500 font-medium">MISSING (from Q4)</span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-gray-50 transition-colors cursor-pointer">
                              <Upload className="w-6 h-6 text-gray-400 mb-2" />
                              <div className="text-sm font-medium text-blue-600">Click to upload</div>
                              <div className="text-xs text-gray-500 mt-1">or drag and drop missing file</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Leg C */}
                <tr 
                  className={`hover:bg-gray-50 cursor-pointer transition-colors ${expandedLeg === 'C' ? 'bg-blue-50' : ''}`}
                  onClick={() => setExpandedLeg(expandedLeg === 'C' ? null : 'C')}
                >
                  <td className="px-4 py-4">
                    <div className="font-bold text-gray-900">Leg C</div>
                    <div className="text-xs text-gray-500 mono mt-0.5">TX-558822</div>
                  </td>
                  <td className="px-4 py-4 font-medium text-gray-700">Coding</td>
                  <td className="px-4 py-4 text-gray-500">Apr 11</td>
                  <td className="px-4 py-4 font-semibold mono">$19.00</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-900 font-medium">Q1/4</span>
                      <span className="text-xs text-gray-500 bg-gray-100 px-1.5 rounded">0/2 docs</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="cc-badge bg-gray-100 text-gray-600 border-gray-200">On hold</span>
                  </td>
                </tr>
              </tbody>
            </table>
            
            {/* 7. Hidden Legs */}
            <div className="bg-gray-50 px-4 py-3 text-sm text-gray-500 border-t border-gray-200 flex items-center justify-center gap-2 font-medium cursor-pointer hover:bg-gray-100 transition-colors">
              <Info className="w-4 h-4" />
              +2 hidden (1 excluded, 1 sibling-dup of Leg A)
            </div>
          </div>
        </div>

        {/* 8. Unified History Rail */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="cc-card p-4 hover:border-blue-300 hover:shadow-md transition-all text-left flex items-start gap-4">
            <div className="bg-blue-100 p-2 rounded-lg text-blue-600 shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-base mb-0.5">Communication</div>
              <div className="text-sm text-gray-500">0 new messages</div>
            </div>
          </button>
          
          <button className="cc-card p-4 hover:border-purple-300 hover:shadow-md transition-all text-left flex items-start gap-4 bg-purple-50/50">
            <div className="bg-purple-100 border border-purple-200 p-2 rounded-lg text-purple-700 shrink-0">
              <Pin className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-base mb-0.5">Notes & Audit</div>
              <div className="text-sm text-gray-500">15 entries • Latest: Leg B</div>
            </div>
          </button>

          <button className="cc-card p-4 hover:border-gray-300 hover:shadow-md transition-all text-left flex items-start gap-4">
            <div className="bg-gray-100 border border-gray-200 p-2 rounded-lg text-gray-600 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-base mb-0.5">Overrides</div>
              <div className="text-sm text-gray-500">Hold / Withdraw / Close</div>
            </div>
          </button>
        </div>

      </div>
    </div>
  );
}
