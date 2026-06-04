import { useQuery } from "@tanstack/react-query";
import { DEFAULT_ORG_TIMEZONE } from "@/lib/utils";

/**
 * Returns the org's configured IANA timezone (from Settings), falling back to
 * the platform default (Central) until settings load. Use with the formatDate /
 * formatTime / formatDateTime helpers in @/lib/utils so every screen shows times
 * in the org's timezone with a zone abbreviation, regardless of device.
 */
export function useOrgTimezone(): string {
  const { data } = useQuery<{ timezone?: string }>({
    queryKey: ['/api/settings'],
  });
  return data?.timezone || DEFAULT_ORG_TIMEZONE;
}
