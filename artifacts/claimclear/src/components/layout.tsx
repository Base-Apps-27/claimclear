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
  LogIn
} from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, isAuthenticated, login, logout } = useAuth();

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

  return (
    <SidebarProvider>
      <div className="min-h-screen w-full flex bg-background">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarHeader className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-2 font-bold text-xl text-sidebar-foreground tracking-tight">
              <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
                CC
              </div>
              ClaimClear
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
            {isAuthenticated && user ? (
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
            ) : (
              <Button onClick={() => login()} className="w-full justify-start gap-2" variant="outline">
                <LogIn className="h-4 w-4" />
                Log In
              </Button>
            )}
          </SidebarFooter>
        </Sidebar>
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b bg-card flex items-center px-4 sticky top-0 z-10 shrink-0">
            <SidebarTrigger className="mr-4" />
            <h1 className="font-semibold text-sm">NEMT Claim Dispute Command Center</h1>
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
