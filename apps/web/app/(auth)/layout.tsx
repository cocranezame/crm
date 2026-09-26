import { MessagesSquare, KanbanSquare, Users, Zap } from 'lucide-react';

const PUNTOS = [
  { icono: MessagesSquare, titulo: 'Una sola bandeja', texto: 'WhatsApp, Messenger y TikTok en tiempo real, con asignación al equipo.' },
  { icono: KanbanSquare, titulo: 'Tableros Kanban a tu medida', texto: 'Crea tableros, ordena etapas y mueve negocios arrastrando.' },
  { icono: Users, titulo: 'Contactos unificados', texto: 'Una ficha por cliente con todos sus canales, campos y etiquetas.' },
  { icono: Zap, titulo: 'Plantillas y difusiones', texto: 'Mensajes aprobados por Meta y envíos masivos por etiqueta.' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 opacity-90"
          style={{ background: 'radial-gradient(60% 50% at 20% 10%, rgba(99,102,241,.45) 0%, transparent 60%), radial-gradient(50% 45% at 90% 90%, rgba(14,165,233,.30) 0%, transparent 60%)' }} />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <span className="text-lg font-black text-white">K</span>
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">Kallpa CRM</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">Todas tus conversaciones de venta, ordenadas y en un solo lugar.</h2>
          <div className="mt-10 space-y-6">
            {PUNTOS.map(({ icono: I, titulo, texto }) => (
              <div key={titulo} className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-200 ring-1 ring-white/15"><I className="h-5 w-5" /></div>
                <div><p className="font-medium text-white">{titulo}</p><p className="mt-0.5 text-sm text-ink-300">{texto}</p></div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-ink-400">© {new Date().getFullYear()} Kallpasoft · Lima, Perú</p>
      </aside>
      <main className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
