import { api } from './api.js';
import { setError } from './dialogs.js';
import { $, state } from './state.js';

const toggle = $('notify-device');
const ABOUT = 'Overheated and cold holdings, and accounts that stop updating.';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const within = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('The browser did not answer. Try again.')), ms)),
  ]);

const sameKey = (buffer, bytes) => {
  const given = new Uint8Array(buffer ?? []);
  return given.length === bytes.length && given.every((b, i) => b === bytes[i]);
};

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration ? registration.pushManager.getSubscription() : null;
}

async function renderNotify() {
  const blocked = !supported()
    ? /iPhone|iPad|iPod/.test(navigator.userAgent)
      ? 'Add Stashboard to the Home Screen and turn this on there.'
      : 'This browser cannot show notifications.'
    : Notification.permission === 'denied'
      ? 'Notifications are blocked for this site in the browser settings.'
      : null;
  $('notify-text').textContent = blocked ?? ABOUT;
  toggle.disabled = Boolean(blocked);
  toggle.checked = !blocked && Boolean(await currentSubscription());
}

async function turnOn() {
  if ((await Notification.requestPermission()) !== 'granted') return;
  const key = keyBytes(state.data.pushKey);
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await within(
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
    20_000,
  );
  try {
    await api('/api/push', { method: 'POST', body: JSON.stringify(subscription) });
  } catch (err) {
    await subscription.unsubscribe();
    throw err;
  }
}

export async function forgetDevice() {
  if (!supported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api('/api/push', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(
    () => null,
  );
  await subscription.unsubscribe();
}

toggle.addEventListener('change', async () => {
  const on = toggle.checked;
  toggle.disabled = true;
  setError('notify-error', null);
  try {
    await (on ? turnOn() : forgetDevice());
  } catch (err) {
    setError('notify-error', err.message);
  }
  await renderNotify();
});

$('open-account').addEventListener('click', () => {
  setError('notify-error', null);
  void renderNotify();
});
