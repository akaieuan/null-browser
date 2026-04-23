import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Shared header used across Settings, History, and other full-screen panels. */
export function PanelHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between px-4">
      <div className="text-sm font-medium">{title}</div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="h-7 w-7"
      >
        <X size={14} strokeWidth={1.5} />
      </Button>
    </header>
  );
}
