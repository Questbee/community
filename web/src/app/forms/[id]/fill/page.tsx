"use client";

/**
 * Web form fill page — /forms/[id]/fill
 *
 * Renders a published form for data entry.
 */

import { useEffect, useState, Suspense } from "react";
import { useParams } from "next/navigation";
import api from "@/lib/api";
import { evaluateRelevant, evaluateExpression } from "@/lib/relevant";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldOption { value: string; label: string; }

interface FormField {
  id: string;
  type: string;
  label?: string;
  hint?: string;
  required?: boolean;
  relevant?: string;
  read_only?: boolean;
  default?: any;
  options?: FieldOption[];
  body?: string;
  expression?: string;
  fields?: FormField[];
  collapsible?: boolean;
  button_label?: string;
  min_count?: number;
  max_count?: number;
  other_text_label?: string;
}

interface FormSchema {
  version: number;
  title?: string;
  description?: string;
  settings?: { show_progress_bar?: boolean };
  fields: FormField[];
}

type FormValues = Record<string, any>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function collectDefaults(fields: FormField[]): FormValues {
  const result: FormValues = {};
  for (const f of fields) {
    if (f.type === "timestamp") {
      result[f.id] = new Date().toISOString();
    } else if (f.default !== undefined && f.default !== null) {
      result[f.id] =
        f.default === "today" ? new Date().toISOString().slice(0, 10) :
        f.default === "now"   ? new Date().toISOString().slice(0, 16).replace("T", " ") :
        f.default;
    }
    if (f.fields) Object.assign(result, collectDefaults(f.fields));
  }
  return result;
}

function buildSubmissionData(fields: FormField[], values: FormValues, allValues: FormValues): FormValues {
  const data: FormValues = {};
  for (const field of fields) {
    const visible = evaluateRelevant(field.relevant, allValues);
    if (field.type === "calculated") {
      const r = evaluateExpression(field.expression ?? "", allValues);
      data[field.id] = isNaN(r) ? null : r;
      continue;
    }
    if (!visible) continue;
    if (field.type === "group") {
      const gv = values[field.id] ?? {};
      data[field.id] = buildSubmissionData(field.fields ?? [], gv, { ...allValues, ...gv });
      continue;
    }
    if (field.type === "repeat") {
      const rows: FormValues[] = Array.isArray(values[field.id]) ? values[field.id] : [];
      data[field.id] = rows.map((row) => buildSubmissionData(field.fields ?? [], row, row));
      continue;
    }
    data[field.id] = values[field.id] ?? null;
  }
  return data;
}

function collectMissing(fields: FormField[], values: FormValues, allValues: FormValues): FormField[] {
  const missing: FormField[] = [];
  for (const field of fields) {
    if (field.type === "calculated") continue;
    if (!evaluateRelevant(field.relevant, allValues)) continue;
    if (field.type === "group") {
      const gv = values[field.id] ?? {};
      missing.push(...collectMissing(field.fields ?? [], gv, { ...allValues, ...gv }));
      continue;
    }
    if (field.type === "repeat") {
      const rows: FormValues[] = Array.isArray(values[field.id]) ? values[field.id] : [];
      for (const row of rows) missing.push(...collectMissing(field.fields ?? [], row, row));
      continue;
    }
    if (!field.required) continue;
    const v = values[field.id];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) missing.push(field);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Field renderers
// ---------------------------------------------------------------------------

function FieldLabel({ field }: { field: FormField }) {
  return (
    <div className="mb-1.5">
      <label className="text-sm font-semibold text-gray-700">
        {field.label || field.id}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.hint && <p className="text-xs text-gray-400 mt-0.5">{field.hint}</p>}
    </div>
  );
}

