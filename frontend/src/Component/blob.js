import { useState, useEffect, useRef, useCallback } from "react";

/* ─────────────────────────────────────────────────────────────
   F.R.I.D.A.Y  —  React Component
   Auto-detects:
     • Microphone input  → THINKING  (you're speaking to it)
     • Speaker / audio   → REPLYING  (TTS / ElevenLabs playing)
     • setState('search')  called externally for web search
     • Idle otherwise    → STANDBY
   Expose on window.FRIDAY:
     friday.setState(0|1|2|3)
     friday.setSearching(bool)
     friday.setThinking(bool)
     friday.connectAudio(audioElement|MediaStream)
     friday.startMic()
     friday.stopMic()
     friday.isMicGranted()
   ───────────────────────────────────────────────────────────── */

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `
precision highp float;
uniform vec2 R;
uniform float T;
uniform float S;
uniform float AMP;

#define PI 3.14159265

float hash(vec3 p){
  p=fract(p*vec3(443.897,397.297,491.187));
  p+=dot(p.zxy,p.yxz+19.27);
  return fract(p.x*p.y*p.z*74.93);
}
float n3(vec3 p){
  vec3 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(
    mix(mix(hash(i),hash(i+vec3(1,0,0)),u.x),
        mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),u.x),u.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),u.x),
        mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),u.x),u.y),u.z);
}
float fbm(vec3 p,int oct,float spd){
  float v=0.,a=.5;
  vec3 d=vec3(spd*T*.22,spd*T*.17,spd*T*.19);
  for(int i=0;i<8;i++){
    if(i>=oct)break;
    v+=a*n3(p+d*float(i+1));
    p*=2.03;a*=.5;
  }
  return v;
}
mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0,s,0,1,0,-s,0,c);}
mat3 rotX(float a){float c=cos(a),s=sin(a);return mat3(1,0,0,0,c,-s,0,s,c);}

float sdf(vec3 p,float spd,float amp){
  float r=length(p);
  float n=fbm(normalize(p)*2.2+vec3(0.,T*spd*.25,0.),6,spd);
  float n2=fbm(normalize(p)*4.5+vec3(T*spd*.1,0.,T*spd*.12),4,spd*1.3);
  return r-(0.42+n*amp+n2*amp*.4+AMP*0.18);
}
vec3 calcNorm(vec3 p,float spd,float amp){
  float e=.004;
  return normalize(vec3(
    sdf(p+vec3(e,0,0),spd,amp)-sdf(p-vec3(e,0,0),spd,amp),
    sdf(p+vec3(0,e,0),spd,amp)-sdf(p-vec3(0,e,0),spd,amp),
    sdf(p+vec3(0,0,e),spd,amp)-sdf(p-vec3(0,0,e),spd,amp)));
}
vec3 getColor(float t,float s){
  if(s<0.5){
    vec3 a=vec3(.95,.35,.85),b=vec3(.55,.15,.95),c=vec3(1.,.2,.5);
    return clamp(a+b*cos(6.28*(c*t+vec3(.0,.3,.6))),0.,1.);
  }
  if(s<1.5){
    float f=s-.5;
    vec3 idl=vec3(.95,.35,.85)+vec3(.55,.15,.95)*cos(6.28*(vec3(1.,.2,.5)*t+vec3(.0,.3,.6)));
    vec3 srch=vec3(.05,.55,1.)+vec3(.0,.45,.9)*cos(6.28*(vec3(.5,.8,1.)*t+vec3(.0,.33,.66)));
    return clamp(mix(idl,srch,f),0.,1.);
  }
  if(s<2.5){
    float f=s-1.5;
    vec3 srch=vec3(.05,.55,1.)+vec3(.0,.45,.9)*cos(6.28*(vec3(.5,.8,1.)*t+vec3(.0,.33,.66)));
    vec3 rply=vec3(.1,.9,.55)+vec3(.0,.5,.35)*cos(6.28*(vec3(.4,.9,.6)*t+vec3(.0,.33,.66)));
    return clamp(mix(srch,rply,f),0.,1.);
  }
  float f=s-2.5;
  vec3 rply=vec3(.1,.9,.55)+vec3(.0,.5,.35)*cos(6.28*(vec3(.4,.9,.6)*t+vec3(.0,.33,.66)));
  vec3 thnk=vec3(1.,.7,.1)+vec3(.6,.3,.0)*cos(6.28*(vec3(.9,.6,.2)*t+vec3(.0,.33,.66)));
  return clamp(mix(rply,thnk,f),0.,1.);
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/min(R.x,R.y);
  float camSpd=.18+S*.08;
  vec3 ro=vec3(0.,0.,1.55);
  ro=rotY(T*camSpd)*ro;
  ro=rotX(sin(T*.14)*.25)*ro;
  vec3 fwd=normalize(-ro),rgt=normalize(cross(vec3(0,1,0),fwd)),upv=cross(fwd,rgt);
  vec3 rd=normalize(fwd+uv.x*rgt+uv.y*upv);
  float spd=1.0+S*1.2,amp=.20+S*.07;
  float d=0.,dHit=-1.;
  vec3 rp=ro;
  for(int i=0;i<160;i++){
    rp=ro+rd*d;
    float b=sdf(rp,spd,amp);
    if(b<.0015){dHit=d;break;}
    if(d>4.)break;
    d+=max(b*.55,.004);
  }
  vec3 col=vec3(0.);
  float gd=0.;
  for(int i=0;i<100;i++){
    vec3 gp=ro+rd*gd;
    float gb=sdf(gp,spd,amp);
    float gs=exp(-abs(gb)*22.);
    float nc=fbm(normalize(gp)*2.+vec3(T*.06),4,spd);
    col+=getColor(nc+float(i)/100.+T*.04,S)*gs*.035*(1.+S*.3);
    if(gd>3.)break;
    gd+=max(abs(gb)*.5,.006);
  }
  if(dHit>0.){
    vec3 n=calcNorm(rp,spd,amp),vd=normalize(ro-rp);
    vec3 l1=normalize(vec3(1.4,2.0,1.2)),l2=normalize(vec3(-1.5,-0.8,1.8)),l3=normalize(vec3(.0,-2.,-1.));
    float d1=max(dot(n,l1),0.),d2=max(dot(n,l2),0.)*.5,d3=max(dot(n,l3),0.)*.3;
    float diff=d1+d2+d3;
    float sp1=pow(max(dot(reflect(-l1,n),vd),0.),90.),sp2=pow(max(dot(reflect(-l2,n),vd),0.),45.);
    float rim=pow(1.-clamp(dot(n,vd),0.,1.),4.);
    float nc=fbm(rp*2.8+vec3(T*.08),6,spd),nc2=fbm(rp*5.5+vec3(T*.12),4,spd*1.2);
    vec3 base=getColor(nc+T*.04,S),deep=getColor(nc2+.5+T*.04,S),rimC=getColor(nc+.4+T*.04,S);
    float trans=pow(max(dot(-rd,n),0.),1.8)*.6;
    vec3 core=mix(base,vec3(1.,1.,1.),trans);
    col+=core*(diff*.65+.18);
    col+=vec3(1.)*sp1*.8;
    col+=deep*sp2*.35;
    col+=rimC*rim*.9;
    if(S>0.8&&S<1.2){float scan=sin(rp.y*22.+T*9.)*.5+.5;col+=vec3(.1,.5,1.)*scan*.18;}
    if(S>1.8&&S<2.2){float wave=sin(length(rp)*16.-T*8.)*.5+.5;col+=vec3(.05,.9,.4)*wave*.22;}
    if(S>2.8){float sp=sin(atan(rp.z,rp.x)*6.+length(rp)*12.-T*7.)*.5+.5;col+=vec3(.95,.65,.1)*sp*.18;}
    float ao=fbm(rp*3.5,1,1.)*.35+.65;
    col*=ao;
  }
  float v=1.-smoothstep(.35,.85,length(uv*.78));
  col*=v;
  col=col/(col+.6);
  col=pow(max(col,0.),vec3(.72));
  gl_FragColor=vec4(col,1.);
}`;

