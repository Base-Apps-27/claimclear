import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FakeSidebar, FakeHeader, Callout } from './shared';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000), // Lanes
      setTimeout(() => setPhase(2), 5000), // Past-deadline
      setTimeout(() => setPhase(3), 9000), // Engagement filter
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
      <FakeSidebar active="Queue" />
      <div className="flex-1 flex flex-col relative">
        <FakeHeader title="Queue" />
        <div className="p-8 flex flex-col gap-6 relative">
          
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <div className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-slate-400" />
                All Engagements
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <div className="w-8 h-4 bg-primary rounded-full relative">
                <div className="w-3 h-3 bg-white rounded-full absolute right-0.5 top-0.5" />
              </div>
              <span className="text-sm font-medium">Show past-deadline</span>
            </div>
          </div>

          {/* Lanes */}
          <div className="grid grid-cols-3 gap-6 h-[600px]">
            <div className="bg-slate-100 rounded-xl p-4 flex flex-col gap-4 border border-slate-200/60">
              <div className="flex justify-between items-center">
                <div className="font-bold text-slate-800">Urgent</div>
                <div className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">12</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 border-l-4 border-l-red-500">
                <div className="text-xs text-slate-500 font-bold mb-1">MAS · CLM-2026-0481</div>
                <div className="font-medium text-slate-800">$1,450.00</div>
                <div className="text-xs text-red-600 mt-2 font-medium">Expiring today</div>
              </div>
            </div>
            
            <div className="bg-slate-100 rounded-xl p-4 flex flex-col gap-4 border border-slate-200/60">
              <div className="flex justify-between items-center">
                <div className="font-bold text-slate-800">Stuck</div>
                <div className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-bold">8</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 border-l-4 border-l-amber-500">
                <div className="text-xs text-slate-500 font-bold mb-1">LogistiCare · CLM-2026-0210</div>
                <div className="font-medium text-slate-800">$850.00</div>
                <div className="text-xs text-amber-600 mt-2 font-medium">Needs info</div>
              </div>
            </div>

            <div className="bg-slate-100 rounded-xl p-4 flex flex-col gap-4 border border-slate-200/60">
              <div className="flex justify-between items-center">
                <div className="font-bold text-slate-800">Soon</div>
                <div className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">45</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                <div className="text-xs text-slate-500 font-bold mb-1">Modivcare · CLM-2026-0992</div>
                <div className="font-medium text-slate-800">$320.00</div>
                <div className="text-xs text-slate-500 mt-2">Due in 4 days</div>
              </div>
            </div>
          </div>

          <Callout 
            x="20px" y="140px" 
            title="Triage Lanes" 
            description="Work flows from left to right. Urgent claims first, then stuck, then everything else." 
            phase={phase} showAtPhase={1} 
          />
          <Callout 
            x="600px" y="80px" 
            title="Past-Deadline Toggle" 
            description="Toggle to temporarily include claims that are already past their deadline." 
            phase={phase} showAtPhase={2} 
            align="right"
          />
        </div>
      </div>
    </motion.div>
  );
}
