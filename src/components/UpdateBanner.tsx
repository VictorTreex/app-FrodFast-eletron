import { useEffect, useState } from 'react';
import { Download, RefreshCw, X, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type UpdatePhase = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  version?: string;
  percent?: number;
  error?: string;
}

const isElectron = typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined';

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isElectron) return;

    const api = (window as any).electronAPI;

    const unsubStatus = api.onUpdateStatus?.((data: any) => {
      if (data.status === 'available') {
        setDismissed(false);
        setUpdate({ phase: 'available', version: data.version });
      } else if (data.status === 'downloaded') {
        setDismissed(false);
        setUpdate({ phase: 'downloaded', version: data.version });
      } else if (data.status === 'error') {
        setUpdate({ phase: 'error', error: data.error });
      } else {
        setUpdate({ phase: 'idle' });
      }
    });

    const unsubProgress = api.onUpdateProgress?.((data: any) => {
      setUpdate(prev => ({
        ...prev,
        phase: 'downloading',
        percent: Math.round(data.percent ?? 0)
      }));
    });

    // Solicitar check ao montar o componente.
    // O check automático do main.js dispara quando a página carrega,
    // mas se o evento chegar antes dos listeners estarem registrados
    // ele seria perdido. Pedir aqui garante que o check acontece
    // depois que o React já está pronto para receber a resposta.
    api.checkForUpdates?.();

    return () => {
      unsubStatus?.();
      unsubProgress?.();
    };
  }, []);

  if (!isElectron || dismissed || update.phase === 'idle') return null;

  const handleInstall = async () => {
    await (window as any).electronAPI?.installUpdateNow?.();
  };

  if (update.phase === 'error') return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium
      bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg">

      <div className="flex items-center gap-2.5 min-w-0">
        {update.phase === 'available' && (
          <>
            <Download className="h-4 w-4 shrink-0" />
            <span>Nova versão <strong>{update.version}</strong> disponível — baixando automaticamente...</span>
          </>
        )}

        {update.phase === 'downloading' && (
          <>
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
            <span>Baixando atualização... <strong>{update.percent}%</strong></span>
            <div className="ml-2 h-1.5 w-32 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-white transition-all duration-300"
                style={{ width: `${update.percent}%` }}
              />
            </div>
          </>
        )}

        {update.phase === 'downloaded' && (
          <>
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-300" />
            <span>Versão <strong>{update.version}</strong> pronta! Reinicie para aplicar.</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {update.phase === 'downloaded' && (
          <Button
            size="sm"
            onClick={handleInstall}
            className="h-7 px-3 text-xs bg-white text-indigo-700 hover:bg-white/90 font-semibold"
          >
            Reiniciar agora
          </Button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
