import './style.css';
import { createSessionController } from './session.js';
import { mountApp } from './ui.js';

const session = createSessionController();
mountApp(session);
session.start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const worker = navigator.serviceWorker;
  const wasControlled = Boolean(worker.controller);
  let updateReady = false;
  // Progress is saved as it changes, so reloading while hidden loses nothing and interrupts nobody.
  const reloadIfHidden = () => {
    if (updateReady && document.visibilityState === 'hidden') location.reload();
  };
  worker.addEventListener('controllerchange', () => {
    updateReady = wasControlled;
    reloadIfHidden();
  });
  worker.register('/sw.js').then(registration => {
    // An installed app can resume for days without the navigation that normally triggers a check.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
      reloadIfHidden();
    });
  }).catch(() => {});
}
