import { motion } from 'framer-motion';

export function Scene5() {
  return (
    <motion.div 
      className="absolute inset-0 bg-[#0d162b] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="absolute inset-0 opacity-30"
        style={{ background: 'radial-gradient(circle at 50% 50%, #3b82f6 0%, transparent 50%)' }}
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      
      <div className="relative z-10 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.4 }}
        >
          <h2 className="text-5xl font-bold text-white mb-4 tracking-tight">ClaimClear</h2>
          <div className="h-1 w-24 bg-blue-500 mx-auto rounded-full mb-6" />
          <p className="text-2xl text-blue-200">Your week in review.</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
