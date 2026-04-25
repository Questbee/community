"use client";

import { useEffect, useState } from "react";
import { Users, UserPlus } from "lucide-react";
import NavSidebar from "@/components/NavSidebar";
import Modal from "@/components/Modal";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import api from "@/lib/api";

interface User {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  tenant_id: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin:        "bg-red-100 text-red-700",
  manager:      "bg-blue-100 text-blue-700",
  field_worker: "bg-gray-100 text-gray-700",
};

const ROLE_LABELS: Record<string, string> = {
  admin:        "Admin",
  manager:      "Manager",
  field_worker: "Field Worker",
};

export default function UsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "manager" | "field_worker">("field_worker");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/users");
      setUsers(res.data);
    } catch {
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await api.post("/users", { email: newEmail, password: newPassword, role: newRole });
      setModalOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewRole("field_worker");
      toast("User created.");
      await loadUsers();
    } catch (err: any) {
      setCreateError(err?.response?.data?.detail ?? "Failed to create user.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeactivate() {
    if (!deactivateTarget) return;
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await api.delete(`/users/${deactivateTarget.id}`);
      toast(`${deactivateTarget.email} deactivated.`);
      setDeactivateTarget(null);
      await loadUsers();
    } catch (err: any) {
      setDeactivateError(err?.response?.data?.detail ?? "Failed to deactivate user.");
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <NavSidebar />

      <main className="flex-1 px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="p-2 bg-brand-100 rounded-xl">
              <Users size={20} className="text-brand-700" />
            </span>
            <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <UserPlus size={15} strokeWidth={2.5} />
            Add User
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <div className="text-red-600 text-sm">{error}</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-100 text-brand-800 text-xs font-bold flex-shrink-0">
                          {user.email[0].toUpperCase()}
                        </span>
                        <span className="text-gray-800">{user.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[user.role] ?? "bg-gray-100 text-gray-600"}`}>
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {user.is_active && (
                        <button
                          onClick={() => { setDeactivateTarget(user); setDeactivateError(null); }}
                          className="text-xs text-red-500 hover:text-red-700 font-medium"
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Deactivate confirmation modal */}
      <Modal
        open={!!deactivateTarget}
        onClose={() => { setDeactivateTarget(null); setDeactivateError(null); }}
        title="Deactivate user?"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Deactivate <strong>{deactivateTarget?.email}</strong>? They will no longer be able to log in.
          </p>
          {deactivateError && <p className="text-sm text-red-600">{deactivateError}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => { setDeactivateTarget(null); setDeactivateError(null); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deactivating}
              onClick={handleDeactivate}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {deactivating ? "Deactivating…" : "Deactivate"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add user modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add User">
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as typeof newRole)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value="field_worker">Field Worker</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
