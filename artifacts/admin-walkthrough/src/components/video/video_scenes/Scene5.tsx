import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FakeSidebar, FakeHeader, Callout } from './shared';

export function Scene5() {
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
      <FakeSidebar active="Invoice Groups" />
      <div className="flex-1 flex flex-col relative">
        <FakeHeader title="Invoice Group Detail" />
        <div className="p-8 flex flex-col gap-6 relative">
          
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-bold text-slate-800">INV-GRP-8832</h2>
                <div className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border border-blue-200">Verdict Pending</div>
              </div>
              <div className="text-slate-500">LogistiCare • 4 Legs</div>
            </div>
            <div className="flex gap-2">
               <div className="bg-white text-slate-700 border border-slate-300 px-4 py-2 rounded-lg font-medium shadow-sm text-sm">Mark as already re-attested</div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                   <tr>
                      <th className="px-6 py-3 font-medium">Leg ID</th>
                      <th className="px-6 py-3 font-medium">Service Date</th>
                      <th className="px-6 py-3 font-medium">Amount</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                   <tr className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-800">LEG-9912A</td>
                      <td className="px-6 py-4 text-slate-600">Oct 14, 2026</td>
                      <td className="px-6 py-4 text-slate-600">$120.00</td>
                      <td className="px-6 py-4"><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Pending</span></td>
                   </tr>
                   <tr className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-800">LEG-9912B</td>
                      <td className="px-6 py-4 text-slate-600">Oct 14, 2026</td>
                      <td className="px-6 py-4 text-slate-600">$120.00</td>
                      <td className="px-6 py-4"><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Pending</span></td>
                   </tr>
                </tbody>
             </table>
          </div>

          <Callout 
            x="400px" y="60px" 
            title="Mark as Already Re-attested" 
            description="Admin action to log offline re-attestations into the audit timeline." 
            phase={phase} showAtPhase={2} 
            align="right"
          />
          <Callout 
            x="150px" y="250px" 
            title="Legs List" 
            description="View and manage individual legs within an invoice group." 
            phase={phase} showAtPhase={3} 
          />
        </div>
      </div>
    </motion.div>
  );
}
