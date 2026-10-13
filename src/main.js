import './style.css';
import { createSessionController } from './session.js';
import { mountApp } from './ui.js';

const session = createSessionController();
mountApp(session);
session.start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
