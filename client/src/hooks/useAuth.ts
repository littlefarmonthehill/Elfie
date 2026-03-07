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
    superAdmin: user?.superAdmin ?? false,
  };
}
