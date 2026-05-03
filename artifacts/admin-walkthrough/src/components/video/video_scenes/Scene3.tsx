import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-white flex"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.5 }}
    >
      {/* Sidebar mockup */}
      <div className="w-64 bg-[#0d162b] text-white/70 p-4 border-r border-[#1e293b]">
        <div className="h-8 w-32 bg-white/10 rounded mb-8" />
        <div className="space-y-2">
          <div className="h-8 w-full bg-white/10 rounded" />
          <div className="h-8 w-4/5 bg-white/5 rounded" />
          <div className="h-8 w-full bg-white/5 rounded" />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-[#f8fafc] flex flex-col">
        {/* Header */}
        <div className="h-16 border-b border-[#e5e7eb] bg-white flex items-center px-6">
          <div className="h-5 w-48 bg-[#e5e7eb] rounded" />
        </div>

        <div className="p-8 flex-1 overflow-hidden relative">
          <motion.div 
            className="flex items-center justify-between mb-6"
            initial={{ opacity: 0 }}
            animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          >
            <div>
              <h2 className="text-2xl font-bold">INV-90245-A</h2>
              <p className="text-[#6b7280]">Created on Oct 12, 2026</p>
            </div>
            <div className="flex gap-2">
              <div className="px-3 py-1.5 bg-[#e0f2fe] text-[#1e40af] text-sm font-medium rounded-md">Action Required</div>
            </div>
          </motion.div>

          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-4">
              <motion.div 
                className="bg-white border border-[#e5e7eb] rounded-lg p-6 shadow-sm h-64 relative overflow-hidden"
                initial={{ opacity: 0, y: 20 }}
                animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ delay: 0.1 }}
              >
                <div className="h-4 w-32 bg-[#e5e7eb] rounded mb-4" />
                <div className="space-y-2">
                  <div className="h-3 w-full bg-[#f1f5f9] rounded" />
                  <div className="h-3 w-full bg-[#f1f5f9] rounded" />
                  <div className="h-3 w-3/4 bg-[#f1f5f9] rounded" />
                </div>
                
                {/* Highlight box */}
                <motion.div 
                  className="absolute inset-0 bg-blue-500/10 border-2 border-blue-500 rounded-lg pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
                />
              </motion.div>
              
              <motion.div 
                className="bg-white border border-[#e5e7eb] rounded-lg p-6 shadow-sm h-48"
                initial={{ opacity: 0, y: 20 }}
                animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ delay: 0.2 }}
              />
            </div>
            
            <div className="space-y-4">
              <motion.div 
                className="bg-white border border-[#e5e7eb] rounded-lg p-6 shadow-sm h-96 relative"
                initial={{ opacity: 0, y: 20 }}
                animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ delay: 0.3 }}
              >
                <div className="h-4 w-24 bg-[#e5e7eb] rounded mb-4" />
                
                {/* Audit Timeline Mock */}
                <div className="space-y-6 mt-6">
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
                    <div className="space-y-1 flex-1">
                      <div className="h-3 w-full bg-[#e5e7eb] rounded" />
                      <div className="h-2 w-16 bg-[#f1f5f9] rounded" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
                    <div className="space-y-1 flex-1">
                      <div className="h-3 w-4/5 bg-[#e5e7eb] rounded" />
                      <div className="h-2 w-16 bg-[#f1f5f9] rounded" />
                    </div>
                  </div>
                </div>
                
                <motion.div 
                  className="absolute inset-0 border-2 border-blue-500 rounded-lg pointer-events-none"
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.05 }}
                  transition={{ type: "spring", bounce: 0.5 }}
                />
              </motion.div>
            </div>
          </div>

          <motion.div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#0d162b] text-white px-8 py-4 rounded-xl shadow-2xl"
            initial={{ scale: 0.8, opacity: 0, y: 20 }}
            animate={phase >= 4 ? { scale: 1, opacity: 1, y: "-50%" } : { scale: 0.8, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <h3 className="text-2xl font-bold">New claim detail layout</h3>
            <p className="text-blue-200 mt-1">Audit you can trust. Everything in one place.</p>
          </motion.div>
          
          <motion.div 
            className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-40 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 4 ? 1 : 0 }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>
    </motion.div>
  );
}
