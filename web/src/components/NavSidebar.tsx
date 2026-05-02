"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Inbox, Users, Key, Settings, LogOut, Smartphone } from "lucide-react";
import api, { clearAuthCookies } from "@/lib/api";

const NAV_LINKS = [
  { href: "/dashboard",   label: "Dashboard",   icon: LayoutDashboard },
  { href: "/forms",       label: "Forms",        icon: FileText },
  { href: "/mobile",      label: "Mobile App",   icon: Smartphone },
  { href: "/submissions", label: "Submissions",  icon: Inbox },
  { href: "/users",       label: "Users",        icon: Users },
  { href: "/api-keys",    label: "API Keys",     icon: Key },
  { href: "/settings",    label: "Settings",     icon: Settings },
];

export default function NavSidebar() {
  const pathname = usePathname();

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore errors, still clear cookies and redirect
    }
    clearAuthCookies();
    window.location.href = "/login";
  }

  return (
    <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-200 flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/questbee-icon.svg" alt="Questbee" width={32} height={32} className="rounded-lg flex-shrink-0" />
        <span className="text-lg font-bold text-gray-900">Questbee</span>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-brand-100 text-brand-800 font-semibold"
                  : "font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Icon size={16} strokeWidth={2} className="flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <LogOut size={16} strokeWidth={2} className="flex-shrink-0" />
          Log out
        </button>
      </div>
    </aside>
  );
}
