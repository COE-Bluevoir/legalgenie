import React, { useState } from "react";
import { useAuth } from "@/lib/auth";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, LockKeyhole } from "lucide-react";

/** Logo assets */
const BV_WHITE = "/logos/bluevoir-white.png";
const BV_COLORED = "/logos/bluevoir-colored.png";
const LG_ICON = "/logos/legal-genie.png";

const PRODUCT_NAME = "Legal Genie";

const LoginPage: React.FC = () => {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | undefined>(undefined);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const result = await login({ email, password });
    setStatus(result.ok ? undefined : result.status);
    if (!result.ok) {
      setFormError(result.error || "Login failed");
      return;
    }
    setPassword("");
  };

  const headline = status === 401 || formError ? "Invalid credentials" : "Welcome back";

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[1.1fr_520px] bg-slate-950">
      {/* LEFT — Hero */}
      <div className="relative hidden md:flex flex-col items-center justify-center text-white overflow-hidden p-12">
        {/* Parent brand */}
        <img src={BV_WHITE} alt="Bluevoir" className="absolute top-8 left-8 h-8 w-auto" />

        {/* Background blobs */}
        <motion.div
          className="absolute -top-28 -left-24 h-[26rem] w-[26rem] rounded-full bg-emerald-400/12 blur-3xl"
          animate={{ scale: [1, 1.05, 1], opacity: [0.25, 0.35, 0.25] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-36 -right-32 h-[30rem] w-[30rem] rounded-full bg-indigo-500/16 blur-3xl"
          animate={{ scale: [1.05, 1, 1.05], opacity: [0.28, 0.22, 0.28] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Spotlight behind logo */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_70%)]" />

        {/* Product lock-up */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 flex flex-col items-center text-center space-y-3"
        >
          {/* Framed logo */}
          <div className="p-3 bg-white/90 rounded-2xl shadow-md ring-1 ring-slate-200/70">
            <img
              src={LG_ICON}
              alt={`${PRODUCT_NAME} logo`}
              className="h-20 w-20 object-contain drop-shadow-[0_0_20px_rgba(99,102,241,0.35)]"
            />
          </div>

          {/* Wordmark */}
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
            <span className="text-white">Legal</span>
            <span className="text-emerald-300"> Genie</span>
          </h1>

          {/* Tagline */}
          <p className="text-indigo-100/90 text-lg max-w-md">
            AI-powered legal research & drafting — faster answers, better first drafts.
          </p>

          {/* Feature bullets */}
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-indigo-100/85 max-w-lg">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Case-law retrieval
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Draft petitions & replies
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Cite-checking
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Knowledge-graph insights
            </li>
          </ul>
        </motion.div>
      </div>

      {/* RIGHT — Login */}
      <div className="flex items-center justify-center bg-slate-50 p-6 md:p-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-md"
        >
          {/* Mobile brand row */}
          <div className="md:hidden flex items-center justify-center gap-3 mb-6">
            <img src={BV_COLORED} alt="Bluevoir" className="h-5 object-contain" />
            <span className="text-slate-400">•</span>
            <div className="flex items-center gap-2">
              <img src={LG_ICON} alt="Legal Genie" className="h-6 w-6 object-contain" />
              <span className="font-semibold">Legal Genie</span>
            </div>
          </div>

          <Card className="rounded-3xl shadow-xl border border-slate-200 bg-white hover:shadow-2xl hover:-translate-y-1 transition">
            <CardHeader className="space-y-3 text-center">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-indigo-500/15 text-indigo-600 flex items-center justify-center">
                <LockKeyhole className="h-7 w-7" />
              </div>
              <CardTitle className="text-2xl font-semibold text-slate-900">{headline}</CardTitle>
              <CardDescription className="text-sm text-slate-500">
                Sign in with your {PRODUCT_NAME} admin or analyst account to continue.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form className="space-y-5" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500"
                  />
                </div>

                {formError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-2xl px-3 py-2"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    <span>{formError}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full rounded-2xl gap-2 active:scale-95 transition bg-gradient-to-r from-indigo-600 to-indigo-800 hover:opacity-90"
                  disabled={loading}
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? "Signing in..." : "Sign in"}
                </Button>

                <div className="pt-2 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <span>Powered by</span>
                  <img src={BV_COLORED} alt="Bluevoir" className="h-4 object-contain" />
                </div>
              </form>
            </CardContent>
          </Card>

          <footer className="mt-6 text-center text-xs text-slate-400">
            © {new Date().getFullYear()} Bluevoir · All rights reserved
          </footer>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
