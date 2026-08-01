import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_BASE_IS_FIXED, getApiBase, myUserId, registerUser, setApiBaseOverride, setAuthToken } from './api';

const TOKEN_KEY = 'vcp.mobile.token';
const API_BASE_KEY = 'vcp.mobile.apiBase';

interface SessionValue {
  ready: boolean;
  token: string;
  userId: string;
  isAdmin: boolean;
  apiBase: string;
  apiBaseFixed: boolean;
  register: () => Promise<void>;
  logout: () => Promise<void>;
  setApiBase: (base: string) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Hält Anmeldezustand und (optionale) API-Basis-Override, persistiert in AsyncStorage,
 * und spiegelt beides in den API-Client (`setAuthToken` / `setApiBaseOverride`).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState('');
  const [apiBase, setApiBaseState] = useState(getApiBase());

  useEffect(() => {
    (async () => {
      const [storedToken, storedBase] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(API_BASE_KEY),
      ]);
      if (storedBase) {
        setApiBaseOverride(storedBase);
        setApiBaseState(storedBase);
      }
      if (storedToken) {
        setAuthToken(storedToken);
        setToken(storedToken);
      }
      setReady(true);
    })();
  }, []);

  const register = useCallback(async () => {
    const id = await registerUser();
    setAuthToken(id);
    setToken(id);
    await AsyncStorage.setItem(TOKEN_KEY, id);
  }, []);

  const logout = useCallback(async () => {
    setAuthToken('');
    setToken('');
    await AsyncStorage.removeItem(TOKEN_KEY);
  }, []);

  const setApiBase = useCallback(async (base: string) => {
    setApiBaseOverride(base);
    setApiBaseState(getApiBase());
    if (base) await AsyncStorage.setItem(API_BASE_KEY, base);
    else await AsyncStorage.removeItem(API_BASE_KEY);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      token,
      userId: myUserId(token),
      isAdmin: token.startsWith('admin:'),
      apiBase,
      apiBaseFixed: API_BASE_IS_FIXED,
      register,
      logout,
      setApiBase,
    }),
    [ready, token, apiBase, register, logout, setApiBase],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error('useSession muss innerhalb von SessionProvider verwendet werden.');
  return ctx;
}
