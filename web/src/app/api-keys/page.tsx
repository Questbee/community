"use client";

import { useEffect, useState } from "react";
import { Key, Plus } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Spinner from "@/components/Spinner";
import api from "@/lib/api";

interface ApiKey {
  id: string;
  scopes: string[];
  revoked: boolean;
  created_at: string;
  expires_at: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    try {
      const res = await api.get("/api-keys/");
      setKeys(res.data);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setError("API Keys management is only available to admins.");
      } else {
        setError("Failed to load API keys.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadKeys(); }, []);

  async function handleCreate() {
    setCreating(true);
    setNewKey(null);
    try {
      const res = await api.post("/api-keys/", { scopes: [] });
      setNewKey(res.data.key);
      await loadKeys();
    } catch {
      setError("Failed to create API key.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    setRevoking(id);
    try {
      await api.delete(`/api-keys/${id}`);
      await loadKeys();
    } catch {
      setError("Failed to revoke key.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <NavSidebar />
      <main className="flex-1 p-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-start gap-3">
            <span className="p-2 bg-brand-100 rounded-xl flex-shrink-0 mt-0.5">
              <Key size={20} className="text-brand-700" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
              <p className="text-sm text-gray-500 mt-1">
                Submit form data from IoT devices or external systems via{" "}
                <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">POST /api/v1/headless/submit</code>.
              </p>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !!error}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors flex-shrink-0"
          >
            <Plus size={15} strokeWidth={2.5} />
            {creating ? "Creating…" : "New API Key"}
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
            {error}
          </div>
        )}

        {/* Newly created key — show once */}
        {newKey && (
          <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4">
            <p className="text-sm font-semibold text-amber-800 mb-2">
              Save this key — it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-white border border-amber-200 rounded px-3 py-2 break-all text-gray-800">
                {newKey}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(newKey); }}
                className="px-3 py-2 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 rounded font-medium transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-amber-700 mt-2">
              Include it in requests as: <code className="font-mono">X-API-Key: {newKey.slice(0, 8)}…</code>
            </p>
          </div>
        )}

        {/* Key list */}
        {loading ? (
          <div className="flex justify-center mt-12"><Spinner /></div>
        ) : keys.length === 0 ? (
          <div className="text-center text-gray-400 mt-12">
            <Key size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-base font-medium text-gray-500">No API keys yet</p>
            <p className="text-sm mt-1">Create one to start submitting data programmatically.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((k) => (
              <div
                key={k.id}
                className={`bg-white border rounded-xl px-5 py-4 flex items-center justify-between ${k.revoked ? "opacity-50 border-gray-200" : "border-gray-200"}`}
              >
                <div>
                  <p className="text-sm font-mono text-gray-700">{k.id.slice(0, 8)}…</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Created {new Date(k.created_at).toLocaleDateString()}
                    {k.expires_at && ` · Expires ${new Date(k.expires_at).toLocaleDateString()}`}
                  </p>
                  {k.scopes.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {k.revoked ? (
                    <span className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded-full font-medium">Revoked</span>
                  ) : (
                    <>
                      <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">Active</span>
                      <button
                        onClick={() => handleRevoke(k.id)}
                        disabled={revoking === k.id}
                        className="text-sm text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                      >
                        {revoking === k.id ? "Revoking…" : "Revoke"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Usage example */}
        <div className="mt-8 bg-gray-900 rounded-xl p-5 text-xs font-mono text-gray-300">
          <p className="text-gray-500 mb-2"># Submit a form response via API key</p>
          <p>curl -X POST {"{API_URL}"}/api/v1/headless/submit \</p>
          <p className="ml-4">-H &quot;X-API-Key: YOUR_KEY&quot; \</p>
          <p className="ml-4">-H &quot;Content-Type: application/json&quot; \</p>
          <p className="ml-4">-d {"'"}{"{"}&quot;form_id&quot;: &quot;...&quot;, &quot;data_json&quot;: {"{"}&quot;field_id&quot;: &quot;value&quot;{"}"}{"}"}{"'"}</p>
        </div>
      </main>
    </div>
  );
}
