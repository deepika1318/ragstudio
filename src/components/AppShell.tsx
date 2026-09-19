import { Link } from "@tanstack/react-router";
import { Boxes, FileStack, FlaskConical, MessagesSquare, Workflow } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Q&A Workspace", icon: MessagesSquare },
  { to: "/documents", label: "Document Index", icon: FileStack },
  { to: "/pipeline", label: "Pipeline", icon: Workflow },
  { to: "/evaluation", label: "Evaluation", icon: FlaskConical },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Boxes className="size-5" />
            </span>
            <span>
              <span className="block text-base font-semibold tracking-tight">RAGStudio</span>
              <span className="block text-xs text-muted-foreground">
                Citation-Aware Hybrid RAG
              </span>
            </span>
          </Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{ className: "bg-primary/15 text-primary" }}
                inactiveProps={{ className: "text-muted-foreground hover:bg-secondary" }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
