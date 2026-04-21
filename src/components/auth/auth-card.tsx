"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type AuthMode = "login" | "signup";

interface AuthCardProps {
  mode: AuthMode;
}

export function AuthCard({ mode }: AuthCardProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isSignup = mode === "signup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...(isSignup ? { name } : {}),
          email,
          password
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Unable to continue right now." }));
        throw new Error(data.error || "Unable to continue right now.");
      }

      router.push("/learn");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to continue right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card hero-card">
        <div className="auth-copy">
          <p className="auth-kicker">{isSignup ? "Start your workspace" : "Welcome back"}</p>
          <h1>{isSignup ? "Create your YouTube study workspace." : "Sign in to your study workspace."}</h1>
          <p className="muted">
            Your processed videos stay in the cloud database, and AI generation runs through Ollama Cloud.
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isSignup ? (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
            />
          </div>

          {error ? <p className="error-text auth-error">{error}</p> : null}

          <button className="button button-primary auth-submit" disabled={loading} type="submit">
            {loading ? "Working..." : isSignup ? "Create account" : "Sign in"}
          </button>

          <p className="muted auth-footer">
            {isSignup ? "Already have an account?" : "Need an account?"}{" "}
            <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create one"}</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
