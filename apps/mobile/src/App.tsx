import { CormorantGaramond_300Light } from "@expo-google-fonts/cormorant-garamond/300Light";
import { CormorantGaramond_300Light_Italic } from "@expo-google-fonts/cormorant-garamond/300Light_Italic";
import { Jost_300Light } from "@expo-google-fonts/jost/300Light";
import { Jost_400Regular } from "@expo-google-fonts/jost/400Regular";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";
import { deviceMessages, formatEuro, type LoginChallengeResponse, type PendingApproval, type SessionUser } from "@maestranze/shared";
import { api, ApiFailure, setSession } from "./api";
import { locale, t } from "./i18n";
import { forgetDevice, generateKey, signWithBiometrics, storedDeviceId } from "./keys";
import { colors, fonts } from "./theme";

type Screen =
  | { name: "boot" }
  | { name: "welcome" }
  | { name: "scan" }
  | { name: "login" }
  | { name: "locked"; deviceId: string }
  | { name: "home"; deviceId: string; user: SessionUser };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const errorText = (err: unknown) => {
  if (err instanceof ApiFailure) {
    const key = `error.${err.code}`;
    const msg = t(key);
    return msg === key ? t("error.generic") : msg;
  }
  if (err instanceof Error && err.message === "biometric") return t("error.biometric");
  return t("error.generic");
};

