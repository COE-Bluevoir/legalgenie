import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Scale, FileText, Gavel, Landmark, ShieldCheck, Settings, ChevronRight, ChevronLeft,
  Bell, Download, UploadCloud, Languages, History, Sparkles, Loader2, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { ResearchAPI, VectorAPI } from "@/lib/api";

// Feature tabs
import ResearchEngine from "@/features/research/ResearchEngine";
import ContractsSuite from "@/features/contracts/ContractsSuite";
import DraftingAssistant from "@/features/drafting/DraftingAssistant";
import LitigationSupport from "@/features/litigation/LitigationSupport";
import ComplianceDashboard from "@/features/compliance/ComplianceDashboard";
import AdminPanel from "@/features/admin/AdminPanel";
import LoginPage from "@/features/auth/LoginPage";
import { useAuth } from "@/lib/auth";
import type { AuthUser } from "@/lib/api";

/* simple hook used by GlobalSearch */
function useApiAction<A, R>(fn: (args: A) => Promise<{ ok: boolean; data?: R; error?: string }>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<R | null>(null);
  const execute = async (args: A) => {
    setLoading(true);
    setError(null);
    const res = await fn(args);
    setLoading(false);
    if (res.ok && res.data !== undefined) setData(res.data);
    else setError(res.error || "Error");
    return res;
  };
  return { execute, loading, error, data, setData };
}

/*******************
 * Layout Shell
 *******************/
type ShellProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  active: string;
  setActive: (value: string) => void;
  user: AuthUser;
  onLogout: () => void;
  authLoading?: boolean;
};

const Shell: React.FC<ShellProps> = ({
  sidebarOpen,
  setSidebarOpen,
  active,
  setActive,
  user,
  onLogout,
  authLoading,
}) => {
  const baseNav = [
    { key: "research", label: "Research", icon: Scale},
    { key: "contracts", label: "Contracts", icon: FileText},
    { key: "drafting", label: "Drafting", icon: FileText},
    { key: "litigation", label: "Litigation", icon: Gavel},
    { key: "compliance", label: "Compliance", icon: ShieldCheck},
  ];
  const nav = useMemo(() => {
    const items = [...baseNav];
    if (user.role === "admin") {
      items.push({ key: "admin", label: "Admin", icon: Settings});
    }
    return items;
  }, [user.role]);

  return (
    <div className="flex h-screen min-h-screen overflow-auto bg-gradient-to-b from-white to-slate-50 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="hidden w-72 shrink-0 border-r bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-slate-800 dark:bg-slate-900/60 md:block"
          >
            <div className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white font-semibold shadow-lg">
                LG
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight">LegalGenie</div>
                <div className="text-xs text-slate-500">Research workspace</div>
              </div>
            </div>
            <Separator />
            <div className="space-y-1 p-3">
              {nav.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.key;
                return (
                  <Button
                    key={item.key}
                    variant={isActive ? "default" : "ghost"}
                    className="w-full justify-start gap-3 rounded-xl py-5"
                    onClick={() => setActive(item.key)}
                  >
                    <Icon className="h-4 w-4" />
                    <div className="flex flex-col text-left">
                      <span className="font-medium">{item.label}</span>
                    
                    </div>
                    {isActive && <Badge className="ml-auto">Active</Badge>}
                  </Button>
                );
              })}
            </div>
            <Separator />
            <div className="space-y-1 p-3">
              <Label className="text-xs text-slate-500">Quick Actions</Label>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button className="rounded-xl" variant="secondary">
                  <UploadCloud className="mr-2 h-4 w-4" />
                  Upload
                </Button>
                <Button className="rounded-xl" variant="secondary">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
                <Button className="rounded-xl" variant="secondary">
                  <Languages className="mr-2 h-4 w-4" />
                  Translate
                </Button>
                <Button className="rounded-xl" variant="secondary">
                  <History className="mr-2 h-4 w-4" />
                  History
                </Button>
              </div>
            </div>
            <Separator />
            <div className="p-4">
              <Card className="rounded-2xl border-dashed">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4" /> Pro Tips
                  </CardTitle>
                  <CardDescription>
                    Use court/judge filters and citations:strict for precise validation.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* right column */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <Header
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          user={user}
          onLogout={onLogout}
          authLoading={authLoading}
        />
        {/* main needs min-h-0 so children can scroll */}
        <main className="flex flex-1 min-h-0 flex-col gap-6 overflow-auto p-4 md:p-6">
          {active !== "research" && <GlobalSearch />}
          {/* The workspace fills and handles its own scrolling */}
          <div className="flex-1 min-h-0 overflow-auto">
            <Workspace active={active} />
          </div>
        </main>
      </div>
    </div>
  );
};

