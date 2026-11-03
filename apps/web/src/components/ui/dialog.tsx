import * as RD from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button } from './button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const widths = { sm: 'w-[min(420px,92vw)]', md: 'w-[min(560px,92vw)]', lg: 'w-[min(720px,94vw)]' };

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 'md' }: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="anim-overlay fixed inset-0 z-(--z-overlay) bg-overlay" />
        <RD.Content
          ref={contentRef}
          // Radix skips this when a field already took autofocus; otherwise focus the dialog, not the close button.
          onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
          className={clsx(
            'anim-dialog fixed left-1/2 top-1/2 z-(--z-modal) flex max-h-[88vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-raised shadow-pop focus-visible:outline-none',
            widths[width],
          )}
        >
          <div className="flex items-start gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <RD.Title className="text-title font-semibold tracking-[-0.01em]">{title}</RD.Title>
              {description ? <RD.Description className="mt-1 text-muted">{description}</RD.Description> : <RD.Description className="sr-only">{title}</RD.Description>}
            </div>
            <RD.Close aria-label="Close" className="fx relative -mr-2 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted before:absolute before:-inset-1 hover:bg-hover hover:text-fg">
              <X size={16} aria-hidden />
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer ? <div className="hairline-t flex items-center justify-end gap-2 px-5 py-3">{footer}</div> : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, loading, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-muted">{description}</div>
    </Dialog>
  );
}
