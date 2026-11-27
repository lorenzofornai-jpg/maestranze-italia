"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { RTL_LANGUAGES, type CallSession, type CallStatus } from "@maestranze/shared";
import { speechLocale, speechRecognition } from "@/components/atelier-bits";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

type Phase = "waiting" | "connecting" | "live" | "ended" | "missed" | "declined" | "failed" | "denied";
type Caption = { id: number; text: string; original: string | null; untranslated: boolean; at: number };
type Signal = { id: number; kind: "offer" | "answer" | "ice"; payload: any };

const CAPTION_MS = 7000;

/**
 * Videochiamata dell'Atelier. Audio e video passano direttamente tra i due browser (WebRTC); il portale
 * fa solo da centralino per lo scambio dei segnali. Sottotitoli: il browser trascrive chi parla nella sua
 * lingua, il portale traduce, la traduzione arriva all'altro sul canale dati della chiamata.
 */
export function VideoCall({ session, onClose }: { session: CallSession; onClose: () => void }) {
  const t = useT();
  const { call } = session;
  const [phase, setPhase] = useState<Phase>(call.mine && call.status === "RINGING" ? "waiting" : "connecting");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [subtitles, setSubtitles] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const [theirs, setTheirs] = useState<Caption[]>([]);
  const [mine, setMine] = useState<string>("");
  const [noSpeech, setNoSpeech] = useState(false);
  const [, tick] = useState(0);

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const recognizer = useRef<any>(null);
  const closed = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const subtitlesRef = useRef(subtitles);
  subtitlesRef.current = subtitles;
  const captionSeq = useRef(0);

  const base = `/calls/${call.id}`;

  const stopAll = useCallback(() => {
    closed.current = true;
    try {
      recognizer.current?.abort?.();
    } catch {}
    recognizer.current = null;
    channel.current?.close();
    pc.current?.close();
    stream.current?.getTracks().forEach((tr) => tr.stop());
  }, []);

  const finish = useCallback(
    (to: Phase) => {
      if (closed.current) return;
      stopAll();
      setPhase(to);
    },
    [stopAll],
  );

  const hangUp = async () => {
    stopAll();
    await api(`${base}/end`, { body: {} }).catch(() => {});
    onClose();
  };

  // --- Sottotitoli: si trascrive chi parla, si traduce, si manda all'altro --------------------------
  const startRecognition = useCallback(() => {
    const R = speechRecognition();
    if (!R) {
      setNoSpeech(true);
      return;
    }
    if (recognizer.current || closed.current) return;
    const r = new R();
    r.lang = speechLocale(call.myLanguage);
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = String(e.results[i][0].transcript).trim();
        if (!text) continue;
        if (e.results[i].isFinal) {
          setMine(text);
          api<{ text: string; translation: string | null }>(`${base}/captions`, { body: { text } })
            .then((res) => {
              const msg = JSON.stringify({ text: res.translation ?? text, original: res.translation && res.translation !== text ? text : null, untranslated: !res.translation });
              if (channel.current?.readyState === "open") channel.current.send(msg);
            })
            .catch(() => {});
        } else interim += text + " ";
      }
      if (interim) setMine(interim.trim());
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setNoSpeech(true);
    };
    // Il riconoscimento si ferma dopo un silenzio: lo si riavvia finché la chiamata è aperta.
    r.onend = () => {
      recognizer.current = null;
      if (!closed.current && subtitlesRef.current && phaseRef.current === "live") setTimeout(startRecognition, 300);
    };
    recognizer.current = r;
    try {
      r.start();
    } catch {
      recognizer.current = null;
    }
  }, [base, call.myLanguage]);

  const onChannel = useCallback(
    (dc: RTCDataChannel) => {
      channel.current = dc;
      dc.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data));
          const id = ++captionSeq.current;
          setTheirs((list) => [...list.slice(-1), { id, text: m.text, original: m.original ?? null, untranslated: !!m.untranslated, at: Date.now() }]);
        } catch {}
      };
    },
    [],
  );

  // --- Collegamento ---------------------------------------------------------------------------------
  useEffect(() => {
    closed.current = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: RTCIceCandidateInit[] = [];

    const send = (kind: Signal["kind"], payload: object) => api(`${base}/signals`, { body: { kind, payload } }).catch(() => {});

    const setup = async () => {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        await api(`${base}/end`, { body: {} }).catch(() => {});
        finish("denied");
        return;
      }
      if (closed.current) return stream.current.getTracks().forEach((tr) => tr.stop());
      if (localVideo.current) localVideo.current.srcObject = stream.current;

      const peer = new RTCPeerConnection({ iceServers: session.iceServers });
      pc.current = peer;
      stream.current.getTracks().forEach((tr) => peer.addTrack(tr, stream.current!));
      peer.ontrack = (ev) => {
        if (remoteVideo.current && ev.streams[0]) remoteVideo.current.srcObject = ev.streams[0];
      };
      peer.onicecandidate = (ev) => {
        if (ev.candidate) send("ice", ev.candidate.toJSON());
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") setPhase("live");
        if (peer.connectionState === "failed") {
          api(`${base}/end`, { body: {} }).catch(() => {});
          finish("failed");
        }
      };
      if (call.mine) {
        onChannel(peer.createDataChannel("captions"));
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await send("offer", { type: offer.type, sdp: offer.sdp });
      } else {
        peer.ondatachannel = (ev) => onChannel(ev.channel);
      }
      poll();
    };

    const flush = async () => {
      while (pending.length) await pc.current?.addIceCandidate(pending.shift()!).catch(() => {});
    };

    const handle = async (s: Signal) => {
      const peer = pc.current;
      if (!peer) return;
      if (s.kind === "offer" && !call.mine) {
        await peer.setRemoteDescription(s.payload);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await send("answer", { type: answer.type, sdp: answer.sdp });
        await flush();
      } else if (s.kind === "answer" && call.mine && !peer.currentRemoteDescription) {
        await peer.setRemoteDescription(s.payload);
        await flush();
      } else if (s.kind === "ice") {
        if (peer.remoteDescription) await peer.addIceCandidate(s.payload).catch(() => {});
        else pending.push(s.payload);
      }
    };

    const poll = async () => {
      if (closed.current) return;
      try {
        const r = await api<{ status: CallStatus; signals: Signal[]; last: number }>(`${base}/signals?after=${last}`);
        last = r.last;
        for (const s of r.signals) await handle(s);
        if (r.status === "ACTIVE" && phaseRef.current === "waiting") setPhase("connecting");
        if (r.status === "MISSED") return finish("missed");
        if (r.status === "DECLINED") return finish("declined");
        if (r.status === "ENDED") return finish("ended");
      } catch {}
      // Fitto mentre ci si collega, rado quando la chiamata è in corso (serve solo a sapere se l'altro chiude).
      timer = setTimeout(poll, phaseRef.current === "live" ? 3000 : 900);
    };

    setup();
    return () => {
      clearTimeout(timer);
      stopAll();
    };
  }, [base, call.mine, session.iceServers, onChannel, finish, stopAll]);

  // Sottotitoli attivi solo a chiamata in corso.
  useEffect(() => {
    if (phase === "live" && subtitles) startRecognition();
    if (!subtitles) {
      try {
        recognizer.current?.abort?.();
      } catch {}
      recognizer.current = null;
      setMine("");
    }
  }, [phase, subtitles, startRecognition]);

  // I sottotitoli svaniscono dopo qualche secondo.
  useEffect(() => {
    const id = setInterval(() => {
      setTheirs((list) => list.filter((c) => Date.now() - c.at < CAPTION_MS));
      tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const toggle = (kind: "audio" | "video") => {
    const tracks = kind === "audio" ? stream.current?.getAudioTracks() : stream.current?.getVideoTracks();
    tracks?.forEach((tr) => (tr.enabled = !tr.enabled));
    if (kind === "audio") setMuted((v) => !v);
    else setCameraOff((v) => !v);
  };

  const status =
    phase === "waiting"
      ? t("call.waiting", { name: call.otherName })
      : phase === "connecting"
        ? t("call.connecting")
        : phase === "live"
          ? t("call.live", { name: call.otherName })
          : t(`call.${phase === "denied" ? "media_denied" : phase}`);
  const over = phase === "ended" || phase === "missed" || phase === "declined" || phase === "failed" || phase === "denied";
  const rtl = RTL_LANGUAGES.includes(call.myLanguage) ? "rtl" : "auto";

  return (
    <div className="call" role="dialog" aria-modal="true" aria-label={t("call.start")}>
      <video ref={remoteVideo} className="call-remote" autoPlay playsInline />
      {phase !== "live" && (
        <div className="call-veil">
          <span className="eyebrow">{t("call.start")}</span>
          <p className="display call-name">{call.otherName}</p>
          <p className="call-status">{status}</p>
          {!over && <span className="call-pulse" aria-hidden="true" />}
          {over && (
            <button type="button" className="btn light" onClick={onClose}>
              {t("call.hangup")}
            </button>
          )}
        </div>
      )}
      {phase === "live" && <p className="call-status live">{status}</p>}

      <video ref={localVideo} className={`call-local ${cameraOff ? "off" : ""}`} autoPlay playsInline muted />

      {subtitles && phase === "live" && (
        <div className="call-captions" aria-live="polite">
          {theirs.map((c) => (
            <p key={c.id} className="caption" dir={rtl}>
              {showOriginal && c.original ? c.original : c.text}
              {c.untranslated && <span className="caption-note"> · {t("call.subtitles.untranslated")}</span>}
            </p>
          ))}
          {mine && (
            <p className="caption mine" dir={rtl}>
              <span>{t("call.subtitles.mine")}:</span> {mine}
            </p>
          )}
          {noSpeech && <p className="caption-note">{t("call.subtitles.unsupported")}</p>}
        </div>
      )}

      {!over && (
        <div className="call-controls">
          <button type="button" className={`call-btn ${muted ? "off" : ""}`} onClick={() => toggle("audio")} aria-pressed={muted}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              {muted && <path d="M4 4l16 16" />}
            </svg>
            <span>{t("call.mute")}</span>
          </button>
          <button type="button" className={`call-btn ${cameraOff ? "off" : ""}`} onClick={() => toggle("video")} aria-pressed={cameraOff}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="7" width="13" height="10" rx="1" />
              <path d="M16 11l5-3v8l-5-3" />
              {cameraOff && <path d="M3 4l17 17" />}
            </svg>
            <span>{t("call.camera")}</span>
          </button>
          <button type="button" className={`call-btn ${subtitles ? "" : "off"}`} onClick={() => setSubtitles((v) => !v)} aria-pressed={subtitles}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="1" />
              <path d="M7 12h4M13 12h4M7 15h7" />
            </svg>
            <span>{t("call.subtitles")}</span>
          </button>
          {theirs.some((c) => c.original) && (
            <button type="button" className={`call-btn ${showOriginal ? "" : "off"}`} onClick={() => setShowOriginal((v) => !v)} aria-pressed={showOriginal}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h9M8 4v2M6 6c1 4 4 7 7 8M11 6c-1 4-4 7-7 8M13 20l4-9 4 9M14.5 17h5" />
              </svg>
              <span>{t("at.show_original")}</span>
            </button>
          )}
          <button type="button" className="call-btn hangup" onClick={hangUp}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3-2v-2.5c-2.5-1-4.5-1-7 0V14.5l-3 2z" />
            </svg>
            <span>{t("call.hangup")}</span>
          </button>
        </div>
      )}
      <p className="call-private small">{t("call.private")}</p>
    </div>
  );
}
