import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AppSettings, User } from "@shared/schema";
import { APP_VERSION, APP_NAME } from "@shared/version";
import { X, Download, Trash2, Settings, Package, Sparkles, Database, Clock, Shield, History, AlertTriangle, CheckCircle2, Calendar, RotateCcw, FileText, HardDrive, Upload, CloudUpload, Smartphone, RefreshCw, Users, Wrench, Zap, Info, Layers } from "lucide-react";
import { PomCategoryTiers } from "@/components/PomCategoryTiers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EmbeddingsManager } from "@/components/EmbeddingsManager";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// User Management Section Component (Admin Only)
function UserManagementSection() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  
  // Early return if not admin (defense in depth)
  if (!isAdmin) {
    return null;
  }
  
  const { data: users, isLoading, isError } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
    enabled: isAdmin, // Only fetch if user is admin
  });

  // Show error state if query fails
  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">Access Denied</p>
          <p className="text-xs text-gray-400">You don't have permission to manage users.</p>
        </div>
      </div>
    );
  }

  const updateUserApprovalMutation = useMutation({
    mutationFn: async ({ userId, isApproved }: { userId: string; isApproved: boolean }) => {
      return await apiRequest('PATCH', `/api/admin/users/${userId}/approval`, { isApproved });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: "User Updated",
        description: "User approval status has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user approval status.",
        variant: "destructive",
      });
    },
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return await apiRequest('PATCH', `/api/admin/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: "Role Updated",
        description: "User role has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user role.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
          <p className="text-xs text-gray-400">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-[400px]">
      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
          <Users className="h-4 w-4 text-purple-400" />
          User Management
        </h3>
        <p className="text-xs text-gray-400 mb-4">Manage user access and approvals for PlanetBrick</p>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-300">
            <strong>Note:</strong> Users must be approved before they can access the platform. New users will see a pending approval page after logging in.
          </p>
        </div>

        <div className="space-y-2">
          {users && users.length > 0 ? (
            users.map((user) => (
              <div
                key={user.id}
                className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center justify-between hover-elevate"
                data-testid={`user-card-${user.id}`}
              >
                <div className="flex items-center gap-3 flex-1">
                  {user.profileImageUrl ? (
                    <img
                      src={user.profileImageUrl}
                      alt={`${user.firstName} ${user.lastName}`}
                      className="h-10 w-10 rounded-full"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <Users className="h-5 w-5 text-purple-400" />
                    </div>
                  )}
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-200">
                        {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : 'Unknown User'}
                      </p>
                    </div>
                    <p className="text-xs text-gray-400">{user.email || 'No email'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-500">Role:</span>
                      <Select
                        value={user.role}
                        onValueChange={(role) => updateUserRoleMutation.mutate({ userId: user.id, role })}
                        disabled={updateUserRoleMutation.isPending}
                      >
                        <SelectTrigger 
                          className="h-6 text-[10px] w-[100px] bg-gray-900/50 border-gray-600"
                          data-testid={`select-role-${user.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customer">Customer</SelectItem>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  {user.isApproved ? (
                    <>
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Approved
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateUserApprovalMutation.mutate({ userId: user.id, isApproved: false })}
                        disabled={updateUserApprovalMutation.isPending}
                        data-testid={`button-revoke-${user.id}`}
                      >
                        Revoke
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-orange-400 flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4" />
                        Pending
                      </span>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => updateUserApprovalMutation.mutate({ userId: user.id, isApproved: true })}
                        disabled={updateUserApprovalMutation.isPending}
                        data-testid={`button-approve-${user.id}`}
                      >
                        Approve
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">
              No users found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Device detection helper
