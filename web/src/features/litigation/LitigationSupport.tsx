import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Gavel, CalendarClock, Loader2, TrendingUp, UserRound } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip as RTooltip } from "recharts";
import { LitigationAPI } from "@/lib/api";

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

const defaultTimeline = [
  { day: "Day 0", events: 2 },
  { day: "Day 7", events: 5 },
  { day: "Day 14", events: 8 },
  { day: "Day 21", events: 10 },
  { day: "Day 30", events: 13 },
];

const LitigationSupport: React.FC = () => {
  const [matter, setMatter] = useState("");
  const { execute, loading, error, data } = useApiAction(LitigationAPI.insights);
  const run = async () => { await execute({ matter }); };
  const timelineData = (data as any)?.timeline?.length ? (data as any).timeline : defaultTimeline;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Gavel className="h-5 w-5" /> Strategy Recommendations</CardTitle>
                <CardDescription>Based on similar case clusters and outcome signals.</CardDescription>
              </div>
              <div className="flex gap-2">
                <Input placeholder="Matter summary…" className="rounded-xl w-64" value={matter} onChange={(e) => setMatter(e.target.value)} />
                <Button className="rounded-xl" onClick={run} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run Insights"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {error && <div className="text-sm text-red-600 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</div>}
            {((data as any)?.strategies || [
              { title: "Primary Strategy", text: "File under writ jurisdiction; seek interim relief citing urgency.", confidence: "High", cites: "SC 2020, Del HC 2019" },
              { title: "Fallback Strategy", text: "Consider arbitration invocation and Section 9 relief.", confidence: "Medium", cites: "Bom HC 2018" },
            ]).map((s: any, i: number) => (
              <div key={i} className="p-3 border rounded-xl">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-sm text-slate-600 dark:text-slate-300">{s.text}</div>
                <div className="text-xs text-slate-500 mt-1">Confidence: {s.confidence} · Cited: {s.cites}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" /> Timeline Builder</CardTitle>
            <CardDescription>Chronological view of events, filings, and hearings.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <RTooltip />
                  <Line type="monotone" dataKey="events" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Settlement Probability</CardTitle>
            <CardDescription>Model-estimated chance of settlement.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-semibold">{(data as any)?.settlement_probability ?? 64}%</div>
            <div className="text-xs text-slate-500">Based on similar matters in last 5 years</div>
            <div className="mt-3 flex gap-2">
              <Button className="rounded-xl">Improve Odds</Button>
              <Button variant="outline" className="rounded-xl">See Drivers</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" /> Opposing Counsel</CardTitle>
            <CardDescription>Historical performance & appearance stats.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {((data as any)?.counsel_stats || [
              { name: "R. Mehta", win: 58 },
              { name: "S. Iyer", win: 46 },
              { name: "A. Khan", win: 51 },
            ]).map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between border p-2 rounded-xl">
                <span>{c.name}</span>
                <Badge className="rounded-xl">Win {c.win}%</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LitigationSupport;
