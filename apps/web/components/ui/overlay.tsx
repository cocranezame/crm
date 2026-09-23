'use client';
import * as Dialog from '@radix-ui/react-dialog';
import * as DM from '@radix-ui/react-dropdown-menu';
import * as Pop from '@radix-ui/react-popover';
import * as Tip from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';
import { Button } from './button';

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({ abierto, onClose, titulo, descripcion, children, pie, ancho = 'md', className }: {
  abierto: boolean; onClose: () => void; titulo: React.ReactNode; descripcion?: React.ReactNode;
  children: React.ReactNode; pie?: React.ReactNode; ancho?: 'sm' | 'md' | 'lg' | 'xl'; className?: string;
}) {
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[ancho];
  return (
    <Dialog.Root open={abierto} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content className={cn('fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-pop animate-scale-in focus:outline-none', w, className)}>
          <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-ink-900">{titulo}</Dialog.Title>
              {descripcion ? <Dialog.Description className="mt-0.5 text-[13px] text-ink-500">{descripcion}</Dialog.Description> : <Dialog.Description className="sr-only">{String(titulo)}</Dialog.Description>}
            </div>
            <Dialog.Close className="-mr-2 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {pie && <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-ink-100 bg-ink-50/60 px-6 py-3">{pie}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Panel lateral ────────────────────────────────────────────────────────────

export function Drawer({ abierto, onClose, titulo, children, pie, ancho = 'max-w-xl', subtitulo }: {
  abierto: boolean; onClose: () => void; titulo: React.ReactNode; subtitulo?: React.ReactNode; children: React.ReactNode; pie?: React.ReactNode; ancho?: string;
}) {
  return (
    <Dialog.Root open={abierto} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-900/30 animate-fade-in" />
        <Dialog.Content className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-pop animate-slide-in-right focus:outline-none', ancho)}>
          <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold text-ink-900">{titulo}</Dialog.Title>
              <Dialog.Description className={subtitulo ? 'mt-0.5 text-[13px] text-ink-500' : 'sr-only'}>{subtitulo ?? String(titulo)}</Dialog.Description>
            </div>
            <Dialog.Close className="-mr-2 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {pie && <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-6 py-3">{pie}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Menú desplegable ─────────────────────────────────────────────────────────

export interface ItemMenu { label: React.ReactNode; icono?: React.ReactNode; onClick?: () => void; peligro?: boolean; disabled?: boolean; separador?: boolean }

export function Menu({ trigger, items, align = 'end', className }: { trigger: React.ReactNode; items: ItemMenu[]; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className={cn('z-50 min-w-[180px] rounded-xl border border-ink-200 bg-white p-1 shadow-pop animate-scale-in', className)}>
          {items.map((it, i) => it.separador ? <DM.Separator key={i} className="my-1 h-px bg-ink-100" /> : (
            <DM.Item key={i} disabled={it.disabled} onSelect={() => it.onClick?.()}
              className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
                it.peligro ? 'text-red-600 data-[highlighted]:bg-red-50' : 'text-ink-700 data-[highlighted]:bg-ink-100 data-[highlighted]:text-ink-900')}>
              {it.icono && <span className="flex h-4 w-4 items-center justify-center opacity-70">{it.icono}</span>}
              {it.label}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────

export function Popover({ trigger, children, abierto, onOpenChange, align = 'start', className, side }: {
  trigger: React.ReactNode; children: React.ReactNode; abierto?: boolean; onOpenChange?: (o: boolean) => void;
  align?: 'start' | 'end' | 'center'; className?: string; side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Pop.Root open={abierto} onOpenChange={onOpenChange}>
      <Pop.Trigger asChild>{trigger}</Pop.Trigger>
      <Pop.Portal>
        <Pop.Content align={align} side={side} sideOffset={6} className={cn('z-50 rounded-xl border border-ink-200 bg-white shadow-pop animate-scale-in focus:outline-none', className)}>
          {children}
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

export function Tooltip({ texto, children, side = 'top' }: { texto: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tip.Provider delayDuration={250}>
      <Tip.Root>
        <Tip.Trigger asChild>{children}</Tip.Trigger>
        <Tip.Portal>
          <Tip.Content side={side} sideOffset={6} className="z-[60] max-w-xs rounded-md bg-ink-900 px-2 py-1 text-xs text-white shadow-lg animate-fade-in">
            {texto}
          </Tip.Content>
        </Tip.Portal>
      </Tip.Root>
    </Tip.Provider>
  );
}

// ── Confirmación global: const ok = await confirmar({...}) ───────────────────

interface Conf { titulo: string; texto?: React.ReactNode; confirmar?: string; peligro?: boolean }
const useConf = create<{ c: (Conf & { resolver: (v: boolean) => void }) | null; set: (c: (Conf & { resolver: (v: boolean) => void }) | null) => void }>((set) => ({ c: null, set: (c) => set({ c }) }));

export function confirmar(c: Conf): Promise<boolean> {
  return new Promise((resolver) => useConf.getState().set({ ...c, resolver }));
}

export function ConfirmHost() {
  const { c, set } = useConf();
  const cerrar = (v: boolean) => { c?.resolver(v); set(null); };
  return (
    <Modal abierto={!!c} onClose={() => cerrar(false)} titulo={c?.titulo ?? ''} ancho="sm"
      pie={<>
        <Button variante="secundario" onClick={() => cerrar(false)}>Cancelar</Button>
        <Button variante={c?.peligro ? 'peligro' : 'primario'} onClick={() => cerrar(true)} autoFocus>{c?.confirmar ?? 'Confirmar'}</Button>
      </>}>
      <div className="text-sm leading-relaxed text-ink-600">{c?.texto}</div>
    </Modal>
  );
}
