import { useEffect } from 'react';

export function useAdminScaling() {
  useEffect(() => {
    document.documentElement.classList.add('admin-mode');
    return () => {
      document.documentElement.classList.remove('admin-mode');
    };
  }, []);
}
