"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Inbox, Download, ChevronRight } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import api from "@/lib/api";

interface FieldOption {
  value: string;
  label: string;
}

interface SchemaField {
  id: string;
  label?: string;
  type?: string;
  options?: FieldOption[];
}

interface Submission {
  id: string;
  form_version_id: string;
  local_uuid: string | null;
  data_json: Record<string, unknown>;
  collected_at: string | null;
  submitted_at: string;
  submitted_by_email?: string | null;
  form_name?: string;
  schema_fields?: SchemaField[];
}

/** Fields that carry no user data and should be skipped in the detail panel. */
const DISPLAY_SKIP_TYPES = new Set(["note", "divider"]);

/** Field types whose values are media files — rendered via the media API. */
const MEDIA_FIELD_TYPES = new Set(["photo", "audio", "signature", "file"]);

interface MediaFileMeta {
  id: string;
  field_name: string;
  mime_type: string;
  size_bytes: number;
}

function MediaPreview({ media }: { media: MediaFileMeta }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/media/${media.id}`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        const url = URL.createObjectURL(res.data);
        urlRef.current = url;
        setObjectUrl(url);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [media.id]);

  if (loading) return <span className="text-xs text-gray-400">Loading…</span>;
  if (error || !objectUrl) return <span className="text-xs text-red-400">Failed to load</span>;

  if (media.mime_type.startsWith("image/")) {
    return (
      <a href={objectUrl} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={objectUrl} alt={media.field_name} className="max-w-full max-h-48 rounded border border-gray-200 mt-1" />
      </a>
    );
  }

  if (media.mime_type.startsWith("audio/")) {
    return <audio controls src={objectUrl} className="w-full mt-1" />;
  }

  const sizeKb = Math.round(media.size_bytes / 1024);
  return (
    <a
      href={objectUrl}
      download
      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-1"
    >
      Download ({sizeKb} KB)
    </a>
  );
}

function formatFieldValue(field: SchemaField, rawValue: unknown): string {
  if (rawValue === undefined || rawValue === null || rawValue === "") return "—";

  if (field.type === "select_one") {
    const match = field.options?.find((o) => o.value === rawValue);
    return match ? match.label : String(rawValue);
  }

  if (field.type === "select_multiple") {
    const selected = Array.isArray(rawValue) ? rawValue : [rawValue];
    return selected
      .map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v))
      .join(", ") || "—";
  }

  if (field.type === "geopoint" && typeof rawValue === "object" && rawValue !== null) {
    const g = rawValue as Record<string, number>;
    if (g.latitude != null && g.longitude != null)
      return `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}${g.accuracy != null ? ` (±${Math.round(g.accuracy)}m)` : ""}`;
    return "—";
  }

  if (field.type === "geotrace" && Array.isArray(rawValue)) {
    return `${rawValue.length} point${rawValue.length !== 1 ? "s" : ""}`;
  }

  if (field.type === "route" && typeof rawValue === "object" && rawValue !== null) {
    const r = rawValue as Record<string, number>;
    const dist = r.distance_meters != null ? `${(r.distance_meters / 1000).toFixed(2)} km` : null;
    const dur = r.duration_seconds != null ? `${Math.round(r.duration_seconds)}s` : null;
    return [dist, dur].filter(Boolean).join(", ") || "Recorded";
  }

  if (field.type === "repeat" && Array.isArray(rawValue)) {
    return `${rawValue.length} entr${rawValue.length !== 1 ? "ies" : "y"}`;
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") || "—";
  }

  if (typeof rawValue === "object") {
    return JSON.stringify(rawValue);
  }

  return String(rawValue);
}

function SubmissionsContent() {
  const searchParams = useSearchParams();
  const formId = searchParams.get("form_id");
  const { toast } = useToast();

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Export modal state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"package" | "csv" | "geojson" | "gpx" | "media">("package");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportFormId, setExportFormId] = useState(formId ?? "");
  const [allForms, setAllForms] = useState<{ id: string; name: string }[]>([]);

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = formId ? `/submissions?form_id=${formId}` : "/submissions";
      const res = await api.get(url);
      setSubmissions(res.data);
    } catch {
      setError("Failed to load submissions.");
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  async function handleRowClick(submissionId: string) {
    setSelectedId(submissionId);
    setDetailLoading(true);
    try {
      const res = await api.get(`/submissions/${submissionId}`);
      setDetail(res.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function openExportModal() {
    setExportFormId(formId ?? "");
    setExportError(null);
    if (!formId && allForms.length === 0) {
      api.get("/forms").then((res) => setAllForms(res.data)).catch(() => {});
    }
    setExportOpen(true);
  }

  async function handleExport() {
    if (!exportFormId) return;
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams({ form_id: exportFormId });
      if (exportFrom) params.set("from", exportFrom);
      if (exportTo) params.set("to", exportTo);

      const mimeTypes: Record<string, string> = {
        package: "application/zip",
        csv: "text/csv",
        geojson: "application/geo+json",
        gpx: "application/gpx+xml",
        media: "application/zip",
      };
      const extensions: Record<string, string> = {
        package: "zip", csv: "csv", geojson: "geojson", gpx: "gpx", media: "zip",
      };

      const res = await api.get(
        `/submissions/export/${exportFormat}?${params.toString()}`,
        { responseType: "blob" },
      );

      const url = window.URL.createObjectURL(new Blob([res.data], { type: mimeTypes[exportFormat] }));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `export_${exportFormId.slice(0, 8)}.${extensions[exportFormat]}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportOpen(false);
      toast("Export downloaded.");
    } catch {
      setExportError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <NavSidebar />

      <div className="flex-1 flex overflow-hidden">
        {/* Main table */}
        <main className="flex-1 px-8 py-8 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <span className="p-2 bg-brand-100 rounded-xl">
                <Inbox size={20} className="text-brand-700" />
              </span>
              <h1 className="text-2xl font-bold text-gray-900">Submissions</h1>
            </div>
            <button
              onClick={openExportModal}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download size={14} />
              Export
            </button>
          </div>

          {/* Export modal */}
          {exportOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Export Data</h2>

                {!formId && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Form
                    </label>
                    <select
                      value={exportFormId}
                      onChange={(e) => setExportFormId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">— select a form —</option>
                      {allForms.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <fieldset className="mb-4">
                  <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Format</legend>
                  <div className="space-y-2">
                    {[
                      { value: "package", label: "Full package", desc: "CSV + GeoJSON + GPX + media (ZIP)" },
                      { value: "csv",     label: "CSV only",     desc: "Flat CSV, all field types" },
                      { value: "geojson", label: "GeoJSON",      desc: "Location fields — QGIS / GIS tools" },
                      { value: "gpx",     label: "GPX",          desc: "Route tracks with telemetry" },
                      { value: "media",   label: "Media files",  desc: "All photos, audio, and files (ZIP)" },
                    ].map((opt) => (
                      <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="exportFormat"
                          value={opt.value}
                          checked={exportFormat === opt.value}
                          onChange={() => setExportFormat(opt.value as typeof exportFormat)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="text-sm font-medium text-gray-800">{opt.label}</span>
                          <span className="text-xs text-gray-400 ml-2">{opt.desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="mb-5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date range (optional)</p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={exportFrom}
                      onChange={(e) => setExportFrom(e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <input
                      type="date"
                      value={exportTo}
                      onChange={(e) => setExportTo(e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>

                {exportError && (
                  <p className="text-sm text-red-600 mb-3">{exportError}</p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setExportOpen(false)}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={exporting || !exportFormId}
                    className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {exporting ? "Preparing…" : "Download"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : error ? (
            <div className="text-red-600 text-sm">{error}</div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <Inbox size={44} className="mx-auto mb-3 text-gray-300" />
              <p className="text-base font-medium text-gray-500">No submissions yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Form</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Collected At</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted At</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted By</th>
                    <th className="px-4 py-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((sub) => (
                    <tr
                      key={sub.id}
                      onClick={() => handleRowClick(sub.id)}
                      className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedId === sub.id ? "bg-brand-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {sub.form_name ?? <span className="text-gray-400 font-mono text-xs">{sub.id.slice(0, 8)}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {sub.collected_at ? new Date(sub.collected_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(sub.submitted_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{sub.submitted_by_email ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-300">
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* Side panel */}
        {selectedId && (
          <aside className="w-80 bg-white border-l border-gray-200 overflow-y-auto p-6 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Details</h2>
              <button onClick={() => { setSelectedId(null); setDetail(null); }} className="text-gray-400 hover:text-gray-600 text-xl">
                &times;
              </button>
            </div>
            {detailLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : detail ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Form</p>
                  <p className="text-sm text-gray-700">{detail.form_name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Version</p>
                  <p className="text-sm text-gray-700">v{detail.version_num}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Submitted By</p>
                  <p className="text-sm text-gray-700">{detail.submitted_by_email ?? "—"}</p>
                </div>
                <hr className="border-gray-100" />
                {detail.schema_fields
                  ?.filter((field: SchemaField) => !DISPLAY_SKIP_TYPES.has(field.type ?? ""))
                  .map((field: SchemaField) => {
                    const isMedia = MEDIA_FIELD_TYPES.has(field.type ?? "");
                    const mediaFiles: MediaFileMeta[] = isMedia
                      ? (detail.media_files ?? []).filter((m: MediaFileMeta) => m.field_name === field.id)
                      : [];

                    return (
                      <div key={field.id}>
                        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                          {field.label ?? field.id}
                        </p>
                        {isMedia ? (
                          mediaFiles.length > 0 ? (
                            <div className="flex flex-col gap-2">
                              {mediaFiles.map((m) => (
                                <MediaPreview key={m.id} media={m} />
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm mt-0.5 text-gray-400 italic">—</p>
                          )
                        ) : (
                          (() => {
                            const formatted = formatFieldValue(field, detail.data_json?.[field.id]);
                            return (
                              <p className={`text-sm mt-0.5 ${formatted === "—" ? "text-gray-400 italic" : "text-gray-800"}`}>
                                {formatted}
                              </p>
                            );
                          })()
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Could not load details.</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

export default function SubmissionsPage() {
  return (
    <Suspense>
      <SubmissionsContent />
    </Suspense>
  );
}
