import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { FadeUp, GlowButton, MorphLoader } from './amicro.jsx';
import './renderer.css';

const defaultPath = window.installer.defaultInstallPath;

function App() {
  const [installPath, setInstallPath] = useState(defaultPath);
  const [desktop, setDesktop] = useState(true);
  const [startMenu, setStartMenu] = useState(true);
  const [launch, setLaunch] = useState(true);
  const [phase, setPhase] = useState('ready');
  const [error, setError] = useState('');
  const version = window.installer.version || '1.1.3';
  useEffect(() => { document.body.classList.add('ready'); window.installer.onProgress(message => setStatus(message)); window.installer.ready(); }, []);
  const [status, setStatus] = useState('Ready to install');
  async function browse() { const value = await window.installer.chooseFolder(installPath); if (value) setInstallPath(value); }
  async function install() {
    if (phase === 'installing') return;
    setError(''); setPhase('installing');
    try { await window.installer.install({ installPath, desktop, startMenu, launch }); setPhase('done'); }
    catch (cause) { setError((cause?.message || 'Installation could not be completed.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); setPhase('ready'); }
  }
  function close() { if (phase !== 'installing') window.installer.close(); }
  return <main className="installer-shell">
    <header className="window-bar"><span className="window-caption">LUNA SETUP</span><button className="window-close" onClick={close} disabled={phase === 'installing'} aria-label="Close">×</button></header>
    <section className="layout">
      <aside className="sidebar">
        <FadeUp delay={0.04}><div className="logo-orbit"><img src="app.png" alt="Luna" /></div></FadeUp>
        <FadeUp delay={0.12}><h1>luna</h1></FadeUp>
        <FadeUp delay={0.2}><p className="tagline">A calmer way<br />to browse.</p></FadeUp>
        <FadeUp delay={0.32}><div className="side-signals"><span>DOWNLOAD QUEUE</span><span>PRIVATE BY DEFAULT</span><span>BUILT FOR FOCUS</span></div></FadeUp>
        <span className="version">Luna Browser {version}</span>
      </aside>
      <section className="content">
        <FadeUp delay={0.1}><h2>Install Luna Browser</h2></FadeUp>
        <FadeUp delay={0.16}><p className="subtitle">A focused, private home for the web.</p></FadeUp>
        <FadeUp delay={0.23}><label className="eyebrow" htmlFor="install-location">INSTALL LOCATION</label><div className="path-card"><input id="install-location" value={installPath} onChange={event => setInstallPath(event.target.value)} disabled={phase !== 'ready'} /><button onClick={browse} disabled={phase !== 'ready'} aria-label="Choose folder">…</button></div></FadeUp>
        <FadeUp delay={0.3}><label className="eyebrow included-label">{phase === 'ready' && !error ? 'INCLUDED WITH LUNA' : 'INSTALLATION STATUS'}</label><div className="feature-card" style={phase !== 'ready' || error ? { display: 'flex', alignItems: 'center' } : undefined}>
          {phase === 'ready' && !error && <><span>◌ &nbsp;Fast segmented downloads</span><span>◌ &nbsp;Encrypted browser backup</span><span>◌ &nbsp;Website permission center</span><span>◌ &nbsp;Isolated website apps</span></>}
          <AnimatePresence mode="wait">
            {phase === 'installing' && <motion.div key="installing" className="installing-row" role="status" style={{ position: 'static', margin: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><MorphLoader size={24} /><span>{status}</span></motion.div>}
            {phase === 'done' && <motion.div key="done" className="installing-row done" role="status" style={{ position: 'static', margin: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span className="done-mark">✓</span><span>Luna is ready.</span></motion.div>}
            {error && <motion.div key="error" className="error-row" role="alert" style={{ position: 'static', margin: 0, maxHeight: 72, overflowY: 'auto', overflowWrap: 'anywhere' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{error}</motion.div>}
          </AnimatePresence>
        </div></FadeUp>
        <FadeUp delay={0.36}><div className="options"><Option disabled={phase !== 'ready'} checked={desktop} setChecked={setDesktop}>Create a desktop shortcut</Option><Option disabled={phase !== 'ready'} checked={startMenu} setChecked={setStartMenu}>Add to the Start menu</Option><Option disabled={phase !== 'ready'} checked={launch} setChecked={setLaunch}>Launch Luna after installation</Option></div></FadeUp>
        <FadeUp delay={0.43}><GlowButton disabled={phase === 'installing'} onClick={phase === 'done' ? window.installer.launch : install}>{phase === 'done' ? 'Launch Luna' : 'Install Luna'}</GlowButton></FadeUp>
      </section>
    </section>
  </main>;
}

function Option({ checked, setChecked, children, disabled }) { return <label className="option"><input type="checkbox" checked={checked} disabled={disabled} onChange={event => setChecked(event.target.checked)} /><span className="checkbox-mark">✓</span><span>{children}</span></label>; }

createRoot(document.getElementById('root')).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
