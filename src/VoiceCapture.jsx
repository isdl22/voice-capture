import { useState, useEffect, useRef, useCallback } from "react";

const PHASES = {
  IDLE: "idle",
  RECORDING: "recording",
  PROCESSING: "processing",
  DONE: "done",
};

function WaveBar({ active, delay = 0 }) {
  return (
    <span style={{
      display: "inline-block",
      width: 3,
      borderRadius: 99,
      background: active ? "#ff4c4c" : "#444",
      animation: active ? `wave 0.8s ease-in-out ${delay}s infinite alternate` : "none",
      height: active ? undefined : 8,
      minHeight: 4,
      maxHeight: 32,
      alignSelf: "center",
    }} />
  );
}

function Timer({ running }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) { setSeconds(0); return; }
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{m}:{s}</span>;
}

function Pulse({ color }) {
  return (
    <span style={{
      width: 10, height: 10, borderRadius: "50%",
      background: color,
      display: "inline-block",
      boxShadow: `0 0 0 0 ${color}`,
      animation: "pulse 1.2s ease-out infinite",
    }} />
  );
}

export default function VoiceCapture() {
  const [phase, setPhase] = useState(PHASES.IDLE);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const streamRef = useRef(null);
  const transcriptRef = useRef("");
  const isRecordingRef = useRef(false);

  const isRecording = phase === PHASES.RECORDING;

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) setSpeechSupported(false);
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    setTranscript("");
    setSummary("");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    transcriptRef.current = "";
    isRecordingRef.current = true;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      isRecordingRef.current = false;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("마이크 권한이 필요합니다. 브라우저 주소창 옆 자물쇠 아이콘에서 마이크를 허용해주세요.");
      } else {
        setError("마이크를 시작할 수 없습니다: " + err.message);
      }
      return;
    }

    streamRef.current = stream;
    audioChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/ogg";

    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(1000);

    // Web Speech API for real-time Korean transcription
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = "ko-KR";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let final = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += text + " ";
          else interim += text;
        }
        if (final) transcriptRef.current += final;
        setTranscript(transcriptRef.current + interim);
      };

      recognition.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        console.warn("Speech recognition error:", e.error);
      };

      // Auto-restart so recognition survives brief pauses
      recognition.onend = () => {
        if (isRecordingRef.current) {
          try { recognition.start(); } catch (_) {}
        }
      };

      recognitionRef.current = recognition;
      try { recognition.start(); } catch (_) {}
    }

    setPhase(PHASES.RECORDING);
  }, [audioUrl]);

  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false;
    setPhase(PHASES.PROCESSING);
    setLoading(true);

    // Stop speech recognition
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (_) {}
      recognitionRef.current = null;
    }

    // Stop media recorder and collect final chunks
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      await new Promise((resolve) => {
        mediaRecorderRef.current.onstop = resolve;
        mediaRecorderRef.current.stop();
      });
    }

    // Release mic
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    setAudioUrl(URL.createObjectURL(audioBlob));

    const finalTranscript = transcriptRef.current.trim();
    setTranscript(finalTranscript || "(음성 인식 결과 없음 — 스피커폰을 사용하거나 Chrome 브라우저를 이용해주세요)");

    // Claude AI summary
    try {
      const res = await fetch("/api/voice-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: finalTranscript }),
      });
      const data = await res.json();
      setSummary(data.summary || data.error || "요약을 생성할 수 없습니다.");
    } catch (e) {
      setSummary("서버 연결 실패. 서버가 실행 중인지 확인해주세요.");
    }

    setLoading(false);
    setPhase(PHASES.DONE);
  }, []);

  const reset = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setPhase(PHASES.IDLE);
    setTranscript("");
    setSummary("");
    setError("");
    setAudioUrl(null);
    transcriptRef.current = "";
  }, [audioUrl]);

  const filename = `rec_${new Date().toISOString().slice(0, 10)}_${Date.now()}.webm`;

  const statusLabel = {
    [PHASES.IDLE]: "대기 중",
    [PHASES.RECORDING]: "녹음 중",
    [PHASES.PROCESSING]: "변환 중...",
    [PHASES.DONE]: "완료",
  }[phase];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Noto Sans KR', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap');
        @keyframes wave { 0% { height: 4px; } 100% { height: 32px; } }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          70% { box-shadow: 0 0 0 8px transparent; opacity: 0.6; }
          100% { box-shadow: 0 0 0 0 transparent; opacity: 1; }
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        button { cursor: pointer; border: none; outline: none; }
      `}</style>

      {/* Phone frame */}
      <div style={{
        width: 375,
        minHeight: 780,
        background: "#111",
        borderRadius: 44,
        border: "2px solid #222",
        boxShadow: "0 40px 80px #000, 0 0 0 1px #333 inset",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Status bar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 24px 0",
          color: "#888", fontSize: 11, fontFamily: "'DM Mono', monospace",
        }}>
          <span>9:41</span>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span>●●●</span><span>WiFi</span><span>🔋</span>
          </div>
        </div>

        {/* App header */}
        <div style={{ padding: "16px 24px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #ff4c4c, #ff1a1a)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 17,
          }}>🎙</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>VoiceCapture</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <Pulse color={isRecording ? "#ff4c4c" : "#555"} />
              <span style={{ color: isRecording ? "#ff4c4c" : "#555", fontSize: 11, fontWeight: 500 }}>
                {statusLabel}
              </span>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: "#1e1e1e", margin: "0 24px" }} />

        {/* Main content */}
        <div style={{ flex: 1, padding: "20px 24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Recording card with waveform + timer */}
          {isRecording && (
            <div style={{
              background: "#161616", borderRadius: 20, padding: "20px",
              border: "1px solid #222", animation: "fadeIn 0.3s ease",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: "50%",
                  background: "linear-gradient(135deg, #2a0000, #1a0000)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, border: "2px solid #3a0000",
                }}>🎙</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>녹음 중</div>
                  <div style={{ color: "#555", fontSize: 12, marginTop: 2 }}>
                    통화 종료 후 아래 버튼을 누르세요
                  </div>
                </div>
                <div style={{ display: "flex", gap: 3, alignItems: "center", height: 32 }}>
                  {[0, 0.1, 0.2, 0.15, 0.05, 0.18, 0.08].map((d, i) => (
                    <WaveBar key={i} active delay={d} />
                  ))}
                </div>
              </div>
              <div style={{
                marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e1e1e",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  color: "#ff4c4c", fontSize: 13, fontFamily: "'DM Mono', monospace",
                }}>
                  <Pulse color="#ff4c4c" />
                  <Timer running={isRecording} />
                </div>
                <div style={{ color: "#444", fontSize: 11 }}>● REC</div>
              </div>
            </div>
          )}

          {/* Live transcript during recording */}
          {isRecording && transcript && (
            <div style={{
              background: "#0d1a0d", borderRadius: 16, padding: "14px",
              border: "1px solid #1a3a1a", animation: "fadeIn 0.3s ease",
            }}>
              <div style={{ color: "#4eff88", fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: "0.08em" }}>
                🔴 실시간 음성 인식
              </div>
              <div style={{ color: "#aaa", fontSize: 12, lineHeight: 1.8, maxHeight: 100, overflowY: "auto" }}>
                {transcript}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: "#1a0a0a", borderRadius: 12, padding: "12px 14px",
              border: "1px solid #3a1a1a", color: "#ff6666", fontSize: 12,
              animation: "fadeIn 0.3s ease",
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Browser compatibility warning */}
          {!speechSupported && phase === PHASES.IDLE && (
            <div style={{
              background: "#1a1500", borderRadius: 12, padding: "12px 14px",
              border: "1px solid #3a2a00", color: "#ffcc44", fontSize: 12,
            }}>
              ⚠️ 이 브라우저는 실시간 음성 인식을 지원하지 않습니다.<br/>
              <span style={{ color: "#888", fontSize: 11 }}>Chrome에서 열면 실시간 텍스트 변환이 가능합니다. 녹음은 모든 브라우저에서 동작합니다.</span>
            </div>
          )}

          {/* IDLE */}
          {phase === PHASES.IDLE && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeIn 0.3s ease" }}>
              <div style={{
                background: "#111", borderRadius: 16, padding: "16px",
                border: "1px solid #1e1e1e",
              }}>
                <div style={{ color: "#555", fontSize: 12, lineHeight: 2 }}>
                  <div style={{ color: "#777", fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: "0.06em" }}>사용 방법</div>
                  📞 전화가 오면 즉시 <b style={{ color: "#ff4c4c" }}>녹음 시작</b> 버튼 클릭<br/>
                  🔊 스피커폰으로 통화 시 상대방 음성도 녹음됨<br/>
                  📝 통화 중 실시간 텍스트 변환 (Chrome만 지원)<br/>
                  ✨ 통화 종료 후 AI가 자동으로 요약 생성<br/>
                  💾 녹음 파일 저장 가능
                </div>
              </div>
              <button
                onClick={startRecording}
                style={{
                  width: "100%", padding: "18px",
                  background: "linear-gradient(135deg, #ff2222, #cc0000)",
                  borderRadius: 16, color: "#fff", fontSize: 16, fontWeight: 700,
                  letterSpacing: "0.02em",
                  boxShadow: "0 4px 24px #ff000044",
                }}
              >
                🎙 녹음 시작
              </button>
            </div>
          )}

          {/* RECORDING — stop button */}
          {phase === PHASES.RECORDING && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <button
                onClick={stopRecording}
                style={{
                  width: "100%", padding: "16px",
                  background: "linear-gradient(135deg, #333, #222)",
                  borderRadius: 16, color: "#fff", fontSize: 15, fontWeight: 700,
                  border: "1px solid #444",
                }}
              >
                ⏹ 녹음 종료 + 저장
              </button>
            </div>
          )}

          {/* PROCESSING / DONE */}
          {(phase === PHASES.PROCESSING || phase === PHASES.DONE) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeIn 0.4s ease" }}>
              {/* Saved badge */}
              {phase === PHASES.DONE && audioUrl && (
                <div style={{
                  background: "#001a08", border: "1px solid #003a10",
                  borderRadius: 12, padding: "10px 14px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ color: "#4eff88", fontSize: 12 }}>✅ 녹음 저장됨</span>
                  <a
                    href={audioUrl}
                    download={filename}
                    style={{
                      color: "#4eff88", fontSize: 11,
                      fontFamily: "'DM Mono', monospace",
                      textDecoration: "underline",
                    }}
                  >
                    다운로드
                  </a>
                </div>
              )}

              {/* Transcript */}
              <div style={{
                background: "#161616", borderRadius: 16, padding: "16px",
                border: "1px solid #222",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  {loading && (
                    <span style={{
                      width: 14, height: 14, border: "2px solid #ff4c4c",
                      borderTopColor: "transparent", borderRadius: "50%",
                      display: "inline-block", animation: "spin 0.8s linear infinite",
                    }} />
                  )}
                  <span style={{ color: "#888", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em" }}>
                    {loading ? "AI 요약 중..." : "📝 통화 내용"}
                  </span>
                </div>
                <div style={{
                  color: "#ccc", fontSize: 13, lineHeight: 1.8,
                  minHeight: 60, maxHeight: 160, overflowY: "auto",
                }}>
                  {transcript || "(음성 없음)"}
                </div>
              </div>

              {/* Summary */}
              {summary && (
                <div style={{
                  background: "#0d0d1f", borderRadius: 16, padding: "16px",
                  border: "1px solid #1e1e3a", animation: "fadeIn 0.4s ease",
                }}>
                  <div style={{ color: "#6666cc", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", marginBottom: 10 }}>
                    ✨ AI 요약
                  </div>
                  <div style={{ color: "#aaa", fontSize: 12, lineHeight: 2, whiteSpace: "pre-line" }}>
                    {summary}
                  </div>
                </div>
              )}

              {phase === PHASES.DONE && (
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={reset}
                    style={{
                      flex: 1, padding: "13px",
                      background: "#1a1a1a", border: "1px solid #2a2a2a",
                      borderRadius: 14, color: "#888", fontSize: 13,
                    }}
                  >
                    🔄 초기화
                  </button>
                  {audioUrl && (
                    <a
                      href={audioUrl}
                      download={filename}
                      style={{
                        flex: 1, padding: "13px",
                        background: "linear-gradient(135deg, #1a1a3a, #12122a)",
                        border: "1px solid #2a2a5a",
                        borderRadius: 14, color: "#8888ff", fontSize: 13,
                        textDecoration: "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      💾 저장
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Bottom nav */}
          <div style={{
            marginTop: "auto", display: "flex", justifyContent: "center", gap: 24, paddingTop: 8,
          }}>
            {["🎙 녹음", "📁 저장소", "⚙️ 설정"].map((item, i) => (
              <div key={i} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                opacity: i === 0 ? 1 : 0.35,
              }}>
                <span style={{ fontSize: 18 }}>{item.split(" ")[0]}</span>
                <span style={{ color: i === 0 ? "#ff4c4c" : "#555", fontSize: 10 }}>{item.split(" ")[1]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Home indicator */}
        <div style={{ height: 22, display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 6 }}>
          <div style={{ width: 120, height: 4, borderRadius: 2, background: "#2a2a2a" }} />
        </div>
      </div>
    </div>
  );
}
