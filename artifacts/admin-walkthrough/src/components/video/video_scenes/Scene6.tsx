import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FakeSidebar, FakeHeader, Callout } from './shared';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 5000),
      setTimeout(() => setPhase(3), 9000),
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
      <FakeSidebar active="Attestation" />
      <div className="flex-1 flex flex-col relative">
        <FakeHeader title="Attestation Queue" />
        <div className="p-8 flex flex-col gap-6 relative max-w-4xl mx-auto w-full">
          
          <div className="text-xl font-bold text-slate-800 mb-2">Step 3: Draft Verdicts</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm relative overflow-hidden">
              <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">INV-90245-A</div>
              <div className="flex gap-2">
                <div className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-sm font-medium">Hold for Review</div>
                <div className="bg-primary/10 text-primary px-2 py-1 rounded text-sm font-medium flex items-center gap-1 border border-primary/20">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  Draft
                </div>
              </div>
            </div>
          </div>

          <div className="text-xl font-bold text-slate-800 mt-8 mb-2">Step 4: Commit</div>
          <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm flex justify-between items-center">
            <div>
              <div className="font-bold text-slate-800">Ready to Submit to Portal</div>
              <div className="text-sm text-slate-500">1 draft verdict waiting</div>
            </div>
            <div className="bg-green-600 text-white px-6 py-2 rounded-lg font-bold shadow-sm relative overflow-hidden">
              <motion.div 
                className="absolute inset-0 bg-white/20"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
              Submit to Payor
            </div>
          </div>

          <Callout 
            x="500px" y="150px" 
            title="Draft Verdicts" 
            description="Lit pills indicate a draft verdict. Click to clear or modify." 
            phase={phase} showAtPhase={2} 
            align="right"
          />
          <Callout 
            x="500px" y="400px" 
            title="Step 4 Commit" 
            description="Review drafted verdicts before committing them to the payor portal in bulk." 
            phase={phase} showAtPhase={3} 
            align="right"
          />
        </div>
      </div>
    </motion.div>
  );
}
