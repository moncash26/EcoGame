// Puente entre el juego (game.js) y las funciones nativas de iOS/Android.
// Se empaqueta con esbuild en www/native.js y se carga ANTES del juego.
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';
import {
  AdMob, AdmobConsentStatus,
  RewardAdPluginEvents, InterstitialAdPluginEvents,
} from '@capacitor-community/admob';
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import CFG from '../eco.config.json';

const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
const isNative = platform === 'ios' || platform === 'android';
const ADS = CFG.admob[platform] || CFG.admob.android;
const SAVE_KEY = 'eco-save';
const LEDGER_KEY = 'eco-granted-tx';

const log = (...a) => { try { console.log('[ECO]', ...a); } catch (_) {} };
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- guardado
// localStorage del WebView puede borrarse en iOS si falta espacio.
// Guardamos una copia en Preferences (almacenamiento nativo) y la restauramos al abrir.
let saveTimer = null, pendingSave = null;
function save(json) {
  pendingSave = json;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { Preferences.set({ key: SAVE_KEY, value: pendingSave }).catch(() => {}); }, 400);
}
async function flushSave() {
  if (pendingSave == null) return;
  clearTimeout(saveTimer);
  try { await Preferences.set({ key: SAVE_KEY, value: pendingSave }); } catch (_) {}
}
async function restoreSave() {
  try {
    const { value } = await Preferences.get({ key: SAVE_KEY });
    const local = localStorage.getItem(SAVE_KEY);
    if (value && !local) localStorage.setItem(SAVE_KEY, value);
    else if (value && local) {
      // conserva la copia más avanzada
      const a = JSON.parse(value), b = JSON.parse(local);
      const score = x => (x.stats && x.stats.played || 0) * 1e6 + (x.luz || 0);
      if (score(a) > score(b)) localStorage.setItem(SAVE_KEY, value);
    }
  } catch (_) {}
}

// ---------------------------------------------------------------- háptica
let lastBuzz = 0;
function haptic(ms) {
  const t = Date.now(); if (t - lastBuzz < 40) return; lastBuzz = t;
  const total = Array.isArray(ms) ? ms.reduce((a, b) => a + b, 0) : ms;
  const style = total >= 60 ? ImpactStyle.Heavy : total >= 20 ? ImpactStyle.Medium : ImpactStyle.Light;
  Haptics.impact({ style }).catch(() => {});
}

// ---------------------------------------------------------------- anuncios
let adsReady = false, canRequestAds = false, npa = false;
const adPrivacyListeners = [];
let privacyRequired = false;
const rewardedState = { loaded: false, loading: null };
const interState = { loaded: false, loading: null };

async function initAds() {
  try {
    await AdMob.initialize({ initializeForTesting: CFG.adsTestMode, maxAdContentRating: 'Teen' });

    // 1) Consentimiento (Google UMP): obligatorio en Europa, Reino Unido, Suiza y algunos estados de EE. UU.
    let info = await AdMob.requestConsentInfo();
    if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
      info = await AdMob.showConsentForm();
    }
    canRequestAds = info.canRequestAds !== false;
    privacyRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';
    adPrivacyListeners.forEach(f => f(privacyRequired));

    // 2) iOS: permiso de rastreo (App Tracking Transparency). Si lo niega, se muestran anuncios no personalizados.
    if (platform === 'ios') {
      try {
        let t = await AdMob.trackingAuthorizationStatus();
        if (t.status === 'notDetermined') { await AdMob.requestTrackingAuthorization(); t = await AdMob.trackingAuthorizationStatus(); }
        npa = t.status !== 'authorized';
      } catch (_) {}
    }
    adsReady = true;
    preload('rewarded'); preload('inter');
  } catch (e) { log('ads init error', e); }
}

function preload(kind) {
  if (!adsReady || !canRequestAds) return Promise.resolve(false);
  const st = kind === 'rewarded' ? rewardedState : interState;
  if (st.loaded) return Promise.resolve(true);
  if (st.loading) return st.loading;
  const opts = { adId: kind === 'rewarded' ? ADS.rewarded : ADS.interstitial, isTesting: CFG.adsTestMode, npa };
  st.loading = (kind === 'rewarded' ? AdMob.prepareRewardVideoAd(opts) : AdMob.prepareInterstitial(opts))
    .then(() => { st.loaded = true; return true; })
    .catch(e => { log('load fail', kind, e); return false; })
    .finally(() => { st.loading = null; });
  return st.loading;
}

