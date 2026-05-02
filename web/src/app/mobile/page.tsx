"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Smartphone,
  Download,
  Monitor,
  Wifi,
  CheckCircle2,
  ArrowRight,
  Terminal,
  Pencil,
  X,
} from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Modal from "@/components/Modal";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import api from "@/lib/api";

interface Device {
  id: string;
  label: string | null;
  user_email: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

// Auto-build the correct API URL from whatever the user pastes.
// Handles: bare IP, http://IP (no port), IP:3000 (hostname cmd output),
// or a full custom URL that already has the right port/scheme.
function buildApiUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  // Bare IP address (no scheme, no port) → http://IP:8000
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return `http://${s}:8000`;
  // http://something with no port at all → add :8000
  if (/^http:\/\/[^/:]+\/?$/.test(s)) return s.replace(/\/?$/, "") + ":8000";
  // Any http(s):// URL with port 3000 → swap to 8000
  if (/^https?:\/\/.+:3000\/?$/.test(s)) return s.replace(/:3000\/?$/, ":8000");
  // Already has correct port or https:// → keep as-is (strip trailing slash)
  return s.replace(/\/$/, "");
}

export default function MobilePage() {
  const { toast } = useToast();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  // Raw input from the user (may be IP or full URL)
  const [urlInput, setUrlInput] = useState("");
  // The saved/committed API URL
  const [savedUrl, setSavedUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Device | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const builtUrl = buildApiUrl(urlInput);
  const isAdmin = userRole === "admin";
  const urlChanged = builtUrl !== savedUrl;

  function loadDevices() {
    setDevicesLoading(true);
    api
      .get("/settings/mobile/devices")
      .then((res) => setDevices(res.data))
      .catch(() => {})
      .finally(() => setDevicesLoading(false));
  }

  useEffect(() => {
    api.get("/auth/me").then((res) => setUserRole(res.data.role)).catch(() => {});
    api.get("/settings/mobile/server-url")
      .then((res) => {
        const url = res.data.server_url || "";
        setUrlInput(url);
        setSavedUrl(url);
      })
      .catch(() => {});
    loadDevices();
  }, []);

  // Countdown timer for QR code
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

  async function handleSaveUrl() {
    if (!builtUrl) return;
    setSaving(true);
    try {
      await api.put("/settings/mobile/server-url", { server_url: builtUrl });
      setSavedUrl(builtUrl);
      setUrlInput(builtUrl);
      toast("Server address saved.");
    } catch {
      toast("Failed to save server address.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateToken() {
    if (!builtUrl) {
      toast("Enter a server address first.", "error");
      return;
    }
    setGenerating(true);
    try {
      const label = deviceName.trim() || null;
      const res = await api.post("/settings/mobile/pairing-token", { label });
      setPairingToken(res.data.pairing_token);
      setExpiresAt(new Date(res.data.expires_at));
      setSecondsLeft(600);
    } catch {
      toast("Failed to generate pairing token.", "error");
    } finally {
      setGenerating(false);
    }
  }

  function handlePairAnother() {
    setPairingToken(null);
    setExpiresAt(null);
    setDeviceName("");
  }

  function startRename(device: Device) {
    setRenamingId(device.id);
    setRenameValue(device.label ?? "");
  }

  async function handleRename(deviceId: string) {
    try {
      await api.patch(`/settings/mobile/devices/${deviceId}`, { label: renameValue });
      setDevices((prev) =>
        prev.map((d) => d.id === deviceId ? { ...d, label: renameValue.trim() || null } : d)
      );
      setRenamingId(null);
    } catch {
      toast("Failed to rename device.", "error");
    }
  }

  async function handleRevokeDevice() {
    if (!revokeTarget) return;
    setRevoking(revokeTarget.id);
    setRevokeError(null);
    try {
      await api.delete(`/settings/mobile/devices/${revokeTarget.id}`);
      setDevices((prev) => prev.filter((d) => d.id !== revokeTarget.id));
      toast("Device revoked.");
      setRevokeTarget(null);
    } catch {
      setRevokeError("Failed to revoke device.");
    } finally {
      setRevoking(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  const qrValue = pairingToken
    ? JSON.stringify({ server_url: builtUrl.replace(/\/$/, ""), pairing_token: pairingToken })
    : "";

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <NavSidebar />

      <main className="flex-1 px-8 py-8 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <span className="p-2 bg-brand-100 rounded-xl">
            <Smartphone size={20} className="text-brand-700" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Mobile App</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Download the app, connect it to this server, and manage devices.
            </p>
          </div>
        </div>

        {/* ── 1. Get the App ── */}
        <section className="bg-brand-600 rounded-xl p-6 mb-6 text-white">
          <div className="flex items-start gap-4">
            <div className="p-2.5 bg-brand-500 rounded-xl flex-shrink-0">
              <Smartphone size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold mb-1">Questbee for Android</h2>
              <p className="text-sm text-brand-100 mb-4">
                Collect form data in the field — online or fully offline.
                Submissions sync automatically when connectivity returns.
              </p>
              <a
                href="https://github.com/Questbee/app/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-900 text-sm font-semibold rounded-lg hover:bg-brand-50 transition-colors"
              >
                <Download size={15} />
                Download APK
              </a>
              <p className="text-xs text-brand-200 mt-2">
                Android 8.0+ · Enable &ldquo;Install from unknown sources&rdquo; in
                your phone&apos;s settings before installing
              </p>
            </div>
          </div>
        </section>

        {/* ── 2. Server Address ── */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2.5 mb-1">
            <Wifi size={17} className="text-brand-600 flex-shrink-0" />
            <h2 className="text-base font-semibold text-gray-900">Server Address</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5 pl-7">
            The address the phone uses to reach this server.
            Your phone must be on the <strong>same Wi-Fi</strong> as this computer.
          </p>

          {/* Step 1 — find the IP */}
          <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 mb-4">
            <Terminal size={15} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-800 mb-0.5">
                Step 1 — find this computer&apos;s IP address
              </p>
              <p>
                In your terminal, run:{" "}
                <code className="bg-gray-200 text-gray-800 px-1.5 py-0.5 rounded text-xs font-mono">
                  ./questbee hostname
                </code>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                You&apos;ll see something like{" "}
                <code className="text-gray-500 font-mono">http://192.168.1.42:3000</code> —
                copy the numbers after <code className="text-gray-500 font-mono">http://</code>{" "}
                and before <code className="text-gray-500 font-mono">:3000</code>.
              </p>
            </div>
          </div>

          {/* Step 2 — enter it */}
          <div className="mb-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Step 2 — enter the IP address
            </label>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="192.168.1.42"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Just the numbers — for example{" "}
              <code className="font-mono">192.168.1.42</code>. You can also paste
              the full URL from the terminal if you prefer.
            </p>
          </div>

          {/* Live preview */}
          {builtUrl && (
            <div className="flex items-center gap-2 mt-3 mb-4">
              <ArrowRight size={13} className="text-brand-400 flex-shrink-0" />
              <span className="text-xs text-gray-500">Phone will connect to:</span>
              <code className="text-sm font-mono font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded">
                {builtUrl}
              </code>
            </div>
          )}

          {/* Save */}
          {isAdmin && (
            <button
              onClick={handleSaveUrl}
              disabled={saving || !urlChanged || !builtUrl}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors flex items-center gap-1.5"
            >
              {saving ? (
                "Saving…"
              ) : !urlChanged && savedUrl ? (
                <>
                  <CheckCircle2 size={13} className="text-green-500" />
                  Saved
                </>
              ) : (
                "Save as default"
              )}
            </button>
          )}
        </section>

        {/* ── 3. Pair a Device ── */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2.5 mb-1">
            <Smartphone size={17} className="text-brand-600 flex-shrink-0" />
            <h2 className="text-base font-semibold text-gray-900">Pair a Device</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5 pl-7">
            Generate a QR code and scan it in the app to connect a phone to this
            server. The code expires in 10 minutes.
          </p>

          {pairingToken ? (
            <div className="flex flex-col items-center gap-4">
              {/* Device name badge */}
              {deviceName.trim() && (
                <div className="w-full flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                  <Smartphone size={13} className="text-brand-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-brand-800">
                    {deviceName.trim()}
                  </span>
                </div>
              )}
              {/* Server URL */}
              <div className="w-full flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs">
                <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                <span className="text-gray-500">Connecting to:</span>
                <code className="font-mono text-gray-800 ml-1 truncate">{builtUrl}</code>
              </div>
              {/* QR code */}
              <div className="p-5 bg-white border border-gray-200 rounded-xl shadow-sm">
                <QRCodeSVG value={qrValue} size={200} />
              </div>
              {/* Timer */}
              <p className="text-sm text-gray-600">
                Expires in{" "}
                <span className={`font-semibold tabular-nums ${secondsLeft < 60 ? "text-red-600" : "text-gray-900"}`}>
                  {minutes}:{String(seconds).padStart(2, "0")}
                </span>
              </p>
              <ol className="text-sm text-gray-600 space-y-1 text-left w-full max-w-xs list-none">
                <li>1. Open the Questbee app on your phone</li>
                <li>2. Tap <strong>Scan QR Code</strong></li>
                <li>3. Point the camera at the code above</li>
              </ol>
              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handlePairAnother}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Pair another device →
                </button>
                <button
                  onClick={() => { setPairingToken(null); setExpiresAt(null); setDeviceName(""); }}
                  className="text-sm text-gray-400 hover:text-gray-600"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Device name input */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Device name <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && builtUrl) handleGenerateToken(); }}
                  placeholder="e.g. Mario's phone, Field unit 3, Team B tablet"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Name appears in Connected Devices so you can identify which phone is which.
                </p>
              </div>
              <button
                onClick={handleGenerateToken}
                disabled={generating || !builtUrl}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                title={!builtUrl ? "Enter a server address above first" : undefined}
              >
                {generating ? "Generating…" : "Generate QR Code"}
              </button>
            </div>
          )}
        </section>

        {/* ── 4. Connected Devices ── */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <Monitor size={17} className="text-brand-600 flex-shrink-0" />
                <h2 className="text-base font-semibold text-gray-900">Connected Devices</h2>
              </div>
              <p className="text-sm text-gray-500 pl-7">
                Phones paired with this server. Revoke a device to block sync.
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
                  <div className="min-w-0 flex-1">
                    {renamingId === device.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(device.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          placeholder="Device name"
                          className="flex-1 px-2 py-1 text-sm border border-brand-400 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-0"
                        />
                        <button
                          onClick={() => handleRename(device.id)}
                          className="px-2.5 py-1 text-xs font-medium bg-brand-600 text-white rounded-md hover:bg-brand-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setRenamingId(null)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startRename(device)}
                        className="group flex items-center gap-1.5 text-left"
                      >
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {device.label ?? (
                            <span className="text-gray-400 italic">Unnamed — click to add a name</span>
                          )}
                        </p>
                        <Pencil
                          size={12}
                          className="flex-shrink-0 text-gray-300 group-hover:text-brand-500 transition-colors"
                        />
                      </button>
                    )}
                    {device.user_email && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">{device.user_email}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      Paired {formatDate(device.created_at)}
                      {device.last_used_at && (
                        <> &middot; Last sync {formatDate(device.last_used_at)}</>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => { setRevokeTarget(device); setRevokeError(null); }}
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
      </main>

      {/* Revoke confirmation modal */}
      <Modal
        open={!!revokeTarget}
        onClose={() => { setRevokeTarget(null); setRevokeError(null); }}
        title="Revoke device?"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Revoke <strong>{revokeTarget?.label ?? "this device"}</strong>? It will
            no longer be able to sync with this server.
          </p>
          {revokeError && <p className="text-sm text-red-600">{revokeError}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => { setRevokeTarget(null); setRevokeError(null); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!!revoking}
              onClick={handleRevokeDevice}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {revoking ? "Revoking…" : "Revoke"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
