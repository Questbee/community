"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, FolderOpen, Plus, Trash2 } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Modal from "@/components/Modal";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import api from "@/lib/api";

interface Project {
  id: string;
  name: string;
  description: string | null;
  tenant_id: string;
  created_at?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formCounts, setFormCounts] = useState<Record<string, number>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/projects");
      setProjects(res.data);
    } catch {
      setError("Failed to load projects.");
    } finally {
      setLoading(false);
    }
  }

  async function loadFormCounts() {
    try {
      const res = await api.get("/forms");
      const counts: Record<string, number> = {};
      for (const form of res.data) {
        counts[form.project_id] = (counts[form.project_id] ?? 0) + 1;
      }
      setFormCounts(counts);
    } catch {
      // non-blocking
    }
  }

  useEffect(() => {
    loadProjects();
    loadFormCounts();
    api.get("/auth/me").then((res) => setIsAdmin(res.data.role === "admin")).catch(() => {});
  }, []);

  async function handleDeleteProject() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/projects/${deleteTarget.id}`);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteConfirm("");
      toast("Project deleted.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setDeleteError(msg ?? "Failed to delete project.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/projects", { name: newName, description: newDesc || null });
      setModalOpen(false);
      setNewName("");
      setNewDesc("");
      toast("Project created.");
      await Promise.all([loadProjects(), loadFormCounts()]);
    } catch {
      // keep modal open, user can retry
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
            <span className="p-2 bg-brand-100 rounded-xl">
              <LayoutDashboard size={20} className="text-brand-700" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-sm text-gray-500">Manage your data collection projects.</p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={15} strokeWidth={2.5} />
            New Project
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-6 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-2/3 mb-3" />
                <div className="h-4 bg-gray-100 rounded w-full mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-red-600 text-sm">{error}</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <FolderOpen size={44} className="mx-auto mb-3 text-gray-300" />
            <p className="text-base font-medium text-gray-500">No projects yet.</p>
            <p className="text-sm mt-1">Click &quot;New Project&quot; to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div key={project.id} className="flex items-stretch group bg-white border border-gray-200 rounded-xl hover:border-brand-400 hover:shadow-md transition-all">
                <button
                  onClick={() => router.push(`/forms?project_id=${project.id}`)}
                  className="flex-1 text-left p-5 min-w-0"
                >
                  <div className="flex items-start gap-3 mb-2">
                    <span className="p-2 bg-brand-50 rounded-lg flex-shrink-0 mt-0.5">
                      <FolderOpen size={16} className="text-brand-600" />
                    </span>
                    <h2 className="text-base font-semibold text-gray-900 leading-snug truncate">{project.name}</h2>
                  </div>
                  {project.description && (
                    <p className="text-sm text-gray-500 mb-2 line-clamp-2 pl-11">{project.description}</p>
                  )}
                  <div className="flex items-center gap-3 pl-11">
                    {project.created_at && (
                      <p className="text-xs text-gray-400">
                        {new Date(project.created_at).toLocaleDateString()}
                      </p>
                    )}
                    {formCounts[project.id] !== undefined && (
                      <p className="text-xs text-gray-400">
                        {formCounts[project.id]} form{formCounts[project.id] !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </button>
                {isAdmin && (
                  <button
                    onClick={() => { setDeleteTarget(project); setDeleteConfirm(""); setDeleteError(null); }}
                    className="px-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-r-xl border-l border-gray-100 transition-colors opacity-60 sm:opacity-0 sm:group-hover:opacity-100 flex-shrink-0"
                    title="Delete project"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <Modal open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteConfirm(""); setDeleteError(null); }} title="Delete project?">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            You are about to permanently delete <strong>{deleteTarget?.name}</strong>.
          </p>
          <p className="text-sm text-gray-600">
            The project must have no forms. If it still has forms, delete them first.
          </p>
          <p className="text-sm text-gray-700">This action cannot be undone. Type <strong>delete</strong> to confirm.</p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="delete"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); setDeleteError(null); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteConfirm !== "delete" || deleting}
              onClick={handleDeleteProject}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Project">
        <form onSubmit={handleCreateProject} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Project name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="What is this project for?"
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
