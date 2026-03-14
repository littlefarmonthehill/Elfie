import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function getIsIos(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isIos] = useState(getIsIos);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");

    const isStandalone =
      standaloneQuery.matches ||
      (navigator as any).standalone === true ||
      document.referrer.includes("android-app://");

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setIsInstalling(false);
    };

    const onStandaloneChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);
    standaloneQuery.addEventListener("change", onStandaloneChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
      standaloneQuery.removeEventListener("change", onStandaloneChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    setIsInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
      }
    } finally {
      setDeferredPrompt(null);
      setIsInstalling(false);
    }
  }, [deferredPrompt]);

  const canPromptInstall = !!deferredPrompt && !isInstalled;
  const showInstallOption = !isInstalled;

  return { canPromptInstall, showInstallOption, isInstalled, isInstalling, isIos, install };
}
