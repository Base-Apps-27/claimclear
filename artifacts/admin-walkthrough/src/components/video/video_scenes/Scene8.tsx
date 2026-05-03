import React from 'react';
import { motion } from 'framer-motion';

export function Scene8() {
  return (
    <motion.div 
      className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="absolute inset-0 opacity-20"
        style={{ background: 'radial-gradient(circle at center, var(--color-primary), transparent 60%)' }}
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 10, repeat: Infinity }}
      />
      <div className="relative z-10 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.4 }}
        >
          <div className="w-16 h-16 bg-primary rounded-xl mb-6 mx-auto flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-white animate-pulse" />
          </div>
          <h2 className="text-5xl font-bold text-white mb-4 tracking-tight">That's the tour.</h2>
          <div className="h-1 w-24 bg-primary mx-auto rounded-full mb-6" />
          <p className="text-2xl text-slate-300">You're ready to triage your first claim.</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
