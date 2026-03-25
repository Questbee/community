"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Plus, ArrowLeft, Trash2 } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Modal from "@/components/Modal";
import Spinner from "@/components/Spinner";
import api from "@/lib/api";

interface Form {
  id: string;
  name: string;
  project_id: string;
  current_version_id: string | null;
  is_published: boolean;
  version_num: number | null;
}

function FormsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id");

  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Form | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const loadForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = projectId ? `/forms?project_id=${projectId}` : "/forms";
      const res = await api.get(url);
      setForms(res.data);
    } catch {
      setError("Failed to load forms.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadForms();
    api.get("/auth/me").then((res) => setIsAdmin(res.data.role === "admin")).catch(() => {});
  }, [loadForms]);

  async function handleDeleteForm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/forms/${deleteTarget.id}`);
      setForms((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteConfirm("");
    } catch {
      // keep modal open
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreateForm(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setCreating(true);
    try {
      const res = await api.post("/forms", {
        project_id: projectId,
        name: newName,
        schema_json: { version: 1, title: newName, fields: [] },
      });
      setModalOpen(false);
      setNewName("");
      router.push(`/forms/${res.data.id}/builder`);
    } catch {
      // keep modal open
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <NavSidebar />

      <main className="flex-1 px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft size={18} />
            </button>
            <span className="p-2 bg-brand-100 rounded-xl">
              <FileText size={20} className="text-brand-700" />
            </span>
            <h1 className="text-2xl font-bold text-gray-900">Forms</h1>
          </div>
          {projectId && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={15} strokeWidth={2.5} />
              New Form
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : error ? (
          <div className="text-red-600 text-sm">{error}</div>
        ) : forms.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <FileText size={44} className="mx-auto mb-3 text-gray-300" />
            <p className="text-base font-medium text-gray-500">No forms yet.</p>
            {projectId && <p className="text-sm mt-1">Click &quot;New Form&quot; to create one.</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {forms.map((form) => (
              <div key={form.id} className="flex items-stretch group bg-white border border-gray-200 rounded-xl hover:border-brand-400 hover:shadow-md transition-all">
                <button
                  onClick={() => router.push(`/forms/${form.id}/builder`)}
                  className="flex-1 text-left p-5 min-w-0"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`p-1.5 rounded-lg flex-shrink-0 ${form.is_published ? "bg-green-50" : "bg-brand-50"}`}>
                        <FileText size={15} className={form.is_published ? "text-green-600" : "text-brand-600"} />
                      </span>
                      <h2 className="text-sm font-semibold text-gray-900 leading-snug truncate">{form.name}</h2>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${form.is_published ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {form.is_published ? "Published" : "Draft"}
                    </span>
                  </div>
                  {form.version_num !== null && (
                    <p className="text-xs text-gray-400 pl-8">v{form.version_num}</p>
                  )}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => { setDeleteTarget(form); setDeleteConfirm(""); }}
                    className="px-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-r-xl border-l border-gray-100 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                    title="Delete form"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <Modal open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteConfirm(""); }} title="Delete form?">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            This will permanently delete <strong>{deleteTarget?.name}</strong> and all of its data:
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>All published versions</li>
            <li>All submissions and responses</li>
            <li>All uploaded media files</li>
          </ul>
          <p className="text-sm text-gray-700">This action cannot be undone. Type <strong>delete</strong> to confirm.</p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="delete"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteConfirm !== "delete" || deleting}
              onClick={handleDeleteForm}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Form">
        <form onSubmit={handleCreateForm} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Form Name</label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="e.g. Household Survey"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function FormsPage() {
  return (
    <Suspense>
      <FormsContent />
    </Suspense>
  );
}
