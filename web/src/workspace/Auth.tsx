import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, MailCheck } from "lucide-react";
import {
  Brand,
  Field,
  Lang,
  Msg,
  onSubmit,
  useJob,
  useT,
  write,
} from "./shared";
import type { Locale } from "./model";

type Mode =
  | "login"
  | "register"
  | "forgot"
  | "verify"
  | "verify-notification"
  | "reset"
  | "invite"
  | "recover-account";
export function Auth({
  signedIn,
  onDone,
  locale,
  onLocale,
}: {
  signedIn: boolean;
  onDone: () => Promise<void>;
  locale: Locale;
  onLocale: (l: Locale) => void;
}) {
  const t = useT(),
    params = new URLSearchParams(location.search),
    flow = params.get("flow"),
    token = params.get("token") || "";
  const initial = (
    [
      "verify",
      "verify-notification",
      "reset",
      "invite",
      "recover-account",
    ].includes(flow || "") && token
      ? flow
      : "login"
  ) as Mode;
  const [mode, setMode] = useState<Mode>(
      initial === "invite" && !signedIn ? "login" : initial,
    ),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [sent, setSent] = useState(false);
  const job = useJob();
  function select(next: Mode) {
    job.clear();
    setMode(next);
    setPassword("");
    setSent(false);
  }
  const titles: Record<Mode, string> = {
    login: t("Welcome back", "Boas-vindas"),
    register: t("Create your account", "Crie sua conta"),
    forgot: t("Reset your password", "Redefinir sua senha"),
    reset: t("Choose a new password", "Escolha uma nova senha"),
    verify: t("Verify your email", "Verifique seu e-mail"),
    "verify-notification": t(
      "Verify notification email",
      "Verifique o e-mail de notificações",
    ),
    invite: t("Accept invitation", "Aceitar convite"),
    "recover-account": t("Recover your account", "Recuperar sua conta"),
  };
  const action: Record<Mode, string> = {
    login: t("Sign in", "Entrar"),
    register: t("Create account", "Criar conta"),
    forgot: t("Send reset link", "Enviar link"),
    reset: t("Set new password", "Definir nova senha"),
    verify: t("Verify email", "Verificar e-mail"),
    "verify-notification": t("Confirm address", "Confirmar endereço"),
    invite: t("Join organization", "Entrar na organização"),
    "recover-account": t("Restore account", "Restaurar conta"),
  };
  async function submit() {
    await write("/auth/" + mode, "POST", {
      ...(["login", "forgot", "register"].includes(mode) ? { email } : {}),
      ...(["login", "register", "reset"].includes(mode) ? { password } : {}),
      ...(mode === "register" ? { name } : {}),
      ...(token ? { token } : {}),
    });
    if (mode === "forgot" || mode === "register") {
      setSent(true);
      return;
    }
    if (mode === "login" && initial === "invite") {
      select("invite");
      return;
    }
    history.replaceState({}, "", "/app");
    select("login");
    await onDone();
  }
  return (
    <div className="ws-auth">
      <header>
        <Brand />
        <Lang locale={locale} onChange={onLocale} />
      </header>
      <main className="ws-auth-box">
        <div className="ws-auth-mark">
          {sent ? (
            <MailCheck />
          ) : (
            <span>
              p<span>•</span>
            </span>
          )}
        </div>
        <h1>
          {sent
            ? t("Check your inbox", "Verifique sua caixa de entrada")
            : titles[mode]}
        </h1>
        <p>
          {sent
            ? mode === "register"
              ? t(
                  "Open the verification email to finish creating your workspace.",
                  "Abra o e-mail de verificação para concluir seu cadastro.",
                )
              : t(
                  "If the address has an account, a reset link is on its way.",
                  "Se o endereço tiver uma conta, você receberá o link de redefinição.",
                )
            : mode === "login"
              ? initial === "invite"
                ? t(
                    "Sign in with the invited address to join the organization.",
                    "Entre com o endereço convidado para participar da organização.",
                  )
                : t(
                    "Sign in to your PatchBoard workspace.",
                    "Entre no seu espaço PatchBoard.",
                  )
              : mode === "register"
                ? t(
                    "Bring community feedback together in a free workspace.",
                    "Reúna o feedback da comunidade em um espaço gratuito.",
                  )
                : mode === "forgot"
                  ? t(
                      "We’ll email you a link to choose a new password.",
                      "Enviaremos por e-mail um link para escolher uma nova senha.",
                    )
                  : t(
                      "Confirm this request to continue.",
                      "Confirme esta solicitação para continuar.",
                    )}
        </p>
        {!sent && (
          <form onSubmit={onSubmit(() => void job.run(submit))}>
            {mode === "register" && (
              <Field label={t("Display name", "Nome de exibição")}>
                <input
                  autoComplete="name"
                  required
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            )}
            {["login", "forgot", "register"].includes(mode) && (
              <Field label={t("Email address", "Endereço de e-mail")}>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            )}
            {["login", "reset", "register"].includes(mode) && (
              <Field
                label={
                  mode === "reset"
                    ? t("New password", "Nova senha")
                    : t("Password", "Senha")
                }
              >
                <input
                  required
                  type="password"
                  minLength={mode === "login" ? 1 : 10}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            )}
            {mode === "login" && (
              <button
                className="ws-text"
                type="button"
                onClick={() => select("forgot")}
              >
                {t("Forgot password?", "Esqueceu sua senha?")}
              </button>
            )}
            <Msg error>{job.error}</Msg>
            <button className="ws-primary ws-auth-submit" disabled={job.busy}>
              {action[mode]}
              {token ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}
            </button>
          </form>
        )}
        {mode === "login" ? (
          <footer>
            {t("New to PatchBoard?", "Novo no PatchBoard?")}{" "}
            <button className="ws-text" onClick={() => select("register")}>
              {t("Create an account", "Criar uma conta")}
            </button>
          </footer>
        ) : (
          <button className="ws-text" onClick={() => select("login")}>
            <ArrowLeft size={14} />
            {t("Back to sign in", "Voltar para entrar")}
          </button>
        )}
      </main>
    </div>
  );
}
