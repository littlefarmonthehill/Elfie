import { useState } from 'react';
import DashboardNav, { DashboardType } from '../DashboardNav';

export default function DashboardNavExample() {
  const [active, setActive] = useState<DashboardType>('dashboard');
  return <DashboardNav active={active} onSelect={setActive} />;
}
