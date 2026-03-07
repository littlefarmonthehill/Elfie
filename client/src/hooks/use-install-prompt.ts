import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallStatus =
  | "installed"
  | "promptable"
  | "ios"
  | "unsupported";

interface UseInstallPromptReturn {
  status: InstallStatus;
  promptInstall: () => Promise<"accepted" | "dismissed" | null>;
}

function detectStatus(deferredPrompt: BeforeInstallPromptEvent | null): InstallStatus {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true;

  if (isStandalone) return "installed";

  if (deferredPrompt) return "promptable";

  const ua = navigator.userAgent;
  const isIOS =
    (/iPhone|iPad|iPod/.test(ua) && !(window as any).MSStream) ||
    (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua);
  if (isIOS && isSafari) return "ios";

  return "unsupported";
}

export function useInstallPrompt(): UseInstallPromptReturn {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<InstallStatus>(() => detectStatus(null));

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const prompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(prompt);
      setStatus("promptable");
    };

    window.addEventListener("beforeinstallprompt", handler);

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const standaloneHandler = () => {
      if (mediaQuery.matches) setStatus("installed");
    };
    mediaQuery.addEventListener("change", standaloneHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      mediaQuery.removeEventListener("change", standaloneHandler);
    };
  }, []);

  const promptInstall = async (): Promise<"accepted" | "dismissed" | null> => {
    if (!deferredPrompt) return null;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") setStatus("installed");
    return outcome;
  };

  return { status, promptInstall };
}
