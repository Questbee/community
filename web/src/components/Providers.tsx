"use client";

import { ReactNode } from "react";
import { ToastProvider } from "./Toast";

export default function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
