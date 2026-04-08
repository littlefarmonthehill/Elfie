import { useState, useDeferredValue, useRef, useEffect } from "react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchDrawerProps {
  open: boolean;
  onClose: () => void;
  onQueryChange?: (q: string) => void;
  placeholder: string;
  title: string;
  accentBorder: string;
  accentIcon: string;
  children: (query: string, deferred: string, close: () => void) => React.ReactNode;
}

export function SearchDrawer({
  open,
  onClose,
  onQueryChange,
  placeholder,
  title,
  accentBorder,
  accentIcon,
  children,
}: SearchDrawerProps) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      onQueryChange?.('');
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open]);

  function updateQuery(v: string) {
    setQuery(v);
    onQueryChange?.(v);
  }

  function handleClose() {
    setQuery('');
    onQueryChange?.('');
    onClose();
  }

  return (
    <Drawer open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DrawerContent className="bg-gray-950 border-gray-800 focus:outline-none">
        <div className="px-4 pt-2 pb-3 border-b border-gray-800/60">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">{title}</p>
          <div className={cn("flex items-center gap-2 rounded-md border px-3 h-10 bg-gray-900/80", accentBorder)}>
            <Search className={cn("w-4 h-4 shrink-0", accentIcon)} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => updateQuery(e.target.value)}
              placeholder={placeholder}
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="flex-1 h-full border-0 bg-transparent text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none"
              data-testid="input-search-drawer"
            />
            {query ? (
              <button type="button" onClick={() => updateQuery('')} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="overflow-y-auto pb-safe" style={{ maxHeight: '55vh' }}>
          {children(query, deferred, handleClose)}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
