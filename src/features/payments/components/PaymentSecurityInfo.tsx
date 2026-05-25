import React from 'react';
import { Shield, Lock, RotateCcw } from 'lucide-react';

export const PaymentSecurityInfo: React.FC = () => {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-1 text-[11px] text-zinc-600">
      <span className="flex items-center gap-1.5">
        <Shield className="h-3.5 w-3.5 text-green-600" />
        Criptografia SSL
      </span>
      <span className="flex items-center gap-1.5">
        <Lock className="h-3.5 w-3.5 text-green-600" />
        Dados protegidos por lei
      </span>
      <span className="flex items-center gap-1.5">
        <RotateCcw className="h-3.5 w-3.5 text-green-600" />
        Cancele quando quiser
      </span>
    </div>
  );
};
