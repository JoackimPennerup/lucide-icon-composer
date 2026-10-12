import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProofHarness } from './proof/ProofHarness';
import './proof/styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ProofHarness /></React.StrictMode>
);
