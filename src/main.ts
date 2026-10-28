import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { AppStore } from './app/store';
import { AudioEngine } from './engine/AudioEngine';
import { requestPersistentStorage } from './storage/patchStore';
import { App } from './ui/App';

registerSW({ immediate: true });

const store = new AppStore();
const engine = new AudioEngine();
const app = new App(document.getElementById('app')!, store, engine);

// Handy for debugging from the browser console and for automated smoke tests.
(window as unknown as { maenglerbox: unknown }).maenglerbox = { store, engine };

void store.init().then(() => app.mount());
void requestPersistentStorage();
