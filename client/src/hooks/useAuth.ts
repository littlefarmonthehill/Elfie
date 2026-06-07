// Reference: blueprint:javascript_log_in_with_replit
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isApproved: user?.isApproved ?? false,
    isAdmin: user?.role === 'admin' || user?.role === 'employee',
    // Effective super-admin: the server already reports this as false while a
    // super admin is "viewing as a regular user", so all existing gates follow.
    superAdmin: user?.superAdmin ?? false,
    // The real super-admin flag, used only to show the preview toggle/banner.
    actualSuperAdmin: (user as any)?.actualSuperAdmin ?? user?.superAdmin ?? false,
    previewAsUser: (user as any)?.previewAsUser ?? false,
  };
}
