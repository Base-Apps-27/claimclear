import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FakeSidebar, FakeHeader, Callout } from './shared';

export function Scene7() {
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
      <FakeSidebar active="Settings" />
      <div className="flex-1 flex flex-col relative">
        <FakeHeader title="System Health" />
        <div className="p-8 flex flex-col gap-6 relative">
          
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="font-bold text-slate-800">LLM Classifier Status</div>
                <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Healthy
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Agreement Rate</span>
                    <span className="font-medium text-slate-800">98.4%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{ width: '98.4%' }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="font-bold text-slate-800 mb-4">Auto-Retire Signals</div>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="font-medium text-slate-700">Duplicate claims</div>
                  <div className="text-slate-500 text-sm">24 retired today</div>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="font-medium text-slate-700">Already paid</div>
                  <div className="text-slate-500 text-sm">12 retired today</div>
                </div>
              </div>
            </div>
          </div>

          <Callout 
            x="450px" y="100px" 
            title="LLM Classifier" 
            description="Monitors the agreement rate of the AI classifier. If it dips, human review is requested." 
            phase={phase} showAtPhase={2} 
          />
          <Callout 
            x="500px" y="300px" 
            title="Auto-Retire Signals" 
            description="Claims safely retired automatically based on high-confidence signals." 
            phase={phase} showAtPhase={3} 
          />
        </div>
      </div>
    </motion.div>
  );
}