function TextField({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  const multiline = field.type === "textarea";
  const isReadOnly = field.read_only;
  const base = "w-full border rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition";
  const cls = isReadOnly ? `${base} bg-gray-50 border-gray-200 text-gray-500 cursor-default` : `${base} bg-white border-gray-300`;

  const isDateType = field.type === "date" || field.type === "time" || field.type === "datetime";

  function setNow() {
    const now = new Date();
    if (field.type === "date") onChange(now.toISOString().slice(0, 10));
    else if (field.type === "time") onChange(now.toTimeString().slice(0, 5));
    else onChange(now.toISOString().slice(0, 16));
  }

  const inputType =
    field.type === "number"   ? "number"
    : field.type === "email"  ? "email"
    : field.type === "date"   ? "date"
    : field.type === "time"   ? "time"
    : field.type === "datetime" ? "datetime-local"
    : "text";

  return (
    <div id={`field-${field.id}`} className="mb-5">
      <FieldLabel field={field} />
      {multiline ? (
        <textarea className={`${cls} resize-none`} rows={4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} readOnly={isReadOnly} />
      ) : (
        <div className={isDateType ? "flex gap-2" : undefined}>
          <input
            type={inputType}
            className={cls}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            readOnly={isReadOnly}
          />
          {isDateType && !isReadOnly && (
            <button
              type="button"
              onClick={setNow}
              className="flex-shrink-0 px-3 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded-xl hover:bg-amber-100 transition whitespace-nowrap"
            >
              Now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TimestampField({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  const isReadOnly = field.read_only;
  const display = value ? new Date(value).toLocaleString() : "—";

  return (
    <div id={`field-${field.id}`} className="mb-5">
      <FieldLabel field={field} />
      <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50">
        <span className="text-sm text-gray-700 flex-1">{display}</span>
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => onChange(new Date().toISOString())}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition"
          >
            Reset to now
          </button>
        )}
      </div>
    </div>
  );
}

function SelectOneField({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  return (
    <div id={`field-${field.id}`} className="mb-5">
      <FieldLabel field={field} />
      <div className="space-y-2">
        {(field.options ?? []).map((opt) => (
          <label key={opt.value} className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${value === opt.value ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-gray-300"}`}>
            <input type="radio" name={field.id} value={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} className="accent-brand-600" />
            <span className="text-sm text-gray-700">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SelectMultipleField({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  const selected: string[] = Array.isArray(value) ? value : [];
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
  return (
    <div id={`field-${field.id}`} className="mb-5">
      <FieldLabel field={field} />
      <div className="space-y-2">
        {(field.options ?? []).map((opt) => {
          const checked = selected.includes(opt.value);
          return (
            <label key={opt.value} className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${checked ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-gray-300"}`}>
              <input type="checkbox" value={opt.value} checked={checked} onChange={() => toggle(opt.value)} className="accent-brand-600 rounded" />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SelectOneOtherField({ field, value, onChange }: { field: FormField; value: any; onChange: (v: any) => void }) {
  const selected = typeof value === "object" && value !== null ? value.choice : value;
  const otherText = typeof value === "object" && value !== null ? (value.other ?? "") : "";
  const isOther = selected === "__other__";

  function pickChoice(choice: string) {
    onChange(choice === "__other__" ? { choice: "__other__", other: otherText } : choice);
  }

  return (
    <div id={`field-${field.id}`} className="mb-5">
      <FieldLabel field={field} />
      <div className="space-y-2">
        {(field.options ?? []).map((opt) => (
          <label key={opt.value} className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${selected === opt.value ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-gray-300"}`}>
            <input type="radio" name={field.id} value={opt.value} checked={selected === opt.value} onChange={() => pickChoice(opt.value)} className="accent-brand-500" />
            <span className="text-sm text-gray-700">{opt.label}</span>
          </label>
        ))}
        <label className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${isOther ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-gray-300"}`}>
          <input type="radio" name={field.id} value="__other__" checked={isOther} onChange={() => pickChoice("__other__")} className="accent-brand-500" />
          <span className="text-sm text-gray-700">{field.other_text_label ?? "Other (please specify)"}</span>
        </label>
        {isOther && (
          <input
            type="text"
            value={otherText}
            onChange={(e) => onChange({ choice: "__other__", other: e.target.value })}
            placeholder="Please specify…"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
          />
        )}
      </div>
    </div>
  );
}

function MobileOnlyField({ field, label }: { field: FormField; label: string }) {
  return (
    <div id={`field-${field.id}`} className="mb-5">
      <FieldLabel field={field} />
      <div className="flex items-center gap-3 border border-dashed border-gray-300 rounded-xl px-4 py-3 bg-gray-50 text-sm text-gray-400">
        <span>{label} — available in the mobile app</span>
      </div>
    </div>
  );
}

function NoteField({ field }: { field: FormField }) {
  return (
    <div className="mb-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl px-4 py-3 text-sm text-amber-900">
      {field.body ?? field.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive field renderer
// ---------------------------------------------------------------------------

function RenderFields({
  fields, values, allValues, setVal,
}: {
  fields: FormField[];
  values: FormValues;
  allValues: FormValues;
  setVal: (id: string, v: any) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        if (field.type === "calculated") return null;
        const visible = evaluateRelevant(field.relevant, allValues);
        if (!visible) return null;

        if (field.type === "divider") return <hr key={field.id} className="my-4 border-gray-200" />;
        if (field.type === "note") return <NoteField key={field.id} field={field} />;
        if (field.type === "select_one") return <SelectOneField key={field.id} field={field} value={values[field.id]} onChange={(v) => setVal(field.id, v)} />;
        if (field.type === "select_multiple") return <SelectMultipleField key={field.id} field={field} value={values[field.id]} onChange={(v) => setVal(field.id, v)} />;
        if (field.type === "select_one_other") return <SelectOneOtherField key={field.id} field={field} value={values[field.id]} onChange={(v) => setVal(field.id, v)} />;
        if (field.type === "timestamp") return <TimestampField key={field.id} field={field} value={values[field.id]} onChange={(v) => setVal(field.id, v)} />;
        if (field.type === "photo") return <MobileOnlyField key={field.id} field={field} label="Photo capture" />;
        if (field.type === "audio") return <MobileOnlyField key={field.id} field={field} label="Audio recording" />;
        if (field.type === "signature") return <MobileOnlyField key={field.id} field={field} label="Signature" />;
        if (field.type === "file") return <MobileOnlyField key={field.id} field={field} label="File upload" />;
        if (field.type === "geopoint") return <MobileOnlyField key={field.id} field={field} label="GPS point" />;
        if (field.type === "geotrace") return <MobileOnlyField key={field.id} field={field} label="GPS trace" />;
        if (field.type === "route") return <MobileOnlyField key={field.id} field={field} label="Route tracking" />;
        if (field.type === "barcode") return <MobileOnlyField key={field.id} field={field} label="Barcode / QR scan" />;

        if (field.type === "group") {
          const gv = values[field.id] ?? {};
          const gAll = { ...allValues, ...gv };
          return (
            <div key={field.id} className="mb-5 border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">{field.label || field.id}</h3>
              </div>
              <div className="p-4">
                <RenderFields fields={field.fields ?? []} values={gv} allValues={gAll} setVal={(id, v) => setVal(field.id, { ...gv, [id]: v })} />
              </div>
            </div>
          );
        }

        if (field.type === "repeat") {
          const rows: FormValues[] = Array.isArray(values[field.id]) ? values[field.id] : [];
          return (
            <div key={field.id} className="mb-5">
              <FieldLabel field={field} />
              {rows.map((row, i) => (
                <div key={i} className="border border-gray-200 rounded-xl mb-3 overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">{field.label} {i + 1}</span>
                    <button onClick={() => setVal(field.id, rows.filter((_, j) => j !== i))} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  </div>
                  <div className="p-4">
                    <RenderFields fields={field.fields ?? []} values={row} allValues={row} setVal={(id, v) => { const updated = rows.map((r, j) => j === i ? { ...r, [id]: v } : r); setVal(field.id, updated); }} />
                  </div>
                </div>
              ))}
              {rows.length < (field.max_count ?? 100) && (
                <button onClick={() => setVal(field.id, [...rows, {}])} className="w-full border border-dashed border-amber-400 rounded-xl py-2.5 text-sm text-amber-600 hover:bg-amber-50 transition font-medium">
                  + {field.button_label ?? "Add another"}
                </button>
              )}
            </div>
          );
        }

        // All text-like fields
        return <TextField key={field.id} field={field} value={values[field.id]} onChange={(v) => setVal(field.id, v)} />;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main fill page
// ---------------------------------------------------------------------------

function FillPageInner() {
  const { id: formId } = useParams<{ id: string }>();

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [formName, setFormName] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<FormField[]>([]);
  const [formVersionId, setFormVersionId] = useState<string>("");

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get(`/forms/${formId}`);
        const s: FormSchema = res.data.schema_json;
        setSchema(s);
        setFormName(res.data.name);
        setFormVersionId(res.data.current_version_id ?? "");

        setValues(collectDefaults(s.fields));
      } catch {
        setError("Form not found.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [formId]);

  function setFieldValue(id: string, v: any) {
    setValues((prev) => ({ ...prev, [id]: v }));
  }

  async function handleSubmit() {
    if (!schema) return;
    const missing = collectMissing(schema.fields, values, values);
    if (missing.length > 0) {
      setMissingFields(missing);
      setError("Please fill in all required fields:");
      document.getElementById(`field-${missing[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setMissingFields([]);
    setError(null);
    setSubmitting(true);
    try {
      const data = buildSubmissionData(schema.fields, values, values);
      await api.post("/submissions/", {
        form_version_id: formVersionId,
        data_json: data,
        collected_at: new Date().toISOString(),
      });
      setSubmitted(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error && !schema) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm w-full">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Response submitted</h2>
          <p className="text-gray-500 text-sm mb-6">Thank you. Your response has been recorded.</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setSubmitted(false);
                setValues(schema ? collectDefaults(schema.fields) : {});
                setError(null);
                setMissingFields([]);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Submit another response
            </button>
            <button
              onClick={() => window.history.back()}
              className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  function collectVisibleRequired(fields: FormField[], vals: FormValues, allVals: FormValues): FormField[] {
    const result: FormField[] = [];
    for (const f of fields) {
      if (!evaluateRelevant(f.relevant, allVals)) continue;
      if (f.type === "group") {
        const gv = vals[f.id] ?? {};
        result.push(...collectVisibleRequired(f.fields ?? [], gv, { ...allVals, ...gv }));
      } else if (f.type === "repeat") {
        const rows: FormValues[] = Array.isArray(vals[f.id]) ? vals[f.id] : [];
        for (const row of rows) result.push(...collectVisibleRequired(f.fields ?? [], row, row));
      } else if (f.required && f.type !== "calculated") {
        result.push(f);
      }
    }
    return result;
  }

  const visibleRequired = collectVisibleRequired(schema?.fields ?? [], values, values);
  const filledRequired = visibleRequired.filter((f) => {
    const v = values[f.id];
    return Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && v !== "");
  });
  const progress = visibleRequired.length > 0 ? filledRequired.length / visibleRequired.length : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Amber progress bar */}
      {visibleRequired.length > 0 && schema?.settings?.show_progress_bar !== false && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 z-50">
          <div className="h-1 bg-amber-400 transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      <div className="max-w-xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/questbee-icon.svg" alt="Questbee" className="w-8 h-8 rounded-lg" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{schema?.title || formName}</h1>
          {schema?.description && <p className="text-gray-500 mt-2 text-sm">{schema.description}</p>}
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <RenderFields
            fields={schema?.fields ?? []}
            values={values}
            allValues={values}
            setVal={setFieldValue}
          />

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <p className="font-semibold">{error}</p>
              {missingFields.length > 0 && (
                <ul className="mt-2 list-disc list-inside space-y-0.5">
                  {missingFields.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => document.getElementById(`field-${f.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                        className="underline hover:no-underline"
                      >
                        {f.label ?? f.id}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by <span className="font-semibold">Questbee</span>
        </p>
      </div>
    </div>
  );
}

export default function FillPage() {
  return (
    <Suspense>
      <FillPageInner />
    </Suspense>
  );
}
