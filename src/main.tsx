import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ProofHarness } from './proof/ProofHarness';
import { Editor } from './editor/Editor';
import './proof/styles.css';
import './editor/editor.css';
import './editor/lucide-theme.css';

function App() {
  const [proof, setProof] = useState(false);
  return <>
    <div hidden={proof}><Editor openProof={() => setProof(true)} /></div>
    {proof && <><div className="proof-return"><button onClick={() => setProof(false)}>← Back to designer</button></div><ProofHarness /></>}
  </>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
