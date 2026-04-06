import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  LayoutDashboard, 
  ListTodo, 
  Files, 
  Upload, 
  AlertCircle, 
  Send, 
  Settings, 
  BarChart3,
  LogOut,
  LogIn,
  Clock,
  ShieldX
} from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, isAuthenticated, sessionExpiry, login, logout } = useAuth();

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Queue", href: "/queue", icon: ListTodo },
    { label: "All Claims", href: "/claims", icon: Files },
    { label: "Import", href: "/import", icon: Upload },
    { label: "Error Types", href: "/error-types", icon: AlertCircle },
    { label: "Portal Submissions", href: "/portal-submissions", icon: Send },
    { label: "Summary", href: "/summary", icon: BarChart3 },
    { label: "Settings", href: "/settings", icon: Settings },
  ];

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-xl bg-[#1B2A4A] flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 100 100" fill="none">
                  <path d="M50 8 C50 8 20 55 20 70 C20 85 33 95 50 95 C67 95 80 85 80 70 C80 55 50 8 50 8Z" fill="none" stroke="white" strokeWidth="6"/>
                  <path d="M35 72 L50 45 L65 72" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M65 72 C72 60 78 65 82 58" fill="none" stroke="#E85D3A" strokeWidth="5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <CardTitle className="text-2xl">Agape ClaimClear</CardTitle>
            <p className="text-muted-foreground text-sm mt-1">NEMT Claims Dispute Command Center</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {sessionExpiry === "expired_idle" && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 w-full text-center">
                <div className="flex items-center justify-center gap-2 text-amber-800 font-medium text-sm">
                  <Clock className="h-4 w-4" />
                  Session timed out due to inactivity
                </div>
                <p className="text-xs text-amber-600 mt-1">For security, sessions expire after 30 minutes of inactivity.</p>
              </div>
            )}
            {sessionExpiry === "expired_absolute" && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 w-full text-center">
                <div className="flex items-center justify-center gap-2 text-blue-800 font-medium text-sm">
                  <Clock className="h-4 w-4" />
                  Session expired
                </div>
                <p className="text-xs text-blue-600 mt-1">For security, sessions expire after 8 hours. Please sign in again.</p>
              </div>
            )}
            {!sessionExpiry && (
              <p className="text-sm text-muted-foreground text-center">
                Sign in with your Replit account to access the dashboard.
              </p>
            )}
            <Button onClick={() => login()} size="lg" className="w-full gap-2">
              <LogIn className="h-5 w-5" />
              Sign In with Replit
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user.status === "pending") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock className="h-8 w-8 text-amber-600" />
              </div>
            </div>
            <CardTitle className="text-xl">Access Request Submitted</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center">
              Your request to access Agape ClaimClear has been submitted. An administrator will review and approve your access shortly.
            </p>
            <div className="text-sm text-muted-foreground bg-muted rounded-md p-3 w-full">
              <div className="flex justify-between"><span>Account</span><span className="font-medium">{user.email}</span></div>
              <div className="flex justify-between mt-1"><span>Status</span><span className="font-medium text-amber-600">Pending Approval</span></div>
            </div>
            <Button variant="outline" onClick={() => logout()} className="w-full gap-2">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user.status === "denied") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-xl bg-red-100 flex items-center justify-center">
                <ShieldX className="h-8 w-8 text-red-600" />
              </div>
            </div>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center">
              Your access request has been denied. Please contact an administrator if you believe this is an error.
            </p>
            <Button variant="outline" onClick={() => logout()} className="w-full gap-2">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen w-full flex bg-background">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarHeader className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-2.5 font-bold text-xl text-sidebar-foreground tracking-tight">
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
                  <path d="M50 8 C50 8 20 55 20 70 C20 85 33 95 50 95 C67 95 80 85 80 70 C80 55 50 8 50 8Z" fill="none" stroke="white" strokeWidth="7"/>
                  <path d="M35 72 L50 45 L65 72" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M65 72 C72 60 78 65 82 58" fill="none" stroke="#E85D3A" strokeWidth="6" strokeLinecap="round"/>
                </svg>
              </div>
              <span>Agape <span className="font-normal text-sidebar-foreground/60 text-base">ClaimClear</span></span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton 
                        asChild 
                        isActive={location === item.href || location.startsWith(`${item.href}/`)}
                        tooltip={item.label}
                      >
                        <Link href={item.href} className="flex items-center gap-3">
                          <item.icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3 overflow-hidden">
                <Avatar className="h-9 w-9 border border-sidebar-border">
                  <AvatarImage src={user.profileImageUrl || undefined} />
                  <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground">
                    {user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium text-sidebar-foreground truncate">
                    {user.displayName || "User"}
                  </span>
                  <span className="text-xs text-sidebar-foreground/70 truncate">
                    {user.email}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => logout()} className="text-sidebar-foreground hover:bg-sidebar-accent shrink-0">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b bg-card flex items-center px-4 sticky top-0 z-10 shrink-0">
            <SidebarTrigger className="mr-4" />
            <h1 className="font-semibold text-sm text-muted-foreground">NEMT Claims Dispute Command Center</h1>
          </header>
          <main className="flex-1 overflow-auto p-6 md:p-8">
            <div className="max-w-7xl mx-auto h-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
