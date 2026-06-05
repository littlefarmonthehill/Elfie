import { useQuery } from "@tanstack/react-query";

export interface BetaFeatureInfo {
  key: string;
  title: string;
  description: string;
  votes: number;
  enabled: boolean;
}

export interface VisibleFeatures {
  visible: string[];
  beta: BetaFeatureInfo[];
}

/**
 * Loads the feature-staging state for the current user/org:
 *  - `visible`: feature keys the user can see right now (after stage + opt-in rules)
 *  - `beta`: beta-stage features available to opt into (for the Beta Features panel)
 */
export function useFeatures() {
  // Override the app-wide "cache forever" default so that stage changes
  // (beta <-> released) propagate without a hard reload: refetch on window
  // focus and on a slow interval picks up changes made in other sessions.
  const query = useQuery<VisibleFeatures>({
    queryKey: ['/api/features'],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  return {
    ...query,
    visible: query.data?.visible ?? [],
    beta: query.data?.beta ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * Returns whether a given feature key is currently visible to the user/org.
 * While loading, returns false so gated features stay hidden until confirmed.
 * NOTE: the UI gate is convenience only — gated routes must still enforce on the server.
 */
export function useFeature(key: string): boolean {
  const { visible } = useFeatures();
  return visible.includes(key);
}

/**
 * Returns whether a given feature key is currently at the BETA stage.
 * Used to show a "Beta" marker on launchers so super admins (who see every
 * beta feature automatically) and opted-in orgs know the tool is beta.
 */
export function useFeatureBeta(key: string): boolean {
  const { beta } = useFeatures();
  return beta.some(b => b.key === key);
}