async function pushToken(): Promise<string | undefined> {
  try {
    if (!Device.isDevice) return undefined;
    if (Platform.OS === "android") {
      // Canale ad alta priorità: le richieste di approvazione devono arrivare subito.
      await Notifications.setNotificationChannelAsync("approvals", {
        name: t("home.pending"),
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return undefined;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    return undefined;
  }
}

/**
 * Associa il telefono: genera la coppia di chiavi, firma la richiesta (prova di possesso),
 * la invia e salva la chiave privata protetta da biometria.
 */
async function enroll(authorization: { pairingCode: string } | "session") {
  const key = generateKey();
  const auth = authorization === "session" ? "session" : authorization.pairingCode;
  const res = await api<{ deviceId: string }>("/device/enroll", {
    ...(authorization === "session" ? {} : { pairingCode: authorization.pairingCode }),
    publicKey: key.publicKey,
    signature: key.sign(deviceMessages.enroll(auth, key.publicKey)),
    name: Device.deviceName ?? Device.modelName ?? (Platform.OS === "ios" ? "iPhone" : "Android"),
    platform: Platform.OS === "ios" ? "ios" : "android",
    pushToken: await pushToken(),
  });
  await key.persist(res.deviceId);
  return res.deviceId;
}

/** Accesso diretto: nonce dal server, firma con la chiave sbloccata da impronta o volto. */
async function deviceLogin(deviceId: string) {
  const { nonce } = await api<{ nonce: string }>("/device/nonce", { deviceId });
  const signature = await signWithBiometrics(deviceMessages.login(deviceId, nonce), t("unlock.reason"));
  const res = await api<{ sessionToken: string; user: SessionUser }>("/device/login", { deviceId, nonce, signature });
  setSession(res.sessionToken);
  return res.user;
}

export default function App() {
  const [loaded] = useFonts({ CormorantGaramond_300Light, CormorantGaramond_300Light_Italic, Jost_300Light, Jost_400Regular });
  const [screen, setScreen] = useState<Screen>({ name: "boot" });

  useEffect(() => {
    storedDeviceId().then((id) => setScreen(id ? { name: "locked", deviceId: id } : { name: "welcome" }));
  }, []);

  if (!loaded || screen.name === "boot") {
    return (
      <View style={[s.dark, s.center]}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  switch (screen.name) {
    case "welcome":
      return <Welcome onScan={() => setScreen({ name: "scan" })} onLogin={() => setScreen({ name: "login" })} />;
    case "scan":
      return <Scan onBack={() => setScreen({ name: "welcome" })} onEnrolled={(id) => setScreen({ name: "locked", deviceId: id })} />;
    case "login":
      return <Login onBack={() => setScreen({ name: "welcome" })} onEnrolled={(id) => setScreen({ name: "locked", deviceId: id })} />;
    case "locked":
      return (
        <Locked
          deviceId={screen.deviceId}
          onUnlocked={(user) => setScreen({ name: "home", deviceId: screen.deviceId, user })}
          onRevoked={async () => {
            await forgetDevice();
            setScreen({ name: "welcome" });
          }}
        />
      );
    case "home":
      return (
        <Home
          deviceId={screen.deviceId}
          user={screen.user}
          onLock={() => {
            setSession(null);
            setScreen({ name: "locked", deviceId: screen.deviceId });
          }}
          onUnlink={async () => {
            await api(`/me/devices/${screen.deviceId}`, undefined, "DELETE").catch(() => undefined);
            await forgetDevice();
            setSession(null);
            setScreen({ name: "welcome" });
          }}
        />
      );
  }
}

// =============================================================================================
// Schermate
// =============================================================================================

function Wordmark({ light = true }: { light?: boolean }) {
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Text style={[s.wordmark, { color: light ? colors.paper : colors.ink }]}>MAESTRANZE</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={[s.hair, { backgroundColor: colors.gold }]} />
        <Text style={[s.italic, { color: colors.gold, fontSize: 14 }]}>Italia</Text>
        <View style={[s.hair, { backgroundColor: colors.gold }]} />
      </View>
    </View>
  );
}

/** Arco con monogramma: la stessa firma del sito. */
function Arch({ children, size = 140 }: { children?: ReactNode; size?: number }) {
  return (
    <View style={[s.arch, { width: size, height: size * 1.25, borderTopLeftRadius: size / 2, borderTopRightRadius: size / 2 }]}>
      {children ?? <Text style={[s.serif, { fontSize: size * 0.45, color: colors.gold }]}>M</Text>}
    </View>
  );
}

function Button({ label, onPress, variant = "light", busy }: { label: string; onPress: () => void; variant?: "light" | "dark" | "ghost"; busy?: boolean }) {
  const bg = variant === "light" ? colors.paper : variant === "dark" ? colors.ink : "transparent";
  const fg = variant === "light" ? colors.ink : variant === "dark" ? colors.paper : colors.paper;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: variant === "ghost" ? colors.mutedDark : bg, opacity: pressed || busy ? 0.7 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{label.toUpperCase()}</Text>}
    </Pressable>
  );
}

function Welcome({ onScan, onLogin }: { onScan: () => void; onLogin: () => void }) {
  return (
    <View style={[s.dark, s.page]}>
      <StatusBar style="light" />
      <Wordmark />
      <View style={{ alignItems: "center", gap: 28 }}>
        <Arch />
        <Text style={[s.title, { color: colors.paper, textAlign: "center" }]}>{t("welcome.title")}</Text>
        <Text style={[s.body, { color: colors.mutedDark, textAlign: "center" }]}>{t("welcome.body")}</Text>
      </View>
      <View style={{ gap: 14, alignSelf: "stretch" }}>
        <Button label={t("welcome.pair")} onPress={onScan} />
        <Text style={[s.small, { textAlign: "center" }]}>{t("welcome.pair.hint")}</Text>
        <Button label={t("welcome.login")} onPress={onLogin} variant="ghost" />
      </View>
    </View>
  );
}

function Scan({ onBack, onEnrolled }: { onBack: () => void; onEnrolled: (deviceId: string) => void }) {
  const [permission, request] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const onCode = async (data: string) => {
    if (busy.current) return;
    const match = data.match(/^maestranze:\/\/pair\?code=([\w-]+)/);
    if (!match) return;
    busy.current = true;
    try {
      onEnrolled(await enroll({ pairingCode: decodeURIComponent(match[1]!) }));
    } catch (err) {
      setError(errorText(err));
      setTimeout(() => (busy.current = false), 2500);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={[s.dark, s.page]}>
        <Wordmark />
        <Text style={[s.body, { color: colors.paper, textAlign: "center" }]}>{t("scan.permission")}</Text>
        <View style={{ gap: 14, alignSelf: "stretch" }}>
          <Button label={t("scan.allow")} onPress={request} />
          <Button label={t("back")} onPress={onBack} variant="ghost" />
        </View>
      </View>
    );
  }
  return (
    <View style={s.dark}>
      <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => onCode(data)} />
      <View style={[s.page, { backgroundColor: "rgba(27,25,21,.45)" }]}>
        <Text style={[s.title, { color: colors.paper }]}>{t("scan.title")}</Text>
        <View style={s.viewfinder} />
        <View style={{ gap: 14, alignSelf: "stretch" }}>
          {error && <Text style={[s.small, { color: "#e3a08a", textAlign: "center" }]}>{error}</Text>}
          <Button label={t("back")} onPress={onBack} variant="ghost" />
        </View>
      </View>
    </View>
  );
}

/** Primo accesso dall'app: email + password, codice SMS, poi associazione automatica. */
function Login({ onBack, onEnrolled }: { onBack: () => void; onEnrolled: (deviceId: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<LoginChallengeResponse | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.light}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[s.page, { justifyContent: "flex-start", gap: 36 }]} keyboardShouldPersistTaps="handled">
        <Wordmark light={false} />
        {!challenge ? (
          <View style={{ gap: 26, alignSelf: "stretch" }}>
            <Text style={[s.title, { color: colors.ink }]}>{t("welcome.login")}</Text>
            <Input label={t("login.email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
            <Input label={t("login.password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
            {error && <Text style={s.error}>{error}</Text>}
            <Button
              variant="dark"
              label={t("login.submit")}
              busy={busy}
              onPress={() =>
                run(async () => {
                  const c = await api<LoginChallengeResponse>("/auth/login", { email, password });
                  const sms = await api<{ devCode?: string }>("/auth/mfa/sms", { loginToken: c.loginToken });
                  setDevCode(sms.devCode ?? null);
                  setChallenge(c);
                })
              }
            />
          </View>
        ) : (
          <View style={{ gap: 26, alignSelf: "stretch" }}>
            <Text style={[s.body, { color: colors.ink2 }]}>{t("login.sms", { phone: challenge.maskedPhone ?? "" })}</Text>
            {devCode && <Text style={[s.body, { color: colors.accent }]}>{t("login.dev_code", { code: devCode })}</Text>}
            <Input label={t("login.code")} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" big />
            {error && <Text style={s.error}>{error}</Text>}
            <Button
              variant="dark"
              label={t("login.verify")}
              busy={busy}
              onPress={() =>
                run(async () => {
                  const r = await api<{ sessionToken: string }>("/auth/mfa/verify", { loginToken: challenge.loginToken, method: "SMS", code });
                  setSession(r.sessionToken);
                  const deviceId = await enroll("session");
                  setSession(null);
                  onEnrolled(deviceId);
                })
              }
            />
          </View>
        )}
        <Pressable onPress={onBack}>
          <Text style={[s.small, { color: colors.ink2, textDecorationLine: "underline" }]}>{t("back")}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Input({ label, big, ...props }: { label: string; big?: boolean } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <TextInput
        autoCapitalize="none"
        placeholderTextColor={colors.muted}
        style={[s.input, big && { fontSize: 36, letterSpacing: 10 }]}
        {...props}
      />
    </View>
  );
}

function Locked({ deviceId, onUnlocked, onRevoked }: { deviceId: string; onUnlocked: (u: SessionUser) => void; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await deviceLogin(deviceId));
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "DEVICE_NOT_ACTIVE") return onRevoked();
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [deviceId, onUnlocked, onRevoked]);

  useEffect(() => {
    unlock();
  }, [unlock]);

  return (
    <View style={[s.dark, s.page]}>
      <StatusBar style="light" />
      <Wordmark />
      <View style={{ alignItems: "center", gap: 28 }}>
        <Arch />
        <Text style={[s.title, { color: colors.paper }]}>{t("unlock.title")}</Text>
        {error && <Text style={[s.small, { color: "#e3a08a" }]}>{error}</Text>}
      </View>
      <View style={{ alignSelf: "stretch" }}>
        <Button label={t("unlock.cta")} onPress={unlock} busy={busy} />
      </View>
    </View>
  );
}

function Home({ deviceId, user, onLock, onUnlink }: { deviceId: string; user: SessionUser; onLock: () => void; onUnlink: () => void }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setApprovals((await api<{ approvals: PendingApproval[] }>("/me/approvals")).approvals);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "UNAUTHENTICATED") onLock();
    }
  }, [onLock]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    const sub = Notifications.addNotificationReceivedListener(() => refresh());
    // Tocco sulla notifica: l'app si apre (dopo lo sblocco) e mostra subito la richiesta.
    const tap = Notifications.addNotificationResponseReceivedListener(() => refresh());
    return () => {
      clearInterval(id);
      sub.remove();
      tap.remove();
    };
  }, [refresh]);

  /** Approva o rifiuta: la firma richiede impronta o volto, ogni volta. */
  const respond = async (a: PendingApproval, decision: "APPROVE" | "DENY") => {
    try {
      const reason = a.purpose === "TRANSACTION" ? t("approval.reason.pay", { amount: formatEuro(Number(a.details?.amountCents ?? 0), locale) }) : t("approval.reason");
      const signature = await signWithBiometrics(deviceMessages.respond(a.id, a.nonce, decision), reason);
      const r = await api<{ status: "APPROVED" | "DENIED" }>("/device/approvals/respond", { deviceId, challengeId: a.id, decision, signature });
      setNotice(t(`approval.done.${a.purpose === "TRANSACTION" ? "PAY_" : ""}${r.status}`));
      refresh();
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={s.light}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 28, paddingTop: 72, gap: 36 }}>
        <Wordmark light={false} />
        <View style={{ gap: 6 }}>
          <Text style={[s.italic, { fontSize: 20, color: colors.muted }]}>{t("home.hello")}</Text>
          <Text style={[s.title, { color: colors.ink }]}>{user.displayName}</Text>
        </View>
        <View style={{ gap: 16 }}>
          <Text style={s.label}>{t("home.pending").toUpperCase()}</Text>
          <View style={{ height: 1, backgroundColor: colors.line }} />
          {approvals.length === 0 && <Text style={[s.italic, { fontSize: 19, color: colors.muted }]}>{t("home.none")}</Text>}
          {approvals.map((a) => (
            <View key={a.id} style={s.card}>
              <Text style={[s.label, { color: colors.accent }]}>{time(a.createdAt)}</Text>
              <Text style={[s.serif, { fontSize: 28, color: colors.ink }]}>{t(`approval.${a.purpose}`)}</Text>
              {a.purpose === "TRANSACTION" && a.details && (
                <View style={{ gap: 2, marginVertical: 6 }}>
                  {/* Dynamic linking: si approva esattamente questo importo verso questo beneficiario. */}
                  <Text style={[s.serif, { fontSize: 40, color: colors.ink }]}>{formatEuro(Number(a.details.amountCents), locale)}</Text>
                  <Text style={[s.body, { color: colors.ink2 }]}>{t("approval.payee", { payee: String(a.details.payee) })}</Text>
                  <Text style={s.small}>{t("approval.order", { n: String(a.details.orderNumber) })}</Text>
                </View>
              )}
              {a.ip && <Text style={s.small}>{t("approval.from", { ip: a.ip })}</Text>}
              {a.userAgent && (
                <Text style={s.small} numberOfLines={1}>
                  {a.userAgent}
                </Text>
              )}
              <View style={{ flexDirection: "row", gap: 12, marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button variant="dark" label={t("approval.approve")} onPress={() => respond(a, "APPROVE")} />
                </View>
                <Pressable onPress={() => respond(a, "DENY")} style={[s.btn, { flex: 1, borderColor: colors.ink }]}>
                  <Text style={[s.btnText, { color: colors.ink }]}>{t("approval.deny").toUpperCase()}</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {notice && <Text style={[s.small, { color: colors.ink2 }]}>{notice}</Text>}
        </View>
        <View style={{ gap: 18, marginTop: 24 }}>
          <Button variant="dark" label={t("lock")} onPress={onLock} />
          <Pressable onPress={onUnlink}>
            <Text style={[s.small, { textAlign: "center", textDecorationLine: "underline" }]}>{t("unlink")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  dark: { flex: 1, backgroundColor: colors.ink },
  light: { flex: 1, backgroundColor: colors.paper },
  center: { alignItems: "center", justifyContent: "center" },
  page: { flexGrow: 1, flex: 1, paddingHorizontal: 28, paddingTop: 72, paddingBottom: 48, alignItems: "center", justifyContent: "space-between" },
  wordmark: { fontFamily: fonts.serif, fontSize: 18, letterSpacing: 7 },
  hair: { width: 20, height: StyleSheet.hairlineWidth },
  serif: { fontFamily: fonts.serif },
  italic: { fontFamily: fonts.serifItalic },
  title: { fontFamily: fonts.serif, fontSize: 36, lineHeight: 40 },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 24 },
  small: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.muted },
  label: { fontFamily: fonts.sansRegular, fontSize: 10, letterSpacing: 2.6, color: colors.muted },
  error: { fontFamily: fonts.sans, fontSize: 13, color: colors.error },
  input: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.ink,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.muted,
    paddingVertical: 8,
  },
  btn: { borderWidth: 1, paddingVertical: 18, alignItems: "center", justifyContent: "center" },
  btnText: { fontFamily: fonts.sansRegular, fontSize: 11, letterSpacing: 3 },
  arch: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gold, borderBottomWidth: 0, alignItems: "center", justifyContent: "center" },
  viewfinder: { width: 240, height: 240, borderWidth: 1, borderColor: colors.gold },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.muted, padding: 22, gap: 6, backgroundColor: colors.ivory },
});
