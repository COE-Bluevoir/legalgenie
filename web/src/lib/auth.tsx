import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AuthState, AuthUser } from "@/lib/api";
import { getAuthState, subscribeAuth, clearAuthSession, AuthAPI } from "@/lib/api";

export type AuthContextValue = {
  auth: AuthState;
  logout: () => void;
  login: typeof AuthAPI.login;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [auth, setAuth] = useState<AuthState>(() => getAuthState());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeAuth((state) => setAuth(state));
    return () => unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    auth,
    loading,
    login: async (credentials) => {
      setLoading(true);
      const result = await AuthAPI.login(credentials);
      setLoading(false);
      return result;
    },
    logout: () => {
      clearAuthSession();
    },
  }), [auth, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useCurrentUser(): AuthUser | null {
  return useAuth().auth.user;
}
