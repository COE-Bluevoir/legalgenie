import React, { useState } from "react";
import { Sparkles, FileSignature, AlertTriangle, GitBranch, Download, Activity, ArrowRightLeft} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

// If you already have a real API, replace this with your hook
// import { useApiAction } from "@/lib/hooks"; // example
// import { DraftingAPI } from "@/lib/api";       // example

const DraftingAssistant: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string>("");

  async function draft() {
    setError(null);
    setLoading(true);
    try {
      // TODO: swap with your actual API call:
      // const res = await DraftingAPI.generate({ prompt });
      // if (!res.ok) throw new Error(res.error);
      // setDraftText(res.data.draft_text);

      // Demo fallback:
      await new Promise((r) => setTimeout(r, 800));
      setDraftText(
        `IN THE HIGH COURT OF …\n\nRe: ${prompt || "(no prompt)"}\n\n1) Facts...\n2) Grounds...\n3) Reliefs...\n\n(Generated preview — replace with backend output)`
      );
    } catch (e: any) {
      setError(e?.message || "Failed to generate draft");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* LEFT + MIDDLE */}
      <div className="lg:col-span-2 space-y-4">
        {/* Templates */}
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5" /> Smart Templates
            </CardTitle>
            <CardDescription>
              Generate notices, applications, pleadings with court-specific formatting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                "Legal Notice for Recovery",
                "Writ Petition (Art. 226)",
                "Bail Application",
                "Consumer Complaint",
                "Injunction Application",
                "Arbitration Petition",
              ].map((t) => (
                <Button
                  key={t}
                  variant="outline"
                  className="justify-start rounded-xl h-20 text-left"
                  onClick={() => setPrompt(`Template: ${t}\n\nFacts: ...\nRelief: ...`)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* AI Writing */}
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> AI Writing
            </CardTitle>
            <CardDescription>Clarity optimization, citations, and precedent integration.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Prompt</Label>
                <Textarea
                  className="h-48 rounded-xl"
                  placeholder="Explain the dispute and desired relief…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                {error && (
                  <div className="text-xs text-red-600 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> {error}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button className="rounded-xl" onClick={draft} disabled={loading}>
                    {loading ? "Drafting…" : "Draft"}
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => setDraftText("")}>
                    Clear
                  </Button>
                  <Button variant="secondary" className="rounded-xl">
                    Insert Precedent
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Output</Label>
                <Textarea
                  className="h-48 rounded-xl"
                  placeholder="Draft appears here with citations and court formatting…"
                  value={draftText}
                  readOnly
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-between">
            <div className="text-xs text-slate-500">Version control enabled</div>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl">
                <GitBranch className="h-4 w-4 mr-2" />
                New Version
              </Button>
              <Button className="rounded-xl">
                <Download className="h-4 w-4 mr-2" />
                Export DOCX
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* RIGHT */}
      <div className="space-y-4">
        {/* Collaboration (static demo) */}
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" /> Collaboration
            </CardTitle>
            <CardDescription>Share drafts and collect feedback.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { user: "A Sharma", note: "Please tighten relief clause." },
              { user: "R Gupta", note: "Add SC 2023 cite on maintainability." },
            ].map((c) => (
              <div key={c.user} className="p-2 border rounded-xl">
                <div className="text-sm font-medium">{c.user}</div>
                <div className="text-xs text-slate-500">{c.note}</div>
              </div>
            ))}
            <Button variant="outline" className="w-full rounded-xl">Invite Reviewer</Button>
          </CardContent>
        </Card>

        {/* Style & Clarity */}
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Style & Clarity
            </CardTitle>
            <CardDescription>Readability and structure checks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Readability</span>
              <Badge variant="secondary" className="rounded-xl">Good</Badge>
            </div>
            <Progress value={78} className="h-2" />
            <div className="flex items-center justify-between text-sm">
              <span>Clarity</span>
              <Badge variant="secondary" className="rounded-xl">Great</Badge>
            </div>
            <Progress value={85} className="h-2" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DraftingAssistant;
