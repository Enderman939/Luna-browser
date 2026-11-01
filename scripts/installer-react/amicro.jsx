import React, { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export function FadeUp({ children, duration = 0.6, delay = 0, yOffset = 20, className = '' }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return <motion.div initial={{ opacity: 0, y: yOffset }} animate={{ opacity: 1, y: 0 }} transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] }} className={className}>{children}</motion.div>;
}

export function MorphLoader({ size = 34, color = '#f4f4f7', className = '' }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={'morph-loader ' + className} style={{ width: size, height: size, borderRadius: '50%', background: color }} />;
  return <div className={'morph-loader ' + className} style={{ width: size, height: size }}><motion.div animate={{ borderRadius: ['25%', '50%', '50%', '25%', '25%'], rotate: [0, 90, 180, 270, 360], scale: [1, 0.8, 1.1, 0.8, 1] }} transition={{ duration: 2.2, ease: 'easeInOut', repeat: Infinity }} style={{ width: size, height: size, background: color }} /></div>;
}

export function GlowButton({ children, className = '', glowColor = 'rgba(255,255,255,0.28)', onClick, disabled = false }) {
  const ref = useRef(null); const [coords, setCoords] = useState({ x: 0, y: 0 }); const [opacity, setOpacity] = useState(0);
  return <motion.button ref={ref} disabled={disabled} onMouseMove={event => { const rect = ref.current?.getBoundingClientRect(); if (rect) setCoords({ x: event.clientX - rect.left, y: event.clientY - rect.top }); }} onMouseEnter={() => setOpacity(1)} onMouseLeave={() => setOpacity(0)} onClick={onClick} whileHover={{ scale: disabled ? 1 : 1.025 }} whileTap={{ scale: disabled ? 1 : 0.97 }} className={'glow-button ' + className}>
    <span className="glow-layer" style={{ opacity, background: `radial-gradient(120px circle at ${coords.x}px ${coords.y}px, ${glowColor}, transparent 80%)` }} />
    <span className="glow-content">{children}</span>
  </motion.button>;
}
