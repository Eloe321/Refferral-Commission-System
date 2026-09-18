"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { clsx } from "clsx";

export type SheetProps = {
  title: string;
  children: ReactNode;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
};

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => {
      setReduced(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  return reduced;
}

export function Sheet({
  title,
  children,
  trigger,
  open,
  onOpenChange,
  onCloseAutoFocus,
  className,
}: SheetProps) {
  const reducedMotion = useReducedMotion();
  const controlledProps = {
    ...(open === undefined ? {} : { open }),
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
  };

  return (
    <Dialog.Root {...controlledProps}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="ui-sheet-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className={clsx("ui-sheet-content", className)}
          data-motion={reducedMotion ? "reduced" : "standard"}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className="ui-sheet-heading">
            <Dialog.Title className="ui-sheet-title">{title}</Dialog.Title>
            <Dialog.Close className="ui-sheet-close" aria-label={`Close ${title}`}>
              <X aria-hidden="true" size={20} strokeWidth={2} />
            </Dialog.Close>
          </div>
          <div className="ui-sheet-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
