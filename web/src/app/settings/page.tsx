"use client";

import { useEffect, useState } from "react";
import { Settings, User, BookOpen, FileText, LifeBuoy, Heart, ExternalLink } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Spinner from "@/components/Spinner";
import api from "@/lib/api";

interface CurrentUser {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
}

const DOCS_BASE = "https://questbee.github.io/page/docs";
const HOME_URL  = "https://questbee.github.io/page";

export default function SettingsPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    api.get("/auth/me").then((res) => setCurrentUser(res.data)).catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <NavSidebar />

      <main className="flex-1 px-8 py-8 max-w-2xl">
        <div className="flex items-center gap-3 mb-8">
          <span className="p-2 bg-brand-100 rounded-xl">
            <Settings size={20} className="text-brand-700" />
          </span>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        </div>

        {/* Account */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2.5 mb-4">
            <User size={17} className="text-brand-600 flex-shrink-0" />
            <h2 className="text-base font-semibold text-gray-900">Account</h2>
          </div>
          {currentUser ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Email</p>
                <p className="text-sm text-gray-800">{currentUser.email}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Role</p>
                <p className="text-sm text-gray-800 capitalize">{currentUser.role.replace("_", " ")}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Tenant ID</p>
                <p className="text-sm text-gray-800 font-mono">{currentUser.tenant_id}</p>
              </div>
            </div>
          ) : (
            <Spinner size={20} />
          )}
        </section>

        {/* Documentation & Troubleshooting */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2.5 mb-1">
            <BookOpen size={17} className="text-brand-600 flex-shrink-0" />
            <h2 className="text-base font-semibold text-gray-900">Documentation</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4 pl-7">
            Guides, CLI reference, API docs, and troubleshooting for every part of Questbee.
          </p>
          <div className="grid grid-cols-2 gap-2 pl-7">
            {[
              { label: "Getting Started",   href: `${DOCS_BASE}/getting-started.html` },
              { label: "CLI Reference",     href: `${DOCS_BASE}/cli-reference.html` },
              { label: "Mobile App Guide",  href: `${DOCS_BASE}/mobile-app.html` },
              { label: "Deployment Guide",  href: `${DOCS_BASE}/deployment.html` },
              { label: "API Reference",     href: `${DOCS_BASE}/api-reference.html` },
              { label: "Architecture",      href: `${DOCS_BASE}/architecture.html` },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-brand-50 hover:border-brand-200 text-sm text-gray-700 hover:text-brand-700 transition-colors group"
              >
                <FileText size={13} className="flex-shrink-0 text-gray-400 group-hover:text-brand-500" />
                <span className="flex-1">{label}</span>
                <ExternalLink size={11} className="flex-shrink-0 text-gray-300 group-hover:text-brand-400" />
              </a>
            ))}
          </div>
          <div className="mt-3 pl-7">
            <a
              href={`${DOCS_BASE}/index.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium"
            >
              <LifeBuoy size={14} />
              Browse all docs &amp; troubleshooting →
            </a>
          </div>
        </section>

        {/* About & Support */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center gap-2.5 mb-1">
            <Heart size={17} className="text-brand-600 flex-shrink-0" />
            <h2 className="text-base font-semibold text-gray-900">About Questbee</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4 pl-7">
            Questbee is a self-hosted, offline-first field data collection platform — free and open source (MIT).
            Built and maintained as a side project.
          </p>
          <div className="pl-7 space-y-3">
            <a
              href={HOME_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-brand-300 hover:bg-brand-50 transition-colors group"
            >
              <div className="p-1.5 bg-brand-100 rounded-lg group-hover:bg-brand-200 transition-colors">
                <ExternalLink size={14} className="text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 group-hover:text-brand-800">Questbee Webpage</p>
                <p className="text-xs text-gray-400">Features, pricing, partner program</p>
              </div>
            </a>
            <a
              href="https://github.com/Questbee/community"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-colors group"
            >
              <div className="p-1.5 bg-gray-100 rounded-lg group-hover:bg-gray-200 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-gray-700">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">GitHub — Questbee/community</p>
                <p className="text-xs text-gray-400">Source code, issues, releases</p>
              </div>
            </a>
            <a
              href={`${HOME_URL}#support`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-300 transition-colors group"
            >
              <div className="p-1.5 bg-amber-100 rounded-lg group-hover:bg-amber-200 transition-colors">
                <Heart size={14} className="text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900">Support the project</p>
                <p className="text-xs text-amber-700">
                  Questbee is free and maintained as a side project. Sponsoring keeps it alive.
                </p>
              </div>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