const STATE_INFO = [
    { label: "● ONLINE — READY ●", color: "rgba(200,130,255,0.75)" },
    { label: "● SEARCHING THE WEB ●", color: "rgba(80,180,255,0.85)" },
    { label: "● SPEAKING RESPONSE ●", color: "rgba(80,255,160,0.85)" },
    { label: "● PROCESSING QUERY ●", color: "rgba(255,195,60,0.85)" },
];

const BAR_COUNT = 20;

function mkShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error(gl.getShaderInfoLog(s));
    return s;
}

export default function FridayAssistant() {
    const canvasRef = useRef(null);
    const glRef = useRef(null);
    const progRef = useRef(null);
    const uRef = useRef({});
    const rafRef = useRef(null);
    const t0Ref = useRef(Date.now());

    // State machine: 0=standby 1=search 2=reply 3=thinking
    const targetStateRef = useRef(0);
    const smoothStateRef = useRef(0);
    const audioAmpRef = useRef(0);
    const smoothAmpRef = useRef(0);

    const isSearchingRef = useRef(false);
    const isThinkingRef = useRef(false);
    const isMicActiveRef = useRef(false);
    const isSpeakingRef = useRef(false);

    const audioCtxRef = useRef(null);
    const micAnalyserRef = useRef(null);
    const spkAnalyserRef = useRef(null);
    const micStreamRef = useRef(null);
    const micDataRef = useRef(new Uint8Array(256));
    const spkDataRef = useRef(new Uint8Array(256));

    const meterRef = useRef(null);
    const [displayState, setDisplayState] = useState(0);
    const [micGranted, setMicGranted] = useState(false);
    const [suggestions, setSuggestions] = useState('SYSTEM INITIALIZED. STANDBY FOR QUERY ANALYTICAL INPUT.');

    const micGrantedRef = useRef(false);
    micGrantedRef.current = micGranted;

    // ── resolve priority: reply > search > thinking > standby ──
    const resolveState = useCallback(() => {
        if (isSpeakingRef.current) return 2;
        if (isSearchingRef.current) return 1;
        if (isThinkingRef.current || isMicActiveRef.current) return 3;
        return 0;
    }, []);

    // ── Microphone setup ──
    const startMic = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStreamRef.current = stream;
            if (!audioCtxRef.current) {
                audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') {
                await ctx.resume().catch(() => {});
            }
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.75;
            src.connect(analyser);
            micAnalyserRef.current = analyser;
            micDataRef.current = new Uint8Array(analyser.frequencyBinCount);
            setMicGranted(true);
            window.dispatchEvent(new CustomEvent('friday-mic-change', { detail: { active: true } }));
        } catch (err) {
            console.error('Microphone setup failed:', err);
            setMicGranted(false);
            window.dispatchEvent(new CustomEvent('friday-mic-change', { detail: { active: false } }));
        }
    }, []);

    const stopMic = useCallback(() => {
        micStreamRef.current?.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
        micAnalyserRef.current = null;
        setMicGranted(false);
        window.dispatchEvent(new CustomEvent('friday-mic-change', { detail: { active: false } }));
    }, []);

    // ── external API ──
    useEffect(() => {
        window.FRIDAY = {
            setState: (s) => {
                targetStateRef.current = s;
            },
            setSearching: (v) => {
                isSearchingRef.current = !!v;
                targetStateRef.current = resolveState();
            },
            setThinking: (v) => {
                isThinkingRef.current = !!v;
                targetStateRef.current = resolveState();
            },
            setSpeaking: (v) => {
                isSpeakingRef.current = !!v;
                targetStateRef.current = resolveState();
            },
            connectAudio: (source) => {
                try {
                    if (!audioCtxRef.current) {
                        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    const ctx = audioCtxRef.current;
                    if (ctx.state === 'suspended') {
                        ctx.resume().catch(() => {});
                    }
                    let node;
                    if (source instanceof MediaStream) {
                        node = ctx.createMediaStreamSource(source);
                    } else if (source instanceof HTMLMediaElement) {
                        node = ctx.createMediaElementSource(source);
                    } else if (source && source.connect) {
                        node = source;
                    }
                    if (!node) return;
                    const analyser = ctx.createAnalyser();
                    analyser.fftSize = 256;
                    analyser.smoothingTimeConstant = 0.7;
                    node.connect(analyser);
                    analyser.connect(ctx.destination);
                    spkAnalyserRef.current = analyser;
                    spkDataRef.current = new Uint8Array(analyser.frequencyBinCount);
                } catch (err) {
                    console.warn('[BLOB-AUDIO] Failed to connect audio node:', err);
                }
            },
            startMic: () => {
                startMic();
            },
            stopMic: () => {
                stopMic();
            },
            isMicGranted: () => {
                return micGrantedRef.current;
            },
            getAudioAmp: () => {
                return audioAmpRef.current;
            }
        };
        return () => { delete window.FRIDAY; };
    }, [resolveState, startMic, stopMic]);


    // ── Suggestions API ──
    useEffect(() => {
        window.FRIDAY_SUGGESTIONS = {
            show: (text) => {
                setSuggestions(text);
            }
        };
        return () => {
            delete window.FRIDAY_SUGGESTIONS;
        };
    }, []);

    // ── WebGL init ──
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const DPR = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = 420 * DPR;
        canvas.height = 420 * DPR;
        const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
        if (!gl) return;
        glRef.current = gl;

        const prog = gl.createProgram();
        gl.attachShader(prog, mkShader(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, mkShader(gl, gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        gl.useProgram(prog);
        progRef.current = prog;

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const al = gl.getAttribLocation(prog, "a");
        gl.enableVertexAttribArray(al);
        gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);

        uRef.current = {
            R: gl.getUniformLocation(prog, "R"),
            T: gl.getUniformLocation(prog, "T"),
            S: gl.getUniformLocation(prog, "S"),
            AMP: gl.getUniformLocation(prog, "AMP"),
        };
    }, []);

    // ── Main render + audio poll loop ──
    useEffect(() => {
        let frameState = 0;

        const loop = () => {
            rafRef.current = requestAnimationFrame(loop);
            const t = (Date.now() - t0Ref.current) / 1000;

            let micAmp = 0;
            if (micAnalyserRef.current) {
                micAnalyserRef.current.getByteFrequencyData(micDataRef.current);
                const avg = micDataRef.current.reduce((s, v) => s + v, 0) / micDataRef.current.length;
                micAmp = avg / 255;
                const wasActive = isMicActiveRef.current;
                isMicActiveRef.current = micAmp > 0.04;
                if (isMicActiveRef.current !== wasActive)
                    targetStateRef.current = resolveState();
            }

            let spkAmp = 0;
            if (spkAnalyserRef.current) {
                spkAnalyserRef.current.getByteFrequencyData(spkDataRef.current);
                const avg = spkDataRef.current.reduce((s, v) => s + v, 0) / spkDataRef.current.length;
                spkAmp = avg / 255;
                const wasSpeaking = isSpeakingRef.current;
                isSpeakingRef.current = spkAmp > 0.02;
                if (isSpeakingRef.current !== wasSpeaking)
                    targetStateRef.current = resolveState();
            } else if (isSpeakingRef.current) {
                spkAmp = 0.05 + Math.abs(Math.sin(t * 14)) * 0.14 + Math.random() * 0.04;
            }

            const rawAmp = Math.max(micAmp, spkAmp);
            audioAmpRef.current = rawAmp;
            smoothAmpRef.current += (rawAmp - smoothAmpRef.current) * 0.18;

            smoothStateRef.current += (targetStateRef.current - smoothStateRef.current) * 0.03;
            const ss = smoothStateRef.current;

            const rounded = Math.round(targetStateRef.current);
            if (rounded !== frameState) {
                frameState = rounded;
                setDisplayState(rounded);
            }

            const amp = smoothAmpRef.current;
            if (meterRef.current) {
                const bars = meterRef.current.children;
                for (let i = 0; i < BAR_COUNT && i < bars.length; i++) {
                    let h;
                    const sa = ss;
                    if (sa < 0.5) h = 4 + Math.sin(t * 1.5 + i * .7) * 3 + amp * 18 + Math.random();
                    else if (sa < 1.5) h = 4 + Math.abs(Math.sin(t * 6 + i * .5)) * 18 + amp * 22 + Math.random() * 2;
                    else if (sa < 2.5) h = 3 + Math.abs(Math.sin(t * 4 + i * .4 + Math.sin(t * .7) * 2)) * 16 + amp * 24 + Math.random() * 2;
                    else h = 4 + Math.abs(Math.sin(t * 3 + i * .6)) * 12 + Math.abs(Math.cos(t * 5 + i * .9)) * 8 + amp * 20 + Math.random() * 2;
                    bars[i].style.height = `${Math.max(3, h)}px`;
                }
            }

            const gl = glRef.current;
            const u = uRef.current;
            if (!gl || !u.R) return;
            const canvas = canvasRef.current;
            gl.uniform2f(u.R, canvas.width, canvas.height);
            gl.uniform1f(u.T, t);
            gl.uniform1f(u.S, ss);
            gl.uniform1f(u.AMP, smoothAmpRef.current);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };

        rafRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafRef.current);
    }, [resolveState]);

    // cleanup mic on unmount
    useEffect(() => () => {
        micStreamRef.current?.getTracks().forEach(t => t.stop());
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
            audioCtxRef.current.close().catch(() => {});
        }
    }, []);

    const si = STATE_INFO[displayState] || STATE_INFO[0];

    return (
        <>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600&family=Orbitron:wght@400;500;700&display=swap');
        .friday-root *{margin:0;padding:0;box-sizing:border-box;}
        .friday-root{
          background:#04020a;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          min-height:100vh;font-family:'Rajdhani',sans-serif;overflow:hidden;user-select:none;
        }
        .fri-title{
          font-family:'Orbitron',monospace;font-size:13px;font-weight:500;
          letter-spacing:6px;color:rgba(200,160,255,0.6);margin-bottom:32px;text-transform:uppercase;
        }
        .fri-wrap{position:relative;width:420px;height:420px;}
        .fri-canvas{display:block;width:420px;height:420px;border-radius:50%;will-change:transform;transform:translateZ(0);backface-visibility:hidden;}
        .fri-ring-outer{
          position:absolute;inset:-24px;border-radius:50%;
          border:1px solid rgba(180,100,255,0.15);
          animation:fri-spin 12s linear infinite;pointer-events:none;
          will-change:transform;backface-visibility:hidden;
        }
        .fri-ring-outer::before{
          content:'';position:absolute;top:-2px;left:50%;
          width:4px;height:4px;background:#cc88ff;border-radius:50%;
          box-shadow:0 0 8px 3px #cc88ff;transform:translateX(-50%);
        }
        .fri-ring-mid{
          position:absolute;inset:-14px;border-radius:50%;
          border:1px solid rgba(120,80,255,0.1);
          animation:fri-spin 8s linear infinite reverse;pointer-events:none;
          will-change:transform;backface-visibility:hidden;
        }
        .fri-ring-mid::before{
          content:'';position:absolute;bottom:-2px;left:50%;
          width:3px;height:3px;background:#8866ff;border-radius:50%;
          box-shadow:0 0 6px 2px #8866ff;transform:translateX(-50%);
        }
        @keyframes fri-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        .fri-status{
          margin-top:28px;font-family:'Orbitron',monospace;font-size:11px;
          letter-spacing:4px;text-transform:uppercase;min-height:20px;transition:color .5s;
        }
        .fri-meter{margin-top:14px;display:flex;gap:4px;align-items:flex-end;height:28px;}
        .fri-bar{width:3px;background:rgba(180,100,255,0.5);border-radius:2px;}
        
        /* ── Futuristic Suggestions Terminal ── */
        .suggestion-terminal {
          position: relative;
          margin-top: 24px;
          width: 380px;
          height: 120px;
          background: rgba(4, 10, 8, 0.65);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(180, 100, 255, 0.15);
          border-radius: 4px;
          box-shadow: 0 5px 25px rgba(0, 0, 0, 0.6), inset 0 0 10px rgba(180, 100, 255, 0.02);
          padding: 10px;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          overflow: hidden;
          transition: all 0.3s;
        }
        .suggestion-terminal:hover {
          border-color: rgba(180, 100, 255, 0.35);
          box-shadow: 0 8px 30px rgba(180, 100, 255, 0.08);
        }
        .suggestion-terminal .term-bracket {
          position: absolute;
          width: 6px;
          height: 6px;
          border-color: rgba(180, 100, 255, 0.3);
          border-style: solid;
          pointer-events: none;
        }
        .suggestion-terminal .t-l { top: -1px; left: -1px; border-width: 1px 0 0 1px; }
        .suggestion-terminal .t-r { top: -1px; right: -1px; border-width: 1px 1px 0 0; }
        .suggestion-terminal .b-l { bottom: -1px; left: -1px; border-width: 0 0 1px 1px; }
        .suggestion-terminal .b-r { bottom: -1px; right: -1px; border-width: 0 1px 1px 0; }
        
        .sug-header {
          display: flex;
          align-items: center;
          gap: 6px;
          border-bottom: 1px dashed rgba(180, 100, 255, 0.2);
          padding-bottom: 4px;
          margin-bottom: 6px;
          font-family: 'Orbitron', monospace;
        }
        .sug-dot {
          width: 5px;
          height: 5px;
          background: #cc88ff;
          border-radius: 50%;
          box-shadow: 0 0 6px #cc88ff;
        }
        .sug-label {
          font-size: 8px;
          font-weight: 700;
          color: rgba(226, 232, 240, 0.85);
          letter-spacing: 1.5px;
        }
        .sug-body {
          flex-grow: 1;
          font-family: 'Rajdhani', sans-serif;
          font-size: 11px;
          color: rgba(226, 232, 240, 0.8);
          line-height: 1.4;
          text-align: left;
          overflow-y: auto;
          word-break: break-word;
        }
        .sug-prompt {
          color: #cc88ff;
          font-weight: 700;
          margin-right: 4px;
        }
      `}</style>

            <div className="friday-root">
                <div className="fri-title">F . R . I . D . A . Y</div>

                <div className="fri-wrap">
                    <div className="fri-ring-outer" />
                    <div className="fri-ring-mid" />
                    <canvas ref={canvasRef} className="fri-canvas" />
                </div>

                <div className="fri-status" style={{ color: si.color }}>{si.label}</div>

                <div className="fri-meter" ref={meterRef}>
                    {Array.from({ length: BAR_COUNT }).map((_, i) => (
                        <div key={i} className="fri-bar" style={{ height: '6px' }} />
                    ))}
                </div>

                {/* Suggestions Terminal HUD */}
                <div className="suggestion-terminal">
                    <div className="term-bracket t-l" />
                    <div className="term-bracket t-r" />
                    <div className="term-bracket b-l" />
                    <div className="term-bracket b-r" />
                    <div className="sug-header">
                        <span className="sug-dot" />
                        <span className="sug-label">MY SUGGESTION</span>
                    </div>
                    <div className="sug-body">
                        <span className="sug-prompt">&gt;</span> {suggestions}
                    </div>
                </div>
            </div>
        </>
    );
}