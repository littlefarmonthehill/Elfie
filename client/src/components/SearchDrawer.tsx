import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  placeholder: string;
  accentColor: "blue" | "orange" | "yellow";
  searchInput: string;
  onSearchChange: (value: string) => void;
  children: React.ReactNode;
  isLoading?: boolean;
}

const ACCENT = {
  blue: {
    ring: "ring-blue-500/40 focus:ring-blue-400/70",
    icon: "text-blue-400",
    title: "text-blue-200",
    border: "border-blue-500/30",
    glow: "shadow-[0_0_40px_rgba(59,130,246,0.15)]",
    divider: "via-blue-400/40",
  },
  orange: {
    ring: "ring-orange-500/40 focus:ring-orange-400/70",
    icon: "text-orange-400",
    title: "text-orange-200",
    border: "border-orange-500/30",
    glow: "shadow-[0_0_40px_rgba(249,115,22,0.15)]",
    divider: "via-orange-400/40",
  },
  yellow: {
    ring: "ring-yellow-500/40 focus:ring-yellow-400/70",
    icon: "text-yellow-400",
    title: "text-yellow-200",
    border: "border-yellow-500/30",
    glow: "shadow-[0_0_40px_rgba(234,179,8,0.15)]",
    divider: "via-yellow-400/40",
  },
};

export default function SearchDrawer({
  open,
  onClose,
  title,
  placeholder,
  accentColor,
  searchInput,
  onSearchChange,
  children,
}: SearchDrawerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const accent = ACCENT[accentColor];

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-950/97 backdrop-blur-sm">
      {/* Header */}
      <div className={cn("flex-shrink-0 border-b px-4 py-4 bg-gray-900/80", accent.border, accent.glow)}>
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <Search className={cn("h-5 w-5 shrink-0", accent.icon)} />
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              value={searchInput}
              onChange={e => onSearchChange(e.target.value)}
              placeholder={placeholder}
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-form-type="other"
              className={cn(
                "w-full bg-gray-800/60 text-gray-100 placeholder:text-gray-500",
                "rounded-lg px-4 py-2.5 text-sm",
                "ring-1 outline-none transition-shadow",
                accent.ring
              )}
              data-testid="input-search-drawer"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-500 hover:text-gray-200 transition-colors p-1"
            data-testid="button-search-drawer-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3 max-w-2xl mx-auto">
          <p className={cn("text-[11px] uppercase tracking-widest font-semibold", accent.title)}>
            {title}
          </p>
        </div>
      </div>

      {/* Divider line */}
      <div className={cn("h-px bg-gradient-to-r from-transparent to-transparent", accent.divider)} />

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
