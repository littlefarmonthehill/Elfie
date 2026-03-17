import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PdfViewerProps {
  url: string;
  onClose: () => void;
}

export default function PdfViewer({ url, onClose }: PdfViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleLoad = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    closedRef.current = false;

    const afterPrint = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      onClose();
    };

    win.addEventListener("afterprint", afterPrint, { once: true });
    window.addEventListener("afterprint", afterPrint, { once: true });

    setTimeout(() => {
      try { win.print(); } catch { /* cross-origin guard */ }
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black/90">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <span className="text-xs text-gray-400">Print dialog opening…</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="gap-1.5 text-xs text-gray-300"
          data-testid="button-pdf-close"
        >
          <X className="w-3.5 h-3.5" />
          Close
        </Button>
      </div>
      <iframe
        ref={iframeRef}
        src={url}
        className="flex-1 w-full border-0"
        title="PDF Preview"
        onLoad={handleLoad}
      />
    </div>
  );
}
