import { useEffect, useRef, useCallback } from "react";

const SCANNER_MAX_CHAR_GAP_MS = 50;
const MIN_SCAN_LENGTH = 5;

interface Options {
  onScan: (code: string) => void;
  disabled?: boolean;
}

export function useHardwareScanner({ onScan, disabled = false }: Options) {
  const bufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const code = bufferRef.current.trim();
    bufferRef.current = "";
    if (code.length >= MIN_SCAN_LENGTH) {
      onScan(code);
    }
  }, [onScan]);

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        if (timerRef.current) clearTimeout(timerRef.current);
        flush();
        return;
      }

      if (e.key.length !== 1) return;

      if (gap > SCANNER_MAX_CHAR_GAP_MS && bufferRef.current.length > 0) {
        bufferRef.current = "";
      }

      bufferRef.current += e.key;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        bufferRef.current = "";
      }, 300);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [disabled, flush]);
}
