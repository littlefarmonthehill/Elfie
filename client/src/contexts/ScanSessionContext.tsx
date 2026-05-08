import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ScanSessionContextValue {
  active: boolean;
  setActive: (v: boolean) => void;
}

const ScanSessionContext = createContext<ScanSessionContextValue>({
  active: false,
  setActive: () => {},
});

export function ScanSessionProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState(false);
  const setActive = useCallback((v: boolean) => setActiveState(v), []);
  return (
    <ScanSessionContext.Provider value={{ active, setActive }}>
      {children}
    </ScanSessionContext.Provider>
  );
}

export function useScanSession() {
  return useContext(ScanSessionContext);
}
