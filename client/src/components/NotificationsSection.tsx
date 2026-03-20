import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, BellRing, Loader2, ShieldAlert, Share, SquarePlus, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type SubStatus = "loading" | "needs-pwa" | "needs-ios-update" | "unsupported" | "denied" | "unsubscribed" | "subscribed";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return (
    ("standalone" in navigator && (navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function getIOSVersion(): number {
  const match = navigator.userAgent.match(/OS (\d+)_/);
  return match ? parseInt(match[1], 10) : 0;
}

export default function NotificationsSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SubStatus>("loading");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [notifyAll, setNotifyAll] = useState(true);
  const [notifyPriority, setNotifyPriority] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const { data: vapidData, isLoading: vapidLoading } = useQuery<{ publicKey: string | null }>({
    queryKey: ["/api/notifications/vapid-public-key"],
  });

  const testMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/test"),
    onSuccess: (data: any) => {
      if (data.sent > 0) {
        toast({ title: "Test notification sent", description: "Check your lock screen, Commander." });
      } else {
        toast({ title: "Nothing sent", description: "The subscription may have expired. Try disabling and re-enabling.", variant: "destructive" });
      }
    },
    onError: (e: any) => {
      toast({ title: "Could not send test", description: e.message, variant: "destructive" });
    },
  });

  const detectStatus = useCallback(async () => {
    const ios = isIOS();

    if (ios && !isStandalone()) {
      setStatus("needs-pwa");
      return;
    }

    if (ios && getIOSVersion() < 16) {
      setStatus("needs-ios-update");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      if (ios) {
        try {
          await navigator.serviceWorker.ready;
          if (!("PushManager" in window)) {
            setStatus("needs-ios-update");
            return;
          }
        } catch {
          setStatus("needs-ios-update");
          return;
        }
      } else {
        setStatus("unsupported");
        return;
      }
    }

    const perm = Notification.permission;
    if (perm === "denied") { setStatus("denied"); return; }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setSubscription(sub);
        setStatus("subscribed");
      } else {
        setStatus("unsubscribed");
      }
    } catch {
      setStatus("unsubscribed");
    }
  }, []);

  useEffect(() => { detectStatus(); }, [detectStatus]);

  const handleEnable = async () => {
    if (!vapidData?.publicKey) return;
    setIsBusy(true);
    setEnableError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") { setStatus("denied"); return; }
      if (perm !== "granted") {
        setEnableError("Permission was not granted. Please allow notifications when prompted.");
        return;
      }

      let reg: ServiceWorkerRegistration;
      try {
        reg = await navigator.serviceWorker.ready;
      } catch (e: any) {
        setEnableError("Service worker failed to load. Try closing and reopening the app.");
        return;
      }

      let sub: PushSubscription;
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
        });
      } catch (e: any) {
        setEnableError(e.message || "Could not subscribe to push notifications.");
        return;
      }

      setSubscription(sub);
      const subJson = sub.toJSON();
      await apiRequest("POST", "/api/notifications/subscribe", {
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        notifyAllOrders: notifyAll,
        notifyPriorityOrders: notifyPriority,
      });
      setStatus("subscribed");
      setEnableError(null);
      toast({ title: "Notifications enabled", description: "E.L.F.I.E. will alert you when orders arrive, Commander." });
    } catch (e: any) {
      setEnableError(e.message || "An unexpected error occurred.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!subscription) return;
    setIsBusy(true);
    try {
      await subscription.unsubscribe();
      await apiRequest("DELETE", "/api/notifications/unsubscribe", { endpoint: subscription.endpoint });
      setSubscription(null);
      setStatus("unsubscribed");
      toast({ title: "Notifications disabled", description: "This device will no longer receive order alerts." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setIsBusy(false); }
  };

  const handlePreferenceChange = async (key: "notifyAllOrders" | "notifyPriorityOrders", value: boolean) => {
    if (key === "notifyAllOrders") setNotifyAll(value);
    else setNotifyPriority(value);
    if (subscription) {
      await apiRequest("PUT", "/api/notifications/subscription", {
        endpoint: subscription.endpoint,
        notifyAllOrders: key === "notifyAllOrders" ? value : notifyAll,
        notifyPriorityOrders: key === "notifyPriorityOrders" ? value : notifyPriority,
      });
    }
  };

  const isSubscribed = status === "subscribed";
  const ios = isIOS();

  return (
    <div className="p-4 space-y-6 max-w-lg">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <BellRing className="w-4 h-4 text-amber-400" />
          Order Notifications
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          E.L.F.I.E. will send a lock screen alert on this device when orders arrive during a sync — even if the app is in the background.
        </p>
      </div>

      {/* Status card */}
      <div className="rounded-md border bg-card p-4 space-y-3">

        {status === "loading" && (
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">Checking notification status…</p>
          </div>
        )}

        {status === "subscribed" && (
          <div className="flex items-center gap-3">
            <Bell className="w-4 h-4 text-green-400 shrink-0" />
            <p className="text-sm text-green-400 font-medium flex-1">This device is receiving notifications</p>
            <Button size="sm" variant="ghost" onClick={handleDisable} disabled={isBusy} data-testid="button-disable-notifications">
              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Disable"}
            </Button>
          </div>
        )}

        {status === "unsubscribed" && (
          <>
            <div className="flex items-center gap-3">
              <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground flex-1">Notifications are off for this device</p>
              <Button
                size="sm"
                onClick={handleEnable}
                disabled={isBusy || vapidLoading || !vapidData?.publicKey}
                data-testid="button-enable-notifications"
              >
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : vapidLoading ? "Loading…" : "Enable"}
              </Button>
            </div>
            {enableError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2">
                <p className="text-xs text-destructive">{enableError}</p>
              </div>
            )}
            {!vapidData?.publicKey && !vapidLoading && (
              <p className="text-xs text-amber-400">Push notifications are not configured on this server.</p>
            )}
          </>
        )}

        {status === "denied" && (
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-400 font-medium">Notifications blocked</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ios
                  ? "Go to Settings › E.L.F.I.E. › Notifications and set to Allow, then come back here."
                  : "Allow notifications for this site in your browser or OS settings, then reload."}
              </p>
            </div>
          </div>
        )}

        {status === "needs-pwa" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Share className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Install the app to enable notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  iOS requires the app to be added to your Home Screen before push notifications can be enabled.
                </p>
              </div>
            </div>
            <div className="rounded-md bg-muted/50 p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How to install</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-foreground">
                  <span className="w-4 h-4 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                  Tap the <Share className="w-3 h-3 inline mx-0.5 text-muted-foreground" /> Share button in Safari
                </div>
                <div className="flex items-center gap-2 text-xs text-foreground">
                  <span className="w-4 h-4 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                  Tap <SquarePlus className="w-3 h-3 inline mx-0.5 text-muted-foreground" /> <strong>Add to Home Screen</strong>
                </div>
                <div className="flex items-center gap-2 text-xs text-foreground">
                  <span className="w-4 h-4 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                  Open E.L.F.I.E. from your Home Screen and return here
                </div>
              </div>
            </div>
          </div>
        )}

        {status === "needs-ios-update" && (
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">iOS 16.4 or later required</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Update your iPhone or iPad in Settings › General › Software Update, then come back here.
              </p>
            </div>
          </div>
        )}

        {status === "unsupported" && (
          <div className="flex items-start gap-3">
            <BellOff className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Push notifications aren't supported in this browser. Try Chrome, Edge, or Safari on iOS 16.4+.
            </p>
          </div>
        )}
      </div>

      {/* Test notification button — only shown when subscribed */}
      {isSubscribed && (
        <div className="rounded-md border bg-card p-3 flex items-center gap-3">
          <Send className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Send a test notification</p>
            <p className="text-xs text-muted-foreground mt-0.5">Check that alerts are reaching this device.</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            data-testid="button-test-notification"
          >
            {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Send"}
          </Button>
        </div>
      )}

      {/* Preference toggles */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Orders</p>
        <div className="rounded-md border bg-card divide-y divide-border">
          <div className="flex items-start gap-3 p-3">
            <Bell className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">All new orders</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                "Commander! 3 new missions just dropped — BL-12345 and more are locked and loaded."
              </p>
            </div>
            <Switch
              checked={notifyAll}
              onCheckedChange={(v) => handlePreferenceChange("notifyAllOrders", v)}
              disabled={!isSubscribed}
              data-testid="switch-notify-all-orders"
            />
          </div>
          <div className="flex items-start gap-3 p-3">
            <BellRing className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">High priority orders only</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                "Priority Alert! Express orders incoming — full thrusters, Commander!"
              </p>
            </div>
            <Switch
              checked={notifyPriority}
              onCheckedChange={(v) => handlePreferenceChange("notifyPriorityOrders", v)}
              disabled={!isSubscribed}
              data-testid="switch-notify-priority-orders"
            />
          </div>
        </div>
        {!isSubscribed && !["loading", "needs-pwa", "needs-ios-update", "unsupported", "denied"].includes(status) && (
          <p className="text-xs text-muted-foreground">Enable notifications above to configure these preferences.</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Notification settings are per device. Each device you use needs to be enabled separately.
      </p>
    </div>
  );
}
