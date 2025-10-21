import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertCircle, Mail, LogOut } from "lucide-react";

export default function PendingApproval() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-900 via-gray-800 to-lego-red/20">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-orange-500/10 rounded-full">
              <AlertCircle className="w-12 h-12 text-orange-400" />
            </div>
          </div>
          <CardTitle className="text-2xl">Access Pending Approval</CardTitle>
          <CardDescription className="text-base mt-2">
            Your account is awaiting approval from an administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 space-y-2">
            <p className="text-sm text-gray-300">
              <strong>Logged in as:</strong>
            </p>
            <p className="text-sm text-gray-400">
              {user?.email || "No email"}
            </p>
            {user?.firstName && user?.lastName && (
              <p className="text-sm text-gray-400">
                {user.firstName} {user.lastName}
              </p>
            )}
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-2">
            <div className="flex items-start gap-2">
              <Mail className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-300 font-medium">What happens next?</p>
                <p className="text-xs text-gray-400 mt-1">
                  A PlanetBrick administrator will review your account and approve access. 
                  You'll be able to access the platform once approved.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 space-y-2">
            <p className="text-xs text-gray-400">
              <strong>Need to contact us?</strong>
            </p>
            <p className="text-xs text-gray-500">
              Email: <a href="mailto:bhnorby@gmail.com" className="text-lego-blue hover:underline">bhnorby@gmail.com</a>
            </p>
          </div>

          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => window.location.href = '/api/logout'}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Log Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