// Escucha eventos del anuncio mientras está en pantalla y limpia los listeners al cerrar.
async function listen(pairs) {
  const hs = await Promise.all(pairs.map(([ev, fn]) => AdMob.addListener(ev, fn)));
  return () => hs.forEach(h => h.remove());
}

// Devuelve true solo si el jugador vio el video y ganó la recompensa. Se resuelve al cerrar el anuncio.
async function showRewarded() {
  if (!adsReady) await Promise.race([waitFor(() => adsReady), wait(4000)]);
  const ok = await Promise.race([preload('rewarded'), wait(8000).then(() => false)]);
  if (!ok) return false;
  rewardedState.loaded = false;
  let rewarded = false, close;
  const closed = new Promise(res => { close = res; });
  const off = await listen([
    [RewardAdPluginEvents.Rewarded, () => { rewarded = true; }],
    [RewardAdPluginEvents.Dismissed, () => close()],
    [RewardAdPluginEvents.FailedToShow, () => close()],
  ]);
  AdMob.showRewardVideoAd().then(() => { rewarded = true; }).catch(e => { log('show rewarded fail', e); close(); });
  await Promise.race([closed, wait(5 * 60000)]);
  await wait(250);
  off(); preload('rewarded');
  return rewarded;
}

async function showInterstitial() {
  if (!adsReady || !interState.loaded) { preload('inter'); return false; }
  interState.loaded = false;
  let close; const closed = new Promise(res => { close = res; });
  const off = await listen([
    [InterstitialAdPluginEvents.Dismissed, () => close()],
    [InterstitialAdPluginEvents.FailedToShow, () => close()],
  ]);
  AdMob.showInterstitial().catch(e => { log('show inter fail', e); close(); });
  await Promise.race([closed, wait(90000)]);
  off(); preload('inter'); preload('rewarded');
  return true;
}

function waitFor(fn) { return new Promise(r => { const i = setInterval(() => { if (fn()) { clearInterval(i); r(true); } }, 150); }); }

// ---------------------------------------------------------------- compras
const PRODUCTS = CFG.products;                          // id del juego -> { store, consumable }
const byStoreId = {}; Object.entries(PRODUCTS).forEach(([id, p]) => { byStoreId[p.store] = id; });
const prices = {};
let grantFn = null;
let ledger = [];

async function loadLedger() {
  try { const { value } = await Preferences.get({ key: LEDGER_KEY }); ledger = value ? JSON.parse(value) : []; } catch (_) { ledger = []; }
}
function markGranted(txId) {
  if (!txId) return;
  ledger.push(txId); ledger = ledger.slice(-300);
  Preferences.set({ key: LEDGER_KEY, value: JSON.stringify(ledger) }).catch(() => {});
}
function grantOnce(tx) {
  const id = byStoreId[tx.productIdentifier]; if (!id) return false;
  const key = tx.transactionId || tx.purchaseToken || tx.orderId;
  if (key && ledger.includes(key)) return false;
  if (grantFn) grantFn(id);
  markGranted(key);
  return true;
}

async function initPurchases() {
  try {
    const { isBillingSupported } = await NativePurchases.isBillingSupported();
    if (!isBillingSupported) return;
    const ids = Object.values(PRODUCTS).map(p => p.store);
    const { products } = await NativePurchases.getProducts({ productIdentifiers: ids, productType: PURCHASE_TYPE.INAPP });
    products.forEach(p => { const id = byStoreId[p.identifier]; if (id) prices[id] = p.priceString; });

    // Pagos que quedaron pendientes (p. ej. efectivo en Android) o se interrumpieron al cerrar la app.
    NativePurchases.addListener('transactionUpdated', tx => { settle(tx).catch(() => {}); });
    await recoverUnfinished();
  } catch (e) { log('iap init error', e); }
}

async function settle(tx) {
  const id = byStoreId[tx.productIdentifier]; if (!id) return 'error';
  if (platform === 'android' && tx.purchaseState && tx.purchaseState !== '1') return 'pending';
  grantOnce(tx);
  if (platform === 'android' && PRODUCTS[id].consumable && tx.purchaseToken) {
    await NativePurchases.consumePurchase({ purchaseToken: tx.purchaseToken }).catch(() => {});
  }
  return 'ok';
}

