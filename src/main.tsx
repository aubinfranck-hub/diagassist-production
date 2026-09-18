import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ShopApp from './components/shop/ShopApp.tsx';
import './index.css';

// Section boutique/CRM : totalement indépendante de l'app de diagnostic, activée uniquement
// sur les chemins /boutique* — permet un accès public direct (Google/Facebook/TikTok) sans
// jamais charger l'app de diagnostic (auth, scanner, etc.).
const isShopRoute = window.location.pathname.startsWith('/boutique');

// Register PWA Service Worker for offline support and mobile install prompt
if ('serviceWorker' in navigator) {
  // Proactively clear old caches to free users from any previously stuck v1 caches
  if ('caches' in window) {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => {
        if (cacheName !== 'diagassist-cache-v3') {
          console.log('[Cache Cleanup] Deleting legacy cache:', cacheName);
          caches.delete(cacheName).catch(err => console.warn('Cache delete failed:', err));
        }
      });
    }).catch(err => console.error('Error listing caches:', err));
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('DiagAssist PWA Service Worker enregistré avec succès:', registration.scope);
      })
      .catch((error) => {
        console.error('Échec de l\'enregistrement du Service Worker:', error);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isShopRoute ? <ShopApp /> : <App />}
  </StrictMode>,
);

