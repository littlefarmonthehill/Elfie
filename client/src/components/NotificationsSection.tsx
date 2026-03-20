import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, BellRing, Loader2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type SubStatus = "loading" | "unsupported" | "denied" | "unsubscribed" | "subscribed";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function NotificationsSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SubStatus>("loading");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [notifyAll, setNotifyAll] = useState(true);
  const [notifyPriority, setNotifyPriority] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const { data: vapidData } = useQuery<{ publicKey: string | null }>({
    queryKey: ["/api/notifications/vapid-public-key"],
  });

  const detectStatus = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    const perm = Notification.permission;
    if (perm === "denied") { setStatus("denied"); return; }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      setSubscription(sub);
      setStatus("subscribed");
    } else {
      setStatus(perm === "granted" ? "unsubscribed" : "unsubscribed");
    }
  }, []);

  useEffect(() => { detectStatus(); }, [detectStatus]);

  const handleEnable = async () => {
    if (!vapidData?.publicKey) return;
    setIsBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setStatus("denied"); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      });
      setSubscription(sub);

      const subJson = sub.toJSON();
      await apiRequest("POST", "/api/notifications/subscribe", {
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        notifyAllOrders: notifyAll,
        notifyPriorityOrders: notifyPriority,
      });
      setStatus("subscribed");
      toast({ title: "Notifications enabled", description: "E.L.F.I.E. will alert you when orders arrive, Commander." });
    } catch (e: any) {
      toast({ title: "Could not enable notifications", description: e.message, variant: "destructive" });
    } finally { setIsBusy(false); }
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
      <div className="rounded-md border bg-card p-4 flex items-center gap-3">
        {status === "loading" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
        {status === "subscribed" && <Bell className="w-4 h-4 text-green-400 shrink-0" />}
        {(status === "unsubscribed") && <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />}
        {status === "denied" && <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />}
        {status === "unsupported" && <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />}

        <div className="flex-1 min-w-0">
          {status === "loading" && <p className="text-sm text-muted-foreground">Checking notification status…</p>}
          {status === "subscribed" && <p className="text-sm text-green-400 font-medium">This device is receiving notifications</p>}
          {status === "unsubscribed" && <p className="text-sm text-muted-foreground">Notifications are off for this device</p>}
          {status === "denied" && (
            <div>
              <p className="text-sm text-red-400 font-medium">Notifications blocked</p>
              <p className="text-xs text-muted-foreground mt-0.5">Allow notifications for this site in your browser settings, then reload.</p>
            </div>
          )}
          {status === "unsupported" && <p className="text-sm text-muted-foreground">Your browser doesn't support push notifications. Try Chrome or Edge.</p>}
        </div>

        {(status === "unsubscribed") && (
          <Button size="sm" onClick={handleEnable} disabled={isBusy || !vapidData?.publicKey} data-testid="button-enable-notifications">
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Enable"}
          </Button>
        )}
        {status === "subscribed" && (
          <Button size="sm" variant="ghost" onClick={handleDisable} disabled={isBusy} data-testid="button-disable-notifications">
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Disable"}
          </Button>
        )}
      </div>

      {/* Preference toggles — Orders section */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Orders</p>

        <div className="rounded-md border bg-card divide-y divide-border">
          {/* All orders */}
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

          {/* Priority only */}
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
        {!isSubscribed && (
          <p className="text-xs text-muted-foreground">Enable notifications above to configure these preferences.</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Notification settings are per device. Each device you use needs to be enabled separately.
      </p>
    </div>
  );
}
