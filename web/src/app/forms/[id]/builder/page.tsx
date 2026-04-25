"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, TriangleAlert, Upload, Download, Save, Send, CheckCircle2, PencilLine, Lock, ChevronUp, ChevronDown, X, Copy, Search, ChevronRight } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Spinner from "@/components/Spinner";
import FieldIcon from "@/components/FieldIcon";
import { useToast } from "@/components/Toast";
import api from "@/lib/api";
import { evaluateRelevant } from "@/lib/relevant";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldOption {
  value: string;
  label: string;
}

interface FormField {
  id: string;
  type: string;
  label: string;
  hint?: string;
  required?: boolean;
  relevant?: string;
  read_only?: boolean;
  default?: string;
  options?: FieldOption[];
  body?: string;
  // calculated
  expression?: string;
  // group / repeat
  fields?: FormField[];
  collapsible?: boolean;
  button_label?: string;
  min_count?: number;
  max_count?: number;
  // select_one_other
  other_text_label?: string;
  // photo
  max_photos?: number;
  allow_gallery?: boolean;
  // audio
  max_duration_seconds?: number;
  // file
  allowed_types?: string;
  // geopoint
  auto_capture?: boolean;
  // route
  capture_interval_seconds?: number;
  allow_pause?: boolean;
  // barcode
  allow_manual_entry?: boolean;
  // date / time / datetime display format
  date_format?: string;
}

interface FormSchema {
  version: number;
  title: string;
  description?: string;
  fields: FormField[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_TYPES = [
  // Basic
  { type: "text",             label: "Text",           category: "basic" },
  { type: "textarea",         label: "Long Text",      category: "basic" },
  { type: "number",           label: "Number",         category: "basic" },
  { type: "email",            label: "Email",          category: "basic" },
  { type: "phone",            label: "Phone",          category: "basic" },
  // Date/time
  { type: "date",             label: "Date",           category: "datetime" },
  { type: "time",             label: "Time",           category: "datetime" },
  { type: "datetime",         label: "Date & Time",    category: "datetime" },
  { type: "timestamp",        label: "Timestamp",      category: "datetime" },
  // Choice
  { type: "select_one",       label: "Select One",       category: "choice" },
  { type: "select_multiple",  label: "Select Multiple",  category: "choice" },
  { type: "select_one_other", label: "Select One + Other", category: "choice" },
  // Location
  { type: "geopoint",         label: "GPS Point",        category: "location" },
  { type: "geotrace",         label: "GPS Trace",        category: "location" },
  { type: "route",            label: "Route",            category: "location" },
  // Media
  { type: "photo",            label: "Photo",            category: "media" },
  { type: "audio",            label: "Audio",            category: "media" },
  { type: "signature",        label: "Signature",        category: "media" },
  { type: "file",             label: "File Upload",      category: "media" },
  // Scan
  { type: "barcode",          label: "Barcode / QR",     category: "scan" },
  // Structure
  { type: "group",            label: "Group",          category: "structure" },
  { type: "repeat",           label: "Repeat",         category: "structure" },
  // Logic
  { type: "calculated",       label: "Calculated",     category: "logic" },
  // Display
  { type: "note",             label: "Note",           category: "display" },
  { type: "divider",          label: "Divider",        category: "display" },
];

const FIELD_TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((f) => [f.type, f.label]));

const FIELD_CATEGORIES: { label: string; types: string[] }[] = [
  { label: "Basic",       types: ["text", "textarea", "number", "email", "phone"] },
  { label: "Date & Time", types: ["date", "time", "datetime", "timestamp"] },
  { label: "Choice",      types: ["select_one", "select_multiple", "select_one_other"] },
  { label: "Location",    types: ["geopoint", "geotrace", "route"] },
  { label: "Media",       types: ["photo", "audio", "signature", "file"] },
  { label: "Scan",        types: ["barcode"] },
  { label: "Structure",   types: ["group", "repeat"] },
  { label: "Logic",       types: ["calculated"] },
  { label: "Display",     types: ["note", "divider"] },
];


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultField(type: string): FormField {
  const base: FormField = {
    id: `field_${Date.now()}`,
    type,
    label: "",
    required: false,
  };
  if (type === "select_one" || type === "select_multiple" || type === "select_one_other") {
    base.options = [{ value: "option_1", label: "Option 1" }]; // value auto-updated when user edits label
  }
  if (type === "group" || type === "repeat") {
    base.fields = [];
    if (type === "repeat") base.button_label = "Add another";
  }
  if (type === "photo") {
    base.max_photos = 1;
    base.allow_gallery = true;
  }
  return base;
}

// Build a preview-values map from schema defaults for the relevant preview
function buildPreviewValues(fields: FormField[]): Record<string, any> {
  const vals: Record<string, any> = {};
  for (const f of fields) {
    if (f.default !== undefined) vals[f.id] = f.default;
  }
  return vals;
}

/** Convert a human label into a lowercase snake_case value for select options. */
function slugifyOption(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/, "") || "option";
}

/** Convert a field label into a field ID slug. */
function slugifyLabel(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/, "");
  return /^\d/.test(slug) ? `f_${slug}` : slug || "";
}

