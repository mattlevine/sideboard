import { createContext, useContext, type ReactNode } from 'react';
import type { FollowUpBehavior } from '@sideboard-ai/core';

const FollowUpBehaviorContext = createContext<FollowUpBehavior>('steer');

/** Settings → Agents → Follow-up behavior (default steer). */
export function FollowUpBehaviorProvider({
  followUpBehavior,
  children,
}: {
  followUpBehavior: FollowUpBehavior;
  children: ReactNode;
}) {
  return (
    <FollowUpBehaviorContext.Provider value={followUpBehavior}>
      {children}
    </FollowUpBehaviorContext.Provider>
  );
}

export function useFollowUpBehavior(): FollowUpBehavior {
  return useContext(FollowUpBehaviorContext);
}
