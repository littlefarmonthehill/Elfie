import { useState } from 'react';
import SettingsModal from '../SettingsModal';
import { Button } from '@/components/ui/button';

export default function SettingsModalExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Settings</Button>
      <SettingsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
