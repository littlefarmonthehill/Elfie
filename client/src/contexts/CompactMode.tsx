import { createContext, useContext } from "react";

const CompactModeContext = createContext(false);

export const CompactModeProvider = CompactModeContext.Provider;

export function useCompactMode() {
  return useContext(CompactModeContext);
}
