"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Settings, Smartphone, Monitor, User } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Spinner from "@/components/Spinner";
import api from "@/lib/api";

interface CurrentUser {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
}

interface Device {
  id: string;
  label: string | null;
  user_email: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

export default function SettingsPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  const [serverUrl, setServerUrl] = useState("http://localhost:8000");
  const [savedUrl, setSavedUrl] = useState("http://localhost:8000");
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  function loadDevices() {
    setDevicesLoading(true);
    api.get("/settings/mobile/devices")
      .then((res) => setDevices(res.data))
      .catch(() => {})
      .finally(() => setDevicesLoading(false));
  }

  useEffect(() => {
    api.get("/auth/me").then((res) => setCurrentUser(res.data)).catch(() => {});
    // Load the tenant-wide default server URL saved by an admin.
    api.get("/settings/mobile/server-url")
      .then((res) => {
        const url = res.data.server_url || "http://localhost:8000";
        setServerUrl(url);
        setSavedUrl(url);
      })
      .catch(() => {});
    loadDevices();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff === 0) {
        setPairingToken(null);
        setExpiresAt(null);
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  async function handleSaveDefaultUrl() {
    setSaving(true);
    try {
      await api.put("/settings/mobile/server-url", { server_url: serverUrl.trim() });
      setSavedUrl(serverUrl.trim());
    } catch {
      alert("Failed to save default URL.");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateToken() {
    setGenerating(true);
    try {
      const res = await api.post("/settings/mobile/pairing-token");
      setPairingToken(res.data.pairing_token);
      setExpiresAt(new Date(res.data.expires_at));
      setSecondsLeft(600);
    } catch {
      alert("Failed to generate pairing token.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    if (!confirm("Revoke this device? It will no longer be able to sync.")) return;
    setRevoking(deviceId);
    try {
      await api.delete(`/settings/mobile/devices/${deviceId}`);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch {
      alert("Failed to revoke device.");
    } finally {
      setRevoking(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  const qrValue = pairingToken
    ? JSON.stringify({
        server_url: serverUrl.replace(/\/$/, ""),
        pairing_token: pairingToken,
      })
    : "";

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

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

        {/* Mobile Pairing */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2.5 mb-1">
            <Smartphone size={17} className="text-brand-600 flex-shrink-0" />
            <h2 className="text-base font-semibold text-gray-900">Mobile Pairing</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4 pl-7">
            Generate a QR code so a mobile device can pair with this server.
          </p>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Server URL (as reachable from the phone)
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.x:8000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-400">
                Use your machine&apos;s local IP (e.g. 192.168.x.x) so the phone can reach the server over Wi-Fi.
              </p>
              {currentUser?.role === "admin" && (
                <button
                  onClick={handleSaveDefaultUrl}
                  disabled={saving || serverUrl.trim() === savedUrl}
                  className="ml-3 px-3 py-1 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {saving ? "Saving…" : serverUrl.trim() === savedUrl ? "Saved" : "Save as default"}
                </button>
              )}
            </div>
          </div>

          {pairingToken ? (
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-white border border-gray-200 rounded-xl">
                <QRCodeSVG value={qrValue} size={200} />
              </div>
              <p className="text-xs text-gray-400 font-mono">{serverUrl}</p>
              <p className="text-sm text-gray-600">
                Expires in{" "}
                <span className={`font-semibold ${secondsLeft < 60 ? "text-red-600" : "text-gray-900"}`}>
                  {minutes}:{String(seconds).padStart(2, "0")}
                </span>
              </p>
              <button
                onClick={() => { setPairingToken(null); setExpiresAt(null); }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={handleGenerateToken}
              disabled={generating}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {generating ? "Generating…" : "Generate QR Code"}
            </button>
          )}
        </section>

        {/* Connected Devices */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <Monitor size={17} className="text-brand-600 flex-shrink-0" />
                <h2 className="text-base font-semibold text-gray-900">Connected Devices</h2>
              </div>
              <p className="text-sm text-gray-500 pl-7">
                Devices paired with your account. Revoke a device to prevent it from syncing.
              </p>
            </div>
            <button
              onClick={loadDevices}
              disabled={devicesLoading}
              className="ml-4 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {devicesLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {devicesLoading && devices.length === 0 ? (
            <Spinner size={20} />
          ) : devices.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No devices connected yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {devices.map((device) => (
                <div key={device.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {device.label ?? "Unnamed device"}
                    </p>
                    {device.user_email && (
                      <p className="text-xs text-gray-500 truncate">{device.user_email}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      Paired {formatDate(device.created_at)}
                      {device.last_used_at && (
                        <> &middot; Last sync {formatDate(device.last_used_at)}</>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevokeDevice(device.id)}
                    disabled={revoking === device.id}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                  >
                    {revoking === device.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Account */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
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
            </div>
          ) : (
            <Spinner size={20} />
          )}
        </section>
      </main>
    </div>
  );
}
