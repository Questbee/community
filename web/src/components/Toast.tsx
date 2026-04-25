"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

type ToastType = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let _nextId = 0;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), 3500);
    return () => clearTimeout(t);
  }, [item.id, onDismiss]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium bg-white animate-toast-in ${
        item.type === "success" ? "border-green-200 text-green-800" : "border-red-200 text-red-800"
      }`}
    >
      {item.type === "success" ? (
        <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
      ) : (
        <XCircle size={16} className="text-red-500 flex-shrink-0" />
      )}
      <span className="flex-1">{item.message}</span>
      <button onClick={() => onDismiss(item.id)} className="text-gray-400 hover:text-gray-600 ml-1">
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = _nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastCard item={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