/** Derive a unique field ID from a label, avoiding conflicts with existing IDs. */
function deriveUniqueId(label: string, existingIds: string[], excludeId?: string): string {
  const base = slugifyLabel(label);
  if (!base) return excludeId ?? `field_${Date.now()}`;
  const others = existingIds.filter((id) => id !== excludeId);
  if (!others.includes(base)) return base;
  let i = 2;
  while (others.includes(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** Flatten all fields (including nested group/repeat children) into a single list. */
function getAllFields(fields: FormField[]): FormField[] {
  const result: FormField[] = [];
  for (const f of fields) {
    result.push(f);
    if (f.fields && f.fields.length > 0) result.push(...f.fields);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FormBuilderPage() {
  const { id: formId } = useParams<{ id: string }>();
  const router = useRouter();

  const [schema, setSchema] = useState<FormSchema>({ version: 1, title: "", fields: [] });
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // isPublished — the form has a live published version (current_version_id)
  const [isPublished, setIsPublished] = useState(false);
  // hasDraft — a draft_version_id exists alongside the published version
  const [hasDraft, setHasDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [leftTab, setLeftTab] = useState<"fields" | "versions">("fields");
  const [versions, setVersions] = useState<Array<{id: string; version_num: number; published_at: string | null; is_current: boolean; is_draft: boolean; submission_count: number}>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [currentVersionSubmissions, setCurrentVersionSubmissions] = useState(0);
  const [currentVersionNum, setCurrentVersionNum] = useState<number | null>(null);
  const [startingNewDraft, setStartingNewDraft] = useState(false);
  const [formName, setFormName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  // When set, the canvas shows a historical version in read-only mode
  const [previewVersion, setPreviewVersion] = useState<{version_num: number; schema: FormSchema} | null>(null);
  // Group/repeat editing context
  const [activeGroupIdx, setActiveGroupIdx] = useState<number | null>(null);
  const [selectedNestedIdx, setSelectedNestedIdx] = useState<number | null>(null);

  const [paletteSearch, setPaletteSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ Basic: true });

  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const res = await api.get(`/forms/${formId}/versions`);
      setVersions(res.data);
    } catch {
      // ignore
    } finally {
      setVersionsLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    async function loadForm() {
      try {
        const res = await api.get(`/forms/${formId}`);
        setSchema(res.data.schema_json ?? { version: 1, title: res.data.name, fields: [] });
        setIsPublished(res.data.is_published ?? false);
        setHasDraft(res.data.has_draft ?? false);
        setFormName(res.data.name ?? "form");
        // Load submission count for the current version to show warning
        try {
          const versRes = await api.get(`/forms/${formId}/versions`);
          const current = versRes.data.find((v: any) => v.is_current);
          if (current) {
            setCurrentVersionSubmissions(current.submission_count);
            setCurrentVersionNum(current.version_num);
          }
        } catch {
          // non-blocking
        }
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    }
    loadForm();
  }, [formId]);

  // isEditable: builder is actively editing content (initial draft OR active draft alongside published)
  const isEditable = !isPublished || hasDraft;

  useEffect(() => {
    if (loading || !isEditable || previewVersion) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.put(`/forms/${formId}`, { schema_json: schema });
      } catch {
        // silent
      } finally {
        setSaving(false);
      }
    }, 1500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [schema, formId, loading, isEditable, previewVersion]);

  // Auto-scroll the canvas to keep the selected top-level card visible
  useEffect(() => {
    if (selectedIdx === null) return;
    const el = canvasRef.current?.querySelector(`[data-field-idx="${selectedIdx}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedIdx]);

  // Auto-scroll to the selected nested field when in group mode
  useEffect(() => {
    if (activeGroupIdx === null || selectedNestedIdx === null) return;
    const el = canvasRef.current?.querySelector(`[data-nested-idx="${selectedNestedIdx}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedNestedIdx, activeGroupIdx]);

  function addField(type: string) {
    if (!isEditable || previewVersion) return;
    if (activeGroupIdx !== null) {
      // Add into the active group/repeat
      const newNested = makeDefaultField(type);
      const updatedNested = [...(schema.fields[activeGroupIdx].fields ?? []), newNested];
      updateField(activeGroupIdx, { fields: updatedNested });
      setSelectedNestedIdx(updatedNested.length - 1);
      return;
    }
    setSchema((prev) => ({
      ...prev,
      fields: [...prev.fields, makeDefaultField(type)],
    }));
    setSelectedIdx(schema.fields.length);
  }

  function moveField(idx: number, direction: -1 | 1) {
    const newFields = [...schema.fields];
    const target = idx + direction;
    if (target < 0 || target >= newFields.length) return;
    [newFields[idx], newFields[target]] = [newFields[target], newFields[idx]];
    setSchema((prev) => ({ ...prev, fields: newFields }));
    setSelectedIdx(target);
  }

  function deleteField(idx: number) {
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== idx),
    }));
    setSelectedIdx(null);
  }

  function updateField(idx: number, patch: Partial<FormField>) {
    setSchema((prev) => {
      const fields = [...prev.fields];
      fields[idx] = { ...fields[idx], ...patch };
      return { ...prev, fields };
    });
  }

  function updateNestedField(groupIdx: number, nestedIdx: number, patch: Partial<FormField>) {
    setSchema((prev) => {
      const fields = [...prev.fields];
      const group = { ...fields[groupIdx] };
      const nested = [...(group.fields ?? [])];
      nested[nestedIdx] = { ...nested[nestedIdx], ...patch };
      group.fields = nested;
      fields[groupIdx] = group;
      return { ...prev, fields };
    });
  }

  function moveNestedField(groupIdx: number, nestedIdx: number, direction: -1 | 1) {
    const nested = [...(schema.fields[groupIdx].fields ?? [])];
    const target = nestedIdx + direction;
    if (target < 0 || target >= nested.length) return;
    [nested[nestedIdx], nested[target]] = [nested[target], nested[nestedIdx]];
    updateField(groupIdx, { fields: nested });
    setSelectedNestedIdx(target);
  }

  function deleteNestedField(groupIdx: number, nestedIdx: number) {
    const nested = (schema.fields[groupIdx].fields ?? []).filter((_, i) => i !== nestedIdx);
    updateField(groupIdx, { fields: nested });
    setSelectedNestedIdx(null);
  }

  function duplicateField(idx: number) {
    const original = schema.fields[idx];
    const allIds = getAllFields(schema.fields).map((f) => f.id);
    const newId = `${original.id}_copy`;
    const uniqueId = allIds.includes(newId) ? `${original.id}_${Date.now()}` : newId;
    const copy = { ...original, id: uniqueId };
    const newFields = [...schema.fields];
    newFields.splice(idx + 1, 0, copy);
    setSchema((prev) => ({ ...prev, fields: newFields }));
    setSelectedIdx(idx + 1);
  }

  function duplicateNestedField(groupIdx: number, nestedIdx: number) {
    const original = schema.fields[groupIdx].fields![nestedIdx];
    const allIds = (schema.fields[groupIdx].fields ?? []).map((f) => f.id);
    const newId = allIds.includes(`${original.id}_copy`) ? `${original.id}_${Date.now()}` : `${original.id}_copy`;
    const copy = { ...original, id: newId };
    const nested = [...(schema.fields[groupIdx].fields ?? [])];
    nested.splice(nestedIdx + 1, 0, copy);
    updateField(groupIdx, { fields: nested });
    setSelectedNestedIdx(nestedIdx + 1);
  }

  function updateEditingField(patch: Partial<FormField>) {
    const isNested = activeGroupIdx !== null && selectedNestedIdx !== null;
    if (isNested) {
      updateNestedField(activeGroupIdx!, selectedNestedIdx!, patch);
    } else if (selectedIdx !== null) {
      updateField(selectedIdx, patch);
    }
  }

  async function handleSaveDraft() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaving(true);
    try {
      await api.put(`/forms/${formId}`, { schema_json: schema });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast(Array.isArray(detail) ? detail.join(" ") : detail ?? "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleNewDraft() {
    setStartingNewDraft(true);
    try {
      // PUT with the current published schema seeds the draft with existing content.
      // The server creates a new FormVersion and stores it in draft_version_id —
      // current_version_id stays pointing at the live published version.
      await api.put(`/forms/${formId}`, { schema_json: schema });
      setHasDraft(true);
      setPreviewVersion(null);
      setLeftTab("fields");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast(Array.isArray(detail) ? detail.join(" ") : detail ?? "Failed to start new draft.", "error");
    } finally {
      setStartingNewDraft(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      // Save latest changes into the draft first, then publish.
      await api.put(`/forms/${formId}`, { schema_json: schema });
      await api.post(`/forms/${formId}/publish`);
      // After publishing: the draft is now the live version; no active draft.
      setIsPublished(true);
      setHasDraft(false);
      setPreviewVersion(null);
      toast("Form published.");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast(Array.isArray(detail) ? detail.join(" ") : detail ?? "Publish failed.", "error");
    } finally {
      setPublishing(false);
    }
  }

  function handleExportSchema(schemaToExport: object, label: string) {
    const blob = new Blob([JSON.stringify(schemaToExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formName.replace(/\s+/g, "-").toLowerCase()}-${label}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportVersion(versionId: string, versionNum: number) {
    try {
      const res = await api.get(`/forms/${formId}/versions/${versionId}`);
      handleExportSchema(res.data.schema_json, `v${versionNum}`);
    } catch {
      toast("Failed to download schema.", "error");
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-imported after edits
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(parsed?.fields)) {
          setImportError("Invalid schema: missing 'fields' array.");
          return;
        }
        setSchema(parsed);
        setImportError(null);
      } catch {
        setImportError("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <NavSidebar />
        <main className="flex-1 flex items-center justify-center">
          <Spinner />
        </main>
      </div>
    );
  }

  // When viewing a historical version, the canvas shows that version's fields read-only.
  const displayFields = previewVersion ? previewVersion.schema.fields : schema.fields;

  const selectedField = selectedIdx !== null ? schema.fields[selectedIdx] : null;
  const previewValues = buildPreviewValues(schema.fields);

  // The field currently shown in the right-panel editor:
  // either the selected nested field (when in group mode), or the selected top-level field.
  const editingIsNested = activeGroupIdx !== null && selectedNestedIdx !== null;
  const editingField: FormField | null = editingIsNested
    ? (schema.fields[activeGroupIdx!]?.fields?.[selectedNestedIdx!] ?? null)
    : selectedField;
  const editingGroupField = activeGroupIdx !== null ? schema.fields[activeGroupIdx] ?? null : null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <NavSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 group/title">
                <input
                  type="text"
                  value={schema.title}
                  onChange={(e) => isEditable && !previewVersion && setSchema((prev) => ({ ...prev, title: e.target.value }))}
                  disabled={!isEditable || !!previewVersion}
                  className="text-lg font-semibold text-gray-900 border-0 focus:outline-none focus:ring-0 bg-transparent disabled:cursor-default min-w-0"
                  placeholder="Form title"
                />
                {isEditable && !previewVersion && (
                  <PencilLine size={14} className="text-gray-400 flex-shrink-0 opacity-0 group-hover/title:opacity-100 transition-opacity" />
                )}
              </div>
              <input
                type="text"
                value={schema.description ?? ""}
                onChange={(e) => isEditable && !previewVersion && setSchema((prev) => ({ ...prev, description: e.target.value || undefined }))}
                disabled={!isEditable || !!previewVersion}
                className="text-xs text-gray-400 border-0 focus:outline-none focus:ring-0 bg-transparent disabled:cursor-default min-w-0 italic"
                placeholder={isEditable && !previewVersion ? "Add a description…" : ""}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-gray-400 mr-1">Saving…</span>}

            {/* Hidden file input for JSON import */}
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />

            {/* Import — icon only, label slides in on hover */}
            {isEditable && !previewVersion && (
              <button
                onClick={() => importInputRef.current?.click()}
                className="group flex items-center gap-1.5 px-2.5 py-2 border border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-gray-500 hover:text-gray-700 rounded-lg transition-all duration-150"
                title="Import schema from .json"
              >
                <Upload size={15} className="flex-shrink-0" />
                <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 transition-all duration-150 text-sm font-medium whitespace-nowrap">
                  Import
                </span>
              </button>
            )}
            {importError && <span className="text-xs text-red-500">{importError}</span>}

            {/* Save draft — icon only, label slides in on hover */}
            {isEditable && !previewVersion && (
              <button
                onClick={handleSaveDraft}
                disabled={saving || publishing}
                className="group flex items-center gap-1.5 px-2.5 py-2 border border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-gray-500 hover:text-gray-700 rounded-lg disabled:opacity-40 transition-all duration-150"
                title="Save draft"
              >
                <Save size={15} className="flex-shrink-0" />
                <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 transition-all duration-150 text-sm font-medium whitespace-nowrap">
                  Save draft
                </span>
              </button>
            )}

            {/* Status badge — normal edit mode */}
            {!previewVersion && isPublished && !hasDraft && (
              <span className="flex items-center gap-1 text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                <CheckCircle2 size={12} />
                Published
              </span>
            )}
            {!previewVersion && isPublished && hasDraft && (
              <span className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">
                <PencilLine size={12} />
                Draft
              </span>
            )}

            {/* Status badge — preview mode (viewing a historical version) */}
            {previewVersion && (() => {
              const isLive = versions.find((v) => v.is_current)?.version_num === previewVersion.version_num;
              return isLive ? (
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                  <Lock size={11} />
                  Live v{previewVersion.version_num}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full font-medium">
                  <Lock size={11} />
                  v{previewVersion.version_num}
                </span>
              );
            })()}

            {/* New Draft (when published, no active draft, not in preview) */}
            {isPublished && !hasDraft && !previewVersion && (
              <button
                onClick={handleNewDraft}
                disabled={startingNewDraft}
                className="group flex items-center gap-1.5 px-2.5 py-2 border border-brand-300 text-brand-600 hover:bg-brand-50 rounded-lg disabled:opacity-50 transition-all duration-150"
                title="Start a new draft"
              >
                <PencilLine size={15} className="flex-shrink-0" />
                <span className="max-w-0 overflow-hidden opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 transition-all duration-150 text-sm font-medium whitespace-nowrap">
                  {startingNewDraft ? "Starting…" : "New Draft"}
                </span>
              </button>
            )}

            {/* Publish — icon + text always visible */}
            {isEditable && !previewVersion && (
              <button
                onClick={handlePublish}
                disabled={publishing || schema.fields.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                <Send size={14} className="flex-shrink-0" />
                {publishing ? "Publishing…" : "Publish"}
              </button>
            )}
          </div>
        </header>

        {/* Preview mode banner */}
        {previewVersion && (
          <div className="bg-gray-100 border-b border-gray-300 px-6 py-2 flex items-center justify-between text-sm text-gray-600">
            <span>Viewing <strong>v{previewVersion.version_num}</strong> — read only</span>
            <button
              onClick={() => setPreviewVersion(null)}
              className="text-brand-600 hover:text-brand-800 font-semibold text-xs"
            >
              ← Back to {hasDraft ? "draft" : "form"}
            </button>
          </div>
        )}

        {/* Warning: draft will update a published version that has submissions */}
        {!previewVersion && hasDraft && currentVersionSubmissions > 0 && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center gap-2 text-sm text-amber-800">
            <TriangleAlert size={15} className="flex-shrink-0" />
            <span>
              Publishing will replace{currentVersionNum !== null ? ` v${currentVersionNum}` : " the current live version"} — it has{" "}
              <strong>{currentVersionSubmissions}</strong> submission{currentVersionSubmissions !== 1 ? "s" : ""}.
              Existing submissions are preserved.
            </span>
          </div>
        )}

        {/* Three-column layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: field palette + version history */}
          <aside
            className="w-56 bg-white border-r border-gray-200 flex flex-col flex-shrink-0"
            style={{ height: "calc(100vh - 57px)" }}
          >
            {/* Tab bar */}
            <div className="flex border-b border-gray-200 flex-shrink-0">
              <button
                onClick={() => setLeftTab("fields")}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${leftTab === "fields" ? "text-brand-600 border-b-2 border-brand-600" : "text-gray-400 hover:text-gray-600"}`}
              >
                Fields
              </button>
              <button
                onClick={() => { setLeftTab("versions"); loadVersions(); }}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${leftTab === "versions" ? "text-brand-600 border-b-2 border-brand-600" : "text-gray-400 hover:text-gray-600"}`}
              >
                Versions
              </button>
            </div>

            {leftTab === "fields" ? (
              <>
                {/* Group mode context banner */}
                {activeGroupIdx !== null && (
                  <div className="px-3 py-2 bg-brand-50 border-b border-brand-200 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FieldIcon type={schema.fields[activeGroupIdx].type} />
                        <span className="text-xs font-semibold text-brand-800 truncate">
                          {schema.fields[activeGroupIdx].label || "Untitled"}
                        </span>
                      </div>
                      <button
                        onClick={() => { setActiveGroupIdx(null); setSelectedNestedIdx(null); }}
                        className="text-xs text-brand-600 hover:text-brand-800 font-semibold ml-2 flex-shrink-0"
                      >
                        Exit
                      </button>
                    </div>
                    <p className="text-xs text-brand-600 mt-0.5">Adding to this group</p>
                  </div>
                )}
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* Search */}
                  <div className="px-3 pt-2 pb-1 flex-shrink-0">
                    <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent">
                      <Search size={12} className="text-gray-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={paletteSearch}
                        onChange={(e) => setPaletteSearch(e.target.value)}
                        placeholder="Filter field types…"
                        className="flex-1 text-xs bg-transparent focus:outline-none text-gray-700 placeholder-gray-400 min-w-0"
                      />
                      {paletteSearch && (
                        <button onClick={() => setPaletteSearch("")} className="text-gray-400 hover:text-gray-600">
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="p-3 pt-1 overflow-y-auto flex-1">
                    {paletteSearch.trim() ? (
                      // Flat filtered list
                      <div className="space-y-0.5 pt-1">
                        {FIELD_TYPES.filter((ft) =>
                          ft.label.toLowerCase().includes(paletteSearch.toLowerCase())
                        ).map((ft) => {
                          const disabledInGroup = activeGroupIdx !== null && (ft.type === "group" || ft.type === "repeat");
                          return (
                            <button
                              key={ft.type}
                              onClick={() => addField(ft.type)}
                              disabled={!isEditable || !!previewVersion || disabledInGroup}
                              title={disabledInGroup ? "Cannot nest groups or repeats" : undefined}
                              className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                            >
                              <FieldIcon type={ft.type} />
                              {ft.label}
                            </button>
                          );
                        })}
                        {FIELD_TYPES.filter((ft) => ft.label.toLowerCase().includes(paletteSearch.toLowerCase())).length === 0 && (
                          <p className="text-xs text-gray-400 px-3 py-2">No matches.</p>
                        )}
                      </div>
                    ) : (
                      // Grouped collapsible categories
                      FIELD_CATEGORIES.map(({ label: catLabel, types }, catIdx) => {
                        const isOpen = expandedCategories[catLabel] !== false;
                        return (
                          <div key={catLabel} className={catIdx > 0 ? "pt-1" : ""}>
                            <button
                              onClick={() => setExpandedCategories((prev) => ({ ...prev, [catLabel]: !isOpen }))}
                              className="w-full flex items-center justify-between px-1 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors"
                            >
                              {catLabel}
                              <ChevronRight size={11} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                            </button>
                            {isOpen && (
                              <div className="space-y-0.5">
                                {types.map((type) => {
                                  const disabledInGroup = activeGroupIdx !== null && (type === "group" || type === "repeat");
                                  return (
                                    <button
                                      key={type}
                                      onClick={() => addField(type)}
                                      disabled={!isEditable || !!previewVersion || disabledInGroup}
                                      title={disabledInGroup ? "Cannot nest groups or repeats" : undefined}
                                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                                    >
                                      <FieldIcon type={type} />
                                      {FIELD_TYPE_LABEL[type] ?? type}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="p-3 overflow-y-auto flex-1">
                {/* New Draft button — only when published and no active draft */}
                {isPublished && !hasDraft && (
                  <button
                    onClick={handleNewDraft}
                    disabled={startingNewDraft}
                    className="w-full mb-3 px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {startingNewDraft ? "Starting…" : "+ New Draft"}
                  </button>
                )}
                {versionsLoading ? (
                  <div className="flex justify-center mt-4"><Spinner /></div>
                ) : (
                  <div className="space-y-2">
                    {/* Active draft card — always at the top when a draft exists */}
                    {isEditable && (
                      <div
                        className={`rounded-lg border p-2 text-xs cursor-pointer transition-colors ${
                          !previewVersion
                            ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300"
                            : "border-amber-200 bg-amber-50 hover:border-amber-400"
                        }`}
                        onClick={() => setPreviewVersion(null)}
                        title="Click to return to editing this draft"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-amber-800">Draft</span>
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                            {previewVersion ? "click to edit" : "editing"}
                          </span>
                        </div>
                        <p className="text-amber-700">
                          {isPublished ? "Pending publish" : "Not yet published"}
                        </p>
                        <p className="text-amber-600 mt-0.5">{schema.fields.length} field{schema.fields.length !== 1 ? "s" : ""}</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExportSchema(schema, "draft"); }}
                          className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors text-xs font-medium"
                        >
                          <Download size={13} className="flex-shrink-0" />
                          Export
                        </button>
                      </div>
                    )}
                    {versions.filter(v => v.published_at).length === 0 && !isEditable && (
                      <p className="text-xs text-gray-400 text-center mt-4">No published versions yet.</p>
                    )}
                    {/* Published version cards */}
                    {versions.filter(v => v.published_at).map((v) => {
                      const isViewing = previewVersion?.version_num === v.version_num;
                      return (
                        <div
                          key={v.id}
                          className={`rounded-lg border p-2 text-xs cursor-pointer transition-colors ${
                            isViewing
                              ? "border-brand-400 bg-brand-50 ring-1 ring-brand-300"
                              : v.is_current
                              ? "border-brand-200 bg-brand-50 hover:border-brand-400"
                              : "border-gray-200 bg-gray-50 hover:border-gray-400"
                          }`}
                          onClick={async () => {
                            try {
                              const res = await api.get(`/forms/${formId}/versions/${v.id}`);
                              setPreviewVersion({ version_num: v.version_num, schema: res.data.schema_json });
                            } catch {
                              toast("Failed to load version.", "error");
                            }
                          }}
                          title="Click to preview this version"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-gray-700">v{v.version_num}</span>
                            <div className="flex gap-1">
                              {v.is_current && (
                                <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">live</span>
                              )}
                              {isViewing && (
                                <span className="px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded text-xs font-medium">viewing</span>
                              )}
                            </div>
                          </div>
                          <p className="text-gray-500">{new Date(v.published_at!).toLocaleDateString()}</p>
                          <p className="text-gray-400 mt-0.5">{v.submission_count} submission{v.submission_count !== 1 ? "s" : ""}</p>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExportVersion(v.id, v.version_num); }}
                            className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 transition-colors text-xs font-medium"
                          >
                            <Download size={13} className="flex-shrink-0" />
                            Export
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* Center: field canvas */}
          <div className="flex-1 overflow-y-auto p-6" ref={canvasRef}>
            {displayFields.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <p className="text-base">No fields yet.</p>
                <p className="text-sm mt-1">Click a field type on the left to add it.</p>
              </div>
            ) : (
              <div className="space-y-2 max-w-xl">
                {displayFields.map((field, idx) => {
                  const isSelected = !previewVersion && selectedIdx === idx;
                  const isHiddenByRelevant =
                    field.relevant
                      ? !evaluateRelevant(field.relevant, previewValues)
                      : false;

                  return (
                    <div
                      key={field.id}
                      data-field-idx={idx}
                      onClick={() => {
                        if (previewVersion) return;
                        if (field.type === "group" || field.type === "repeat") {
                          setSelectedIdx(idx);
                          setActiveGroupIdx(idx);
                          setSelectedNestedIdx(null);
                        } else {
                          setSelectedIdx(idx);
                          setActiveGroupIdx(null);
                          setSelectedNestedIdx(null);
                        }
                      }}
                      className={`bg-white border rounded-xl px-4 py-3 cursor-pointer transition-all ${
                        isSelected
                          ? "border-brand-400 shadow-sm"
                          : "border-gray-200 hover:border-gray-300"
                      } ${isHiddenByRelevant ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <FieldIcon type={field.type} />
                          <span className="text-sm text-gray-700 font-medium truncate">
                            {field.label || <span className="text-gray-400 italic">Untitled</span>}
                          </span>
                          {field.required && (
                            <span className="text-red-500 text-xs flex-shrink-0">*</span>
                          )}
                          {field.relevant && (
                            <span
                              className="text-xs text-purple-500 flex-shrink-0"
                              title={`Shown when: ${field.relevant}`}
                            >
                              ⚡
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); moveField(idx, -1); }}
                            disabled={idx === 0 || !isEditable || !!previewVersion}
                            aria-label="Move up"
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveField(idx, 1); }}
                            disabled={idx === displayFields.length - 1 || !isEditable || !!previewVersion}
                            aria-label="Move down"
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); duplicateField(idx); }}
                            disabled={!isEditable || !!previewVersion}
                            aria-label="Duplicate field"
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteField(idx); }}
                            disabled={!isEditable || !!previewVersion}
                            aria-label="Delete field"
                            className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Nested fields for group/repeat */}
                      {(field.type === "group" || field.type === "repeat") && (
                        <div className={`mt-2 ml-2 space-y-1.5 ${activeGroupIdx === idx ? "border-l-2 border-brand-300 pl-3 pt-1" : "pl-2"}`}>
                          {activeGroupIdx === idx ? (
                            // Expanded clickable nested field cards when this group is active
                            <>
                              {(field.fields ?? []).map((nf, nIdx) => (
                                <div
                                  key={nf.id}
                                  data-nested-idx={nIdx}
                                  onClick={(e) => { e.stopPropagation(); setSelectedNestedIdx(nIdx); }}
                                  className={`bg-white border rounded-lg px-3 py-2 cursor-pointer flex items-center justify-between gap-2 transition-all ${
                                    selectedNestedIdx === nIdx
                                      ? "border-brand-400 shadow-sm"
                                      : "border-gray-200 hover:border-gray-300"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FieldIcon type={nf.type} />
                                    <span className="text-xs text-gray-700 font-medium truncate">
                                      {nf.label || <span className="text-gray-400 italic">Untitled</span>}
                                    </span>
                                    {nf.required && <span className="text-red-500 text-xs flex-shrink-0">*</span>}
                                  </div>
                                  <div className="flex items-center gap-0.5 flex-shrink-0">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); moveNestedField(idx, nIdx, -1); }}
                                      disabled={nIdx === 0 || !isEditable || !!previewVersion}
                                      aria-label="Move up"
                                      className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                    ><ChevronUp size={13} /></button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); moveNestedField(idx, nIdx, 1); }}
                                      disabled={nIdx === (field.fields?.length ?? 0) - 1 || !isEditable || !!previewVersion}
                                      aria-label="Move down"
                                      className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                    ><ChevronDown size={13} /></button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); duplicateNestedField(idx, nIdx); }}
                                      disabled={!isEditable || !!previewVersion}
                                      aria-label="Duplicate field"
                                      className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                    ><Copy size={13} /></button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); deleteNestedField(idx, nIdx); }}
                                      disabled={!isEditable || !!previewVersion}
                                      aria-label="Delete field"
                                      className="p-0.5 text-red-400 hover:text-red-600 disabled:opacity-30"
                                    ><X size={13} /></button>
                                  </div>
                                </div>
                              ))}
                              {(field.fields ?? []).length === 0 && (
                                <p className="text-xs text-gray-400 italic py-1">
                                  No fields yet — add from the palette on the left.
                                </p>
                              )}
                            </>
                          ) : (
                            // Compact read-only preview when group is not active
                            (field.fields ?? []).length > 0 && (field.fields ?? []).map((nf) => (
                              <div key={nf.id} className="text-xs text-gray-400 flex items-center gap-1">
                                <span>└</span>
                                <FieldIcon type={nf.type} />
                                <span>{nf.label || "Untitled"}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: property editor */}
          <aside
            className="w-80 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0 p-4"
            style={{ height: "calc(100vh - 57px)" }}
          >
            {editingField === null ? (
              <p className="text-sm text-gray-400 text-center mt-8">
                Select a field to edit its properties.
              </p>
            ) : editingField.type === "divider" ? (
              <p className="text-sm text-gray-400 text-center mt-8">
                Divider has no properties.
              </p>
            ) : (
              <div className="space-y-4">

                {/* Field type header */}
                <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                  <FieldIcon type={editingField.type} />
                  <span className="text-sm font-semibold text-gray-800">{FIELD_TYPE_LABEL[editingField.type] ?? editingField.type}</span>
                </div>

                {/* Breadcrumb when editing a nested field */}
                {editingIsNested && editingGroupField && (
                  <div className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <FieldIcon type={editingGroupField.type} />
                    <span className="text-gray-500 truncate">{editingGroupField.label || "Untitled group"}</span>
                    <span className="text-gray-300 flex-shrink-0">›</span>
                    <FieldIcon type={editingField.type} />
                    <span className="font-medium text-gray-700 truncate">{editingField.label || "Untitled"}</span>
                  </div>
                )}

                {/* Label */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={editingField.label}
                    onChange={(e) => {
                      if (!isEditable || previewVersion) return;
                      const newLabel = e.target.value;
                      const patch: Partial<FormField> = { label: newLabel };
                      const allIds = getAllFields(schema.fields).map((f) => f.id);
                      if (/^field_\d+$/.test(editingField.id) && newLabel.trim()) {
                        patch.id = deriveUniqueId(newLabel, allIds, editingField.id);
                      }
                      updateEditingField(patch);
                    }}
                    disabled={!isEditable || !!previewVersion}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                    placeholder="Field label"
                  />
                </div>

                {/* Hint */}
                {!["note", "calculated", "divider"].includes(editingField.type) && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Hint
                    </label>
                    <input
                      type="text"
                      value={editingField.hint ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ hint: e.target.value })}
                      disabled={!isEditable || !!previewVersion}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                      placeholder="Helper text shown to user"
                    />
                  </div>
                )}

                {/* Required */}
                {!["note", "calculated", "divider", "group"].includes(editingField.type) && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="required-check"
                      checked={editingField.required ?? false}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ required: e.target.checked })}
                      disabled={!isEditable || !!previewVersion}
                      className="rounded border-gray-300"
                    />
                    <label htmlFor="required-check" className="text-sm text-gray-700">Required</label>
                  </div>
                )}

                {/* Relevant */}
                {!["calculated", "divider"].includes(editingField.type) && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Show when (relevant)
                    </label>
                    <input
                      type="text"
                      value={editingField.relevant ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ relevant: e.target.value || undefined })}
                      disabled={!isEditable || !!previewVersion}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 font-mono"
                      placeholder={`e.g. consent = 'yes'`}
                    />
                    {editingField.relevant && (
                      <p className="text-xs text-purple-600 mt-1">
                        {evaluateRelevant(editingField.relevant, previewValues)
                          ? "✓ Shown (with current defaults)"
                          : "— Hidden (with current defaults)"}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      Leave blank to always show. Example: <code>age &gt;= 18</code>
                    </p>
                    {/* Available field IDs reference */}
                    {(() => {
                      const otherFields = getAllFields(schema.fields).filter(
                        (f) => f.id !== editingField.id && !["divider", "group", "repeat"].includes(f.type)
                      );
                      if (otherFields.length === 0) return null;
                      return (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-400 cursor-pointer select-none hover:text-gray-600">
                            Available field IDs
                          </summary>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {otherFields.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                disabled={!isEditable || !!previewVersion}
                                onClick={() => {
                                  if (!isEditable || previewVersion) return;
                                  const current = editingField.relevant ?? "";
                                  updateEditingField({ relevant: current ? `${current} ${f.id}` : f.id });
                                }}
                                className="px-2 py-0.5 rounded bg-gray-100 hover:bg-purple-100 text-xs text-gray-600 hover:text-purple-700 disabled:opacity-50 disabled:cursor-default transition-colors"
                                title={`ID: ${f.id}`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </details>
                      );
                    })()}
                  </div>
                )}

                {/* Date/time format selector */}
                {["date", "time", "datetime"].includes(editingField.type) && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Display format
                    </label>
                    <select
                      value={editingField.date_format ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ date_format: e.target.value || undefined })}
                      disabled={!isEditable || !!previewVersion}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                    >
                      {editingField.type === "date" && <>
                        <option value="">Default (YYYY-MM-DD)</option>
                        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                        <option value="DD MMM YYYY">DD MMM YYYY (e.g. 22 Mar 2026)</option>
                        <option value="MMM DD, YYYY">MMM DD, YYYY (e.g. Mar 22, 2026)</option>
                      </>}
                      {editingField.type === "time" && <>
                        <option value="">Default (HH:MM 24h)</option>
                        <option value="HH:MM:SS">HH:MM:SS (24h)</option>
                        <option value="hh:MM am/pm">hh:MM am/pm (12h)</option>
                        <option value="hh:MM:SS am/pm">hh:MM:SS am/pm (12h)</option>
                      </>}
                      {editingField.type === "datetime" && <>
                        <option value="">Default (YYYY-MM-DD HH:MM)</option>
                        <option value="DD/MM/YYYY HH:MM">DD/MM/YYYY HH:MM</option>
                        <option value="MM/DD/YYYY hh:MM am/pm">MM/DD/YYYY hh:MM am/pm</option>
                        <option value="DD MMM YYYY HH:MM">DD MMM YYYY HH:MM</option>
                        <option value="ISO8601">ISO 8601 (full)</option>
                      </>}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      Affects how the value is displayed to the user. Stored value is always ISO.
                    </p>
                  </div>
                )}

                {/* Timestamp info */}
                {editingField.type === "timestamp" && (
                  <div className="bg-brand-50 border border-brand-200 rounded-lg px-3 py-2.5 text-xs text-brand-700">
                    Auto-captures the current date &amp; time when the form opens. The user can reset it to &ldquo;now&rdquo; at any time. Stored as ISO 8601.
                  </div>
                )}

                {/* Default value */}
                {["text", "number", "email", "phone", "date", "time", "datetime"].includes(editingField.type) && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Default value
                    </label>
                    <input
                      type="text"
                      value={editingField.default ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ default: e.target.value || undefined })}
                      disabled={!isEditable || !!previewVersion}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                      placeholder={editingField.type === "date" ? `"today" or YYYY-MM-DD` : ""}
                    />
                  </div>
                )}

                {/* Note body */}
                {editingField.type === "note" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Body
                    </label>
                    <textarea
                      value={editingField.body ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ body: e.target.value })}
                      disabled={!isEditable || !!previewVersion}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 resize-none"
                      placeholder="Note text shown to user"
                    />
                  </div>
                )}

                {/* Calculated expression */}
                {editingField.type === "calculated" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Expression
                    </label>
                    <input
                      type="text"
                      value={editingField.expression ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ expression: e.target.value })}
                      disabled={!isEditable || !!previewVersion}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 font-mono"
                      placeholder="e.g. adults + children"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Use field IDs and +, -, *, / operators. Not shown to users.
                    </p>
                    {(() => {
                      const numericFields = getAllFields(schema.fields).filter(
                        (f) => f.id !== editingField.id && ["number", "calculated"].includes(f.type)
                      );
                      if (numericFields.length === 0) return null;
                      return (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-400 cursor-pointer select-none hover:text-gray-600">
                            Insert field ID
                          </summary>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {numericFields.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                disabled={!isEditable || !!previewVersion}
                                onClick={() => {
                                  if (!isEditable || previewVersion) return;
                                  const current = editingField.expression ?? "";
                                  updateEditingField({ expression: current ? `${current} ${f.id}` : f.id });
                                }}
                                className="px-2 py-0.5 rounded bg-gray-100 hover:bg-brand-100 text-xs text-gray-600 hover:text-brand-700 disabled:opacity-50 disabled:cursor-default transition-colors"
                                title={`Type: ${f.type}`}
                              >
                                {f.label || f.id}
                              </button>
                            ))}
                          </div>
                        </details>
                      );
                    })()}
                  </div>
                )}

                {/* Options for select types */}
                {(editingField.type === "select_one" || editingField.type === "select_multiple") && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Options
                    </label>
                    <div className="space-y-2">
                      {(editingField.options ?? []).map((opt, oi) => (
                        <div key={oi} className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={opt.label}
                            onChange={(e) => {
                              if (!isEditable || previewVersion) return;
                              const opts = [...(editingField.options ?? [])];
                              opts[oi] = { label: e.target.value, value: slugifyOption(e.target.value) };
                              updateEditingField({ options: opts });
                            }}
                            className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                            disabled={!isEditable || !!previewVersion}
                            placeholder={`Option ${oi + 1}`}
                          />
                          <button
                            onClick={() => {
                              if (!isEditable || previewVersion) return;
                              const opts = (editingField.options ?? []).filter((_, i) => i !== oi);
                              updateEditingField({ options: opts });
                            }}
                            disabled={!isEditable || !!previewVersion || (editingField.options?.length ?? 0) <= 1}
                            className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30"
                          >
                            <X size={14} />
                          </button>
                          </div>
                          <p className="text-xs font-mono text-gray-400 pl-1">id: {opt.value}</p>
                        </div>
                      ))}
                    </div>
                    {isEditable && !previewVersion && (
                      <button
                        onClick={() => {
                          const opts = [...(editingField.options ?? [])];
                          opts.push({ value: `option_${opts.length + 1}`, label: `Option ${opts.length + 1}` }); // value updated when user types label
                          updateEditingField({ options: opts });
                        }}
                        className="mt-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
                      >
                        + Add option
                      </button>
                    )}
                  </div>
                )}

                {/* Group properties — only when the group itself is selected (not a nested field) */}
                {!editingIsNested && editingField.type === "group" && (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="collapsible-check"
                        checked={editingField.collapsible ?? false}
                        onChange={(e) => isEditable && !previewVersion && updateEditingField({ collapsible: e.target.checked })}
                        disabled={!isEditable || !!previewVersion}
                        className="rounded border-gray-300"
                      />
                      <label htmlFor="collapsible-check" className="text-sm text-gray-700">
                        Collapsible on mobile
                      </label>
                    </div>
                    <div className="bg-brand-50 border border-brand-200 rounded-lg px-3 py-2.5 text-xs text-brand-700">
                      Use the field palette on the left to add fields to this group.
                    </div>
                  </>
                )}

                {/* Repeat properties — only when the repeat itself is selected */}
                {!editingIsNested && editingField.type === "repeat" && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        Add button label
                      </label>
                      <input
                        type="text"
                        value={editingField.button_label ?? ""}
                        onChange={(e) => isEditable && !previewVersion && updateEditingField({ button_label: e.target.value })}
                        disabled={!isEditable || !!previewVersion}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                        placeholder="Add another"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          Min rows
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editingField.min_count ?? ""}
                          onChange={(e) => isEditable && !previewVersion && updateEditingField({ min_count: e.target.value ? parseInt(e.target.value) : undefined })}
                          disabled={!isEditable || !!previewVersion}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          Max rows
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={editingField.max_count ?? ""}
                          onChange={(e) => isEditable && !previewVersion && updateEditingField({ max_count: e.target.value ? parseInt(e.target.value) : undefined })}
                          disabled={!isEditable || !!previewVersion}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                        />
                      </div>
                    </div>
                    <div className="bg-brand-50 border border-brand-200 rounded-lg px-3 py-2.5 text-xs text-brand-700">
                      Use the field palette on the left to add fields to this repeat.
                    </div>
                  </>
                )}

                {/* select_one_other options */}
                {editingField.type === "select_one_other" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Options
                    </label>
                    <div className="space-y-2">
                      {(editingField.options ?? []).map((opt, oi) => (
                        <div key={oi} className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={opt.label}
                            onChange={(e) => {
                              if (!isEditable || previewVersion) return;
                              const opts = [...(editingField.options ?? [])];
                              opts[oi] = { label: e.target.value, value: slugifyOption(e.target.value) };
                              updateEditingField({ options: opts });
                            }}
                            disabled={!isEditable || !!previewVersion}
                            className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                            placeholder={`Option ${oi + 1}`}
                          />
                          <button
                            onClick={() => {
                              if (!isEditable || previewVersion) return;
                              const opts = (editingField.options ?? []).filter((_, i) => i !== oi);
                              updateEditingField({ options: opts });
                            }}
                            disabled={!isEditable || !!previewVersion || (editingField.options?.length ?? 0) <= 1}
                            className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30"
                          >
                            <X size={14} />
                          </button>
                          </div>
                          <p className="text-xs font-mono text-gray-400 pl-1">id: {opt.value}</p>
                        </div>
                      ))}
                    </div>
                    {isEditable && !previewVersion && (
                      <button
                        onClick={() => {
                          const opts = [...(editingField.options ?? [])];
                          opts.push({ value: `option_${opts.length + 1}`, label: `Option ${opts.length + 1}` }); // value updated when user types label
                          updateEditingField({ options: opts });
                        }}
                        className="mt-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
                      >
                        + Add option
                      </button>
                    )}
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        &ldquo;Other&rdquo; field label
                      </label>
                      <input
                        type="text"
                        value={editingField.other_text_label ?? ""}
                        onChange={(e) => isEditable && !previewVersion && updateEditingField({ other_text_label: e.target.value || undefined })}
                        disabled={!isEditable || !!previewVersion}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                        placeholder="Other (please specify)"
                      />
                    </div>
                  </div>
                )}

                {/* Photo properties */}
                {editingField.type === "photo" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        Max photos
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={editingField.max_photos ?? 1}
                        onChange={(e) => isEditable && !previewVersion && updateEditingField({ max_photos: parseInt(e.target.value) || 1 })}
                        disabled={!isEditable || !!previewVersion}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="allow-gallery"
                        checked={editingField.allow_gallery ?? true}
                        onChange={(e) => isEditable && !previewVersion && updateEditingField({ allow_gallery: e.target.checked })}
                        disabled={!isEditable || !!previewVersion}
                        className="rounded border-gray-300"
                      />
                      <label htmlFor="allow-gallery" className="text-sm text-gray-700">Allow choosing from gallery</label>
                    </div>
                  </div>
                )}

                {/* Audio properties */}
                {editingField.type === "audio" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Max duration (seconds)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editingField.max_duration_seconds ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ max_duration_seconds: e.target.value ? parseInt(e.target.value) : undefined })}
                      disabled={!isEditable || !!previewVersion}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                      placeholder="No limit"
                    />
                  </div>
                )}

                {/* File properties */}
                {editingField.type === "file" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Allowed file types
                    </label>
                    <input
                      type="text"
                      value={editingField.allowed_types ?? ""}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ allowed_types: e.target.value || undefined })}
                      disabled={!isEditable || !!previewVersion}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 font-mono"
                      placeholder="pdf,docx,xlsx"
                    />
                    <p className="text-xs text-gray-400 mt-1">Comma-separated extensions. Leave blank to allow any.</p>
                  </div>
                )}

                {/* Geopoint properties */}
                {editingField.type === "geopoint" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="auto-capture"
                      checked={editingField.auto_capture ?? false}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ auto_capture: e.target.checked })}
                      disabled={!isEditable || !!previewVersion}
                      className="rounded border-gray-300"
                    />
                    <label htmlFor="auto-capture" className="text-sm text-gray-700">Auto-capture location on open</label>
                  </div>
                )}

                {/* Route properties */}
                {editingField.type === "route" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        Capture interval (seconds)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={editingField.capture_interval_seconds ?? ""}
                        onChange={(e) => isEditable && !previewVersion && updateEditingField({ capture_interval_seconds: e.target.value ? parseInt(e.target.value) : undefined })}
                        disabled={!isEditable || !!previewVersion}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                        placeholder="5"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="allow-pause"
                        checked={editingField.allow_pause ?? false}
                        onChange={(e) => isEditable && !previewVersion && updateEditingField({ allow_pause: e.target.checked })}
                        disabled={!isEditable || !!previewVersion}
                        className="rounded border-gray-300"
                      />
                      <label htmlFor="allow-pause" className="text-sm text-gray-700">Allow pausing the route</label>
                    </div>
                  </div>
                )}

                {/* Barcode properties */}
                {editingField.type === "barcode" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="allow-manual"
                      checked={editingField.allow_manual_entry ?? false}
                      onChange={(e) => isEditable && !previewVersion && updateEditingField({ allow_manual_entry: e.target.checked })}
                      disabled={!isEditable || !!previewVersion}
                      className="rounded border-gray-300"
                    />
                    <label htmlFor="allow-manual" className="text-sm text-gray-700">Allow manual entry if scan fails</label>
                  </div>
                )}

                {/* Field ID — editable */}
                <div className="pt-2 border-t border-gray-100">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Field ID
                  </label>
                  <input
                    type="text"
                    value={editingField.id}
                    onChange={(e) => {
                      if (!isEditable || previewVersion) return;
                      const val = e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
                      updateEditingField({ id: val });
                    }}
                    disabled={!isEditable || !!previewVersion}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                  />
                  <p className="text-xs text-gray-400 mt-1">Used in relevance expressions.</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
