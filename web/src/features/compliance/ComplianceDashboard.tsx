import React, { useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, ShieldCheck, BookOpenCheck, Scale, AlertTriangle, Loader2 } from "lucide-react";
import { ComplianceAPI } from "@/lib/api";

function useApiAction<A, R>(fn: (args: A) => Promise<{ ok: boolean; data?: R; error?: string }>) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<R | null>(null);
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

const ComplianceDashboard: React.FC = () => {
  const { execute, loading, error, data } = useApiAction(ComplianceAPI.status);

  useEffect(() => { (execute as any)(undefined); }, []); // initial load

  const statuses = (data as any)?.statuses || [
    { title: "DPDP Act, 2023", status: "Attention", pct: 62 },
    { title: "IT Act, 2000", status: "Compliant", pct: 91 },
    { title: "Companies Act, 2013", status: "On Track", pct: 78 },
  ];
  const updates = (data as any)?.updates || [
    { date: "18 Aug 2025", text: "CERT-In advisory on data breach reporting timelines." },
    { date: "12 Aug 2025", text: "SEBI updates on disclosure norms for listed entities." },
    { date: "05 Aug 2025", text: "RBI circular on KYC periodicity changes." },
  ];
  const audit = (data as any)?.audit || [
    { text: "Signed DPA v1.2", time: "12:31 IST" },
    { text: "Updated policy mapping", time: "12:34 IST" },
    { text: "Acknowledged SEBI update", time: "12:36 IST" },
    { text: "Exported compliance report", time: "12:39 IST" },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Compliance Status</CardTitle>
                <CardDescription>Real-time regulatory tracking with actionable insights.</CardDescription>
              </div>
              {loading && <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> syncing…</div>}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {statuses.map((c: any, i: number) => (
              <Card key={i} className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                  <CardDescription>Status: {c.status}</CardDescription>
                </CardHeader>
                <CardContent><Progress value={c.pct} className="h-2" /></CardContent>
                <CardFooter><Button variant="outline" className="rounded-xl w-full">View Details</Button></CardFooter>
              </Card>
            ))}
          </CardContent>
          {error && <CardFooter className="text-sm text-red-600 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</CardFooter>}
        </Card>
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpenCheck className="h-5 w-5" /> Regulatory Updates</CardTitle>
            <CardDescription>Tracked across central & state notifications.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {updates.map((u: any, i: number) => (
              <div key={i} className="p-2 border rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-medium">{u.text}</div>
                  <div className="text-xs text-slate-500">{u.date}</div>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl">Acknowledge</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5" /> Audit Trail</CardTitle>
            <CardDescription>Immutable ledger of actions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {audit.map((a: any, i: number) => (
              <div key={i} className="p-2 border rounded-xl flex items-center justify-between">
                <span>{a.text}</span><span className="text-xs text-slate-500">{a.time}</span>
              </div>
            ))}
            <Button variant="outline" className="w-full rounded-xl"><Download className="h-4 w-4 mr-2" /> Export Report</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ComplianceDashboard;
