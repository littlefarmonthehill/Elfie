import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Opens a persistent Server-Sent Events connection to /api/events.
 *
 * On each named event the relevant TanStack Query cache entries are invalidated
 * so all mounted queries refetch immediately — giving every team member on the
 * same org near-instant updates when another user makes a change.
 *
 * EventSource reconnects automatically after network interruptions or server
 * restarts (browser handles the retry loop).
 */
export function useSSE() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/events", { withCredentials: true });

    const inv = (...keys: string[]) =>
      keys.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));

    es.addEventListener("picklist.pulled", () =>
      inv("/api/picklist", "/api/picklist/order-status")
    );

    es.addEventListener("picklist.fulfilled", () =>
      inv("/api/fulfillment")
    );

    es.addEventListener("order.workflow_changed", () =>
      inv("/api/fulfillment")
    );

    es.addEventListener("order.updated", () =>
      inv("/api/fulfillment")
    );

    es.addEventListener("order.synced", () =>
      inv("/api/fulfillment", "/api/picklist", "/api/orders/dashboard", "/api/orders/stats")
    );

    es.addEventListener("warehouse.location_changed", () =>
      inv("/api/warehouse/locations/inventory")
    );

    return () => es.close();
  }, [queryClient]);
}
