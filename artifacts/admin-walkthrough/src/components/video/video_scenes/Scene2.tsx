import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#f8fafc] flex flex-col pt-12 px-16"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5 }}
    >
      <div className="max-w-5xl w-full mx-auto">
        <motion.div 
          className="mb-8"
          initial={{ opacity: 0, x: -20 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-3xl font-bold text-[#111827]">Command Center</h2>
          <p className="text-[#4b5563] mt-1">Welcome back, Admin — here's what's moving today.</p>
        </motion.div>

        {/* Highlight text overlay */}
        <motion.div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#0d162b] text-white px-8 py-4 rounded-xl shadow-2xl border border-blue-500/30"
          initial={{ scale: 0.9, opacity: 0, y: "-40%" }}
          animate={phase >= 4 ? { scale: 1, opacity: 1, y: "-50%" } : { scale: 0.9, opacity: 0, y: "-40%" }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        >
          <h3 className="text-2xl font-bold">At-Risk, Lost, Reclaimed — now separated</h3>
          <p className="text-blue-200 mt-1">Clearer rules for lost claim calculations.</p>
        </motion.div>

        <div className="grid grid-cols-4 gap-4">
          <KpiCard title="Invoices pending" value="142" sub="42 need evidence" delay={0.1} show={phase >= 2} />
          
          <motion.div className="relative">
            {phase >= 3 && (
              <motion.div 
                className="absolute -inset-2 border-2 border-blue-500 rounded-lg z-10 pointer-events-none"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: [0, 1, 0.5, 1], scale: 1 }}
                transition={{ duration: 1.5 }}
              />
            )}
            <KpiCard title="At risk" value="$42,850" sub="$31,500 claim + prepay" tone="danger" delay={0.2} show={phase >= 2} />
          </motion.div>

          <motion.div className="relative">
            {phase >= 3 && (
              <motion.div 
                className="absolute -inset-2 border-2 border-blue-500 rounded-lg z-10 pointer-events-none"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: [0, 1, 0.5, 1], scale: 1 }}
                transition={{ duration: 1.5, delay: 0.2 }}
              />
            )}
            <KpiCard title="Already lost" value="$5,120" sub="$2,400 expired · $2,720 denied" tone="neutral" delay={0.3} show={phase >= 2} />
          </motion.div>

          <motion.div className="relative">
            {phase >= 3 && (
              <motion.div 
                className="absolute -inset-2 border-2 border-blue-500 rounded-lg z-10 pointer-events-none"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: [0, 1, 0.5, 1], scale: 1 }}
                transition={{ duration: 1.5, delay: 0.4 }}
              />
            )}
            <KpiCard title="Reclaimed" value="$18,450" sub="raw approved" tone="good" delay={0.4} show={phase >= 2} />
          </motion.div>
        </div>
      </div>
      
      {/* Dim overlay when callout appears */}
      <motion.div 
        className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-40 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 4 ? 1 : 0 }}
        transition={{ duration: 0.5 }}
      />
    </motion.div>
  );
}

function KpiCard({ title, value, sub, tone = "neutral", show, delay }: { title: string, value: string, sub: string, tone?: string, show: boolean, delay: number }) {
  const color = tone === 'danger' ? '#ef4444' : tone === 'good' ? '#10b981' : '#111827';
  
  return (
    <motion.div 
      className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm"
      initial={{ opacity: 0, y: 20 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5, delay }}
    >
      <div className="text-[11px] uppercase tracking-wide font-semibold mb-2 text-[#6b7280]">{title}</div>
      <div className="text-3xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs mt-2 text-[#6b7280]">{sub}</div>
    </motion.div>
  );
}
