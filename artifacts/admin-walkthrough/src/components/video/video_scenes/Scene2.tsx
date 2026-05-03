import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FakeSidebar, FakeHeader, Callout } from './shared';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000), // Sidebar callout
      setTimeout(() => setPhase(2), 5000), // Hero buckets
      setTimeout(() => setPhase(3), 9000), // Urgent strip
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
      <FakeSidebar />
      <div className="flex-1 flex flex-col relative">
        <FakeHeader title="Dashboard" />
        <div className="p-8 flex flex-col gap-6 relative">
          
          {/* Urgent Strip */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-8 items-center text-red-800">
            <div className="font-bold">Urgent Attention Required</div>
            <div className="flex gap-4">
              <div className="bg-white px-3 py-1 rounded shadow-sm border border-red-100">12 Claims Expiring Today</div>
              <div className="bg-white px-3 py-1 rounded shadow-sm border border-red-100">8 Stuck in Hold</div>
            </div>
          </div>

          {/* Buckets */}
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">At-Risk</div>
              <div className="text-4xl font-black text-amber-600">$48,250</div>
              <div className="text-sm text-slate-500 mt-2">142 claims pending evidence</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Lost</div>
              <div className="text-4xl font-black text-slate-800">$12,400</div>
              <div className="text-sm text-slate-500 mt-2">Past deadline</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Reclaimed</div>
              <div className="text-4xl font-black text-green-600">$105,800</div>
              <div className="text-sm text-slate-500 mt-2">Successfully disputed</div>
            </div>
          </div>

          <Callout 
            x="280px" y="100px" 
            title="Urgent Strip" 
            description="Claims with deadlines in the next 7 days. Work top-to-bottom." 
            phase={phase} showAtPhase={3} 
          />
          <Callout 
            x="400px" y="220px" 
            title="Money Buckets" 
            description="At-Risk needs your attention. Reclaimed shows successful disputes." 
            phase={phase} showAtPhase={2} 
          />
        </div>
      </div>
    </motion.div>
  );
}
