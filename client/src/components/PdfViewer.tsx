import { useEffect, useRef } from "react";
import { X, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PdfViewerProps {
  url: string;
  onClose: () => void;
}

export default function PdfViewer({ url, onClose }: PdfViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black/90">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={handlePrint}
          className="gap-1.5 text-xs"
          data-testid="button-pdf-print"
        >
          <Printer className="w-3.5 h-3.5" />
          Print
        </Button>
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
      />
    </div>
  );
}
