import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Shield,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  KeyRound,
} from "lucide-react";

const Settings = () => {
  const { user } = useAuth();

  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [showPwd, setShowPwd] = useState({ current: false, next: false, confirm: false });
  const [savingPwd, setSavingPwd] = useState(false);

  const pwdErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (pwd.next && pwd.next.length < 8) e.next = "Mínimo 8 caracteres";
    if (pwd.next && !/[A-Za-z]/.test(pwd.next)) e.next = "Inclua ao menos uma letra";
    if (pwd.next && !/\d/.test(pwd.next)) e.next = "Inclua ao menos um número";
    if (pwd.confirm && pwd.next !== pwd.confirm) e.confirm = "As senhas não coincidem";
    return e;
  }, [pwd]);

  const pwdValid =
    !!pwd.current &&
    !!pwd.next &&
    !!pwd.confirm &&
    Object.keys(pwdErrors).length === 0 &&
    pwd.next === pwd.confirm;

  const changePassword = async () => {
    if (!user || !pwdValid) return;
    setSavingPwd(true);
    const { error: reauth } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: pwd.current,
    });
    if (reauth) {
      toast.error("Senha atual incorreta");
      setSavingPwd(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pwd.next });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Senha alterada com sucesso");
      setPwd({ current: "", next: "", confirm: "" });
    }
    setSavingPwd(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie a segurança da sua conta.
        </p>
      </header>

      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/60 bg-gradient-to-r from-primary/5 via-card to-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Alterar senha</CardTitle>
              <p className="text-xs text-muted-foreground">
                Use uma senha forte com pelo menos 8 caracteres, letras e números.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-6">
          <FieldGroup label="Senha atual" icon={Lock}>
            <PasswordInput
              value={pwd.current}
              onChange={(v) => setPwd({ ...pwd, current: v })}
              show={showPwd.current}
              onToggle={() => setShowPwd({ ...showPwd, current: !showPwd.current })}
              placeholder="••••••••"
            />
          </FieldGroup>

          <FieldGroup label="Nova senha" icon={Lock} error={pwdErrors.next}>
            <PasswordInput
              value={pwd.next}
              onChange={(v) => setPwd({ ...pwd, next: v })}
              show={showPwd.next}
              onToggle={() => setShowPwd({ ...showPwd, next: !showPwd.next })}
              placeholder="Mínimo 8 caracteres"
            />
            {pwd.next && !pwdErrors.next && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> Senha forte
              </p>
            )}
          </FieldGroup>

          <FieldGroup label="Confirmar nova senha" icon={Lock} error={pwdErrors.confirm}>
            <PasswordInput
              value={pwd.confirm}
              onChange={(v) => setPwd({ ...pwd, confirm: v })}
              show={showPwd.confirm}
              onToggle={() => setShowPwd({ ...showPwd, confirm: !showPwd.confirm })}
              placeholder="Repita a nova senha"
            />
          </FieldGroup>

          <div className="flex items-center justify-end gap-3 border-t border-border/60 pt-4">
            <Button
              variant="cta"
              size="lg"
              onClick={changePassword}
              disabled={!pwdValid || savingPwd}
              className="min-w-[180px]"
            >
              {savingPwd ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Alterando...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4" /> Alterar senha
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const FieldGroup = ({
  label,
  icon: Icon,
  error,
  hint,
  children,
}: {
  label: string;
  icon?: any;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </Label>
    <div className="relative">
      {Icon && (
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      )}
      {children}
    </div>
    {error ? (
      <p className="text-[11px] font-medium text-destructive">{error}</p>
    ) : hint ? (
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    ) : null}
  </div>
);

const PasswordInput = ({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
}) => (
  <>
    <Input
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="new-password"
      className="h-11 pl-10 pr-10"
    />
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
      aria-label={show ? "Ocultar senha" : "Mostrar senha"}
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  </>
);

export default Settings;