/*******************
 * Header
 *******************/
type HeaderProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  user: AuthUser;
  onLogout: () => void;
  authLoading?: boolean;
};

const Header: React.FC<HeaderProps> = ({
  sidebarOpen,
  setSidebarOpen,
  user,
  onLogout,
  authLoading = false,
}) => {
  const initials =
    (user.email || "?")
      .split(/[@.]/)
      .filter((segment): segment is string => Boolean(segment))
      .slice(0, 2)
      .map((segment) => segment.charAt(0).toUpperCase())
      .join("") || "LG";

  return (
    <div className="sticky top-0 z-40 border-b bg-white/70 backdrop-blur dark:bg-slate-900/70">
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <Button
          size="icon"
          variant="ghost"
          className="rounded-xl"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </Button>
        <Badge variant="outline" className="gap-2 rounded-xl">
          <Landmark className="h-3 w-3" /> India-first Legal AI
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-xl">
                <Bell className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Notifications</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" className="gap-2 rounded-xl">
                <Settings className="h-4 w-4" /> Settings
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl">
              <DropdownMenuLabel className="text-xs">Signed in as</DropdownMenuLabel>
              <DropdownMenuItem disabled className="opacity-80">
                {user.email}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Preferences</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Dark mode: Auto</DropdownMenuItem>
              <DropdownMenuItem>Language: Auto-detect</DropdownMenuItem>
              <DropdownMenuItem>Data residency: India</DropdownMenuItem>
              <DropdownMenuItem>Export audit log</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                disabled={authLoading}
                onSelect={(event: Event) => {
                  event.preventDefault();
                  if (!authLoading) onLogout();
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </div>
  );
};

/********************************
 * Global Search (top bar card)
 ********************************/
const GlobalSearch: React.FC = () => {
  const [query, setQuery] = useState("");
  const [filters] = useState<Record<string, any>>({});
  const { execute: execSearch, loading, error, data } = useApiAction(VectorAPI.search);
  const { execute: execAsk, loading: askLoading, data: askData, error: askError } = useApiAction(ResearchAPI.ask);

  const onSearch = async () => {
    if (!query.trim()) return;
    await execSearch({ query, filters, topK: 10 });
  };
  const onAsk = async () => {
    if (!query.trim()) return;
    await execAsk({ question: query, k: 6, strictCitations: true });
  };

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4 md:p-6">
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
          <div className="flex-1 flex items-center gap-3">
            <Search className="h-5 w-5 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
              placeholder="Search 20M+ judgments, contracts, drafts (court:SC judge:...)"
              className="rounded-xl"
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <Button className="rounded-xl gap-2" onClick={onAsk} disabled={askLoading}>
              {askLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Ask Genie
            </Button>
            <Button variant="outline" className="rounded-xl gap-2" onClick={onSearch} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </div>
        </div>
        {(error || askError) && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" /> {error || askError}
          </div>
        )}
        {(data || askData) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary" className="rounded-xl">Filters: Supreme Court</Badge>
            <Badge variant="secondary" className="rounded-xl">Language: Auto</Badge>
            <Badge variant="secondary" className="rounded-xl">Date: Last 5 years</Badge>
            <Badge variant="secondary" className="rounded-xl">Citations: Strict</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/*******************
 * Workspace Tabs
 *******************/
const Workspace: React.FC<{ active: string }> = ({ active }) => {
  return (
    <Tabs defaultValue={active} value={active} className="flex h-full w-full min-h-0 flex-col">
      <TabsList className="hidden" />
      {/* Each tab fills and lets its inner content manage scroll */}
      <TabsContent value="research" className="flex h-full min-h-0 flex-col overflow-auto">
        <ResearchEngine />
      </TabsContent>

      <TabsContent value="contracts" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <ContractsSuite />
        </div>
      </TabsContent>

      <TabsContent value="drafting" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <DraftingAssistant />
        </div>
      </TabsContent>

      <TabsContent value="litigation" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <LitigationSupport />
        </div>
      </TabsContent>

      <TabsContent value="compliance" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <ComplianceDashboard />
        </div>
      </TabsContent>

      <TabsContent value="admin" className="flex h-full min-h-0 flex-col overflow-auto">
        <AdminPanel />
      </TabsContent>
    </Tabs>
  );
};

/********
 * Root
 ********/
const App: React.FC = () => {
  const { auth, logout, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [active, setActive] = useState("research");

  if (!auth.token || !auth.user) {
    return <LoginPage />;
  }

  return (
    <TooltipProvider>
      <Shell
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        active={active}
        setActive={setActive}
        user={auth.user}
        onLogout={logout}
        authLoading={loading}
      />
    </TooltipProvider>
  );
};

export default App;
