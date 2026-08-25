import { createContext, useContext, type ReactNode } from 'react';

const ShowCostContext = createContext(false);

/** Gates USD cost chips / Σ / sidebar spend. Default false (Settings → Advanced). */
export function ShowCostProvider({
  showCost,
  children,
}: {
  showCost: boolean;
  children: ReactNode;
}) {
  return <ShowCostContext.Provider value={showCost}>{children}</ShowCostContext.Provider>;
}

export function useShowCost(): boolean {
  return useContext(ShowCostContext);
}