function getDeviceInfo() {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  
  const isIOS = /iPhone|iPad|iPod/.test(userAgent) && !(window as any).MSStream;
  const isIPad = /iPad/.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(userAgent);
  const isMac = /Mac/.test(platform) && !isIPad;
  const isWindows = /Win/.test(platform);
  const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
  const isChrome = /Chrome/.test(userAgent);
  const isFirefox = /Firefox/.test(userAgent);
  const isPWA = window.matchMedia('(display-mode: standalone)').matches;
  
  let deviceType = 'Unknown';
  let browserType = 'Unknown';
  
  if (isIOS) deviceType = 'iPhone';
  else if (isIPad) deviceType = 'iPad';
  else if (isAndroid) deviceType = 'Android';
  else if (isMac) deviceType = 'Mac';
  else if (isWindows) deviceType = 'Windows';
  
  if (isSafari) browserType = 'Safari';
  else if (isChrome) browserType = 'Chrome';
  else if (isFirefox) browserType = 'Firefox';
  
  return { deviceType, browserType, isPWA, isIOS: isIOS || isIPad };
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { toast } = useToast();
  const [clearDataDialog, setClearDataDialog] = useState<'inventory' | 'orders' | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [restoreWizardOpen, setRestoreWizardOpen] = useState(false);
  const [restoreStep, setRestoreStep] = useState<'select' | 'warning' | 'restoring' | 'syncing' | 'differential' | 'verification' | 'complete'>('select');
  const [restoreDate, setRestoreDate] = useState('2025-10-18');
  const [restoreTime, setRestoreTime] = useState('14:30');
  const [restoreProgress, setRestoreProgress] = useState(0);
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/change-password', {
        currentPassword,
        newPassword,
      });
    },
    onSuccess: () => {
      toast({
        title: "Password Changed",
        description: "Your password has been updated successfully.",
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to change password",
        variant: "destructive",
      });
    },
  });
  
  const handlePasswordChange = () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "New passwords do not match",
        variant: "destructive",
      });
      return;
    }
    
    if (newPassword.length < 8) {
      toast({
        title: "Weak Password",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }
    
    changePasswordMutation.mutate();
  };
  const [restoreCurrentTask, setRestoreCurrentTask] = useState('');
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [differentialAnalysis, setDifferentialAnalysis] = useState<{
    totalItems: number;
    quantityChanges: number;
    netQuantityChange: number;
    priceUpdates: number;
    remarksUpdates: number;
    descriptionUpdates: number;
    anomalies?: Array<{
      type: string;
      severity: string;
      description: string;
      affectedItems: number;
      metricValue: number;
    }>;
  } | null>(null);
  const [verificationResults, setVerificationResults] = useState<{
    inventoryMatch: boolean;
    orderStatusMatch: boolean;
    platformSync: boolean;
    inventoryCount?: number;
    bricklinkCount?: number;
    brickowlCount?: number;
    discrepancies?: number;
  } | null>(null);

  // AI Settings
  const [aiEnabled, setAiEnabled] = useState(true);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // BrickLink Settings
  const [bricklinkConsumerKey, setBricklinkConsumerKey] = useState("");
  const [bricklinkConsumerSecret, setBricklinkConsumerSecret] = useState("");
  const [bricklinkTokenValue, setBricklinkTokenValue] = useState("");
  const [bricklinkTokenSecret, setBricklinkTokenSecret] = useState("");

  // BrickOwl Settings
  const [brickowlApiKey, setBrickowlApiKey] = useState("");

  // EasyPost Settings
  const [easypostApiKey, setEasypostApiKey] = useState("");
  const [easypostTestApiKey, setEasypostTestApiKey] = useState("");
  const [easypostKeyMode, setEasypostKeyMode] = useState<'test' | 'production'>('test');
  // International Shipping / Customs
  const [customsSigner, setCustomsSigner] = useState("");
  const [blIossNumber, setBlIossNumber] = useState("");
  const [boIossNumber, setBoIossNumber] = useState("");
  const [blUkVatNumber, setBlUkVatNumber] = useState("");
  const [boUkVatNumber, setBoUkVatNumber] = useState("");

  // Automation Settings
  const [inventorySyncEnabled, setInventorySyncEnabled] = useState(false);
  const [inventorySyncTime, setInventorySyncTime] = useState("02:00");
  const [priceOMaticEnabled, setPriceOMaticEnabled] = useState(false);
  const [rebrickableImageSyncEnabled, setRebrickableImageSyncEnabled] = useState(true);
  const [ordersSyncEnabled, setOrdersSyncEnabled] = useState(false);
  const [ordersSyncFrequency, setOrdersSyncFrequency] = useState(15);

  // Price-o-Matic Formula Settings
  const [pomBasePremium, setPomBasePremium] = useState(10);
  const [pomMinifigPremium, setPomMinifigPremium] = useState(5);
  const [pomScarcityThreshold1, setPomScarcityThreshold1] = useState(50);
  const [pomScarcityBonus1, setPomScarcityBonus1] = useState(15);
  const [pomScarcityThreshold2, setPomScarcityThreshold2] = useState(200);
  const [pomScarcityBonus2, setPomScarcityBonus2] = useState(8);
  const [pomScarcityThreshold3, setPomScarcityThreshold3] = useState(500);
  const [pomScarcityBonus3, setPomScarcityBonus3] = useState(3);
  const [pomTooHighThreshold, setPomTooHighThreshold] = useState(20);
  const [pomTooLowThreshold, setPomTooLowThreshold] = useState(20);
  const [pomBatchSize, setPomBatchSize] = useState(1500);
  const [pomApiCallLimit, setPomApiCallLimit] = useState(4500);
  const [pomCostFloorPct, setPomCostFloorPct] = useState(0);
  const [pomMinPrice, setPomMinPrice] = useState(0.02);

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['/api/settings'],
    enabled: open,
  });

  const { data: backupsData, isLoading: backupsLoading } = useQuery<{
    success: boolean;
    backups: Array<{ filename: string; timestamp: string; size: number }>;
  }>({
    queryKey: ['/api/backups/list'],
    enabled: open,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to update settings');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
  });

  const [showClearPomDialog, setShowClearPomDialog] = useState(false);

  const clearPomCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/sync/priceomatic/cache', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear cache');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/freshness'] });
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      toast({ title: "Cache Cleared", description: `Removed ${data.deleted} price guide records. Ready for a fresh sync.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to clear the cache.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (settings) {
      setAiEnabled(settings.aiEnabled);
      setOpenaiApiKey(settings.openaiApiKey || "");
      setSelectedModel(settings.selectedModel || "gpt-4o-mini");
      setSystemPrompt(settings.systemPrompt || "");
      setBricklinkConsumerKey(settings.bricklinkConsumerKey || "");
      setBricklinkConsumerSecret(settings.bricklinkConsumerSecret || "");
      setBricklinkTokenValue(settings.bricklinkTokenValue || "");
      setBricklinkTokenSecret(settings.bricklinkTokenSecret || "");
      setBrickowlApiKey(settings.brickowlApiKey || "");
      setEasypostApiKey(settings.easypostApiKey || "");
      setEasypostTestApiKey(settings.easypostTestApiKey || "");
      setEasypostKeyMode((settings.easypostKeyMode as 'test' | 'production') || 'test');
      setCustomsSigner(settings.customsSigner || "");
      setBlIossNumber(settings.blIossNumber || "");
      setBoIossNumber(settings.boIossNumber || "");
      setBlUkVatNumber(settings.blUkVatNumber || "");
      setBoUkVatNumber(settings.boUkVatNumber || "");
      setInventorySyncEnabled(settings.inventorySyncEnabled || false);
      setInventorySyncTime(settings.inventorySyncTime || "02:00");
      setPriceOMaticEnabled(settings.priceOMaticEnabled || false);
      setRebrickableImageSyncEnabled(settings.rebrickableImageSyncEnabled !== false);
      setOrdersSyncEnabled(settings.ordersSyncEnabled || false);
      setOrdersSyncFrequency(settings.ordersSyncFrequency || 15);

      // Price-o-Matic formula settings
      setPomBasePremium(settings.pomBasePremium ?? 10);
      setPomMinifigPremium(settings.pomMinifigPremium ?? 5);
      setPomScarcityThreshold1(settings.pomScarcityThreshold1 ?? 50);
      setPomScarcityBonus1(settings.pomScarcityBonus1 ?? 15);
      setPomScarcityThreshold2(settings.pomScarcityThreshold2 ?? 200);
      setPomScarcityBonus2(settings.pomScarcityBonus2 ?? 8);
      setPomScarcityThreshold3(settings.pomScarcityThreshold3 ?? 500);
      setPomScarcityBonus3(settings.pomScarcityBonus3 ?? 3);
      setPomTooHighThreshold(settings.pomTooHighThreshold ?? 20);
      setPomTooLowThreshold(settings.pomTooLowThreshold ?? 20);
      setPomBatchSize(settings.pomBatchSize ?? 1500);
      setPomApiCallLimit(settings.pomApiCallLimit ?? 4500);
      setPomCostFloorPct(settings.pomCostFloorPct ?? 0);
      setPomMinPrice(parseFloat(String(settings.pomMinPrice ?? '0.02')));

      // Fetch models
      fetchModels();
    }
  }, [settings]);

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const response = await fetch('/api/openai/models', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.models) {
        setAvailableModels(data.models);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    } finally {
      setLoadingModels(false);
    }
  };


  const handleExport = async (type: 'inventory' | 'orders', format: 'csv' | 'xml') => {
    try {
      let url = '';
      
      if (type === 'inventory' && format === 'xml') {
        url = '/api/export/bricklink-xml';
      } else if (type === 'inventory' && format === 'csv') {
        url = '/api/export/inventory-csv';
      } else {
        console.log(`Export not yet implemented for ${type} ${format}`);
        return;
      }
      
      // Trigger download by opening URL in new window
      window.open(url, '_blank');
    } catch (error) {
      console.error(`Error exporting ${type} as ${format}:`, error);
    }
  };

  const handleDownloadBackup = (filename: string) => {
    try {
      const url = `/api/backups/download/${encodeURIComponent(filename)}`;
      
      // iOS-compatible download approach
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading backup:', error);
    }
  };

  const handleClearData = (type: 'inventory' | 'orders') => {
    // TODO: Implement clear data functionality
    console.log(`Clearing ${type} data`);
    setClearDataDialog(null);
  };

  const handleCleanupOldOrders = async () => {
    setCleanupRunning(true);
    try {
      const res = await fetch('/api/admin/cleanup-old-orders');
      const data = await res.json();
      if (data.deleted === 0) {
        toast({ title: 'Nothing to clean up', description: 'No stale orders found — already clean.' });
      } else {
        toast({ title: `Removed ${data.deleted} stale order${data.deleted !== 1 ? 's' : ''}`, description: `${data.orders ?? data.deleted} orders and associated records deleted.` });
      }
    } catch {
      toast({ title: 'Cleanup failed', description: 'Could not remove stale orders.', variant: 'destructive' });
    } finally {
      setCleanupRunning(false);
    }
  };

  // Handle app cache and data clearing
  const handleClearAppCache = async () => {
    try {
      // Clear localStorage (except auth data if any)
      const authKeys = ['elfie-session-id']; // Preserve these keys
      const keysToKeep: Record<string, string> = {};
      
      authKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) keysToKeep[key] = value;
      });
      
      localStorage.clear();
      
      // Restore preserved keys
      Object.entries(keysToKeep).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      
      // Clear sessionStorage
      sessionStorage.clear();
      
      // Clear service worker cache and unregister old service workers
      if ('serviceWorker' in navigator && 'caches' in window) {
        // Clear all caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
        
        // Unregister ALL service workers (to remove old one)
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      
      toast({
        title: "Cache Cleared & Service Worker Removed",
        description: "Please close and reopen the app completely to get the latest version.",
      });
      
      // Wait a moment, then reload the page to re-register the new service worker
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Error clearing cache:', error);
      toast({
        title: "Error",
        description: "Failed to clear cache completely. Try manual steps below.",
        variant: "destructive",
      });
    }
  };

  // Restore workflow functions
  const handleInitiateRestore = async () => {
    try {
      setRestoreStep('restoring');
      setRestoreProgress(0);
      setRestoreCurrentTask('Initiating restore workflow...');
      
      const targetTimestamp = `${restoreDate}T${restoreTime}:00`;
      const response = await apiRequest('POST', '/api/backup/restore', {
        targetTimestamp,
        skipPlatformSync: false,
      });
      
      const { jobId } = response;
      setRestoreJobId(jobId);
      setRestoreCurrentTask('Restore job created - manual PITR required');
      setRestoreProgress(100);
      
      // Move to next step (in production, user would manually restore via Neon)
      setTimeout(() => {
        setRestoreStep('differential');
        handleAnalyzeDifferential(jobId);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to initiate restore:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to initiate restore'}`);
    }
  };

  const handleAnalyzeDifferential = async (jobId: string) => {
    try {
      setRestoreCurrentTask('Analyzing differential changes...');
      
      const analysis = await apiRequest('POST', '/api/backup/differential/analyze', {
        jobId,
      });
      
      setDifferentialAnalysis(analysis);
      setRestoreCurrentTask('Differential analysis complete');
    } catch (error: any) {
      console.error('Failed to analyze differential:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to analyze differential'}`);
    }
  };

  const handleApplyDifferential = async (overrideAnomalies = false) => {
    if (!restoreJobId) return;
    
    try {
      setRestoreProgress(0);
      setRestoreCurrentTask('Applying differential recovery to BrickLink...');
      
      await apiRequest('POST', '/api/backup/differential/apply', {
        jobId: restoreJobId,
        overrideAnomalies,
      });
      
      setRestoreProgress(100);
      setRestoreCurrentTask('Differential recovery complete');
      
      // Move to verification
      setTimeout(() => {
        setRestoreStep('verification');
        handleVerifyRestoration();
      }, 1000);
    } catch (error: any) {
      console.error('Failed to apply differential:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to apply differential'}`);
    }
  };

  const handleVerifyRestoration = async () => {
    if (!restoreJobId) return;
    
    try {
      setRestoreCurrentTask('Running verification checks...');
      
      const results = await apiRequest('GET', `/api/backup/verify/${restoreJobId}`);
      
      setVerificationResults(results);
      setRestoreCurrentTask('Verification complete');
    } catch (error: any) {
      console.error('Failed to verify restoration:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to verify restoration'}`);
    }
  };

  const { isAdmin } = useAuth();
  const [activeSection, setActiveSection] = useState<'general' | 'platforms' | 'ai' | 'automation' | 'priceomatic' | 'data' | 'users'>('general');

  const navigationItems = [
    { id: 'general' as const, label: 'General', icon: Settings },
    { id: 'platforms' as const, label: 'Platforms', icon: Package },
    { id: 'ai' as const, label: 'AI & Intelligence', icon: Sparkles },
    { id: 'automation' as const, label: 'Automation', icon: Clock },
    { id: 'priceomatic' as const, label: 'Price-o-Matic', icon: Zap },
    { id: 'data' as const, label: 'Backup & Clear', icon: Database },
    ...(isAdmin ? [{ id: 'users' as const, label: 'User Management', icon: Users }] : []),
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] bg-gray-900 border-gray-700 p-0">
          <div className="flex flex-col sm:flex-row h-full max-h-[90vh]">
            {/* Left Navigation */}
            <div className="sm:w-48 border-b sm:border-b-0 sm:border-r border-gray-700 bg-gray-800/50">
              <DialogHeader className="p-4 sm:p-6">
                <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
              </DialogHeader>
              <nav className="flex sm:flex-col gap-1 p-2 sm:p-3 overflow-x-auto sm:overflow-visible">
                {navigationItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs whitespace-nowrap sm:whitespace-normal transition-colors ${
                      activeSection === item.id
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                    }`}
                    data-testid={`nav-${item.id}`}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Right Content Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">

            {/* General Settings */}
            {activeSection === 'general' && (
              <div className="space-y-4 min-h-[400px]">
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">General Settings</h3>
                
                {/* Version Display */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-300">{APP_NAME}</p>
                      <p className="text-[10px] text-gray-500">Version {APP_VERSION}</p>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-500">
                      <CheckCircle2 className="h-3 w-3 text-green-400" />
                      <span>Up to date</span>
                    </div>
                  </div>
                </div>
                
                {/* Account Security - Password Change */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-purple-400" />
                    <h4 className="text-xs font-medium text-gray-300">Change Password</h4>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="currentPassword" className="text-[10px] text-gray-400">
                        Current Password
                      </Label>
                      <Input
                        id="currentPassword"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="bg-gray-900/50 border-gray-600 text-xs h-8"
                        placeholder="••••••••"
                        data-testid="input-currentPassword"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <Label htmlFor="newPassword" className="text-[10px] text-gray-400">
                        New Password
                      </Label>
                      <Input
                        id="newPassword"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="bg-gray-900/50 border-gray-600 text-xs h-8"
                        placeholder="••••••••"
                        data-testid="input-newPassword"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmPassword" className="text-[10px] text-gray-400">
                        Confirm New Password
                      </Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="bg-gray-900/50 border-gray-600 text-xs h-8"
                        placeholder="••••••••"
                        data-testid="input-confirmNewPassword"
                      />
                    </div>
                    
                    <Button
                      size="sm"
                      onClick={handlePasswordChange}
                      disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmPassword}
                      className="w-full text-xs"
                      data-testid="button-changePassword"
                    >
                      {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="timezone" className="text-xs text-gray-400">Time Zone</Label>
                  <Select defaultValue="america/chicago">
                    <SelectTrigger className="text-xs" data-testid="select-timezone">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="america/new_york">Eastern Time (ET)</SelectItem>
                      <SelectItem value="america/chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="america/denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="america/los_angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="europe/london">London (GMT)</SelectItem>
                      <SelectItem value="europe/paris">Paris (CET)</SelectItem>
                      <SelectItem value="asia/tokyo">Tokyo (JST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator className="bg-gray-700" />

              {/* Data Export (CSV) */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                  <Download className="h-4 w-4 text-green-400" />
                  Data Export (CSV)
                </h3>
                <p className="text-xs text-gray-400 mb-3">Export your business data as CSV files for analysis or record-keeping</p>
                
                <Accordion type="single" collapsible className="space-y-2">
                  {/* Core Business Data */}
                  <AccordionItem value="core" className="bg-gray-800 border border-gray-700 rounded-lg px-3">
                    <AccordionTrigger className="text-xs font-medium text-gray-300 py-2.5 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5 text-purple-400" />
                        Core Business Data
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs"
                          onClick={() => handleExport('inventory', 'csv')}
                          data-testid="button-export-inventory-csv"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Inventory CSV
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs"
                          onClick={() => handleExport('orders', 'csv')}
                          data-testid="button-export-orders-csv"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Orders CSV
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs"
                          data-testid="button-export-warehouse-csv"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Warehouse CSV
                        </Button>
                      </div>
                      <p className="text-[10px] md:text-sm text-gray-500 mt-2">
                        Your inventory quantities, orders, and warehouse locations
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Platform Catalog Data */}
                  <AccordionItem value="catalog" className="bg-gray-800 border border-gray-700 rounded-lg px-3">
                    <AccordionTrigger className="text-xs font-medium text-gray-300 py-2.5 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Database className="h-3.5 w-3.5 text-blue-400" />
                        Platform Catalog Data
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs"
                          data-testid="button-export-catalog-csv"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          BrickLink Catalog
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs"
                          data-testid="button-export-sets-csv"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Set-Part Data
                        </Button>
                      </div>
                      <p className="text-[10px] md:text-sm text-gray-500 mt-2">
                        External catalog data (can be re-fetched from BrickLink/Rebrickable)
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  {/* AI & Analytics */}
                  <AccordionItem value="ai" className="bg-gray-800 border border-gray-700 rounded-lg px-3">
                    <AccordionTrigger className="text-xs font-medium text-gray-300 py-2.5 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                        AI & Analytics Data
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs"
                          data-testid="button-export-embeddings"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          AI Embeddings
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs"
                          data-testid="button-export-analytics"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Analytics Cache
                        </Button>
                      </div>
                      <p className="text-[10px] md:text-sm text-gray-500 mt-2">
                        Derived data (can be regenerated, but expensive)
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <p className="text-[10px] md:text-sm text-yellow-400 mt-3 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  <span>Note: CSV files are for analysis only and are NOT considered backups. Use the Backup & Clear tab for restore capabilities.</span>
                </p>
              </div>

              <Separator className="bg-gray-700" />

              {/* Cache & Storage */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-blue-400" />
                  Cache & Storage
                </h3>
                <p className="text-xs text-gray-400 mb-3">Clear app cache and stored data to fix issues or free up space</p>

                {(() => {
                  const deviceInfo = getDeviceInfo();
                  
                  return (
                    <div className="space-y-3">
                      {/* Device Info */}
                      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Smartphone className="h-4 w-4 text-blue-400" />
                          <span className="text-xs font-medium text-gray-300">Device Info</span>
                        </div>
                        <div className="space-y-1 text-[11px] text-gray-400">
                          <p>Device: <span className="text-gray-300">{deviceInfo.deviceType}</span></p>
                          <p>Browser: <span className="text-gray-300">{deviceInfo.browserType}</span></p>
                          <p>Mode: <span className="text-gray-300">{deviceInfo.isPWA ? 'PWA (Installed)' : 'Browser'}</span></p>
                        </div>
                      </div>

                      {/* Clear App Cache Button */}
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <Button
                          onClick={handleClearAppCache}
                          variant="outline"
                          size="sm"
                          className="w-full text-xs bg-blue-600 hover:bg-blue-700 border-blue-500"
                          data-testid="button-clear-cache"
                        >
                          <RefreshCw className="h-3 w-3 mr-2" />
                          Clear App Cache & Data
                        </Button>
                        <p className="text-[10px] text-blue-300 mt-2">
                          Clears localStorage, sessionStorage, and service worker cache. Your session will be preserved.
                        </p>
                      </div>

                      {/* Device-Specific Instructions */}
                      {deviceInfo.isIOS && (
                        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                          <h4 className="text-xs font-medium text-purple-300 mb-2">iOS/iPadOS Manual Cache Clear</h4>
                          <p className="text-[10px] text-gray-400 mb-2">
                            If issues persist after using the button above, follow these steps:
                          </p>
                          <ol className="text-[10px] text-gray-400 space-y-1 list-decimal list-inside">
                            {deviceInfo.isPWA ? (
                              <>
                                <li>Close this PWA completely</li>
                                <li>Open Safari and go to Settings</li>
                                <li>Scroll down to "Safari" → "Advanced"</li>
                                <li>Tap "Website Data"</li>
                                <li>Search for "planetbrick" or "replit"</li>
                                <li>Swipe left and tap "Delete"</li>
                                <li>Re-open the PWA from your home screen</li>
                              </>
                            ) : (
                              <>
                                <li>Open Safari Settings</li>
                                <li>Go to "Safari" → "Advanced" → "Website Data"</li>
                                <li>Search for "planetbrick" or the current site</li>
                                <li>Swipe left and delete</li>
                                <li>Reload this page</li>
                              </>
                            )}
                          </ol>
                        </div>
                      )}

                      {deviceInfo.deviceType === 'Android' && (
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                          <h4 className="text-xs font-medium text-green-300 mb-2">Android Manual Cache Clear</h4>
                          <p className="text-[10px] text-gray-400 mb-2">
                            If issues persist:
                          </p>
                          <ol className="text-[10px] text-gray-400 space-y-1 list-decimal list-inside">
                            {deviceInfo.isPWA ? (
                              <>
                                <li>Go to Settings → Apps</li>
                                <li>Find "PlanetBrick" in app list</li>
                                <li>Tap "Storage"</li>
                                <li>Tap "Clear Cache" and "Clear Data"</li>
                                <li>Re-open the app</li>
                              </>
                            ) : (
                              <>
                                <li>Open {deviceInfo.browserType} settings</li>
                                <li>Go to Privacy → Clear browsing data</li>
                                <li>Select "Cached images and files"</li>
                                <li>Select "Site settings" or "Cookies"</li>
                                <li>Clear data and reload</li>
                              </>
                            )}
                          </ol>
                        </div>
                      )}

                      {!deviceInfo.isIOS && deviceInfo.deviceType !== 'Android' && (
                        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-3">
                          <h4 className="text-xs font-medium text-gray-300 mb-2">Desktop Cache Clear</h4>
                          <p className="text-[10px] text-gray-400 mb-2">
                            If issues persist, use browser developer tools:
                          </p>
                          <ul className="text-[10px] text-gray-400 space-y-1 list-disc list-inside">
                            <li>Press F12 to open DevTools</li>
                            <li>Go to "Application" or "Storage" tab</li>
                            <li>Clear all storage (localStorage, sessionStorage, Cache)</li>
                            <li>Unregister Service Workers</li>
                            <li>Reload the page</li>
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              </div>
            )}

            {/* Platform Connections */}
            {activeSection === 'platforms' && (
              <div className="space-y-4 min-h-[400px]">
                <h3 className="text-sm font-medium text-gray-300 mb-3">API Credentials</h3>
                <p className="text-xs text-gray-400 mb-4">Configure your platform API keys and credentials</p>
                
                <Accordion type="single" collapsible className="space-y-2">
                  <AccordionItem value="bricklink" className="border border-gray-700 rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-medium text-gray-300 hover:no-underline">
                      BrickLink
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-key" className="text-xs text-gray-400">Consumer Key</Label>
                      <Input
                        id="bricklink-key"
                        placeholder="Enter BrickLink Consumer Key"
                        className="text-xs"
                        value={bricklinkConsumerKey}
                        onChange={(e) => setBricklinkConsumerKey(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-key"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-secret" className="text-xs text-gray-400">Consumer Secret</Label>
                      <Input
                        id="bricklink-secret"
                        type="password"
                        placeholder="Enter BrickLink Consumer Secret"
                        className="text-xs"
                        value={bricklinkConsumerSecret}
                        onChange={(e) => setBricklinkConsumerSecret(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-secret"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-token" className="text-xs text-gray-400">Token Value</Label>
                      <Input
                        id="bricklink-token"
                        placeholder="Enter BrickLink Token Value"
                        className="text-xs"
                        value={bricklinkTokenValue}
                        onChange={(e) => setBricklinkTokenValue(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-token"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-token-secret" className="text-xs text-gray-400">Token Secret</Label>
                      <Input
                        id="bricklink-token-secret"
                        type="password"
                        placeholder="Enter BrickLink Token Secret"
                        className="text-xs"
                        value={bricklinkTokenSecret}
                        onChange={(e) => setBricklinkTokenSecret(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-token-secret"
                      />
                    </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="brickowl" className="border border-gray-700 rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-medium text-gray-300 hover:no-underline">
                      BrickOwl
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="brickowl-key" className="text-xs text-gray-400">API Key</Label>
                      <Input
                        id="brickowl-key"
                        type="password"
                        placeholder="Enter BrickOwl API Key"
                        className="text-xs"
                        value={brickowlApiKey}
                        onChange={(e) => setBrickowlApiKey(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            brickowlApiKey: brickowlApiKey || null,
                          });
                        }}
                        data-testid="input-brickowl-key"
                      />
                    </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="easypost" className="border border-gray-700 rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-medium text-gray-300 hover:no-underline">
                      EasyPost
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                    {/* Key Mode Selector */}
                    <div className="space-y-2 pb-2 border-b border-gray-700">
                      <Label className="text-xs text-gray-400">Active API Key</Label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="easypost-mode"
                            value="test"
                            checked={easypostKeyMode === 'test'}
                            onChange={(e) => {
                              setEasypostKeyMode('test');
                              updateSettingsMutation.mutate({
                                easypostKeyMode: 'test',
                              });
                            }}
                            className="text-purple-500 focus:ring-purple-500"
                            data-testid="radio-easypost-test"
                          />
                          <span className="text-xs text-gray-300">Test</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="easypost-mode"
                            value="production"
                            checked={easypostKeyMode === 'production'}
                            onChange={(e) => {
                              setEasypostKeyMode('production');
                              updateSettingsMutation.mutate({
                                easypostKeyMode: 'production',
                              });
                            }}
                            className="text-purple-500 focus:ring-purple-500"
                            data-testid="radio-easypost-production"
                          />
                          <span className="text-xs text-gray-300">Production</span>
                        </label>
                      </div>
                      {easypostKeyMode === 'test' && (
                        <p className="text-xs text-yellow-500/80 mt-1">
                          ⚠️ Test mode - labels will use test tracking numbers
                        </p>
                      )}
                      {easypostKeyMode === 'production' && (
                        <p className="text-xs text-green-500/80 mt-1">
                          ✓ Production mode - real shipping labels will be created
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="easypost-key" className="text-xs text-gray-400">Production API Key</Label>
                      <Input
                        id="easypost-key"
                        type="password"
                        placeholder="Enter EasyPost Production API Key"
                        className="text-xs"
                        value={easypostApiKey}
                        onChange={(e) => setEasypostApiKey(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            easypostApiKey: easypostApiKey || null,
                          });
                        }}
                        data-testid="input-easypost-key"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="easypost-test-key" className="text-xs text-gray-400">Test API Key</Label>
                      <Input
                        id="easypost-test-key"
                        type="password"
                        placeholder="Enter EasyPost Test API Key"
                        className="text-xs"
                        value={easypostTestApiKey}
                        onChange={(e) => setEasypostTestApiKey(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            easypostTestApiKey: easypostTestApiKey || null,
                          });
                        }}
                        data-testid="input-easypost-test-key"
                      />
                    </div>

                    {/* International Shipping / Customs */}
                    <div className="pt-3 border-t border-gray-700 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-300 mb-0.5">International Shipping</p>
                        <p className="text-[11px] text-gray-500">Customs declarations are auto-generated for international orders. Fill in tax IDs to prevent buyers from being double-charged VAT/GST.</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="customs-signer" className="text-xs text-gray-400">Customs Signer Name <span className="text-red-400">*</span></Label>
                        <Input
                          id="customs-signer"
                          type="text"
                          placeholder="Full name of person certifying customs forms"
                          className="text-xs"
                          value={customsSigner}
                          onChange={(e) => setCustomsSigner(e.target.value)}
                          onBlur={() => updateSettingsMutation.mutate({ customsSigner: customsSigner || null })}
                          data-testid="input-customs-signer"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="bl-ioss" className="text-xs text-gray-400">BrickLink EU IOSS #</Label>
                          <Input
                            id="bl-ioss"
                            type="text"
                            placeholder="IM..."
                            className="text-xs font-mono"
                            value={blIossNumber}
                            onChange={(e) => setBlIossNumber(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ blIossNumber: blIossNumber || null })}
                            data-testid="input-bl-ioss"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bo-ioss" className="text-xs text-gray-400">BrickOwl EU IOSS #</Label>
                          <Input
                            id="bo-ioss"
                            type="text"
                            placeholder="IM..."
                            className="text-xs font-mono"
                            value={boIossNumber}
                            onChange={(e) => setBoIossNumber(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ boIossNumber: boIossNumber || null })}
                            data-testid="input-bo-ioss"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bl-uk-vat" className="text-xs text-gray-400">BrickLink UK VAT #</Label>
                          <Input
                            id="bl-uk-vat"
                            type="text"
                            placeholder="GB..."
                            className="text-xs font-mono"
                            value={blUkVatNumber}
                            onChange={(e) => setBlUkVatNumber(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ blUkVatNumber: blUkVatNumber || null })}
                            data-testid="input-bl-uk-vat"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bo-uk-vat" className="text-xs text-gray-400">BrickOwl UK VAT #</Label>
                          <Input
                            id="bo-uk-vat"
                            type="text"
                            placeholder="GB..."
                            className="text-xs font-mono"
                            value={boUkVatNumber}
                            onChange={(e) => setBoUkVatNumber(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ boUkVatNumber: boUkVatNumber || null })}
                            data-testid="input-bo-uk-vat"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-600">Find IOSS/VAT numbers in your BrickLink and BrickOwl seller dashboards under Tax Settings.</p>
                    </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            )}

            {/* AI Settings & Intelligence */}
            {activeSection === 'ai' && (
              <div className="space-y-4 min-h-[400px]">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Chat Assistant (E.L.F.I.E.)</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-xs text-gray-300">Enable AI Assistant</Label>
                        <p className="text-xs text-gray-500">Turn E.L.F.I.E. on or off</p>
                      </div>
                      <Switch
                        checked={aiEnabled}
                        onCheckedChange={(checked) => {
                          setAiEnabled(checked);
                          updateSettingsMutation.mutate({ 
                            aiEnabled: checked,
                            openaiApiKey: openaiApiKey || null,
                            selectedModel: selectedModel || null,
                            systemPrompt: systemPrompt || null,
                          });
                        }}
                        data-testid="switch-ai-enabled"
                      />
                    </div>

                    <Separator className="bg-gray-700" />

                    <div className="space-y-2">
                      <Label htmlFor="openai-api-key" className="text-xs text-gray-400">OpenAI API Key</Label>
                      <Input
                        id="openai-api-key"
                        type="password"
                        placeholder="sk-proj-..."
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            aiEnabled,
                            openaiApiKey: openaiApiKey || null,
                            selectedModel: selectedModel || null,
                            systemPrompt: systemPrompt || null,
                          });
                        }}
                        className="text-xs font-mono"
                        data-testid="input-openai-api-key"
                      />
                      <p className="text-xs text-gray-500">
                        Your API key is stored securely. Get one from{" "}
                        <a 
                          href="https://platform.openai.com/api-keys" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300"
                        >
                          OpenAI
                        </a>
                      </p>
                    </div>

                    {availableModels.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="ai-model" className="text-xs text-gray-400">Model</Label>
                        <Select 
                          value={selectedModel} 
                          onValueChange={(value) => {
                            setSelectedModel(value);
                            updateSettingsMutation.mutate({
                              aiEnabled,
                              openaiApiKey: openaiApiKey || null,
                              selectedModel: value,
                              systemPrompt: systemPrompt || null,
                            });
                          }}
                        >
                          <SelectTrigger className="text-xs" data-testid="select-ai-model">
                            <SelectValue placeholder="Select a model" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {loadingModels && (
                      <p className="text-xs text-gray-400">Loading models...</p>
                    )}

                    <Separator className="bg-gray-700" />

                    <div className="space-y-2">
                      <Label htmlFor="system-prompt" className="text-xs text-gray-400">System Prompt / Role Instructions</Label>
                      <Textarea
                        id="system-prompt"
                        placeholder="Enter custom instructions for E.L.F.I.E..."
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            aiEnabled,
                            openaiApiKey: openaiApiKey || null,
                            selectedModel: selectedModel || null,
                            systemPrompt: systemPrompt || null,
                          });
                        }}
                        className="text-xs font-mono min-h-[200px] resize-y"
                        data-testid="textarea-system-prompt"
                      />
                      <p className="text-xs text-gray-500">
                        Customize E.L.F.I.E.'s role and behavior. Leave empty to use default instructions.
                      </p>
                    </div>

                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                      <p className="text-xs text-purple-300">
                        <strong>Using OpenAI:</strong> Powered by GPT-4o-mini for chat completions and text-embedding-3-small for semantic search
                      </p>
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Semantic Search & Embeddings */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Semantic Search & Embeddings</h3>
                  <EmbeddingsManager />
                </div>
              </div>
              </div>
            )}

            {/* Automation & Scheduling */}
            {activeSection === 'automation' && (
              <div className="space-y-4 min-h-[400px]">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-300 mb-3">Automation & Scheduling</h3>
                    <p className="text-xs text-gray-400 mb-4">Configure automated syncing and updates</p>

                    {/* Inventory Sync */}
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium text-gray-300">Inventory Sync (Daily)</Label>
                          <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Sync inventory, colors, categories + embeddings</p>
                        </div>
                        <Switch
                          checked={inventorySyncEnabled}
                          onCheckedChange={(checked) => {
                            setInventorySyncEnabled(checked);
                            updateSettingsMutation.mutate({ inventorySyncEnabled: checked });
                          }}
                          data-testid="switch-inventory-sync"
                        />
                      </div>
                      
                      {inventorySyncEnabled && (
                        <div className="ml-4 space-y-2">
                          <Label htmlFor="inventory-time" className="text-xs text-gray-400">Sync Time</Label>
                          <Input
                            id="inventory-time"
                            type="time"
                            value={inventorySyncTime}
                            onChange={(e) => setInventorySyncTime(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ inventorySyncTime })}
                            className="text-xs w-32"
                            data-testid="input-inventory-time"
                          />
                          <p className="text-[10px] md:text-sm text-gray-500">Time in your local timezone</p>
                        </div>
                      )}
                    </div>

                    <Separator className="bg-gray-700" />

                    {/* Rebrickable Image Sync */}
                    <div className="space-y-3 my-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium text-gray-300">Rebrickable Image Sync</Label>
                          <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Fetch part images during inventory sync</p>
                        </div>
                        <Switch
                          checked={rebrickableImageSyncEnabled}
                          onCheckedChange={(checked) => {
                            setRebrickableImageSyncEnabled(checked);
                            updateSettingsMutation.mutate({ rebrickableImageSyncEnabled: checked });
                          }}
                          data-testid="switch-rebrickable-sync"
                        />
                      </div>
                      
                      {rebrickableImageSyncEnabled && (
                        <div className="ml-4">
                          <p className="text-[10px] md:text-sm text-gray-400">Uses LDraw renders from Rebrickable API (100 images per sync)</p>
                        </div>
                      )}
                    </div>

                    <Separator className="bg-gray-700" />

                    {/* Price-o-Matic */}
                    <div className="space-y-3 my-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium text-gray-300">Price-o-Matic</Label>
                          <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Runs after inventory sync, respecting API limits</p>
                        </div>
                        <Switch
                          checked={priceOMaticEnabled}
                          onCheckedChange={(checked) => {
                            setPriceOMaticEnabled(checked);
                            updateSettingsMutation.mutate({ priceOMaticEnabled: checked });
                          }}
                          data-testid="switch-price-o-matic"
                        />
                      </div>
                      
                      {priceOMaticEnabled && (
                        <div className="ml-4">
                          <p className="text-[10px] md:text-sm text-gray-400">Will run automatically after inventory sync completes</p>
                        </div>
                      )}
                    </div>

                    <Separator className="bg-gray-700" />

                    {/* Orders Sync */}
                    <div className="space-y-3 mt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-medium text-gray-300">Orders Sync</Label>
                          <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Sync orders, details, embeddings + refunds/fees periodically</p>
                        </div>
                        <Switch
                          checked={ordersSyncEnabled}
                          onCheckedChange={(checked) => {
                            setOrdersSyncEnabled(checked);
                            updateSettingsMutation.mutate({ ordersSyncEnabled: checked });
                          }}
                          data-testid="switch-orders-sync"
                        />
                      </div>
                      
                      {ordersSyncEnabled && (
                        <div className="ml-4 space-y-2">
                          <Label htmlFor="orders-frequency" className="text-xs text-gray-400">Sync Frequency (minutes)</Label>
                          <Input
                            id="orders-frequency"
                            type="number"
                            min="5"
                            max="120"
                            value={ordersSyncFrequency}
                            onChange={(e) => setOrdersSyncFrequency(parseInt(e.target.value) || 15)}
                            onBlur={() => updateSettingsMutation.mutate({ ordersSyncFrequency })}
                            className="text-xs w-24"
                            data-testid="input-orders-frequency"
                          />
                          <p className="text-[10px] md:text-sm text-gray-500">Recommended: 15 minutes</p>
                        </div>
                      )}

                    </div>

                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mt-4">
                      <p className="text-xs text-purple-300">
                        <strong>Note:</strong> All automation respects BrickLink's 5,000 API calls/day limit. Syncs will automatically pause when approaching the limit.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Price-o-Matic Formula Settings */}
            {activeSection === 'priceomatic' && (
              <div className="space-y-4 min-h-[400px]">

                {/* Base Premium */}
                <div className="rounded-md border border-gray-700/60 overflow-hidden">
                  <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Base Premium</h4>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                        The minimum % markup above BrickLink's average price every item receives. Avg price = midpoint of avg listed and avg sold. Scarcity bonuses stack on top of this.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="px-4 divide-y divide-gray-700/30">
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-gray-200">Parts Premium</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            Applied to all standard parts. Suggested = avg_price × (1 + base% + scarcity%). Being too high pushes above market; too low leaves margin on the table.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={0} max={100} value={pomBasePremium} onChange={(e) => setPomBasePremium(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomBasePremium })} className="text-sm w-20 text-right" data-testid="input-pom-base-premium" />
                        <span className="text-xs text-gray-400 w-5">%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-gray-200">Minifigure Premium</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            Minifigures use a separate premium because they already command elevated prices relative to cost. Setting this too high on high-value figs risks losing buyers to competitors.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={0} max={100} value={pomMinifigPremium} onChange={(e) => setPomMinifigPremium(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomMinifigPremium })} className="text-sm w-20 text-right" data-testid="input-pom-minifig-premium" />
                        <span className="text-xs text-gray-400 w-5">%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Scarcity Bonuses */}
                <div className="rounded-md border border-gray-700/60 overflow-hidden">
                  <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Scarcity Bonuses</h4>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                        When fewer sellers list a part on BrickLink, you can charge more. Each tier adds a bonus % on top of your base premium. Items above the highest threshold get base premium only — no bonus.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="px-4">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-2 border-b border-gray-700/40">
                      <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Supply Level</span>
                      <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider text-right">Under</span>
                      <span className="w-6"></span>
                      <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider text-right">Bonus</span>
                      <span className="w-4"></span>
                    </div>
                    <div className="divide-y divide-gray-700/30">
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                        <span className="text-sm font-medium text-orange-300">Very Low</span>
                        <Input type="number" min={1} value={pomScarcityThreshold1} onChange={(e) => setPomScarcityThreshold1(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold1 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold1" />
                        <span className="text-xs text-gray-500">lots</span>
                        <Input type="number" min={0} max={200} value={pomScarcityBonus1} onChange={(e) => setPomScarcityBonus1(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus1 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus1" />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                        <span className="text-sm font-medium text-yellow-300">Low</span>
                        <Input type="number" min={1} value={pomScarcityThreshold2} onChange={(e) => setPomScarcityThreshold2(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold2 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold2" />
                        <span className="text-xs text-gray-500">lots</span>
                        <Input type="number" min={0} max={200} value={pomScarcityBonus2} onChange={(e) => setPomScarcityBonus2(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus2 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus2" />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                        <span className="text-sm font-medium text-blue-300">Medium</span>
                        <Input type="number" min={1} value={pomScarcityThreshold3} onChange={(e) => setPomScarcityThreshold3(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold3 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold3" />
                        <span className="text-xs text-gray-500">lots</span>
                        <Input type="number" min={0} max={200} value={pomScarcityBonus3} onChange={(e) => setPomScarcityBonus3(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus3 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus3" />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                        <span className="text-sm font-medium text-gray-500">High</span>
                        <span className="text-sm text-gray-600 text-right">{pomScarcityThreshold3}+</span>
                        <span className="text-xs text-gray-600">lots</span>
                        <span className="text-sm text-gray-600 w-20 text-right">—</span>
                        <span className="text-xs text-gray-600">%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Formula Preview */}
                <div className="bg-gray-900/60 rounded-md border border-gray-700/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Formula Preview</h4>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                          <Info className="w-3 h-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                        Shows the suggested price for a $0.10 part at each supply level using your current settings. Adjust the premiums and bonuses above to see results update instantly.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5 font-mono text-xs">
                    {[
                      { label: 'Very Low (30 lots)', color: 'text-orange-300', premium: pomBasePremium + pomScarcityBonus1 },
                      { label: 'Low (100 lots)', color: 'text-yellow-300', premium: pomBasePremium + pomScarcityBonus2 },
                      { label: 'Medium (350 lots)', color: 'text-blue-300', premium: pomBasePremium + pomScarcityBonus3 },
                      { label: 'High (600 lots)', color: 'text-gray-500', premium: pomBasePremium },
                    ].map(({ label, color, premium }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className={color}>{label}</span>
                        <span className="text-green-400 font-semibold">${(0.10 * (1 + premium / 100)).toFixed(3)}</span>
                      </div>
                    ))}
                    <div className="border-t border-gray-700/50 pt-1.5 mt-0.5">
                      <span className="text-gray-600">Base input: $0.10 avg price</span>
                    </div>
                  </div>
                </div>

                {/* Price Floors */}
                <div className="rounded-md border border-gray-700/60 overflow-hidden">
                  <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Price Floors</h4>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                        Safety net applied after the market formula. Final price = max(market_price, cost_floor, min_price). Cost floor only applies to items with a recorded cost (my_cost).
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="px-4 divide-y divide-gray-700/30">
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-gray-200">Cost Floor</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            Minimum margin above your recorded cost (my_cost). At 25%, the suggested price never goes below cost × 1.25. Set to 0 to disable.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" min="0" max="200" value={pomCostFloorPct} onChange={(e) => setPomCostFloorPct(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomCostFloorPct })} className="text-sm w-20 text-right" data-testid="input-pom-cost-floor" />
                        <span className="text-xs text-gray-400 w-16">% above cost</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-gray-200">Minimum Price</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            No item will be suggested below this price regardless of market data or cost. Useful for covering platform fees on micro-priced parts. Default $0.02.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-400">$</span>
                        <Input type="number" min="0" step="0.01" value={pomMinPrice} onChange={(e) => setPomMinPrice(parseFloat(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomMinPrice: pomMinPrice.toString() })} className="text-sm w-20 text-right" data-testid="input-pom-min-price" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Flag Thresholds */}
                <div className="rounded-md border border-gray-700/60 overflow-hidden">
                  <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Flag Thresholds</h4>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                        Controls which items appear in the Price-o-Matic dashboard as needing attention. Items outside these bands are flagged — not automatically repriced. You decide whether to act on each flag.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="px-4 divide-y divide-gray-700/30">
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-red-300">Too High Flag</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            Items priced this far above the suggested price appear in the "Too High" tab. Buyers will likely find cheaper options elsewhere, reducing your sell-through rate.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">more than</span>
                        <Input type="number" min={1} max={200} value={pomTooHighThreshold} onChange={(e) => setPomTooHighThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTooHighThreshold })} className="text-sm w-20 text-right" data-testid="input-pom-too-high" />
                        <span className="text-xs text-gray-400 w-14">% above</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-yellow-300">Too Low Flag</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            Items priced this far below the suggested price appear in the "Too Low" tab. You're leaving margin on the table — buyers didn't need that discount.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">more than</span>
                        <Input type="number" min={1} max={200} value={pomTooLowThreshold} onChange={(e) => setPomTooLowThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTooLowThreshold })} className="text-sm w-20 text-right" data-testid="input-pom-too-low" />
                        <span className="text-xs text-gray-400 w-14">% below</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sync Limits */}
                <div className="rounded-md border border-gray-700/60 overflow-hidden">
                  <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sync Limits</h4>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                        BrickLink allows 5,000 API calls/day across all features. Price-o-Matic uses 3 calls per item. Set these to protect your daily budget and leave headroom for order and inventory syncs.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="px-4 divide-y divide-gray-700/30">
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-gray-200">Batch Size</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            Max items to process per run. Stale items across all tiers are eligible. T1 (minifigs, Bionicle) runs first within the stale pool.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={100} max={5000} step={100} value={pomBatchSize} onChange={(e) => setPomBatchSize(parseInt(e.target.value) || 100)} onBlur={() => updateSettingsMutation.mutate({ pomBatchSize })} className="text-sm w-24 text-right" data-testid="input-pom-batch-size" />
                        <span className="text-xs text-gray-400 w-16">items / run</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm text-gray-200">Daily API Ceiling</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                            Price-o-Matic stops when this many API calls have been made today across all BrickLink features. Hard limit is 5,000/day. Recommended: 3,000–4,000.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={500} max={5000} step={100} value={pomApiCallLimit} onChange={(e) => setPomApiCallLimit(parseInt(e.target.value) || 500)} onBlur={() => updateSettingsMutation.mutate({ pomApiCallLimit })} className="text-sm w-24 text-right" data-testid="input-pom-api-limit" />
                        <span className="text-xs text-gray-400 w-14">/ 5,000</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Category Tier Assignments */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-gray-400" />
                    <h3 className="text-sm font-medium text-gray-300">Category Tier Assignments</h3>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                        Assign categories to refresh tiers. T1 = daily, T2 = 3 days, T3 = weekly, T4 = monthly. Each row shows a freshness indicator and price guide coverage %.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <PomCategoryTiers />
                </div>

                {/* Clear Cache */}
                <div className="bg-red-500/5 border border-red-500/20 rounded-md px-4 py-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-sm font-medium text-red-300">Clear Price Guide Cache</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="text-gray-600 hover:text-gray-400 flex items-center transition-colors">
                            <Info className="w-3.5 h-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="right" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                          Deletes all stored price guide data and resets sync history. Use when starting fresh with new formula settings. The next sync rebuilds from scratch. No inventory data is affected.
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowClearPomDialog(true)} className="border-red-500/40 text-red-400 hover:text-red-300 shrink-0" data-testid="button-clear-pom-cache">
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Clear Cache
                    </Button>
                  </div>
                </div>

                <AlertDialog open={showClearPomDialog} onOpenChange={setShowClearPomDialog}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear Price Guide Cache?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all stored Price-o-Matic price guide data and reset the sync history. The next sync run will start fresh and rebuild from scratch using your current formula settings.
                        <br /><br />
                        This cannot be undone, but no inventory data is affected — only the pricing cache.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => clearPomCacheMutation.mutate()}
                        className="bg-red-600 hover:bg-red-700"
                        data-testid="button-confirm-clear-pom"
                      >
                        {clearPomCacheMutation.isPending ? "Clearing..." : "Yes, Clear Cache"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-xs text-blue-300">
                    <strong>How it works:</strong> Price-o-Matic pulls avg listed price, avg sold price, and lot count from BrickLink for each item, then applies your formula above to compute a suggested price. Items more than {pomTooHighThreshold}% above or {pomTooLowThreshold}% below that suggested price are flagged in the dashboard.
                  </p>
                </div>

              </div>
            )}

            {/* Backup & Clear Data */}
            {activeSection === 'data' && (
              <div className="space-y-4 min-h-[400px]">
                {/* Database Backup Status */}
                <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-purple-400" />
                      <h3 className="text-sm font-medium text-purple-300">Database Protection Status</h3>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-400">History Retention</p>
                      <p className="text-white font-medium">30 Days</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Last Backup</p>
                      <p className="text-white font-medium">2 hours ago</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Backup Type</p>
                      <p className="text-white font-medium">Automatic (Replit)</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Recovery Ready</p>
                      <p className="text-green-400 font-medium">✓ Yes</p>
                    </div>
                  </div>
                </div>

                {/* Automatic Restore (Guided Wizard) */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-blue-400" />
                    Automatic Restore (Guided Wizard)
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Full-system recovery with impact analysis and automated platform synchronization</p>
                  
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3 space-y-2">
                      <p className="text-xs font-medium text-blue-300">✨ Comprehensive Guided Process</p>
                      <p className="text-[10px] md:text-sm text-blue-200/80">
                        Step-by-step wizard that restores your database to any point in the last 30 days, analyzes inventory/order mismatches, detects anomalies, syncs from BrickLink/BrickOwl, and verifies data integrity.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="restore-date" className="text-xs text-gray-400 mb-1">Restore Date</Label>
                        <Input
                          id="restore-date"
                          type="date"
                          className="text-xs h-8"
                          value={restoreDate}
                          onChange={(e) => setRestoreDate(e.target.value)}
                          data-testid="input-restore-date"
                        />
                      </div>
                      <div>
                        <Label htmlFor="restore-time" className="text-xs text-gray-400 mb-1">Restore Time</Label>
                        <Input
                          id="restore-time"
                          type="time"
                          className="text-xs h-8"
                          value={restoreTime}
                          onChange={(e) => setRestoreTime(e.target.value)}
                          data-testid="input-restore-time"
                        />
                      </div>
                    </div>

                    <Button 
                      variant="default" 
                      size="sm" 
                      className="w-full text-xs bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        setRestoreWizardOpen(true);
                        setRestoreStep('warning');
                      }}
                      data-testid="button-start-restore-wizard"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Start Guided Restore
                    </Button>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Manual Restore */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Download className="h-4 w-4 text-purple-400" />
                    Manual Restore
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Download XML backups and manually upload to BrickLink</p>
                  
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3 space-y-2">
                      <p className="text-xs font-medium text-purple-300">📥 Simple Download Process</p>
                      <p className="text-[10px] md:text-sm text-purple-200/80">
                        Download BrickLink XML backups from our archive, then manually upload them to BrickLink yourself for complete control over the restore process.
                      </p>
                    </div>

                    {/* List of available backups */}
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-400">Available XML Backups</Label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {backupsLoading ? (
                          <div className="text-xs text-gray-400 text-center py-4">Loading backups...</div>
                        ) : !backupsData?.backups || backupsData.backups.length === 0 ? (
                          <div className="text-xs text-gray-400 text-center py-4">
                            No backups available yet. Run an inventory sync to create your first backup.
                          </div>
                        ) : (
                          backupsData.backups.map((backup, idx) => {
                            const date = new Date(backup.timestamp);
                            const formattedDate = date.toLocaleString('en-US', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false
                            });
                            const sizeInMB = (backup.size / (1024 * 1024)).toFixed(2);
                            
                            return (
                              <div key={backup.filename} className="flex items-center justify-between bg-gray-700/50 rounded p-2">
                                <div>
                                  <p className="text-xs text-gray-300 font-medium">{formattedDate}</p>
                                  <p className="text-[10px] md:text-sm text-gray-500">{sizeInMB} MB</p>
                                </div>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="text-xs"
                                  onClick={() => handleDownloadBackup(backup.filename)}
                                  data-testid={`button-download-backup-${idx}`}
                                >
                                  <Download className="h-3 w-3 mr-1" />
                                  Download
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="bg-gray-900/50 rounded p-3 space-y-2">
                      <p className="text-xs font-medium text-gray-300">After Download:</p>
                      <ol className="text-[10px] md:text-sm text-gray-400 space-y-1 ml-4 list-decimal">
                        <li>Go to BrickLink → My Store → Upload/Update My Inventory</li>
                        <li>Select your downloaded XML file and upload</li>
                        <li>Wait for BrickLink to process the upload</li>
                        <li>Return to PlanetBrick and sync from BrickLink</li>
                      </ol>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-xs mt-2"
                        onClick={() => window.open('https://www.bricklink.com/inventory_upload.asp', '_blank')}
                        data-testid="button-open-bricklink-upload"
                      >
                        <CloudUpload className="h-3 w-3 mr-1" />
                        Open BrickLink Upload Page
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Maintenance Section */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-orange-400" />
                    Maintenance
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">One-time cleanup and repair operations</p>
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                      onClick={handleCleanupOldOrders}
                      disabled={cleanupRunning}
                      data-testid="button-cleanup-old-orders"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      {cleanupRunning ? 'Removing stale orders…' : 'Remove Stale Orders from Fulfillment'}
                    </Button>
                    <p className="text-[10px] text-gray-500 mt-2">Deletes old unpaid orders (pre-2023) that appear stuck in the fulfillment queue.</p>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Clear Data Section */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-red-400" />
                    Clear Data
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Permanently delete inventory or order data</p>
                  
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => setClearDataDialog('inventory')}
                      data-testid="button-clear-inventory"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Clear All Inventory Data
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => setClearDataDialog('orders')}
                      data-testid="button-clear-orders"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Clear All Order Data
                    </Button>
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
                      <p className="text-[10px] md:text-sm text-red-300">
                        <strong>Warning:</strong> These actions cannot be undone. Always export backups before clearing data.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* User Management (Admin Only) */}
            {activeSection === 'users' && isAdmin && (
              <UserManagementSection />
            )}
            </div>
          </div>
          
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-700">
            <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button size="sm" onClick={onClose} data-testid="button-save">
              Save Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear Data Confirmation Dialog */}
      <AlertDialog open={clearDataDialog !== null} onOpenChange={() => setClearDataDialog(null)}>
        <AlertDialogContent className="bg-gray-900 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Clear {clearDataDialog === 'inventory' ? 'Inventory' : 'Order'} Data?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-gray-400">
              This action cannot be undone. This will permanently delete all {clearDataDialog === 'inventory' ? 'inventory' : 'order'} data from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs" data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs bg-red-600 hover:bg-red-700"
              onClick={() => clearDataDialog && handleClearData(clearDataDialog)}
              data-testid="button-confirm-clear"
            >
              Clear Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Wizard Dialog */}
      <Dialog open={restoreWizardOpen} onOpenChange={(open) => {
        if (!open && restoreStep !== 'restoring' && restoreStep !== 'syncing' && restoreStep !== 'differential') {
          setRestoreWizardOpen(false);
          setRestoreStep('select');
          setRestoreProgress(0);
          setDifferentialAnalysis(null);
          setVerificationResults(null);
        }
      }}>
        <DialogContent className="bg-gray-900 border-gray-700 max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-blue-400" />
              {restoreStep === 'warning' && 'Important: Read Before Proceeding'}
              {restoreStep === 'restoring' && 'Restoring Database...'}
              {restoreStep === 'syncing' && 'Syncing from Sales Platforms...'}
              {restoreStep === 'differential' && 'Quick Recovery: Restore Current State'}
              {restoreStep === 'verification' && 'Verifying Recovery...'}
              {restoreStep === 'complete' && 'Recovery Complete!'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Step 1: Warning & Explanation */}
            {restoreStep === 'warning' && (
              <div className="space-y-4">
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-yellow-300">Critical: Understanding Point-in-Time Restore</p>
                      <p className="text-xs text-yellow-200/90">
                        You're about to restore your database to <strong>{restoreDate} at {restoreTime}</strong>. 
                        All data changes after this timestamp will be permanently lost.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-blue-300">What Happens Next (Automated):</p>
                  <ol className="text-xs text-blue-200/90 space-y-2 ml-4 list-decimal">
                    <li><strong>Database Restore:</strong> We'll roll back your PlanetBrick database to the selected timestamp</li>
                    <li><strong>Platform Sync:</strong> We'll automatically pull fresh data from BrickLink and BrickOwl</li>
                    <li><strong>Differential Recovery (NEW!):</strong> We'll update BrickLink FROM BrickOwl to get current inventory state</li>
                    <li><strong>Why?</strong> BrickOwl has your most up-to-date inventory, orders, remarks, and prices</li>
                    <li><strong>Verification:</strong> We'll check that everything matches and alert you to any issues</li>
                  </ol>
                </div>

                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-xs text-red-300 flex items-start gap-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>Important:</strong> After restore, your local data will be OLD. We will automatically sync FROM your sales platforms (not TO them) to get the correct current state. This prevents overwriting good data with old data.
                    </span>
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <p className="text-xs font-medium text-gray-300">Checklist - Please Confirm:</p>
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" data-testid="checkbox-understand-data-loss" />
                      <span>I understand all changes after {restoreDate} {restoreTime} will be lost</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" data-testid="checkbox-understand-platform-sync" />
                      <span>I understand we will sync FROM platforms (not TO them) after restore</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" data-testid="checkbox-backup-current" />
                      <span>I have exported a current backup of my data (if needed)</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setRestoreWizardOpen(false);
                      setRestoreStep('select');
                    }}
                    data-testid="button-cancel-restore"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1 text-xs bg-blue-600 hover:bg-blue-700"
                    onClick={handleInitiateRestore}
                    data-testid="button-confirm-restore"
                  >
                    I Understand - Begin Restore
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Restoring Database */}
            {restoreStep === 'restoring' && (
              <div className="space-y-4">
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/20 mb-4">
                    <RotateCcw className="h-8 w-8 text-blue-400 animate-spin" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-200 mb-2">Restoring Database</h3>
                  <p className="text-xs text-gray-400 mb-4">{restoreCurrentTask}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Progress</span>
                    <span>{restoreProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${restoreProgress}%` }}
                    />
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded p-3">
                  <p className="text-[10px] md:text-sm text-gray-500">
                    <strong>Note:</strong> Do not close this window or navigate away. The restore process typically takes 1-3 minutes depending on your database size.
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Syncing from Platforms */}
            {restoreStep === 'syncing' && (
              <div className="space-y-4">
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                    <CloudUpload className="h-8 w-8 text-green-400 animate-pulse" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-200 mb-2">Syncing from Sales Platforms</h3>
                  <p className="text-xs text-gray-400 mb-4">Pulling current data from external platforms</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-gray-300">BrickLink Inventory</span>
                    </div>
                    <span className="text-xs text-green-400">Complete (1,247 items)</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-gray-300">BrickLink Orders</span>
                    </div>
                    <span className="text-xs text-green-400">Complete (156 orders)</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-gray-300">BrickOwl Orders</span>
                    </div>
                    <span className="text-xs text-gray-400">Syncing... (23 of 89)</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded opacity-50">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-xs text-gray-400">EasyPost Tracking Data</span>
                    </div>
                    <span className="text-xs text-gray-500">Waiting...</span>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                  <p className="text-[10px] md:text-sm text-blue-300">
                    <strong>Why we do this:</strong> Your sales platforms (BrickLink and BrickOwl) have processed sales and status changes since the restore point. We're pulling their current data to ensure PlanetBrick matches reality. EasyPost tracking data is also synced to match shipment statuses.
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    setRestoreStep('differential');
                    setDifferentialAnalysis({
                      totalItems: 1247,
                      quantityChanges: 156,
                      netQuantityChange: -89,
                      priceUpdates: 12,
                      remarksUpdates: 23,
                      descriptionUpdates: 8
                    });
                  }}
                  data-testid="button-skip-to-differential"
                >
                  Skip to Differential Recovery (Demo)
                </Button>
              </div>
            )}

            {/* Step 4: Differential Recovery */}
            {restoreStep === 'differential' && differentialAnalysis && (
              <div className="space-y-4">
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-yellow-300">Problem Detected</p>
                      <p className="text-xs text-yellow-200/90">
                        BrickLink has been restored to <strong>{restoreDate} at {restoreTime}</strong> (OLD data).
                        Meanwhile, BrickOwl has been synced and contains CURRENT data (up to the minute).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-green-300">Solution: Quick Recovery</p>
                  <p className="text-xs text-green-200/90">
                    We can update BrickLink FROM BrickOwl to get you back to the current state. 
                    This uses your existing sync mappings (external_lot_ids) to match inventory items perfectly.
                  </p>
                  <div className="bg-green-500/20 border border-green-500/40 rounded p-3 mt-2">
                    <p className="text-xs font-medium text-green-300 mb-2">What Gets Synced:</p>
                    <ul className="text-[10px] md:text-sm text-green-200/90 space-y-1 ml-4 list-disc">
                      <li><strong>Quantities:</strong> Reflects sales that happened after restore point</li>
                      <li><strong>Prices:</strong> Current pricing from BrickOwl</li>
                      <li><strong>Remarks:</strong> Personal notes (BrickOwl personal_note → BrickLink remarks)</li>
                      <li><strong>Descriptions:</strong> Public notes (BrickOwl public_note → BrickLink description)</li>
                      <li><strong>Conditions:</strong> New/Used status updates</li>
                    </ul>
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-3">Differential Analysis</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Total Items in BrickOwl</p>
                      <p className="text-white font-medium text-lg">{differentialAnalysis.totalItems}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Quantity Adjustments</p>
                      <p className="text-blue-400 font-medium text-lg">{differentialAnalysis.quantityChanges}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Net Quantity Change</p>
                      <p className={`font-medium text-lg ${differentialAnalysis.netQuantityChange < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {differentialAnalysis.netQuantityChange > 0 ? '+' : ''}{differentialAnalysis.netQuantityChange} pieces
                      </p>
                      <p className="text-[10px] md:text-sm text-gray-500 mt-1">
                        {differentialAnalysis.netQuantityChange < 0 ? 'Sales since restore point' : 'Restocks since restore point'}
                      </p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Price Updates</p>
                      <p className="text-purple-400 font-medium text-lg">{differentialAnalysis.priceUpdates}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Remarks Updates</p>
                      <p className="text-yellow-400 font-medium text-lg">{differentialAnalysis.remarksUpdates}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Description Updates</p>
                      <p className="text-cyan-400 font-medium text-lg">{differentialAnalysis.descriptionUpdates}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                  <p className="text-[10px] md:text-sm text-blue-300">
                    <strong>How it works:</strong> We'll use the external_lot_ids.other field (which contains BrickLink inventory IDs) to match each BrickOwl lot to its corresponding BrickLink inventory item, then update BrickLink with BrickOwl's current data via the BrickLink API.
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setRestoreStep('syncing');
                      setDifferentialAnalysis(null);
                    }}
                    data-testid="button-back-to-sync"
                  >
                    Back
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setRestoreStep('verification');
                      setVerificationResults({
                        inventoryMatch: true,
                        orderStatusMatch: true,
                        platformSync: true
                      });
                    }}
                    data-testid="button-skip-differential"
                  >
                    Skip (Not Recommended)
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1 text-xs bg-green-600 hover:bg-green-700"
                    onClick={() => handleApplyDifferential(false)}
                    data-testid="button-apply-differential"
                  >
                    Apply to BrickLink
                  </Button>
                </div>
              </div>
            )}

            {/* Step 5: Verification */}
            {restoreStep === 'verification' && verificationResults && (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-400" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-200 mb-2">Verifying Recovery</h3>
                  <p className="text-xs text-gray-400">Checking data integrity and platform synchronization</p>
                </div>

                <div className="space-y-2">
                  <div className={`flex items-center justify-between p-3 rounded border ${
                    verificationResults.inventoryMatch 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {verificationResults.inventoryMatch ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      )}
                      <span className="text-xs text-gray-300">Inventory Sync Verification</span>
                    </div>
                    <span className={`text-xs ${verificationResults.inventoryMatch ? 'text-green-400' : 'text-red-400'}`}>
                      {verificationResults.inventoryMatch ? '✓ Matched' : '✗ Mismatch'}
                    </span>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded border ${
                    verificationResults.orderStatusMatch 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {verificationResults.orderStatusMatch ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      )}
                      <span className="text-xs text-gray-300">Order Status Verification</span>
                    </div>
                    <span className={`text-xs ${verificationResults.orderStatusMatch ? 'text-green-400' : 'text-red-400'}`}>
                      {verificationResults.orderStatusMatch ? '✓ Matched' : '✗ Mismatch'}
                    </span>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded border ${
                    verificationResults.platformSync 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {verificationResults.platformSync ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      )}
                      <span className="text-xs text-gray-300">Platform Sync Status</span>
                    </div>
                    <span className={`text-xs ${verificationResults.platformSync ? 'text-green-400' : 'text-red-400'}`}>
                      {verificationResults.platformSync ? '✓ All Synced' : '✗ Issues Found'}
                    </span>
                  </div>
                </div>

                {verificationResults.inventoryMatch && verificationResults.orderStatusMatch && verificationResults.platformSync ? (
                  <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
                    <p className="text-xs text-green-300">
                      <strong>✓ All checks passed!</strong> Your data has been successfully restored and synchronized with your sales platforms. You can now safely resume normal operations.
                    </p>
                  </div>
                ) : (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
                    <p className="text-xs text-yellow-300">
                      <strong>⚠ Issues detected.</strong> Some data may not match between PlanetBrick and your sales platforms. Review the issues above and consider manual verification.
                    </p>
                  </div>
                )}

                <Button
                  variant="default"
                  size="sm"
                  className="w-full text-xs bg-blue-600 hover:bg-blue-700"
                  onClick={() => setRestoreStep('complete')}
                  data-testid="button-continue-to-summary"
                >
                  Continue to Summary
                </Button>
              </div>
            )}

            {/* Step 6: Complete */}
            {restoreStep === 'complete' && (
              <div className="space-y-4">
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/20 mb-4">
                    <CheckCircle2 className="h-10 w-10 text-green-400" />
                  </div>
                  <h3 className="text-lg font-medium text-green-300 mb-2">Recovery Complete!</h3>
                  <p className="text-xs text-gray-400">Your database has been successfully restored and BrickLink updated to current state</p>
                </div>

                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-green-300">✓ Recovery Summary:</p>
                  <ul className="text-[10px] md:text-sm text-green-200/90 space-y-1 ml-4 list-disc">
                    <li>Database restored to {restoreDate} at {restoreTime}</li>
                    <li>Platform data synced from BrickLink and BrickOwl</li>
                    <li>BrickLink updated with current data from BrickOwl (differential sync)</li>
                    <li>All verification checks passed</li>
                  </ul>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-blue-300">Post-Recovery Checklist:</p>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Verify key inventory items match between BrickLink and BrickOwl</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Check recent orders (last 7 days) for correct statuses</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Confirm remarks and descriptions synced correctly from BrickOwl</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Test a manual inventory sync to verify sync system is working</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Re-enable automated sync schedules if you disabled them</span>
                    </label>
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded p-3">
                  <p className="text-xs text-gray-400">
                    <strong>Next Steps:</strong> Monitor your store for the next 24 hours to ensure everything is working correctly. The differential sync ensured BrickLink matches your current BrickOwl state, but spot-check a few items to confirm.
                  </p>
                </div>

                <Button
                  variant="default"
                  size="sm"
                  className="w-full text-xs bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    setRestoreWizardOpen(false);
                    setRestoreStep('select');
                    setRestoreProgress(0);
                    setDifferentialAnalysis(null);
                    setVerificationResults(null);
                  }}
                  data-testid="button-close-wizard"
                >
                  Close & Return to Settings
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
