import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ScanSessionContextValue {
  active: boolean;
  setActive: (v: boolean) => void;
  /**
   * When set, scans that resolve to an inventory lot will open the detail
   * modal with this tab pre-selected (e.g. "details" for the My Inventory tab).
   * Components like ListomaticPriority set this while mounted so a scan from
   * inside the modal lands on the most useful tab.
   */
  inventoryInitialTab: string | null;
  setInventoryInitialTab: (v: string | null) => void;
}

const ScanSessionContext = createContext<ScanSessionContextValue>({
  active: false,
  setActive: () => {},
  inventoryInitialTab: null,
  setInventoryInitialTab: () => {},
});

export function ScanSessionProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState(false);
  const [inventoryInitialTab, setInventoryInitialTabState] = useState<string | null>(null);
  const setActive = useCallback((v: boolean) => setActiveState(v), []);
  const setInventoryInitialTab = useCallback((v: string | null) => setInventoryInitialTabState(v), []);
  return (
    <ScanSessionContext.Provider value={{ active, setActive, inventoryInitialTab, setInventoryInitialTab }}>
      {children}
    </ScanSessionContext.Provider>
  );
}

export function useScanSession() {
  return useContext(ScanSessionContext);
}
