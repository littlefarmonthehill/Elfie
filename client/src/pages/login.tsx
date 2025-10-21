import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LogIn, Package } from "lucide-react";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-900 via-gray-800 to-lego-red/20">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-lego-red/10 rounded-full">
              <Package className="w-12 h-12 text-lego-red" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-lego-red via-lego-yellow to-lego-blue bg-clip-text text-transparent">
            PlanetBrick
          </CardTitle>
          <CardDescription className="text-base mt-2">
            LEGO Business Operations Dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
            <p className="text-sm text-gray-300 text-center">
              Welcome to PlanetBrick, your LEGO inventory and operations platform. 
              Please log in to continue.
            </p>
          </div>

          <Button 
            className="w-full"
            size="lg"
            onClick={() => window.location.href = '/api/login'}
            data-testid="button-login"
          >
            <LogIn className="w-5 h-5 mr-2" />
            Log In
          </Button>

          <div className="text-center">
            <p className="text-xs text-gray-500">
              Access is restricted to approved users only
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
