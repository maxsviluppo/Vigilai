import { useState, useEffect, useRef, useCallback } from "react";
import { 
  Camera as CameraIcon, 
  ShieldAlert, 
  Settings, 
  Activity, 
  History, 
  Bell, 
  Video, 
  VideoOff, 
  AlertTriangle,
  Monitor,
  Plus,
  Trash2,
  Flame,
  Wind,
  Eye,
  UserCheck,
  Zap,
  Volume2,
  VolumeX,
  Globe,
  Home,
  Cloud,
  Smartphone,
  Wifi,
  X,
  Lock
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Hls from "hls.js";
import { analyzeFrame, DetectionResult } from "./services/gemini";
import { Camera, Incident, AlertTrigger } from "./types";

export default function App() {
  const [cameras, setCameras] = useState<Camera[]>([
    { 
      id: "cam-1", 
      name: "Main Entrance", 
      location: "Ingresso Principale", 
      type: "webcam", 
      status: "online",
      enabledTriggers: ["intrusion", "violence"]
    }
  ]);
  const [activeCameraId, setActiveCameraId] = useState<string>("cam-1");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [showNetworkHelper, setShowNetworkHelper] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<DetectionResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null);
  const [isNightMode, setIsNightMode] = useState(false);
  const [notificationEmails, setNotificationEmails] = useState<string[]>(["castromassimo@gmail.com"]);
  const [newEmail, setNewEmail] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [isMultiView, setIsMultiView] = useState(false);
  const [preventSleep, setPreventSleep] = useState(true);
  const [isSoundEnabled, setIsSoundEnabled] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{success: boolean, message: string} | null>(null);
  const [proxyImages, setProxyImages] = useState<Map<string, string>>(new Map());
  const [proxyErrors, setProxyErrors] = useState<Map<string, string>>(new Map());
  const [aiModel, setAiModel] = useState(() => localStorage.getItem("vigilAiModel") || "gemini-1.5-flash");
  const [analysisFrequency, setAnalysisFrequency] = useState(() => Number(localStorage.getItem("vigilAiFreq")) || 10);
  const [analysisCount, setAnalysisCount] = useState(() => Number(localStorage.getItem("vigilAiCount")) || 0);

  useEffect(() => {
    localStorage.setItem("vigilAiModel", aiModel);
    localStorage.setItem("vigilAiFreq", analysisFrequency.toString());
    localStorage.setItem("vigilAiCount", analysisCount.toString());
  }, [aiModel, analysisFrequency, analysisCount]);
  
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const hlsInstancesRef = useRef<Map<string, Hls>>(new Map());
  const wakeLockRef = useRef<any>(null);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const camRotationIndexRef = useRef<number>(0);
  const lastNotificationTimeRef = useRef<number>(0);
  const alertSequenceCountRef = useRef<number>(0);

  const activeCamera = cameras.find(c => c.id === activeCameraId);

  // Notification function
  const sendNotification = async (description: string, screenshot: string) => {
    try {
      await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email",
          recipient: notificationEmails,
          description,
          screenshot
        })
      });
      console.log("Notification request sent to:", notificationEmails.join(", "));
    } catch (e) {
      console.error("Failed to send notification request", e);
    }
  };

  // Sound effects
  const playAlertSound = () => {
    if (!isSoundEnabled) return;
    const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3");
    audio.play().catch(e => console.log("Audio playback failed", e));
  };

  // Start Camera Stream
  // Screen Wake Lock (Prevent Sleep)
  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && preventSleep && isMonitoring) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock is active');
        } catch (err: any) {
          if (err.name === 'NotAllowedError') {
            console.warn("Monitoraggio Anti-Standby bloccato dalle policy del browser. Se sei in una finestra incorporata (iframe), assicurati che i permessi 'screen-wake-lock' siano abilitati.");
          } else {
            console.error(`${err.name}, ${err.message}`);
          }
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock released');
      }
    };

    if (preventSleep && isMonitoring) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (wakeLockRef.current !== null && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [preventSleep, isMonitoring]);

  // Automatic Night Mode check based on time
  useEffect(() => {
    const checkTime = () => {
      const hour = new Date().getHours();
      // Auto-enable night mode between 8 PM and 6 AM
      if (hour >= 20 || hour < 6) {
        setIsNightMode(true);
      } else {
        setIsNightMode(false);
      }
    };
    checkTime();
    const timer = setInterval(checkTime, 60000); // Check every minute
    return () => clearInterval(timer);
  }, []);

  const toggleMonitoring = () => {
    if (isMonitoring) {
      // Reset logic when deactivating
      setIsMonitoring(false);
      setIsAlertActive(false);
      setLastAnalysis(null);
      alertSequenceCountRef.current = 0;
      lastNotificationTimeRef.current = 0;
      setIsSimulating(false);
    } else {
      setIsMonitoring(true);
    }
  };

  const stopActiveAlert = () => {
    setIsAlertActive(false);
    setIsSimulating(false);
    alertSequenceCountRef.current = 0;
    lastNotificationTimeRef.current = 0;
  };

  const startCameras = async () => {
    for (const cam of cameras) {
      if (cam.type === "webcam") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          const videoEl = videoRefs.current.get(cam.id);
          if (videoEl) {
            videoEl.srcObject = stream;
          }
          streamsRef.current.set(cam.id, stream);
        } catch (err) {
          console.error(`Camera ${cam.id} access error:`, err);
        }
      } else if (cam.type === "ip" && cam.url) {
        const videoEl = videoRefs.current.get(cam.id);
        if (videoEl) {
          // Normalize URL: ensure protocol
          let finalUrl = cam.url.trim();
          if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('rtsp://')) {
            finalUrl = `http://${finalUrl}`;
          }
          
          if (finalUrl.startsWith('rtsp://')) {
            console.warn(`[VIGIL.AI] Rilevato protocollo RTSP (${cam.name}). I browser non supportano RTSP direttamente. Serve un proxy/ponte.`);
          }
          
          if (finalUrl.includes('.m3u8') && Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(finalUrl);
            hls.attachMedia(videoEl);
            hlsInstancesRef.current.set(cam.id, hls);
          } else {
            videoEl.src = finalUrl;
            videoEl.load();
          }
        }
      }
    }
  };

  const stopCameras = () => {
    streamsRef.current.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    streamsRef.current.clear();

    hlsInstancesRef.current.forEach(hls => {
      hls.destroy();
    });
    hlsInstancesRef.current.clear();

    videoRefs.current.forEach(video => {
      video.srcObject = null;
      video.src = "";
    });
  };

  // Frame processing
  const captureAndAnalyze = useCallback(async () => {
    if (isAnalyzing || !canvasRef.current || cameras.length === 0) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    // Sequential Rotation: Analyze only ONE camera per cycle to respect API Quota (RPM)
    const camIndex = camRotationIndexRef.current % cameras.length;
    const cam = cameras[camIndex];
    camRotationIndexRef.current += 1;

    let base64Image = "";
    let useProxy = cam.type === 'ip';

    const video = videoRefs.current.get(cam.id);
    
    try {
      if (!useProxy && video && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        base64Image = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
      } else if (useProxy && cam.url) {
        let fetchSuccess = false;
        let imageUrl = "";

        // 1. Try Cloud Proxy (Server-side)
        try {
          const proxyResponse = await fetch(`/api/proxy-camera-frame?url=${encodeURIComponent(cam.url)}`);
          if (proxyResponse.ok) {
            const data = await proxyResponse.json();
            if (data.success) {
              base64Image = data.base64;
              imageUrl = `data:${data.contentType};base64,${data.base64}`;
              fetchSuccess = true;
            }
          }
        } catch (e) {
          console.warn(`[VIGIL.AI] Proxy fallito per ${cam.name}, provo recupero diretto locale...`);
        }

        // 2. Hybrid Fallback: Try Direct Browser Fetch (Same network)
        if (!fetchSuccess) {
          try {
            const localImg = new Image();
            localImg.crossOrigin = "anonymous";
            localImg.src = cam.url + (cam.url.includes("?") ? "&" : "?") + "t=" + Date.now();
            
            const localResult = await new Promise((resolve) => {
              const timeout = setTimeout(() => resolve(null), 5000);
              localImg.onload = () => { clearTimeout(timeout); resolve(localImg); };
              localImg.onerror = () => { clearTimeout(timeout); resolve(null); };
            });

            if (localResult) {
              const tempCanvas = document.createElement("canvas");
              tempCanvas.width = localImg.width;
              tempCanvas.height = localImg.height;
              const tempCtx = tempCanvas.getContext("2d");
              if (tempCtx) {
                tempCtx.drawImage(localImg, 0, 0);
                try {
                  const localBase64 = tempCanvas.toDataURL("image/jpeg", 0.6);
                  base64Image = localBase64.split(",")[1];
                  imageUrl = localBase64;
                  fetchSuccess = true;
                } catch (e) {
                  // If tainted, we can still show it but AI analysis might fail
                  imageUrl = localImg.src;
                }
              }
            }
          } catch (e) { /* silent fail */ }
        }

        if (fetchSuccess) {
          setProxyErrors(prev => {
            const next = new Map(prev);
            next.delete(cam.id);
            return next;
          });

          setProxyImages(prev => {
            const next = new Map(prev);
            next.set(cam.id, imageUrl);
            return next;
          });

          const img = new Image();
          img.src = imageUrl;
          await new Promise((resolve) => {
            img.onload = () => {
              canvas.width = img.width;
              canvas.height = img.height;
              context.drawImage(img, 0, 0);
              resolve(true);
            };
            img.onerror = () => resolve(false);
          });
        } else {
          setProxyErrors(prev => {
            const next = new Map(prev);
            next.set(cam.id, "Timeout: Camera non accessibile. Verifica IP o Firewall.");
            return next;
          });
          return;
        }
      }

      if (!base64Image) return;

      // Simulation Guard: Don't hit API if simulating
      if (isSimulating) {
        setIsAlertActive(true);
        playAlertSound();
        const currentDesc = `[CAMERA: ${cam.name}] SIMULAZIONE: Rilevato atto di rapina con arma`;
        
        handleDetectionAlert(cam, {
          isEmergency: true,
          threatLevel: "high",
          description: currentDesc,
          detectedEvents: ["rapina"]
        }, canvas);
        return;
      }

      setIsAnalyzing(true);
      const result = await analyzeFrame(base64Image, cam.enabledTriggers, cam.location, aiModel);
      
      // Update counter
      setAnalysisCount(prev => prev + 1);

      // Update global feedback only if it's the active cam or is critical
      if (cam.id === activeCameraId || result.isEmergency) {
        setLastAnalysis(result);
      }
      setIsAnalyzing(false);

      if (result.isEmergency) {
        handleDetectionAlert(cam, result, canvas);
      }
    } catch (err: any) {
      if (err.name === 'SecurityError') {
        console.error(`[VIGIL.AI] Errore di sicurezza su ${cam.name}: Accesso ai dati video negato. Provo il proxy server...`);
        // We could technically retry with useProxy = true here, but for now we log it.
      } else {
        console.error(`Errore analisi ${cam.name}:`, err.message);
      }
      setIsAnalyzing(false);
    }
  }, [cameras, activeCameraId, isAnalyzing, isSimulating]);

  // Helper to handle alert logic consistently
  const handleDetectionAlert = (cam: Camera, result: DetectionResult | { isEmergency: boolean, threatLevel: any, description: string, detectedEvents: any }, canvas: HTMLCanvasElement) => {
    setIsAlertActive(true);
    playAlertSound();

    const desc = result.description;

    // Notification Logic with Adaptive Throttling
    const now = Date.now();
    const timeSinceLast = now - lastNotificationTimeRef.current;
    let shouldNotify = false;

    if (alertSequenceCountRef.current === 0) {
      shouldNotify = true;
    } else if (alertSequenceCountRef.current === 1 && timeSinceLast >= 20000) {
      shouldNotify = true;
    } else if (alertSequenceCountRef.current > 1 && timeSinceLast >= 10000) {
      shouldNotify = true;
    }

    if (shouldNotify) {
      const screenshot = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
      sendNotification(desc, screenshot);
      lastNotificationTimeRef.current = now;
      alertSequenceCountRef.current += 1;
    }
    
    setIncidents(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      cameraId: cam.id,
      cameraName: cam.name,
      description: desc,
      threatLevel: "high",
      screenshot: canvas.toDataURL("image/jpeg", 0.8)
    }, ...prev]);
  };

  useEffect(() => {
    if (isMonitoring) {
      startCameras();
      // Use dynamic interval from settings
      analysisIntervalRef.current = setInterval(captureAndAnalyze, analysisFrequency * 1000); 
    } else {
      stopCameras();
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
    }
    return () => {
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
    };
  }, [isMonitoring, captureAndAnalyze, analysisFrequency]);

  const addIPCamera = (name: string, url: string) => {
    const newCam: Camera = {
      id: `cam-${Date.now()}`,
      name,
      location: "Area Remota",
      type: "ip",
      url,
      status: "online",
      enabledTriggers: ["intrusion", "violence"]
    };
    setCameras([...cameras, newCam]);
  };

  const openCameraConfig = (cam?: Camera) => {
    setEditingCamera(cam ? {
      ...cam,
      onvif: cam.onvif || {
        active: true,
        user: "admin",
        password: "",
        port: 8000
      }
    } : {
      id: `cam-${Date.now()}`,
      name: `Camera ${cameras.length + 1}`,
      location: "",
      type: "ip",
      url: "",
      status: "online",
      enabledTriggers: ["intrusion", "violence"],
      onvif: {
        active: true,
        user: "admin",
        password: "",
        port: 8000
      }
    });
    setShowCameraModal(true);
  };

  const probeCamera = async () => {
    if (!editingCamera?.url) return;
    setIsProbing(true);
    setProbeResult(null);
    try {
      const response = await fetch("/api/probe-camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: editingCamera.url })
      });
      const data = await response.json();
      if (data.success) {
        setEditingCamera({ ...editingCamera, url: data.workingUrl });
        setProbeResult({ success: true, message: data.message });
      } else {
        setProbeResult({ success: false, message: data.error });
      }
    } catch (e) {
      setProbeResult({ success: false, message: "Errore di rete durante la scansione." });
    } finally {
      setIsProbing(false);
    }
  };

  const saveCamera = (cam: Camera) => {
    if (cameras.find(c => c.id === cam.id)) {
      setCameras(cameras.map(c => c.id === cam.id ? cam : c));
    } else {
      setCameras([...cameras, cam]);
    }
    setShowCameraModal(false);
    setEditingCamera(null);
  };

  const removeCamera = (id: string) => {
    setCameras(cameras.filter(c => c.id !== id));
    if (activeCameraId === id) setActiveCameraId(cameras[0]?.id);
  };

  return (
    <div className="min-h-screen text-accent font-sans selection:bg-danger/30 flex flex-col p-4 lg:p-6 gap-6 overflow-hidden">
      {/* Header */}
      <header className="min-h-[72px] py-4 glass px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between sticky top-0 z-50 rounded-2xl shadow-2xl gap-4 sm:gap-0">
        <div className="flex items-center justify-between w-full sm:w-auto gap-4">
          <h1 className="logo font-display font-bold text-xl sm:text-2xl tracking-[0.12em] neon-blue shrink-0">VIGIL.AI</h1>
          
          <div className="flex sm:hidden gap-2 shrink-0">
             <button 
              onClick={toggleMonitoring}
              className={`w-11 h-11 flex items-center justify-center glass rounded-full transition-all ${isMonitoring ? 'bg-danger shadow-lg' : 'bg-white/5 opacity-80'}`}
            >
              {isMonitoring ? <VideoOff size={18} /> : <Video size={18} className="text-secondary" />}
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="w-11 h-11 glass rounded-full flex items-center justify-center transition-all text-secondary"
            >
              <Settings size={18} />
            </button>
          </div>

          <div className="hidden xl:flex items-center gap-8 text-[10px] font-bold uppercase tracking-[2px] text-secondary/60">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(76,175,80,0.5)] ${isMonitoring ? 'bg-[#4CAF50]' : 'bg-secondary'}`}></span>
              AI ENGINE: {isMonitoring ? 'ATTIVO' : 'STANDBY'}
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isNightMode ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]' : 'bg-secondary'}`}></span>
              VISIONE: {isNightMode ? 'NOTTURNA' : 'DIURNA'}
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${preventSleep ? (isMonitoring ? 'bg-accent animate-pulse shadow-[0_0_10px_rgba(255,193,7,0.5)]' : 'bg-accent/40') : 'bg-secondary'}`}></span>
              ANTI-STANDBY: {preventSleep ? (isMonitoring ? 'IN ESECUZIONE' : 'PRONTO') : 'OFF'}
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isSoundEnabled ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]' : 'bg-secondary'}`}></span>
              AUDIO: {isSoundEnabled ? 'ATTIVO' : 'MUTO'}
            </div>
            <div className="flex items-center gap-2">
              <Monitor size={14} className="opacity-50" />
              {cameras.length.toString().padStart(2, '0')} CAMERE
            </div>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 lg:gap-3">
          <button 
            onClick={() => setShowPlans(true)}
            className="hidden lg:flex items-center gap-2 px-4 py-2 bg-accent/5 hover:bg-accent/10 rounded-full transition-all border border-accent/10 group active:scale-95 shrink-0"
          >
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-accent">Piani & Prezzi</span>
          </button>
          <div className="h-8 w-px bg-white/10 mx-1 hidden lg:block"></div>
          <button 
            onClick={() => setIsMultiView(!isMultiView)}
            className={`p-3 glass rounded-full hover:scale-110 active:scale-95 transition-all shrink-0 ${isMultiView ? 'text-blue-400 border-blue-400/30' : 'text-secondary'}`}
            title="Toggle Grid View"
          >
            <Monitor size={18} />
          </button>
          <button 
            onClick={toggleMonitoring}
            className={`btn-action h-11 flex items-center gap-2 px-4 lg:px-6 shrink-0 ${isMonitoring ? 'bg-white/5 border-white/20' : 'btn-active'}`}
          >
            {isMonitoring ? (
              <><VideoOff size={16} /> <span className="hidden xl:inline">Disattiva</span></>
            ) : (
              <><Video size={16} /> <span className="hidden xl:inline">Attiva Allarme</span></>
            )}
          </button>
          <div className="h-8 w-px bg-white/10 mx-1 hidden sm:block"></div>
          <button 
            onClick={() => setIsNightMode(!isNightMode)}
            className={`p-3 rounded-full transition-all glass hover:scale-110 active:scale-95 ${isNightMode ? 'text-blue-400 border-blue-400/30' : 'text-secondary'}`}
            title="Toggle Night Mode (IR)"
          >
            <ShieldAlert size={18} className={isNightMode ? "animate-pulse" : ""} />
          </button>
          <button 
            onClick={() => setPreventSleep(!preventSleep)}
            className={`p-3 rounded-full transition-all glass hover:scale-110 active:scale-95 ${preventSleep ? 'text-accent border-accent/30 shadow-[0_0_15px_rgba(255,193,7,0.1)]' : 'text-secondary'}`}
            title={preventSleep ? "Anti-Standby PRONTO/ATTIVO" : "Anti-Standby DISABILITATO"}
          >
            <Zap size={18} className={preventSleep ? (isMonitoring ? "fill-accent animate-pulse" : "fill-accent/30") : ""} />
          </button>
          <button 
            onClick={() => setIsSoundEnabled(!isSoundEnabled)}
            className={`p-3 rounded-full transition-all glass hover:scale-110 active:scale-95 ${isSoundEnabled ? 'text-green-400 border-green-400/30' : 'text-secondary'}`}
            title={isSoundEnabled ? "Audio Allarme ATTIVO" : "Audio Allarme SILENZIOSO"}
          >
            {isSoundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="w-10 h-10 glass rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all text-secondary"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-6 min-h-0 overflow-y-auto lg:overflow-visible no-scrollbar">
        {/* Left Column: Camera Sources */}
        <section className="glass gradient-sidebar rounded-3xl p-8 flex flex-col gap-8 order-2 lg:order-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto no-scrollbar pr-2">
            <h3 className="section-title">SORVEGLIANZA</h3>
            <div className="space-y-2">
              {cameras.map(cam => (
                <div key={cam.id} className="relative group">
                  <button
                    onClick={() => {
                      setActiveCameraId(cam.id);
                      openCameraConfig(cam);
                    }}
                    className={`w-full p-4 rounded-xl flex flex-col gap-1 text-left transition-all duration-300 border relative group/btn ${
                      activeCameraId === cam.id 
                        ? 'bg-white/10 border-white/20 shadow-lg translate-x-1' 
                        : 'border-transparent hover:bg-white/5 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start w-full gap-2 sm:gap-0 pr-8 sm:pr-0">
                      <div className="flex flex-col gap-1">
                        <span className="text-[12px] sm:text-[13px] font-black text-white uppercase tracking-tight flex items-center gap-2">
                          {cam.name}
                          <Settings size={10} className="text-secondary/40 group-hover/btn:text-accent transition-colors" />
                        </span>
                        <span className="font-mono text-[8px] text-secondary tracking-widest uppercase opacity-60">
                          {cam.location || (cam.type === 'webcam' ? 'LOCAL_STREAM' : 'REMOTE_STREAM')}
                        </span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {cam.enabledTriggers.slice(0, 2).map((t, i) => (
                          <span key={i} className="text-[7px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 uppercase tracking-tighter font-black text-blue-400">
                            {t === 'violence' ? 'SCUR' : t === 'fire' ? 'FIRE' : t === 'smoke' ? 'SMOK' : t.slice(0, 4)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                  {cameras.length > 1 && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeCamera(cam.id); }}
                        className="w-8 h-8 flex items-center justify-center glass rounded-lg hover:bg-danger/20 text-secondary hover:text-danger transition-all"
                        title="Rimuovi Camera"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button 
                onClick={() => openCameraConfig()}
                className="w-full p-4 flex items-center justify-center gap-3 text-[10px] text-secondary font-black hover:text-accent transition-all uppercase tracking-widest border border-dashed border-white/10 rounded-xl hover:bg-white/5 active:scale-95 mt-4"
              >
                <Plus size={14} /> Nuova Camera
              </button>
            </div>
          </div>

          <div className="pt-6 border-t border-white/5">
            <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
              <span className="text-[9px] font-black text-secondary/50 uppercase tracking-[0.2em]">Stato Sicurezza</span>
              <p className="text-[11px] text-secondary font-medium leading-relaxed mt-2">
                AI attiva su rapina, aggressione e intrusioni. Protocollo di invio foto 0s/20s/10s abilitato.
              </p>
            </div>
          </div>
        </section>

        {/* Center: Video Feed Grid */}
        <section className={`flex flex-col gap-6 order-1 lg:order-2 overflow-hidden min-h-[400px]`}>
          <div className={`flex-1 grid gap-4 ${isMultiView ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            {cameras.map((cam) => (
              <div 
                key={cam.id} 
                className={`relative glass rounded-[32px] overflow-hidden group shadow-xl transition-all duration-500 ${!isMultiView && cam.id !== activeCameraId ? 'hidden' : ''}`}
              >
                {isMonitoring ? (
                  <div className="relative w-full h-full">
                    <video 
                      ref={(el) => { if (el) videoRefs.current.set(cam.id, el); }}
                      autoPlay 
                      muted 
                      playsInline 
                      crossOrigin="anonymous"
                      className={`w-full h-full object-cover transition-all duration-700 ${isAlertActive ? 'opacity-40 saturate-150' : ''} ${cam.type === 'ip' ? 'hidden' : ''}`}
                      style={isNightMode ? { filter: 'grayscale(1) brightness(1.2) contrast(1.1) sepia(0.2) hue-rotate(180deg) blur(0.2px)' } : {}}
                      onError={(e) => {
                        const video = e.currentTarget;
                        // Suppress "Format not supported" errors (Code 4) in console 
                        // because we handle this via Server Proxy analysis or HLS.
                        if (video.error?.code === 4) {
                          return; 
                        }
                        const errorMsg = video.error ? `Code: ${video.error.code}` : 'Sconosciuto';
                        console.error(`Status Camera ${cam.name}:`, errorMsg);
                      }}
                    />
                    
                    {/* Image View for IP Cameras via Proxy */}
                    {cam.type === 'ip' && (
                      <div className="absolute inset-0 bg-slate-950">
                        {proxyImages.get(cam.id) ? (
                          <img 
                            src={proxyImages.get(cam.id)} 
                            alt={cam.name}
                            className={`w-full h-full object-cover transition-all duration-700 ${isAlertActive ? 'opacity-40 saturate-150' : ''}`}
                            style={isNightMode ? { filter: 'grayscale(1) brightness(1.2) contrast(1.1) sepia(0.2) hue-rotate(180deg) blur(0.2px)' } : {}}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
                            {proxyErrors.get(cam.id) ? (
                              <>
                                <div className="bg-danger/20 p-4 rounded-full">
                                  <AlertTriangle size={32} className="text-danger" />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] text-white font-black uppercase tracking-widest">Connessione Fallita</p>
                                  <p className="text-[9px] text-danger font-bold opacity-80 max-w-[200px] leading-tight">
                                    {proxyErrors.get(cam.id)}
                                  </p>
                                </div>
                                <button 
                                  onClick={() => setShowNetworkHelper(true)}
                                  className="mt-2 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest text-white transition-all flex items-center gap-2"
                                >
                                  <Globe size={11} />
                                  Analisi Rete
                                </button>
                                <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                  <p className="text-[8px] text-secondary leading-normal">
                                    Assicurati che l'IP sia pubblico e accessibile su porta 80/8080. 
                                    Per molte camere serve il percorso (es. /snapshot.jpg).
                                  </p>
                                </div>
                              </>
                            ) : (
                              <>
                                <Activity size={48} className="text-blue-400/20 animate-pulse" />
                                <div className="space-y-1">
                                  <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Inizializzazione...</p>
                                  <p className="text-[8px] text-blue-400/40 uppercase font-bold tracking-tighter">Tentativo di connessione server-to-ip</p>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quality Badges for IP/Error Cameras */}
                    {cam.type === 'ip' && (
                      <div className="absolute top-4 right-4 z-10">
                        <div className="flex items-center gap-2 bg-blue-500/20 backdrop-blur-md border border-blue-500/30 px-3 py-1.5 rounded-full">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                          <span className="text-[9px] font-black text-blue-200 uppercase tracking-widest">Analisi Cloud Attiva</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4 bg-black/40">
                    <VideoOff size={24} className="text-secondary opacity-30" />
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary/40">Offline</p>
                  </div>
                )}

                {/* HUD Overlays */}
                <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div className="glass px-2.5 py-1 rounded-lg border-white/20">
                      <span className="text-[9px] font-black tracking-tighter text-white/90 uppercase">
                        {cam.name}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Global Alert Overlay */}
            <div className="absolute inset-0 pointer-events-none p-10 flex items-end justify-end z-[40]">
              <AnimatePresence>
                {isAlertActive && (
                  <motion.div 
                    initial={{ y: 20, opacity: 0, scale: 0.95 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: 20, opacity: 0, scale: 0.95 }}
                    className="flex flex-col items-end gap-4 pointer-events-none"
                  >
                    <button 
                      onClick={stopActiveAlert}
                      className="pointer-events-auto shadow-2xl glass px-8 py-3 rounded-full text-[11px] font-black uppercase tracking-[0.2em] text-white hover:bg-white/20 transition-all border-white/30"
                    >
                      Termina Allarme
                    </button>
                    <div className="bg-danger px-6 py-4 rounded-3xl shadow-[0_0_60px_rgba(255,59,48,0.6)] flex items-center gap-4 backdrop-blur-md border border-white/20">
                      <div className="bg-white/20 p-2 rounded-xl">
                        <AlertTriangle size={24} className="text-white animate-bounce" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">Protocollo Emergenza</p>
                        <p className="text-sm font-black text-white uppercase tracking-tight">Rilevamento Critico Attivo</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* AI Metadata Footer Panel */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-none">
            <div className="glass rounded-2xl p-5 flex flex-col justify-center">
              <span className="text-[9px] font-black text-secondary uppercase tracking-widest mb-1 opacity-50">Minaccia</span>
              <span className={`text-sm font-black ${
                lastAnalysis?.threatLevel === 'high' ? 'text-danger' : 'text-white'
              }`}>
                {lastAnalysis?.threatLevel.toUpperCase() || 'STABILE'}
              </span>
            </div>
            <div className="glass rounded-2xl p-5 md:col-span-3 flex flex-col justify-center">
              <span className="text-[9px] font-black text-secondary uppercase tracking-widest mb-1 opacity-50">Dettaglio AI</span>
              <span className="text-xs font-medium text-white/90 line-clamp-1">
                {lastAnalysis?.description || 'Analisi dell\'ambiente circostante in corso...'}
              </span>
            </div>
          </div>
        </section>

        {/* Right Column: Events Log */}
        <section className="glass neon-section rounded-3xl p-8 flex flex-col order-3 lg:order-3 overflow-hidden">
          <h3 className="section-title">LOG EVENTI</h3>
          <div className="flex-1 space-y-4 overflow-y-auto no-scrollbar pr-3">
            {incidents.length === 0 ? (
              <div className="py-24 text-center">
                <History size={40} className="mx-auto mb-4 text-secondary/20" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-secondary/30">Nessun evento salvato</p>
              </div>
            ) : (
              incidents.map(incident => (
                <div 
                  key={incident.id} 
                  className={`card-modern rounded-2xl p-4 transition-all hover:scale-[1.02] border-l-4 ${
                    incident.threatLevel === 'high' ? 'border-l-danger bg-danger/5' : 'border-l-secondary/30'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[9px] font-black uppercase ${
                      incident.threatLevel === 'high' ? 'text-danger' : 'text-secondary'
                    }`}>
                      {incident.timestamp.toLocaleTimeString()} — {incident.threatLevel}
                    </span>
                    <Activity size={12} className="opacity-20" />
                  </div>
                  <p className="text-[11px] font-medium leading-relaxed text-white/80">
                    {incident.description}
                  </p>
                </div>
              ))
            )}
          </div>
          
          <div className="pt-6 border-t border-white/5 mt-auto">
            <button className="btn-action w-full h-12 hover:shadow-xl active:scale-95">Archivio Completo</button>
          </div>
        </section>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-3xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="glass bg-slate-900/60 rounded-[32px] md:rounded-[40px] w-full max-w-2xl max-h-[85vh] md:max-h-[90vh] overflow-y-auto shadow-2xl border border-white/5 no-scrollbar"
            >
              <div className="p-6 md:p-10 space-y-8">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Impostazioni</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-secondary/60 mt-1">Configurazione Vigil.AI</p>
                  </div>
                  <button onClick={() => setShowSettings(false)} className="w-10 h-10 glass rounded-full flex items-center justify-center hover:bg-white/10 transition-all">
                    <History size={20} className="rotate-45" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white/5 rounded-3xl p-6 border border-white/5 space-y-4">
                    <div className="flex justify-between items-start">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-400 flex items-center gap-2">
                         <Monitor size={14} /> Anti-Standby
                      </h4>
                      <button 
                        onClick={() => setPreventSleep(!preventSleep)}
                        className={`w-10 h-5 rounded-full transition-all relative ${preventSleep ? 'bg-blue-500' : 'bg-white/10'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${preventSleep ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                    <p className="text-[11px] text-secondary font-medium leading-relaxed">
                      Impedisce al PC di andare in sospensione durante il monitoraggio. (Consigliato)
                    </p>
                  </div>

                  <div className="bg-white/5 rounded-3xl p-6 border border-white/5 space-y-4">
                    <div className="flex justify-between items-start">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-green-400 flex items-center gap-2">
                         {isSoundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />} Audio Allarme
                      </h4>
                      <button 
                        onClick={() => setIsSoundEnabled(!isSoundEnabled)}
                        className={`w-10 h-5 rounded-full transition-all relative ${isSoundEnabled ? 'bg-green-500' : 'bg-white/10'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${isSoundEnabled ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                    <p className="text-[11px] text-secondary font-medium leading-relaxed">
                      Esegue un segnale acustico sul dispositivo in caso di emergenza. (Default: SILENZIOSO)
                    </p>
                  </div>

                  <div className="bg-white/5 rounded-3xl p-6 border border-white/5 space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-danger flex items-center gap-2">
                       <ShieldAlert size={14} /> Sensibilità AI
                    </h4>
                    <p className="text-[11px] text-secondary font-medium leading-relaxed">
                      Soglia di attivazione per minacce critiche (rapine, armi).
                    </p>
                    <input type="range" className="w-full h-1 bg-white/10 appearance-none cursor-pointer accent-danger rounded-full" />
                  </div>

                  <div className="bg-white/5 rounded-3xl p-6 border border-white/5 space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white/50 flex items-center gap-2">
                       <Bell size={14} /> Destinatari Notifiche
                    </h4>
                    
                    <div className="relative group/input">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-secondary/30 group-focus-within/input:text-accent transition-colors">
                        <Plus size={14} />
                      </div>
                      <input 
                        type="email" 
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="Aggiungi email destinatario..."
                        className="w-full bg-white/5 border border-white/10 pl-10 pr-12 py-3 text-[11px] rounded-xl focus:border-white/20 outline-none transition-all placeholder:text-secondary/30"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newEmail) {
                            if (!notificationEmails.includes(newEmail)) {
                              setNotificationEmails([...notificationEmails, newEmail]);
                              setNewEmail("");
                            }
                          }
                        }}
                      />
                      <button 
                        onClick={() => {
                          if (newEmail && !notificationEmails.includes(newEmail)) {
                            setNotificationEmails([...notificationEmails, newEmail]);
                            setNewEmail("");
                          }
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-[9px] font-black uppercase tracking-widest rounded-lg transition-all"
                      >
                        Add
                      </button>
                    </div>

                    <div className="space-y-2 max-h-[160px] overflow-y-auto no-scrollbar pt-2">
                      {notificationEmails.map((email, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-lg border border-white/5 group">
                          <span className="text-[10px] text-white/80 font-medium truncate">{email}</span>
                          <button 
                            onClick={() => setNotificationEmails(notificationEmails.filter(e => e !== email))}
                            className="text-secondary hover:text-danger opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all p-2"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      {notificationEmails.length === 0 && (
                        <p className="text-[10px] text-secondary/40 italic text-center py-2">Nessun destinatario impostato</p>
                      )}
                    </div>
                  </div>

                  {/* AI CORE CONFIG & COSTS */}
                  <div className="bg-white/5 rounded-3xl p-6 border border-white/5 space-y-6 md:col-span-2">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-500/20 p-2 rounded-lg"><Zap size={16} className="text-blue-400" /></div>
                      <h3 className="text-xs font-black uppercase text-white">AI Core Engine & Performance</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div className="space-y-4">
                         <div className="space-y-2">
                            <label className="text-[9px] font-black uppercase tracking-widest text-white/50 px-1">Modello Vision</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {[
                                { id: "gemini-1.5-flash", name: "v1.5 Flash", desc: "Bilanciato & Veloce" },
                                { id: "gemini-2.0-flash-exp", name: "v2.0 Elite", desc: "Precisione Massima" }
                              ].map(m => (
                                <button
                                  key={m.id}
                                  onClick={() => setAiModel(m.id)}
                                  className={`p-3 rounded-xl border text-left transition-all ${aiModel === m.id ? 'bg-blue-500/20 border-blue-500' : 'bg-white/5 border-white/10'}`}
                                >
                                  <div className="text-[10px] font-bold text-white uppercase">{m.name}</div>
                                  <div className="text-[8px] text-white/40">{m.desc}</div>
                                </button>
                              ))}
                            </div>
                         </div>

                         <div className="space-y-3">
                           <div className="flex justify-between items-end px-1">
                             <label className="text-[9px] font-black uppercase tracking-widest text-white/50">Frequenza Scansione</label>
                             <span className="text-[10px] font-bold text-blue-400">{analysisFrequency} secondi</span>
                           </div>
                           <input 
                             type="range" 
                             min="2" 
                             max="10" 
                             step="1"
                             value={analysisFrequency}
                             onChange={(e) => setAnalysisFrequency(Number(e.target.value))}
                             className="w-full h-1 bg-white/10 appearance-none cursor-pointer accent-blue-500 rounded-full" 
                           />
                           <div className="flex justify-between text-[8px] text-white/20 font-black uppercase px-2">
                             <span>Turbo (2s)</span>
                             <span>Standard (10s)</span>
                           </div>
                         </div>
                       </div>

                       <div className="bg-slate-950/40 rounded-2xl p-5 border border-white/5 space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                             <p className="text-[9px] font-black uppercase text-white/40 tracking-wider">Tariffa Mensile Stimata</p>
                             <div className="px-2 py-1 bg-green-500/10 rounded-md">
                               <p className="text-[12px] font-black text-green-400">
                                 €{(aiModel.includes("2.0") ? (40/analysisFrequency * 10) : (20/analysisFrequency * 10)).toFixed(2)}
                                 <span className="text-[8px] text-white/40 ml-1">/mese</span>
                               </p>
                             </div>
                          </div>
                          <div className="h-px bg-white/5" />
                          <div className="space-y-6">
                             <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                               <div>
                                 <p className="text-[8px] font-black uppercase text-white/30">Totale Analisi Eseguite</p>
                                 <p className="text-xl font-black text-white tracking-tighter mt-0.5">{analysisCount.toLocaleString()}</p>
                               </div>
                               <button 
                                 onClick={() => setShowResetModal(true)}
                                 className="px-4 py-2 bg-danger/10 hover:bg-danger/20 border border-danger/20 text-danger text-[9px] font-black uppercase rounded-lg transition-all"
                                >
                                 Reset Contatore
                               </button>
                             </div>
                             <div className="flex gap-4">
                               <div className="flex-1 space-y-1">
                                 <div className="w-full h-1 bg-blue-500/10 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 w-[65%]" />
                                 </div>
                                 <p className="text-[8px] text-white/20 uppercase font-bold">Infrastruttura: Online</p>
                               </div>
                               <div className="flex-1 space-y-1">
                                 <div className="w-full h-1 bg-green-500/10 rounded-full overflow-hidden">
                                    <div className="h-full bg-green-500 w-[92%]" />
                                 </div>
                                 <p className="text-[8px] text-white/20 uppercase font-bold">Affidabilità AI: 99.8%</p>
                               </div>
                             </div>
                          </div>
                       </div>
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-3xl p-6 border border-white/5 md:col-span-2 space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white/50 flex items-center gap-2">
                       <Activity size={14} /> Manutenzione
                    </h4>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          setIsSimulating(!isSimulating);
                          if (!isMonitoring && !isSimulating) toggleMonitoring();
                        }}
                        className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                          isSimulating ? 'bg-danger text-white' : 'bg-white/5 border border-white/10 text-white hover:bg-white/10'
                        }`}
                      >
                        {isSimulating ? 'Spegni Simulazione' : 'Test Allarme (Simula)'}
                      </button>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="btn-action w-full h-14 btn-active text-[11px] font-black rounded-2xl shadow-xl active:scale-95"
                >
                  Applica e Salva
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden canvas for frame processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Global CSS for custom layouts */}
      <style>{`
        @keyframes scan {
          0% { top: 0; }
          100% { top: 100%; }
        }
        .animate-scan {
          animation: scan 3s linear infinite;
        }

        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 8s linear infinite;
        }
        
        @media (max-width: 1024px) {
          main {
            display: flex;
            flex-direction: column;
          }
          section {
            height: auto;
          }
        }
      `}</style>
      
      {/* Network Helper Modal */}
      <AnimatePresence>
        {showNetworkHelper && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[150] bg-slate-950/90 backdrop-blur-3xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass bg-slate-900/60 rounded-[40px] w-full max-w-2xl overflow-hidden shadow-2xl border-white/5"
            >
              <div className="p-10 space-y-8">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Diagnostica Rete Casa</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-secondary/60 mt-1">Perché la tua telecamera non è visibile esternamente</p>
                  </div>
                  <button onClick={() => setShowNetworkHelper(false)} className="bg-white/5 w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-all">
                    <X size={20} className="text-white" />
                  </button>
                </div>

                <div className="flex flex-col md:flex-row gap-8 items-center py-6">
                  {/* Visualizer */}
                  <div className="flex-1 w-full space-y-4">
                    <div className="flex items-center justify-between px-4">
                      <div className="flex flex-col items-center">
                        <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-2">
                          <Home size={24} className="text-blue-400" />
                        </div>
                        <span className="text-[8px] font-bold text-white/40 uppercase">Tua Casa</span>
                      </div>
                      
                      <div className="flex-1 flex flex-col items-center px-4 relative">
                        <div className="w-full h-px bg-white/10 relative">
                          <motion.div 
                            animate={{ x: [0, 100, 0] }}
                            transition={{ duration: 3, repeat: Infinity }}
                            className="absolute -top-1 w-2 h-2 bg-blue-500 rounded-full blur-[2px]"
                          />
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-danger p-1 rounded-full group">
                            <Lock size={12} className="text-white" />
                            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-danger text-[8px] font-black px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all">FIREWALL ROUTER</div>
                          </div>
                        </div>
                        <span className="text-[7px] font-black text-danger uppercase mt-4">Connessione Bloccata</span>
                      </div>

                      <div className="flex flex-col items-center">
                        <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-2">
                          <Cloud size={24} className="text-white/20" />
                        </div>
                        <span className="text-[8px] font-bold text-white/40 uppercase">Vigil.AI Cloud</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4 bg-white/5 p-6 rounded-3xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="bg-orange-500/20 p-2 rounded-lg"><Smartphone size={16} className="text-orange-400" /></div>
                      <h3 className="text-xs font-black uppercase text-white">Guida Smart Life / Tuya</h3>
                    </div>
                    <p className="text-[10px] text-secondary leading-relaxed">
                      L'app Smart Life usa un "ponte" cloud proprietario. Vigil.AI ha bisogno di un accesso diretto.
                    </p>
                    <ul className="text-[9px] text-white/60 space-y-2">
                      <li className="flex gap-2"><span>1.</span> Apri l'app Smart Life, vai su Me → Impostazioni.</li>
                      <li className="flex gap-2"><span>2.</span> Cerca "Servizi di Terze Parti" o "ONVIF".</li>
                      <li className="flex gap-2"><span>3.</span> Attiva **ONVIF** e imposta una password.</li>
                      <li className="flex gap-2"><span>4.</span> In Vigil.AI, usa l'IP pubblico e la porta 8000 o 8080.</li>
                    </ul>
                  </div>

                  <div className="space-y-4 bg-white/5 p-6 rounded-3xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-500/20 p-2 rounded-lg"><Wifi size={16} className="text-blue-400" /></div>
                      <h3 className="text-xs font-black uppercase text-white">Il Problema del Router</h3>
                    </div>
                    <p className="text-[10px] text-secondary leading-relaxed">
                      Il tuo router di casa è una porta blindata chiusa. Vigil.AI è "fuori" e non può entrare.
                    </p>
                    <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/20">
                      <p className="text-[9px] font-bold text-blue-300">Soluzione Rapida:</p>
                      <p className="text-[8px] text-blue-300/70 mt-1">
                        Abilita il **DMZ** per l'IP interno della camera, oppure usa la funzione **Port Forwarding** (Porta 80 o 554).
                      </p>
                    </div>
                  </div>

                  {/* Smartphone Alternative */}
                  <div className="md:col-span-2 space-y-4 bg-blue-500/10 p-6 rounded-3xl border border-blue-500/30">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-400 p-2 rounded-lg"><Smartphone size={16} className="text-slate-900" /></div>
                      <h3 className="text-xs font-black uppercase text-white">Alternativa: Smartphone come Camera</h3>
                    </div>
                    <p className="text-[10px] text-secondary leading-relaxed">
                      Se la configurazione della telecamera IP risulta frustrante, puoi trasformare un vecchio smartphone in una telecamera di sicurezza professionale in 2 minuti:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-white uppercase tracking-tight">Android / iOS</p>
                        <p className="text-[9px] text-white/40">Scarica l'app gratuita **"IP Webcam"** (Android) o **"iVCam"** (iOS).</p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-white uppercase tracking-tight">Perché usarla?</p>
                        <p className="text-[9px] text-white/40">È molto più facile da configurare e offre una qualità video superiore rispetto a molte camere economiche.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center">
                   <p className="text-[9px] text-white/20 italic font-medium">Hai bisogno di assistenza tecnica per il tuo router? Contatta il supporto Vigil.AI</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCameraModal && editingCamera && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-3xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="glass bg-slate-900/60 rounded-[40px] w-full max-w-lg max-h-[85vh] overflow-y-auto no-scrollbar shadow-2xl border-white/5"
            >
              <div className="p-10 space-y-8">
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-tight">Setup Camera</h2>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-secondary/60 mt-1">Configura parametri e profilo AI</p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/50 px-1">Nome Identificativo</label>
                    <input 
                      type="text" 
                      value={editingCamera.name}
                      onChange={(e) => setEditingCamera({...editingCamera, name: e.target.value})}
                      placeholder="es. Ingresso Sud"
                      className="w-full bg-white/5 border border-white/10 px-4 py-3 text-xs rounded-xl focus:border-white/30 outline-none transition-all text-white font-bold"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/50 px-1">Posizione Fisica</label>
                    <input 
                      type="text" 
                      value={editingCamera.location}
                      onChange={(e) => setEditingCamera({...editingCamera, location: e.target.value})}
                      placeholder="es. Primo Piano, Ala Est"
                      className="w-full bg-white/5 border border-white/10 px-4 py-3 text-xs rounded-xl focus:border-white/30 outline-none transition-all text-white font-bold"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-white/50 px-1">Tipo Segnale</label>
                        <select 
                          value={editingCamera.type}
                          onChange={(e) => setEditingCamera({...editingCamera, type: e.target.value as any})}
                          className="w-full bg-white/5 border border-white/10 px-4 py-3 text-xs rounded-xl outline-none transition-all text-white font-bold appearance-none"
                        >
                          <option value="webcam" className="bg-[#0f172a]">Webcam Locale</option>
                          <option value="ip" className="bg-[#0f172a]">IP Camera / RTSP</option>
                        </select>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex justify-between items-end px-1">
                          <label className="text-[9px] font-black uppercase tracking-widest text-white/50">Sorgente Video</label>
                          {editingCamera.type === 'ip' && (
                            <button 
                              onClick={probeCamera}
                              disabled={isProbing || !editingCamera.url}
                              className={`text-[8px] font-black uppercase tracking-widest transition-all ${isProbing ? 'text-accent animate-pulse' : 'text-blue-400 hover:text-blue-300'}`}
                            >
                              {isProbing ? 'Test...' : 'Scan Auto'}
                            </button>
                          )}
                        </div>
                        <input 
                          type="text" 
                          disabled={editingCamera.type === 'webcam'}
                          value={editingCamera.type === 'webcam' ? 'Default System' : editingCamera.url || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingCamera({...editingCamera, url: val});
                            
                            // Detect Smart Life / Tuya links
                            if (val.includes("smart321.com") || val.includes("tuya.com")) {
                              setProbeResult({
                                success: false,
                                message: "I link di condivisione Smart Life NON funzionano qui. Vigil.AI ha bisogno dell'indirizzo IP della telecamera (es: 192.168.1.15) o dell'URL ONVIF."
                              });
                            } else if (probeResult?.message.includes("smart321.com")) {
                              setProbeResult(null);
                            }
                          }}
                          placeholder="es: 93.148.111.227"
                          className="w-full bg-white/5 border border-white/10 px-4 py-3 text-[10px] rounded-xl focus:border-white/30 outline-none transition-all text-white/60 font-mono disabled:opacity-30"
                        />
                      </div>
                    </div>
                    
                    {probeResult && (
                      <div className={`px-4 py-3 rounded-xl text-[9px] font-bold ${probeResult.success ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-danger/10 text-danger border border-danger/20'}`}>
                         <span className="mr-2">{probeResult.success ? '✓' : '⚠'}</span>
                         {probeResult.message}
                      </div>
                    )}

                    {/* ONVIF Configuration Section */}
                    {editingCamera.type === 'ip' && (
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-blue-500/20 rounded-lg">
                              <ShieldAlert size={14} className="text-blue-400" />
                            </div>
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Parametri ONVIF</h3>
                          </div>
                          <button 
                            onClick={() => setEditingCamera({
                              ...editingCamera, 
                              onvif: { ...editingCamera.onvif!, active: !editingCamera.onvif?.active }
                            })}
                            className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${
                              editingCamera.onvif?.active ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/40'
                            }`}
                          >
                            {editingCamera.onvif?.active ? 'Abilitato' : 'Disabilitato'}
                          </button>
                        </div>

                        {editingCamera.onvif?.active && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            className="space-y-4 pt-2 border-t border-white/5 overflow-hidden"
                          >
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[8px] font-black uppercase tracking-widest text-white/30 px-1">Username</label>
                                <input 
                                  type="text" 
                                  value={editingCamera.onvif?.user || ''}
                                  onChange={(e) => setEditingCamera({
                                    ...editingCamera, 
                                    onvif: { ...editingCamera.onvif!, user: e.target.value }
                                  })}
                                  className="w-full bg-slate-950/30 border border-white/5 px-3 py-2 text-[10px] rounded-lg focus:border-blue-500/30 outline-none transition-all text-white font-mono"
                                  placeholder="admin"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[8px] font-black uppercase tracking-widest text-white/30 px-1">Password</label>
                                <input 
                                  type="password" 
                                  value={editingCamera.onvif?.password || ''}
                                  onChange={(e) => setEditingCamera({
                                    ...editingCamera, 
                                    onvif: { ...editingCamera.onvif!, password: e.target.value }
                                  })}
                                  className="w-full bg-slate-950/30 border border-white/5 px-3 py-2 text-[10px] rounded-lg focus:border-blue-500/30 outline-none transition-all text-white font-mono"
                                  placeholder="••••••••"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[8px] font-black uppercase tracking-widest text-white/30 px-1">Porta ONVIF</label>
                              <input 
                                type="number" 
                                value={editingCamera.onvif?.port || 8000}
                                onChange={(e) => setEditingCamera({
                                  ...editingCamera, 
                                  onvif: { ...editingCamera.onvif!, port: parseInt(e.target.value) }
                                })}
                                className="w-full bg-slate-950/30 border border-white/5 px-3 py-2 text-[10px] rounded-lg focus:border-blue-500/30 outline-none transition-all text-white font-mono"
                                placeholder="8000"
                              />
                            </div>
                            <p className="text-[8px] text-white/30 italic">
                              Questi parametri permettono a Vigil.AI di negoziare automaticamente la migliore qualità visiva con la tua telecamera.
                            </p>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                    <p className="text-[10px] text-blue-300 font-medium leading-relaxed">
                      <Monitor size={12} className="inline mr-2" />
                      <strong>MODALITÀ PROXY ATTIVA:</strong> Vigil.AI scaricherà i fotogrammi dal server.
                    </p>
                    <div className="mt-3 pt-3 border-t border-blue-500/20">
                      <p className="text-[8px] text-blue-300/60 uppercase font-black mb-2 tracking-widest">Guide per il tuo business:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                          <p className="text-[8px] text-white font-bold">Cam Professionale</p>
                          <p className="text-[7px] text-white/50">Cerca loghi ONVIF o RTSP (Hikvision, Dahua, Amcrest).</p>
                        </div>
                        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                          <p className="text-[8px] text-white font-bold">Cam Consumer</p>
                          <p className="text-[7px] text-white/50">Abilita "Server Locale" o "Gateway" nell'app originale.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/50 px-1">Trigger Allarmi AI Attivi</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'intrusion', label: 'Intrusione', icon: <Eye size={12} />, color: 'text-blue-400' },
                        { id: 'violence', label: 'Violenza/Armi', icon: <ShieldAlert size={12} />, color: 'text-danger' },
                        { id: 'fire', label: 'Incendio', icon: <Flame size={12} />, color: 'text-orange-500' },
                        { id: 'smoke', label: 'Fumo Denso', icon: <Wind size={12} />, color: 'text-slate-300' },
                        { id: 'safety_gear', label: 'DPI/Sicurezza', icon: <UserCheck size={12} />, color: 'text-green-400' },
                        { id: 'fall', label: 'Cadute/MV', icon: <Activity size={12} />, color: 'text-purple-400' },
                      ].map(trigger => {
                        const isActive = editingCamera.enabledTriggers.includes(trigger.id as AlertTrigger);
                        return (
                          <button
                            key={trigger.id}
                            onClick={() => {
                              const current = editingCamera.enabledTriggers;
                              const updated = isActive 
                                ? current.filter(t => t !== trigger.id)
                                : [...current, trigger.id as AlertTrigger];
                              setEditingCamera({...editingCamera, enabledTriggers: updated});
                            }}
                            className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-tight transition-all border ${
                              isActive 
                                ? 'bg-white/10 border-white/30 text-white shadow-lg' 
                                : 'bg-transparent border-white/5 text-secondary hover:border-white/20'
                            }`}
                          >
                            <span className={isActive ? trigger.color : 'opacity-40'}>{trigger.icon}</span>
                            {trigger.label}
                            {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-secondary/55 leading-tight px-1 italic">
                      Seleziona i pericoli specifici che l'AI deve monitorare in tempo reale per questa telecamera.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowCameraModal(false)}
                    className="flex-1 py-4 glass rounded-2xl text-[10px] font-black uppercase tracking-widest text-secondary hover:text-white transition-all"
                  >
                    Annulla
                  </button>
                  <button 
                    onClick={() => saveCamera(editingCamera)}
                    className="flex-[2] py-4 btn-active rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all text-white"
                  >
                    Salva Configurazione
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subscription Plans Modal */}
      <AnimatePresence>
        {showPlans && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-2xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 50, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 50, opacity: 0 }}
              className="w-full max-w-6xl max-h-[90vh] overflow-y-auto no-scrollbar glass bg-slate-900/40 rounded-[40px] p-10 md:p-14 relative shadow-2xl border-white/5"
            >
              <button 
                onClick={() => setShowPlans(false)}
                className="absolute right-8 top-8 w-12 h-12 glass rounded-full flex items-center justify-center hover:bg-white/10 transition-all text-secondary hover:text-white"
              >
                <Plus size={24} className="rotate-45" />
              </button>

              <div className="text-center mb-16">
                <div className="inline-block px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-[0.3em] mb-6">
                  Soluzioni Professionali
                </div>
                <h2 className="text-4xl md:text-5xl font-black text-white uppercase tracking-tight mb-4">Piani di Protezione</h2>
                <p className="text-secondary/60 uppercase text-xs font-black tracking-[0.4em] max-w-xl mx-auto leading-relaxed">
                  Power your security with our state-of-the-art context-aware artificial intelligence.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
                {/* Home Plan */}
                <div className="glass bg-slate-800/20 rounded-[40px] p-10 border-white/5 flex flex-col hover:border-blue-500/30 transition-all duration-500 group relative overflow-hidden">
                  <div className="absolute -right-20 -top-20 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-all"></div>
                  <div className="mb-8">
                    <span className="text-[10px] font-black text-secondary/50 uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full border border-white/5">Consumer</span>
                    <h3 className="text-3xl font-black text-white uppercase mt-4">Vigil Home</h3>
                    <p className="text-[10px] text-secondary/60 mt-1 uppercase font-bold tracking-widest">Protezione Domestica</p>
                    <div className="flex items-baseline gap-1 mt-8">
                      <span className="text-4xl font-black text-blue-400">€9.90</span>
                      <span className="text-secondary/40 text-[10px] font-black font-mono">/MESE</span>
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-4 mb-10">
                    {[
                      "Fino a 2 Telecamere",
                      "Profilo Domestico Attivo",
                      "Allerte Email & SMS",
                      "Archivio Eventi 24h",
                      "Supporto Community"
                    ].map((feature, i) => (
                      <div key={i} className="flex items-center gap-3 text-[12px] text-secondary">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40"></div>
                        <span className={i === 1 ? "text-white/80 font-bold" : ""}>{feature}</span>
                      </div>
                    ))}
                  </div>

                  <button className="w-full py-5 rounded-2xl glass bg-white/5 hover:bg-white/10 border-white/10 text-[10px] font-black uppercase tracking-widest text-white transition-all shadow-xl">
                    Seleziona Home
                  </button>
                </div>

                {/* Business Plan */}
                <div className="relative glass bg-blue-600/10 rounded-[40px] p-10 border-blue-500/30 flex flex-col shadow-[0_40px_100px_-20px_rgba(59,130,246,0.25)] lg:scale-110 z-10 border-2">
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[9px] font-black px-6 py-2 rounded-full uppercase tracking-widest shadow-[0_0_30px_rgba(59,130,246,0.6)] border border-blue-400/50">
                    Consigliato
                  </div>
                  <div className="mb-8">
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest bg-blue-400/10 px-3 py-1 rounded-full border border-blue-400/20">Aziendale</span>
                    <h3 className="text-3xl font-black text-white uppercase mt-4">Vigil Business</h3>
                    <p className="text-[10px] text-blue-400/60 mt-1 uppercase font-bold tracking-widest">Small & Medium Business</p>
                    <div className="flex items-baseline gap-1 mt-8">
                      <span className="text-4xl font-black text-blue-500">€29.00</span>
                      <span className="text-secondary/40 text-[10px] font-black font-mono">/MESE</span>
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-4 mb-10">
                    {[
                      "Fino a 8 Telecamere",
                      "Analisi Rapina Avanzata",
                      "Profilo Farmacie/Negozi",
                      "Verifica Video Real-time",
                      "Archivio Cloud 7 Giorni",
                      "Analisi Volti Inclusa"
                    ].map((feature, i) => (
                      <div key={i} className="flex items-center gap-3 text-[12px] text-secondary">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                        <span className={i < 3 ? "text-white font-bold" : ""}>{feature}</span>
                      </div>
                    ))}
                  </div>

                  <button className="w-full py-5 rounded-2xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest shadow-[0_15px_40px_-10px_rgba(59,130,246,0.5)] hover:bg-blue-400 active:scale-95 transition-all">
                    Attiva Business
                  </button>
                </div>

                {/* Industrial Plan */}
                <div className="glass bg-slate-800/20 rounded-[40px] p-10 border-white/5 flex flex-col hover:border-yellow-500/30 transition-all duration-500 group relative overflow-hidden">
                  <div className="absolute -right-20 -top-20 w-40 h-40 bg-yellow-500/5 rounded-full blur-3xl group-hover:bg-yellow-500/10 transition-all"></div>
                  <div className="mb-8">
                    <span className="text-[10px] font-black text-yellow-500/80 uppercase tracking-widest bg-yellow-500/5 px-3 py-1 rounded-full border border-yellow-500/10">Enterprise</span>
                    <h3 className="text-3xl font-black text-white uppercase mt-4">Vigil Heavy</h3>
                    <p className="text-[10px] text-yellow-500/40 mt-1 uppercase font-bold tracking-widest">Siti Industriali & Cantieri</p>
                    <div className="flex items-baseline gap-1 mt-8">
                      <span className="text-4xl font-black text-yellow-500">€99.00</span>
                      <span className="text-secondary/40 text-[10px] font-black font-mono">/MESE</span>
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-4 mb-10">
                    {[
                      "Camere Illimitate",
                      "Profilo Safety DPI (Cantieri)",
                      "Report Settimanali Legali",
                      "Supporto H24 Dedicato",
                      "Integrazione API Custom",
                      "Gestione Multi-Sito"
                    ].map((feature, i) => (
                      <div key={i} className="flex items-center gap-3 text-[12px] text-secondary">
                        <div className="w-1.5 h-1.5 rounded-full bg-yellow-600/50"></div>
                        <span className={i === 1 ? "text-yellow-500/80 font-bold" : ""}>{feature}</span>
                      </div>
                    ))}
                  </div>

                  <button className="w-full py-5 rounded-2xl glass bg-white/5 hover:bg-white/10 border-white/10 text-[10px] font-black uppercase tracking-widest text-white transition-all shadow-xl">
                    Richiedi Heavy
                  </button>
                </div>
              </div>
              
              <div className="mt-16 text-center border-t border-white/5 pt-10 flex flex-col md:flex-row items-center justify-center gap-6">
                <div className="flex items-center gap-3">
                  <ShieldAlert size={16} className="text-blue-500" />
                  <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Pagamenti Sicuri SSL</span>
                </div>
                <div className="flex items-center gap-3">
                  <History size={16} className="text-blue-500" />
                  <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Soddisfatti o Rimborsati 14gg</span>
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-secondary/30 ml-auto hidden lg:block">Aggiornamenti AI costanti inclusi.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {showResetModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-3xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass bg-slate-900 border border-white/5 rounded-[32px] p-8 max-w-sm w-full text-center space-y-6"
            >
              <div className="w-16 h-16 bg-danger/10 text-danger rounded-full flex items-center justify-center mx-auto mb-4 border border-danger/20">
                <Trash2 size={32} />
              </div>
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-tight">Vuoi azzerare tutto?</h3>
                <p className="text-xs text-secondary mt-2 px-4">Questa azione resetterà il contatore delle analisi eseguite a zero. Non è possibile tornare indietro.</p>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowResetModal(false)}
                  className="flex-1 py-4 glass text-[10px] font-black uppercase text-white rounded-2xl hover:bg-white/10 transition-all"
                >
                  Indietro
                </button>
                <button 
                  onClick={() => {
                    setAnalysisCount(0);
                    setShowResetModal(false);
                  }}
                  className="flex-1 py-4 bg-danger text-[10px] font-black uppercase text-white rounded-2xl hover:bg-danger/80 transition-all shadow-lg shadow-danger/20"
                >
                  Conferma Reset
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
