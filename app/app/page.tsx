"use client";

import ClientMapWrapper from "@/components/map/ClientMapWrapper";
import SidebarContainer from "@/components/sidebar/SidebarContainer";
import AppNav from "@/components/app/AppNav";
import { useAppStore } from "@/lib/store";

export default function AppPage() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <div className="app-viewport flex-col">
      <AppNav />
      <div className="field-app-shell">
        {sidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fermer le panneau de préparation"
            style={{ background: "rgba(5,8,6,0.64)", backdropFilter: "blur(8px)" }}
          />
        )}

        <aside
          className={`
            field-sidebar fixed inset-0 z-40 w-full
            transform transition-transform duration-300
            md:relative md:w-[410px] md:flex-shrink-0 md:transform-none md:transition-none
            md:border-r md:border-[var(--border)]
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          `}
          aria-label="Console de préparation terrain"
        >
          <button
            type="button"
            className="absolute top-3 right-3 z-50 p-2 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fermer le panneau"
            style={{ color: "var(--text-muted)", background: "none", border: "none" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <SidebarContainer />
        </aside>

        <main className="flex-1 relative" aria-label="Carte interactive du parcours généré">
          <ClientMapWrapper />
        </main>

        {!sidebarOpen && (
          <button type="button" className="field-mobile-fab md:hidden" onClick={() => setSidebarOpen(true)}>
            Préparer
          </button>
        )}
      </div>
    </div>
  );
}
