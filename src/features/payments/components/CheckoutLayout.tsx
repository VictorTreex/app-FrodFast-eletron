import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface CheckoutLayoutProps {
  children: React.ReactNode;
  globalLoading: boolean;
  loadingMessage: string;
  onBack: () => void;
  title?: string;
  subtitle?: string;
}

export const CheckoutLayout: React.FC<CheckoutLayoutProps> = ({
  children,
  globalLoading,
  loadingMessage,
  onBack,
  title,
  subtitle
}) => {
  return (
    <div className="min-h-screen relative overflow-hidden bg-[#050505] text-white">
      {globalLoading && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
            <p className="text-white font-medium">{loadingMessage}</p>
          </div>
        </div>
      )}

      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-200px] left-[-100px] w-[500px] h-[500px] bg-purple-700/20 blur-3xl rounded-full" />
        <div className="absolute bottom-[-200px] right-[-100px] w-[500px] h-[500px] bg-orange-500/10 blur-3xl rounded-full" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }}
        />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        <div className="container mx-auto px-4 max-w-6xl w-full flex-1 flex flex-col py-6 pb-16">

          {/* Top nav */}
          <div className="flex items-center justify-between mb-8">
            <Button
              variant="ghost"
              onClick={onBack}
              className="text-zinc-400 hover:text-white hover:bg-white/5 gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
            <span className="text-xs text-zinc-600 font-medium tracking-widest uppercase">
              TreexMenu
            </span>
          </div>

          {/* Title block */}
          {(title || subtitle) && (
            <div className="text-center mb-10">
              {title && (
                <h1 className="text-3xl lg:text-4xl font-bold mb-3">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="text-zinc-400 max-w-md mx-auto text-sm lg:text-base">{subtitle}</p>
              )}
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
};
