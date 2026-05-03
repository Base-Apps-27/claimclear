import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#0d162b] flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      <motion.div 
        className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'linear-gradient(to right, #1e3a8a 1px, transparent 1px), linear-gradient(to bottom, #1e3a8a 1px, transparent 1px)', backgroundSize: '4rem 4rem' }}
        animate={{ y: [0, 64] }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />
      
      <div className="relative z-10 w-full max-w-4xl px-8">
        <motion.div 
          className="text-center mb-12"
          initial={{ opacity: 0, y: -20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        >
          <h2 className="text-4xl font-bold text-white mb-2">Reattestation Flow</h2>
          <p className="text-xl text-blue-200">Step 3: drafts. Step 4: commit.</p>
        </motion.div>
        
        <div className="flex justify-center gap-8 items-center">
          {/* Step 3 Card */}
          <motion.div 
            className="w-72 bg-white rounded-xl shadow-xl overflow-hidden border-2 border-transparent"
            initial={{ opacity: 0, x: -40, rotateY: -20 }}
            animate={phase >= 1 
              ? { opacity: 1, x: 0, rotateY: 0, borderColor: phase >= 2 && phase < 4 ? '#3b82f6' : 'transparent' } 
              : { opacity: 0, x: -40, rotateY: -20 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          >
            <div className="bg-[#f1f5f9] p-4 border-b border-[#e5e7eb]">
              <div className="text-sm font-bold text-[#64748b] uppercase tracking-wider">Step 3</div>
              <div className="text-lg font-bold text-[#0f172a]">Draft Verdict</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="h-8 bg-[#e0f2fe] rounded border border-[#bae6fd] flex items-center px-3 text-sm text-[#0369a1] font-medium">
                Hold for review
              </div>
              <div className="h-8 bg-[#f1f5f9] rounded border border-[#e5e7eb]" />
              <div className="h-8 bg-[#f1f5f9] rounded border border-[#e5e7eb]" />
            </div>
          </motion.div>
          
          <motion.div 
            className="text-white"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
            transition={{ type: "spring" }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </motion.div>
          
          {/* Step 4 Card */}
          <motion.div 
            className="w-72 bg-white rounded-xl shadow-xl overflow-hidden border-2 border-transparent"
            initial={{ opacity: 0, x: 40, rotateY: 20 }}
            animate={phase >= 1 
              ? { opacity: 1, x: 0, rotateY: 0, borderColor: phase >= 4 ? '#10b981' : 'transparent' } 
              : { opacity: 0, x: 40, rotateY: 20 }}
            transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.1 }}
          >
            <div className="bg-[#f1f5f9] p-4 border-b border-[#e5e7eb]">
              <div className="text-sm font-bold text-[#64748b] uppercase tracking-wider">Step 4</div>
              <div className="text-lg font-bold text-[#0f172a]">Commit to Payor</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm text-[#475569] mb-4">Review your drafted verdicts before committing.</div>
              <motion.div 
                className="h-10 bg-[#10b981] rounded flex items-center justify-center text-white font-medium shadow-sm relative overflow-hidden"
                whileHover={{ scale: 1.02 }}
              >
                {phase >= 4 && (
                  <motion.div 
                    className="absolute inset-0 bg-white/20"
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ duration: 0.6 }}
                  />
                )}
                Submit to Portal
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