async function recoverUnfinished() {
  try {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    for (const tx of purchases || []) {
      const id = byStoreId[tx.productIdentifier]; if (!id) continue;
      if (!PRODUCTS[id].consumable) { if (grantFn) grantFn(id); continue; } // "Sin anuncios": siempre activo si está comprado
      if (platform === 'android') await settle(tx);
    }
  } catch (_) {}
}

async function buy(id) {
  const p = PRODUCTS[id]; if (!p) return 'error';
  try {
    const tx = await NativePurchases.purchaseProduct({
      productIdentifier: p.store, productType: PURCHASE_TYPE.INAPP,
      isConsumable: false, autoAcknowledgePurchases: true, quantity: 1,
    });
    return await settle(tx);
  } catch (e) {
    const msg = String(e && (e.message || e.code || e)).toLowerCase();
    if (msg.includes('cancel')) return 'cancel';
    log('buy error', e); return 'error';
  }
}

async function restore() {
  try {
    await NativePurchases.restorePurchases().catch(() => {});
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    let found = false;
    (purchases || []).forEach(tx => {
      const id = byStoreId[tx.productIdentifier];
      if (id && !PRODUCTS[id].consumable) { if (grantFn) grantFn(id); found = true; }
    });
    return found;
  } catch (_) { return false; }
}

// ---------------------------------------------------------------- ranking global (Firebase, opcional)
async function rankingDb() {
  if (!CFG.firebase) return null;
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
  ]);
  const app = initializeApp(CFG.firebase);
  const a = auth.initializeAuth(app, { persistence: auth.indexedDBLocalPersistence });
  const user = a.currentUser || (await auth.signInAnonymously(a)).user;
  const db = fs.getFirestore(app);
  // Misma interfaz mínima que usa el juego: doc(path).set(data) y collection(...).orderBy().limit().onSnapshot()
  return {
    doc: path => ({ set: data => fs.setDoc(fs.doc(db, path), { ...data, uid: user.uid }) }),
    collection: name => {
      const q = { field: 'best', dir: 'desc', n: 100 };
      const api = {
        orderBy(f, d) { q.field = f; q.dir = d || 'asc'; return api; },
        limit(n) { q.n = n; return api; },
        onSnapshot(cb, err) {
          return fs.onSnapshot(fs.query(fs.collection(db, name), fs.orderBy(q.field, q.dir), fs.limit(q.n)),
            snap => cb({ docs: snap.docs.map(d => ({ id: d.id, data: () => d.data() })) }), err);
        },
      };
      return api;
    },
  };
}

// ---------------------------------------------------------------- ciclo de vida y botón atrás
const pauseHandlers = [];
let backHandler = null;
App.addListener('appStateChange', ({ isActive }) => { if (!isActive) { pauseHandlers.forEach(f => f()); flushSave(); } });
App.addListener('pause', () => { pauseHandlers.forEach(f => f()); flushSave(); });
App.addListener('backButton', () => { if (backHandler) backHandler(); });

// ---------------------------------------------------------------- API para el juego
if (isNative) window.EcoNative = {
  platform,
  storeName: platform === 'ios' ? 'App Store' : 'Google Play',
  save, haptic,
  showRewarded, showInterstitial,
  price: id => prices[id] || null,
  buy, restore,
  rankingDb: CFG.firebase ? rankingDb : null,
  onGrant: fn => { grantFn = fn; },
  onPause: fn => pauseHandlers.push(fn),
  onBack: fn => { backHandler = fn; },
  onAdPrivacy: fn => { adPrivacyListeners.push(fn); fn(privacyRequired); },
  adPrivacyOptions: () => AdMob.showPrivacyOptionsForm().catch(() => {}),
  openPrivacy: () => { window.open(CFG.privacyUrl, '_blank'); },
  exit: () => { flushSave().finally(() => App.exitApp()); },
  ready: () => {
    SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {});
    // Anuncios y compras arrancan después de que el juego ya se ve, para no demorar la apertura.
    setTimeout(() => { initAds(); initPurchases(); }, 600);
  },
};

// Arranque: restaurar partida guardada y luego cargar el juego.
(async () => {
  if (isNative) {
    SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {});
    await Promise.all([restoreSave(), loadLedger()]);
  }
  const s = document.createElement('script');
  s.src = 'game.js';
  document.body.appendChild(s);
})();
