import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export const Callout = ({
  x, y, title, description, phase, showAtPhase, align = 'left'
}: {
  x: number | string;
  y: number | string;
  title: string;
  description: string;
  phase: number;
  showAtPhase: number;
  align?: 'left' | 'right';
}) => {
  const isVisible = phase >= showAtPhase;
  return (
    <motion.div 
      className={`absolute z-50 flex flex-col gap-2 ${align === 'left' ? 'items-start' : 'items-end'}`}
      style={{ top: y, left: x }}
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={isVisible ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 20 }}
      transition={{ type: 'spring', damping: 20, stiffness: 200 }}
    >
      <div className={`flex items-center gap-3 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className="w-16 h-0.5 bg-primary/80" />
        <div className="w-4 h-4 rounded-full bg-primary animate-pulse" />
      </div>
      <div className={`p-4 bg-white shadow-2xl rounded-xl border border-primary/20 max-w-sm ${align === 'right' ? 'text-right' : 'text-left'}`}>
        <h3 className="font-bold text-primary mb-1 uppercase tracking-wider text-sm">{title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
      </div>
    </motion.div>
  );
};

export const FakeSidebar = ({ active = '' }) => (
  <div className="w-64 bg-slate-900 h-full flex flex-col p-4 shrink-0 text-slate-300 gap-2">
    <div className="text-white font-black text-xl mb-8 flex items-center gap-2">
      <div className="w-6 h-6 rounded bg-primary" />
      ClaimClear
    </div>
    {['Dashboard', 'Queue', 'Claims', 'Invoice Groups', 'Attestation', 'Settings'].map(item => (
      <div key={item} className={`px-3 py-2 rounded-lg cursor-pointer font-medium text-sm ${active === item ? 'bg-primary/20 text-primary' : 'bg-slate-800/50 hover:bg-slate-800'}`}>
        {item}
      </div>
    ))}
  </div>
);

export const FakeHeader = ({ title }: { title: string }) => (
  <div className="h-16 border-b border-slate-200 bg-white flex items-center px-8 shrink-0 justify-between">
    <h1 className="text-xl font-bold text-slate-800">{title}</h1>
    <div className="flex items-center gap-4">
      <div className="w-8 h-8 rounded-full bg-slate-200" />
    </div>
  </div>
);
