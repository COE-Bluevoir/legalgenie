import React, { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileText, AlertTriangle, BrainCircuit, ListChecks, Workflow, CheckCheck, Loader2, FileCheck2, Hourglass } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip } from "recharts";
import { ContractsAPI } from "@/lib/api";

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

const ContractsSuite: React.FC = () => {
  const [text, setText] = useState("");
  const { execute, loading, error, data } = useApiAction(ContractsAPI.review);

  const runReview = async () => { await execute({ text }); };

  const riskSeries = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 } as Record<string, number>;
    (data?.clauses || []).forEach((c) => (counts[c.risk] = (counts[c.risk] || 0) + 1));
    return [
      { name: "Sev High", value: counts.High || 7 },
      { name: "Sev Med", value: counts.Medium || 12 },
      { name: "Sev Low", value: counts.Low || 21 },
    ];
  }, [data]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" /> Contract Review
                </CardTitle>
                <CardDescription>Risk assessment, clause extraction, and redlines.</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button onClick={runReview} className="rounded-xl" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={() => setText("")}>
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && <div className="text-sm text-red-600 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border rounded-xl p-3">
                <div className="text-sm font-medium mb-2 flex items-center gap-2"><BrainCircuit className="h-4 w-4" /> Risk Overview</div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={riskSeries} dataKey="value" nameKey="name" outerRadius={80}>
                        {riskSeries.map((_, idx) => (<Cell key={idx} />))}
                      </Pie>
                      <RTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-xs text-slate-500">Auto-categorized by severity.</div>
              </div>
              <div className="border rounded-xl p-3">
                <div className="text-sm font-medium mb-2 flex items-center gap-2"><ListChecks className="h-4 w-4" /> Key Clauses</div>
                <ul className="space-y-2 text-sm">
                  {(data?.clauses || [
                    { name: "Indemnity", risk: "High", recommendation: "Cap liability to 100% fees" },
                    { name: "Limitation of Liability", risk: "Medium", recommendation: "Exclude indirect damages" },
                    { name: "Confidentiality", risk: "Low", recommendation: "Add 2-year survival" },
                  ]).map((c: any, i: number) => (
                    <li key={i} className="p-2 rounded-lg border flex items-center justify-between">
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-slate-500">Recommendation: {c.recommendation}</div>
                      </div>
                      <Badge variant={c.risk === "High" ? "destructive" : c.risk === "Medium" ? "default" : "secondary"} className="rounded-xl">{c.risk}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border rounded-xl p-3">
                <div className="text-sm font-medium mb-2 flex items-center gap-2"><Workflow className="h-4 w-4" /> Redlines</div>
                <Textarea className="h-40 rounded-xl" placeholder="AI redline suggestions..." value={data?.redlines || ""} readOnly />
                <div className="mt-2 flex gap-2">
                  <Button className="rounded-xl">Apply All</Button>
                  <Button variant="outline" className="rounded-xl">Compare</Button>
                </div>
              </div>
              <div className="border rounded-xl p-3">
                <div className="text-sm font-medium mb-2 flex items-center gap-2"><CheckCheck className="h-4 w-4" /> Compliance Check</div>
                <div className="text-sm">Validation against Indian regulations.</div>
                <ul className="mt-2 text-sm space-y-2">
                  {(data?.compliance || [
                    { name: "IT Act, 2000", status: "OK" },
                    { name: "DPDP Act, 2023", status: "Review" },
                    { name: "Contract Act, 1872", status: "OK" },
                  ]).map((c: any, i: number) => (
                    <li key={i} className="flex items-center justify-between border rounded-lg p-2">
                      <span>{c.name}</span>
                      <Badge className="rounded-xl" variant={c.status === "OK" ? "secondary" : c.status === "Review" ? "default" : "destructive"}>{c.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right */}
      <div className="space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileCheck2 className="h-5 w-5" /> Smart Obligations</CardTitle>
            <CardDescription>Track deliverables & deadlines.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.obligations || [
              { title: "Deliver roadmap", due: "10 Sep 2025", status: "Pending" },
              { title: "Data processing addendum", due: "22 Sep 2025", status: "At Risk" },
              { title: "Invoice review", due: "01 Oct 2025", status: "Done" },
            ]).map((o: any, i: number) => (
              <div key={i} className="p-2 border rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{o.title}</div>
                  <div className="text-xs text-slate-500">Due: {o.due}</div>
                </div>
                <Badge className="rounded-xl" variant={o.status === "Done" ? "secondary" : o.status === "At Risk" ? "destructive" : "default"}>{o.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Hourglass className="h-5 w-5" /> Review Progress</CardTitle>
            <CardDescription>Processing, extraction, and validation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label className="text-xs">Extraction</Label>
            <Progress value={72} className="h-2" />
            <Label className="text-xs">Risk Scoring</Label>
            <Progress value={46} className="h-2" />
            <Label className="text-xs">Compliance</Label>
            <Progress value={88} className="h-2" />
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-sm">Paste Contract Text</CardTitle></CardHeader>
          <CardContent>
            <Textarea className="h-40 rounded-xl" placeholder="Paste contract here to analyze…" value={text} onChange={(e) => setText(e.target.value)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ContractsSuite;
