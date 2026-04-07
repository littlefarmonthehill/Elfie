import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MonitorCheck, Wifi, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  open: boolean;
  onClose: () => void;
  labelUrl?: string;
  onOpenSettings?: () => void;
};

export default function PrintMethodSetup({ open, onClose, labelUrl, onOpenSettings }: Props) {
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: (data: { printMethod: string; printSetupDone: boolean }) =>
      apiRequest('POST', '/api/settings', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/settings'] }),
  });

  const choose = async (method: 'browser' | 'direct_zpl' | 'pdf_download') => {
    await saveMutation.mutateAsync({ printMethod: method, printSetupDone: true });
    onClose();

    if (method === 'direct_zpl') {
      // Open settings to configure the printer
      onOpenSettings?.();
    } else if (method === 'pdf_download' && labelUrl) {
      const a = document.createElement('a');
      a.href = labelUrl;
      a.download = '';
      a.click();
    } else if (method === 'browser' && labelUrl) {
      window.open(labelUrl, '_blank');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[400px] bg-gray-900 border-gray-700 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-700">
          <DialogTitle className="text-sm font-semibold text-gray-100">How would you like to print labels?</DialogTitle>
          <p className="text-xs text-gray-400 mt-1">Choose once — you can change this any time in Settings → Printing.</p>
        </DialogHeader>

        <div className="divide-y divide-gray-700/60">

          <button
            onClick={() => choose('browser')}
            disabled={saveMutation.isPending}
            className="w-full flex items-start gap-3 px-5 py-4 hover:bg-gray-800/60 transition-colors text-left"
            data-testid="print-setup-browser"
          >
            <MonitorCheck className="w-5 h-5 text-blue-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-gray-100">Print via AirPrint or device printer</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">Sends the label to your device's print dialog. Works with AirPrint, Silex-connected printers, and any wireless printer on the same network. Recommended.</p>
            </div>
          </button>

          <button
            onClick={() => choose('direct_zpl')}
            disabled={saveMutation.isPending}
            className="w-full flex items-start gap-3 px-5 py-4 hover:bg-gray-800/60 transition-colors text-left"
            data-testid="print-setup-zpl"
          >
            <Wifi className="w-5 h-5 text-green-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-gray-100">I have a label printer <span className="text-[10px] text-green-300 font-normal">(Zebra, Rollo, etc.)</span></p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">Sends ZPL directly to a network label printer. You'll be taken to Settings to enter your printer's IP address.</p>
            </div>
          </button>

          <button
            onClick={() => choose('pdf_download')}
            disabled={saveMutation.isPending}
            className="w-full flex items-start gap-3 px-5 py-4 hover:bg-gray-800/60 transition-colors text-left"
            data-testid="print-setup-download"
          >
            <Download className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-gray-100">Download PDF</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">Downloads the label file for printing manually or later.</p>
            </div>
          </button>

        </div>

        <div className="px-5 py-3 border-t border-gray-700 flex justify-end">
          <Button size="sm" variant="ghost" className="text-xs text-gray-400" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
