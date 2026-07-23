import { useSyncExternalStore } from 'react';
import { ensureStarted, getState, subscribe, type DemoState } from './store';

/** Bindet Komponenten an den zentralen Demo-Store. Jede Store-Änderung (Aktion oder
 *  zeitgesteuerter Tick) rendert die Abonnenten neu — Feed und Profil bleiben synchron. */
export function useDemo(): DemoState {
  ensureStarted();
  return useSyncExternalStore(subscribe, getState, getState);
}
