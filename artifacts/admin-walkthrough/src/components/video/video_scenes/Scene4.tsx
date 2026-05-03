import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FakeSidebar, FakeHeader, Callout } from './shared';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000), // Header
      setTimeout(() => setPhase(2), 5000), // Evidence panel
      setTimeout(() => setPhase(3), 9000), // Audit timeline
      setTimeout(() => setPhase(4), 13000), // Response panel
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-slate-50 flex overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <FakeSidebar active="Claims" />
      <div className="flex-1 flex flex-col relative">
        <FakeHeader title="Claim Detail" />
        <div className="p-8 flex flex-col gap-6 relative">
          
          {/* Header Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-bold text-slate-800">CLM-2026-0481</h2>
                <div className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border border-red-200">Urgent</div>
              </div>
              <div className="text-slate-500">MAS • $1,450.00 • Service Date: Oct 12, 2026</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Deadline</div>
              <div className="text-xl font-bold text-red-600">Today</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 flex flex-col gap-6">
              {/* Evidence Panel */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">Evidence</h3>
                <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="w-10 h-10 bg-slate-200 rounded flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">Trip_Log_0481.pdf</div>
                    <div className="text-xs text-slate-500">Added 2 hours ago by System</div>
                  </div>
                </div>
              </div>
              
              {/* Response Panel */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">Response</h3>
                <div className="w-full h-32 border border-slate-300 rounded-lg bg-slate-50 p-4 text-slate-400">
                  Write response here...
                </div>
                <div className="mt-4 flex justify-end">
                  <div className="bg-primary text-white px-4 py-2 rounded-lg font-medium shadow-sm">Submit Response</div>
                </div>
              </div>
            </div>

            {/* Audit Timeline */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">Audit Timeline</h3>
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-slate-200">
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-4 h-4 rounded-full bg-primary border-2 border-white shadow shrink-0 z-10 -ml-1.5" />
                  <div className="w-full ml-4">
                    <div className="font-medium text-slate-800 text-sm">Evidence Attached</div>
                    <div className="text-xs text-slate-500">2 hours ago</div>
                  </div>
                </div>
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-4 h-4 rounded-full bg-slate-300 border-2 border-white shadow shrink-0 z-10 -ml-1.5" />
                  <div className="w-full ml-4">
                    <div className="font-medium text-slate-800 text-sm">Status: Urgent</div>
                    <div className="text-xs text-slate-500">Yesterday</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Callout 
            x="200px" y="80px" 
            title="Header Summary" 
            description="High-level overview of the claim, status, and deadline at a glance." 
            phase={phase} showAtPhase={1} 
          />
          <Callout 
            x="200px" y="280px" 
            title="Evidence Panel" 
            description="All related documents and trip logs automatically attached by the system." 
            phase={phase} showAtPhase={2} 
          />
          <Callout 
            x="600px" y="280px" 
            title="Audit Timeline" 
            description="A chronological record of every action taken on this claim." 
            phase={phase} showAtPhase={3} 
            align="right"
          />
          <Callout 
            x="200px" y="480px" 
            title="Response Panel" 
            description="Draft and submit your dispute response directly from this view." 
            phase={phase} showAtPhase={4} 
          />
        </div>
      </div>
    </motion.div>
  );
}
