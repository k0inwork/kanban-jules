/// <reference types="vite/client" />
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Wire up the YUAN agent bridge (boardVM + almostnode bootstrap)
import { installBoardVM } from './bridge';
import { initYuanAgent, sendToYuanAgent, getYuanStatus, registerYuanWithBoardVM } from './bridge';

// Install boardVM on globalThis so wasm/boot and shims can access it
installBoardVM();
registerYuanWithBoardVM();

// Expose agent API on window for console testing & Go CLI integration
(window as any).yuanAgent = {
  init: initYuanAgent,
  send: sendToYuanAgent,
  status: getYuanStatus,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
