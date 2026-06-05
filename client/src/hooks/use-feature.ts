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
  const query = useQuery<VisibleFeatures>({ queryKey: ['/api/features'] });
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
