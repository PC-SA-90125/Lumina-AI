import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Video, 
  Play, 
  History, 
  Settings, 
  ArrowRight, 
  Loader2, 
  Info,
  ChevronRight,
  Plus,
  Zap,
  Layout,
  Download,
  Share2,
  Scissors,
  Split,
  SquarePlay,
  Trash2,
  Film,
  Layers,
  Clock,
  Wand2,
  Palette,
  Eye,
  Mic,
  Volume2,
  Waves,
  Type,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Move,
  Maximize,
  RotateCcw,
  Key,
  Upload,
  Target,
  Crosshair,
  Pause,
  Filter
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";
import GIF from 'gif.js.optimized';

// AI Studio injection polyfill for local dev/preview
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [vibe, setVibe] = useState('Cinematic');
  const [resolution, setResolution] = useState('4k');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingStill, setIsGeneratingStill] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [requiresKey, setRequiresKey] = useState(false);
  
  // Editor State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [historyState, setHistoryState] = useState({
    index: 0,
    states: [[] as any[]]
  });

  const updateTimeline = useCallback((update: any[] | ((prev: any[]) => any[]), isCommit = true) => {
    setTimeline(prevTimeline => {
      const next = typeof update === 'function' ? update(prevTimeline) : update;
      
      if (isCommit) {
        setHistoryState(prevHistory => {
          const nextIndex = prevHistory.index + 1;
          // Deep copy to prevent reference issues
          const entry = JSON.parse(JSON.stringify(next));
          const nextStates = [...prevHistory.states.slice(0, nextIndex), entry].slice(-50);
          return {
            index: nextStates.length - 1,
            states: nextStates
          };
        });
      }
      return next;
    });
  }, []);

  const [selectedClipIndex, setSelectedClipIndex] = useState<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'transform' | 'effects' | 'voice' | 'music' | 'text'>('transform');
  const [trimRange, setTrimRange] = useState({ start: 0, end: 100 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);

  const isAppProcessing = useMemo(() => {
    return isGenerating || isGeneratingStill || timeline.some(clip => clip.isProcessing);
  }, [isGenerating, isGeneratingStill, timeline]);

  // Voiceover State
  const [voicePrompt, setVoicePrompt] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);

  // Music State
  const [musicPrompt, setMusicPrompt] = useState('');
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);

  // GIF Export State
  const [isExportingGif, setIsExportingGif] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [gifConfig, setGifConfig] = useState({
    resolution: '480p',
    frameRate: 15
  });

  // App Notification State
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const showNotification = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const undo = useCallback(() => {
    setHistoryState(prev => {
      if (prev.index > 0) {
        const nextIndex = prev.index - 1;
        const targetState = prev.states[nextIndex];
        setTimeline(JSON.parse(JSON.stringify(targetState)));
        showNotification("Undo successful");
        return { ...prev, index: nextIndex };
      }
      return prev;
    });
  }, [showNotification]);

  const redo = useCallback(() => {
    setHistoryState(prev => {
      if (prev.index < prev.states.length - 1) {
        const nextIndex = prev.index + 1;
        const targetState = prev.states[nextIndex];
        setTimeline(JSON.parse(JSON.stringify(targetState)));
        showNotification("Redo successful");
        return { ...prev, index: nextIndex };
      }
      return prev;
    });
  }, [showNotification]);

  const interpolateKeyframes = useCallback((keyframes: any[], time: number) => {
    if (!keyframes || keyframes.length === 0) return null;
    
    // Sort keyframes by time
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    
    // Before first keyframe
    if (time <= sorted[0].time) return sorted[0];
    
    // After last keyframe
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1];
    
    // Somewhere in between
    for (let i = 0; i < sorted.length - 1; i++) {
      const k1 = sorted[i];
      const k2 = sorted[i+1];
      
      if (time >= k1.time && time <= k2.time) {
        const progress = (time - k1.time) / (k2.time - k1.time);
        return {
          x: k1.x + (k2.x - k1.x) * progress,
          y: k1.y + (k2.y - k1.y) * progress,
          scale: k1.scale + (k2.scale - k1.scale) * progress,
          rotation: k1.rotation + (k2.rotation - k1.rotation) * progress
        };
      }
    }
    return null;
  }, []);

  const [isRecordKeyframes, setIsRecordKeyframes] = useState(false);

  const addOrUpdateKeyframe = useCallback((clipIndex: number, time: number, data: any) => {
    updateTimeline(prev => {
      const next = [...prev];
      const clip = { ...next[clipIndex] };
      const keyframes = [...(clip.keyframes || [])];
      
      const existingIdx = keyframes.findIndex(k => Math.abs(k.time - time) < 0.05);
      
      if (existingIdx !== -1) {
        keyframes[existingIdx] = { ...keyframes[existingIdx], ...data };
      } else {
        // Create new keyframe with current clip values as base, merged with new data
        const base = interpolateKeyframes(keyframes, time) || {
          x: clip.x || 0,
          y: clip.y || 0,
          scale: clip.scale || 1,
          rotation: clip.rotation || 0
        };
        keyframes.push({ ...base, ...data, time });
      }
      
      clip.keyframes = keyframes.sort((a, b) => a.time - b.time);
      next[clipIndex] = clip;
      return next;
    }, false);
  }, [updateTimeline, interpolateKeyframes]);

  useEffect(() => {
    // Check key requirements on mount
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setRequiresKey(!hasKey);
      }
    };
    checkKey();

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const handleGenerateStill = async () => {
    if (!prompt.trim()) return;

    setIsGeneratingStill(true);
    setProgress(0);
    
    // Quick progress simulation for placeholder generation
    const interval = setInterval(() => {
      setProgress(p => Math.min(p + (Math.random() * 15), 95));
    }, 150);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key missing");

      const ai = new GoogleGenAI({ apiKey });
      const fullPrompt = `${prompt}. ${vibe === 'Cinematic' ? 'Cinematic film still, high-end production, 8k, extremely detailed.' : prompt}`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { text: fullPrompt },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio === '16:9' ? '16:9' : aspectRatio === '9:16' ? '9:16' : '1:1',
          },
        },
      });

      let imageUrl = "";
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (imageUrl) {
        const newClip = { 
          prompt: fullPrompt, 
          url: imageUrl, 
          date: new Date().toISOString(), 
          duration: 6,
          aspectRatio: aspectRatio,
          isStatic: true 
        };
        setHistory(prev => [newClip, ...prev]);
        
        if (isEditorOpen) {
          updateTimeline(prev => [...prev, newClip]);
          showNotification("Placeholder image added to timeline");
        } else {
          setCurrentVideo(imageUrl);
          showNotification("Still image generated!");
        }
      }
    } catch (error) {
      console.error("Still generation failed:", error);
      showNotification("Still generation failed", "error");
    } finally {
      clearInterval(interval);
      setIsGeneratingStill(false);
      setProgress(0);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    if (window.aistudio && await window.aistudio.hasSelectedApiKey() === false) {
      await window.aistudio.openSelectKey();
      // Assume success as per guidelines
    }

    setIsGenerating(true);
    setCurrentVideo(null);
    setProgress(0);

    // Mocking progress for better UX
    const interval = setInterval(() => {
      setProgress(p => {
        if (p < 30) return p + 2;
        if (p < 70) return p + 0.5;
        if (p < 95) return p + 0.2;
        return p;
      });
    }, 500);

    try {
      // Create fresh instance as recommended
      const ai = new GoogleGenAI({ apiKey: (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY });
      
      const fullPrompt = `${vibe} video: ${prompt}`;
      
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: fullPrompt,
        config: {
          numberOfVideos: 1,
          resolution: resolution as any,
          aspectRatio: aspectRatio as any
        }
      });

      // Polling
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = (operation.response as any)?.generatedVideos?.[0]?.video?.uri;
      
      if (downloadLink) {
        const apiKey = (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey },
        });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        setCurrentVideo(url);
        const newClip = { 
          prompt: fullPrompt, 
          url, 
          date: new Date().toISOString(), 
          duration: 6,
          aspectRatio: aspectRatio 
        };
        setHistory(prev => [newClip, ...prev]);
        
        // Auto-add to timeline if editor is open
        if (isEditorOpen) {
          updateTimeline(prev => [...prev, newClip]);
        }
      }
    } catch (error) {
      console.error("Generation failed:", error);
      // Graceful error state would go here
    } finally {
      clearInterval(interval);
      setIsGenerating(false);
      setProgress(100);
    }
  };

  const processAIResponseAudio = useCallback(async (base64Audio: string) => {
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const floatData = new Float32Array(bytes.length / 2);
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    for (let i = 0; i < floatData.length; i++) {
      floatData[i] = int16[i] / 32768;
    }
    
    const audioBuffer = audioContext.createBuffer(1, floatData.length, 24000);
    audioBuffer.copyToChannel(floatData, 0);
    
    const wavBlob = audioBufferToWavBlob(audioBuffer);
    return URL.createObjectURL(wavBlob);
  }, []);

  const handleGenerateVoiceover = async () => {
    if (!voicePrompt.trim() || selectedClipIndex === null) return;

    setIsGeneratingVoice(true);
    try {
      const apiKey = (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: voicePrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const voiceUrl = await processAIResponseAudio(base64Audio);
        const newTimeline = [...timeline];
        newTimeline[selectedClipIndex].voiceover = voiceUrl;
        updateTimeline(newTimeline);
        showNotification("Voiceover generated!");
      }
    } catch (error) {
      console.error("Voiceover generation failed:", error);
      showNotification("Voiceover generation failed", "error");
    } finally {
      setIsGeneratingVoice(false);
    }
  };

  const handleGenerateMusic = async () => {
    if (!musicPrompt.trim() || selectedClipIndex === null) return;

    setIsGeneratingMusic(true);
    try {
      const apiKey = (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-audio-preview",
        contents: [{ parts: [{ text: `Generate a background music loop based on: ${musicPrompt}. Style: Cinematic, ambient, high quality.` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const musicUrl = await processAIResponseAudio(base64Audio);
        const newTimeline = [...timeline];
        newTimeline[selectedClipIndex].music = musicUrl;
        updateTimeline(newTimeline);
        showNotification("Atmospheric music composed!");
      }
    } catch (error) {
      console.error("Music generation failed:", error);
      showNotification("Music generation failed", "error");
    } finally {
      setIsGeneratingMusic(false);
    }
  };

  const audioBufferToWavBlob = (buffer: AudioBuffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    const setUint32 = (data: number) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };

    const setUint16 = (data: number) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit (hardcoded)

    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length

    for(i = 0; i < buffer.numberOfChannels; i++)
      channels.push(buffer.getChannelData(i));

    while(pos < length) {
      for(i = 0; i < numOfChan; i++) {             // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF); // scale to 16-bit signed int
        view.setInt16(pos, sample, true);          // write 16-bit sample
        pos += 2;
      }
      offset++;                                     // next source sample
    }

    return new Blob([bufferArray], {type: "audio/wav"});
  };

  const handleExportGif = async () => {
    if (selectedClipIndex === null || !timeline[selectedClipIndex]) return;
    
    const clip = timeline[selectedClipIndex];
    setIsExportingGif(true);
    setGifProgress(0);

    try {
      const video = document.createElement('video');
      video.src = clip.url;
      video.crossOrigin = 'anonymous';
      video.muted = true;
      
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      const width = gifConfig.resolution === '480p' ? 480 : 240;
      const height = (video.videoHeight / video.videoWidth) * width;
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return;

      const gif = new GIF({
        workers: 4,
        quality: 10,
        width: width,
        height: height,
        workerScript: 'https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.worker.js'
      });

      const fps = gifConfig.frameRate;
      const delay = 1000 / fps;
      const duration = video.duration;
      
      let currentTime = 0;
      
      while (currentTime < duration) {
        video.currentTime = currentTime;
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });
        
        ctx.drawImage(video, 0, 0, width, height);
        
        // Apply filters if any
        if (clip.filter) {
          ctx.save();
          if (clip.filter === 'Noir') ctx.filter = 'grayscale(1) contrast(1.2)';
          else if (clip.filter === 'Gold') ctx.filter = 'sepia(0.5) saturate(1.8) hue-rotate(-10deg)';
          else if (clip.filter === 'Ocean') ctx.filter = 'hue-rotate(180deg) saturate(1.4) brightness(0.9)';
          else if (clip.filter === 'Lush') ctx.filter = 'saturate(2) contrast(1.1)';
          else if (clip.filter === 'Fade') ctx.filter = 'opacity(0.8) contrast(0.8) brightness(1.1)';
          else if (clip.filter === 'Cyber') ctx.filter = 'hue-rotate(280deg) saturate(2) contrast(1.2)';
          ctx.drawImage(canvas, 0, 0);
          ctx.restore();
        }

        gif.addFrame(ctx, { copy: true, delay: delay });
        currentTime += 1 / fps;
        setGifProgress(Math.min((currentTime / duration) * 50, 50));
      }

      gif.on('progress', (p: number) => {
        setGifProgress(50 + (p * 50));
      });

      gif.on('finished', (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `lumina-ai-${Date.now()}.gif`;
        link.click();
        setIsExportingGif(false);
        setGifProgress(100);
      });

      gif.render();
    } catch (error) {
      console.error("GIF export failed:", error);
      setIsExportingGif(false);
    }
  };

  const handleExportProjectGif = async () => {
    if (timeline.length === 0) return;
    
    setIsExportingGif(true);
    setGifProgress(0);

    try {
      const width = gifConfig.resolution === '480p' ? 480 : 240;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const gif = new GIF({
        workers: 4,
        quality: 10,
        workerScript: 'https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.worker.js'
      });

      const fps = gifConfig.frameRate;
      const delay = 1000 / fps;
      
      let totalDuration = timeline.reduce((acc, clip) => acc + (clip.duration || 6), 0);
      let elapsedSeconds = 0;

      for (const clip of timeline) {
        const video = document.createElement('video');
        video.src = clip.url;
        video.crossOrigin = 'anonymous';
        video.muted = true;
        
        await new Promise((resolve) => {
          video.onloadedmetadata = resolve;
        });

        const height = (video.videoHeight / video.videoWidth) * width;
        canvas.width = width;
        canvas.height = height;
        gif.setOptions({ width, height });

        const duration = video.duration;
        let currentTime = 0;
        
        while (currentTime < duration) {
          video.currentTime = currentTime;
          await new Promise((resolve) => {
            video.onseeked = resolve;
          });
          
          ctx.drawImage(video, 0, 0, width, height);
          
          if (clip.filter) {
            ctx.save();
            if (clip.filter === 'Noir') ctx.filter = 'grayscale(1) contrast(1.2)';
            else if (clip.filter === 'Gold') ctx.filter = 'sepia(0.5) saturate(1.8) hue-rotate(-10deg)';
            else if (clip.filter === 'Ocean') ctx.filter = 'hue-rotate(180deg) saturate(1.4) brightness(0.9)';
            else if (clip.filter === 'Lush') ctx.filter = 'saturate(2) contrast(1.1)';
            else if (clip.filter === 'Fade') ctx.filter = 'opacity(0.8) contrast(0.8) brightness(1.1)';
            else if (clip.filter === 'Cyber') ctx.filter = 'hue-rotate(280deg) saturate(2) contrast(1.2)';
            ctx.drawImage(canvas, 0, 0);
            ctx.restore();
          }

          gif.addFrame(ctx, { copy: true, delay: delay });
          currentTime += 1 / fps;
          elapsedSeconds += 1 / fps;
          setGifProgress(Math.min((elapsedSeconds / totalDuration) * 50, 50));
        }
      }

      gif.on('progress', (p: number) => {
        setGifProgress(50 + (p * 50));
      });

      gif.on('finished', (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `lumina-project-${Date.now()}.gif`;
        link.click();
        setIsExportingGif(false);
        setGifProgress(100);
      });

      gif.render();
    } catch (error) {
      console.error("Project GIF export failed:", error);
      setIsExportingGif(false);
    }
  };

  const previewFilter = useMemo(() => {
    if (selectedClipIndex === null) return '';
    const clip = timeline[selectedClipIndex];
    if (!clip) return '';

    const filters = [];
    if (clip.filter) {
      const f = clip.filter;
      if (f === 'Noir') filters.push('grayscale(1) contrast(1.2)');
      else if (f === 'Gold') filters.push('sepia(0.5) saturate(1.8) hue-rotate(-10deg)');
      else if (f === 'Ocean') filters.push('hue-rotate(180deg) saturate(1.4) brightness(0.9)');
      else if (f === 'Lush') filters.push('saturate(2) contrast(1.1)');
      else if (f === 'Fade') filters.push('opacity(0.8) contrast(0.8) brightness(1.1)');
      else if (f === 'Cyber') filters.push('hue-rotate(280deg) saturate(2) contrast(1.2)');
    }

    if (clip.blurIntensity > 0) {
      filters.push('url(#motion-blur-filter)');
    }

    return filters.join(' ');
  }, [selectedClipIndex, timeline]);

  const previewStyle = useMemo(() => {
    const clip = selectedClipIndex !== null ? timeline[selectedClipIndex] : null;
    const styles: React.CSSProperties = {
      filter: previewFilter,
      transition: 'none' // Remove default transition when using keyframes/time-updates
    };

    if (clip?.stabilization > 0) {
      const strength = clip.stabilization / 100;
      const zoom = 1 + strength * 0.15;
      const mode = clip.stabMode || 'subtle';
      
      styles.transform = `scale(${zoom})`;
      
      // Simulate stabilization jitter smoothing
      if (mode === 'locked') {
        styles.transition = 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
      } else if (mode === 'cinematic') {
        styles.transition = 'all 0.4s ease-out';
      } else {
        styles.transition = 'all 0.2s ease-in-out';
      }
    }

    if (clip?.keyframes && clip.keyframes.length > 0) {
      const interpolated = interpolateKeyframes(clip.keyframes, previewCurrentTime);
      if (interpolated) {
        const baseTransform = styles.transform || '';
        // If followCam is enabled, we INVERT the x/y to keep the object centered in the frame
        const x = clip.followCam ? -interpolated.x : interpolated.x;
        const y = clip.followCam ? -interpolated.y : interpolated.y;
        styles.transform = `${baseTransform} translate(${x}px, ${y}px) scale(${interpolated.scale}) rotate(${interpolated.rotation}deg)`.trim();
        
        if (clip.followCam) {
          styles.transition = (clip.followMode === 'locked') ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0.4, 1)';
        }
      }
    } else if (clip) {
      // Fallback to static transform properties if no keyframes
      const x = clip.x || 0;
      const y = clip.y || 0;
      const scale = clip.scale || 1;
      const rotation = clip.rotation || 0;
      const baseTransform = styles.transform || '';
      styles.transform = `${baseTransform} translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`.trim();
      styles.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
    }

    if (clip?.fadeIn > 0 || clip?.fadeOut > 0 || (clip?.transitionType && clip.transitionType !== 'none')) {
      const duration = clip.duration || 6;
      const fadeIn = clip.fadeIn || 0;
      const fadeOut = clip.fadeOut || 0;
      const transType = clip.transitionType || 'none';
      const transDuration = clip.transitionDuration || 0;
      
      const fadeInPercent = (fadeIn / duration) * 100;
      const fadeOutPercent = 100 - (fadeOut / duration) * 100;
      const transPercent = (transDuration / duration) * 100;

      styles.animation = `preview_transition ${duration}s linear forwards`;
      
      let keyframesContent = '';
      
      if (transType === 'crossfade') {
        keyframesContent = `
          0% { opacity: 0; }
          ${transPercent}% { opacity: 1; }
          ${fadeOutPercent}% { opacity: 1; }
          100% { opacity: 0; }
        `;
      } else if (transType === 'wipe') {
        keyframesContent = `
          0% { clip-path: inset(0 100% 0 0); opacity: 1; }
          ${transPercent}% { clip-path: inset(0 0 0 0); opacity: 1; }
          ${fadeOutPercent}% { clip-path: inset(0 0 0 0); opacity: 1; }
          100% { opacity: 0; }
        `;
      } else if (transType === 'slide') {
        keyframesContent = `
          0% { transform: translateX(100%) ${styles.transform || ''}; opacity: 1; }
          ${transPercent}% { transform: translateX(0) ${styles.transform || ''}; opacity: 1; }
          ${fadeOutPercent}% { transform: translateX(0) ${styles.transform || ''}; opacity: 1; }
          100% { opacity: 0; }
        `;
      } else {
        // Default fade behavior
        keyframesContent = `
          0% { opacity: 0; }
          ${fadeInPercent}% { opacity: 1; }
          ${fadeOutPercent}% { opacity: 1; }
          100% { opacity: 0; }
        `;
      }

      // Inject dynamic keyframes more robustly
      let styleTag = document.getElementById('dynamic-fade-keyframes');
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-fade-keyframes';
        document.head.appendChild(styleTag);
      }
      
      styleTag.innerHTML = `@keyframes preview_transition {
        ${keyframesContent}
      }`;
    }

    if (clip?.bgRemoved || clip?.chromaKey?.enabled) {
      // Simulate subject extraction or chroma keying
      // For chroma key, we use a slightly different gradient to simulate color-based removal
      if (clip?.chromaKey?.enabled) {
        const tolerance = clip.chromaKey.tolerance || 30;
        const smoothness = clip.chromaKey.smoothness || 10;
        // Mocking the visual effect of chroma key removal
        styles.maskImage = `radial-gradient(circle at 50% 50%, black ${100 - tolerance - smoothness}%, transparent ${100 - tolerance}%)`;
        styles.WebkitMaskImage = `radial-gradient(circle at 50% 50%, black ${100 - tolerance - smoothness}%, transparent ${100 - tolerance}%)`;
      } else {
        styles.maskImage = 'radial-gradient(ellipse 50% 80% at 50% 50%, black 40%, transparent 95%)';
        styles.WebkitMaskImage = 'radial-gradient(ellipse 50% 80% at 50% 50%, black 40%, transparent 95%)';
      }
    }

    if (clip?.styleImage && clip.styleApplied) {
      const intensity = (clip.styleIntensity || 50) / 100;
      // Simulate style transfer with high-contrast filters and overlay blending
      styles.filter = `${styles.filter || ''} contrast(${1 + intensity}) saturate(${1 + intensity * 0.5}) brightness(${1 - intensity * 0.1})`.trim();
      
      // We can use a pseudo-element logic or background-blend-mode if the img tag allows it
      // For simplicity in this mockup, we'll shift the hue and add a subtle sepia/overlay vibe
      styles.filter += ` hue-rotate(${intensity * 45}deg)`;
    }

    return styles;
  }, [selectedClipIndex, timeline, previewFilter, previewCurrentTime, interpolateKeyframes]);

  const onPreviewPlay = useCallback(() => {
    setIsPlaying(true);
    const audioVO = document.getElementById('preview-voiceover') as HTMLAudioElement;
    const audioMusic = document.getElementById('preview-music') as HTMLAudioElement;
    if (audioVO) {
      if (videoRef.current) audioVO.currentTime = videoRef.current.currentTime;
      audioVO.play();
    }
    if (audioMusic) {
      if (videoRef.current) audioMusic.currentTime = videoRef.current.currentTime % (audioMusic.duration || 1);
      audioMusic.play();
    }
  }, []);

  const onPreviewPause = useCallback(() => {
    setIsPlaying(false);
    const audioVO = document.getElementById('preview-voiceover') as HTMLAudioElement;
    const audioMusic = document.getElementById('preview-music') as HTMLAudioElement;
    if (audioVO) audioVO.pause();
    if (audioMusic) audioMusic.pause();
  }, []);

  const togglePlayback = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    } else if (selectedClipIndex !== null && timeline[selectedClipIndex]?.isStatic) {
      showNotification("Static clips cannot be played", "error");
    }
  }, [selectedClipIndex, timeline, showNotification]);

  const onPreviewTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    setPreviewCurrentTime((e.target as HTMLVideoElement).currentTime);
  }, []);

  const onPreviewSeeked = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.target as HTMLVideoElement;
    setPreviewCurrentTime(video.currentTime);
    const audioVO = document.getElementById('preview-voiceover') as HTMLAudioElement;
    const audioMusic = document.getElementById('preview-music') as HTMLAudioElement;
    if (audioVO) audioVO.currentTime = video.currentTime;
    if (audioMusic) audioMusic.currentTime = video.currentTime % (audioMusic.duration || 1);
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-orange-500/30">
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-xl border ${
              notification.type === 'success' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-sm font-bold tracking-tight">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Immersive Background Gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-orange-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/10 rounded-full blur-[120px]" />
      </div>

      <nav className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-white/5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Video className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">LUMINA <span className="text-orange-500">AI</span></h1>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Video Studio Beta</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setIsEditorOpen(!isEditorOpen)}
            className={`flex items-center gap-2 text-sm transition-colors ${isEditorOpen ? 'text-orange-500' : 'text-zinc-400 hover:text-white'}`}
          >
            <Film className="w-4 h-4" />
            Studio Editor
          </button>
          <div className="w-[1px] h-4 bg-white/10" />
          <button className="text-sm text-zinc-400 hover:text-white transition-colors">Docs</button>
          <button className="text-sm text-zinc-400 hover:text-white transition-colors">Pricing</button>
          <div className="w-[1px] h-4 bg-white/10" />
          <button className="p-2 text-zinc-400 hover:text-white transition-colors">
            <Settings className="w-5 h-5" />
          </button>
          {requiresKey && (
            <button 
              onClick={() => window.aistudio?.openSelectKey()}
              className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border border-white/10 transition-all active:scale-95"
            >
              <Zap className="w-3 h-3 text-orange-500" />
              Upgrade to Pro
            </button>
          )}
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-8 pt-12 pb-24 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12">
        <section className="space-y-12">
          {isEditorOpen ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <header className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-3xl font-bold tracking-tight">Timeline Editor</h2>
                    {isAppProcessing ? (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20">
                        <Loader2 className="w-2.5 h-2.5 text-orange-500 animate-spin" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-orange-500">AI Compute Active</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Engine Idle</span>
                      </div>
                    )}
                  </div>
                  <p className="text-zinc-500 text-sm">Sequence, trim and refine your AI clips.</p>
                </div>
                <div className="flex bg-zinc-900 border border-white/5 rounded-lg p-1 gap-1">
                  <button 
                    onClick={undo}
                    disabled={historyState.index <= 0}
                    className="p-2 hover:bg-zinc-800 disabled:opacity-30 rounded-md transition-all text-zinc-400 hover:text-white"
                    title="Undo (Ctrl+Z)"
                  >
                    <History className="w-4 h-4 rotate-[-90deg]" />
                  </button>
                  <button 
                    onClick={redo}
                    disabled={historyState.index >= historyState.states.length - 1}
                    className="p-2 hover:bg-zinc-800 disabled:opacity-30 rounded-md transition-all text-zinc-400 hover:text-white"
                    title="Redo (Ctrl+Y)"
                  >
                    <History className="w-4 h-4 scale-x-[-1] rotate-[-90deg]" />
                  </button>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => updateTimeline([])}
                    className="px-4 py-2 bg-zinc-900 border border-white/5 rounded-lg text-xs font-bold hover:bg-zinc-800 transition-all text-zinc-400 hover:text-white"
                  >
                    Clear All
                  </button>
                  <div className="flex bg-zinc-900 border border-white/5 rounded-lg p-1 gap-1">
                    <button 
                      onClick={handleExportProjectGif}
                      disabled={isExportingGif || timeline.length === 0}
                      className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-md text-xs font-bold hover:bg-zinc-700 transition-all flex items-center gap-2"
                    >
                      {isExportingGif ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                      GIF
                    </button>
                    <button className="px-4 py-2 bg-white text-black rounded-md text-xs font-bold hover:bg-orange-500 transition-all flex items-center gap-2">
                      <Download className="w-3 h-3" />
                      Video
                    </button>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-[1fr_280px] gap-8">
                <div className="relative">
                  {/* Preview Area */}
                  <div className={`transition-all duration-500 bg-zinc-950 rounded-3xl border border-white/10 overflow-hidden relative group shadow-2xl ${
                    (selectedClipIndex !== null ? timeline[selectedClipIndex].aspectRatio : timeline[0]?.aspectRatio) === '9:16' 
                      ? 'aspect-[9/16] h-[500px] mx-auto' 
                      : (selectedClipIndex !== null ? timeline[selectedClipIndex].aspectRatio : timeline[0]?.aspectRatio) === '1:1'
                        ? 'aspect-square h-[500px] mx-auto'
                        : 'aspect-video w-full'
                  }`}>
                    {timeline.length > 0 ? (
                      <div className="relative w-full h-full overflow-hidden">
                        {/* Background Layer (for BG Removal or Chroma Key) */}
                        { ((selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0])?.bgRemoved || (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0])?.chromaKey?.enabled) && (
                          <div className="absolute inset-0 z-0">
                            { (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).replacementType === 'color' && (
                              <div 
                                className="w-full h-full" 
                                style={{ backgroundColor: (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).replacementValue || '#000000' }} 
                              />
                            )}
                            { (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).replacementType === 'image' && (
                              <img 
                                src={(selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).replacementValue} 
                                className="w-full h-full object-cover"
                                alt="BG"
                              />
                            )}
                            { (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).replacementType === 'video' && (
                              <video 
                                src={(selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).replacementValue} 
                                className="w-full h-full object-cover"
                                autoPlay
                                loop
                                muted
                                playsInline
                              />
                            )}
                            { (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).replacementType === 'transparent' && (
                              <div 
                                className="w-full h-full"
                                style={{
                                  backgroundImage: `linear-gradient(45deg, #18181b 25%, transparent 25%), 
                                                    linear-gradient(-45deg, #18181b 25%, transparent 25%), 
                                                    linear-gradient(45deg, transparent 75%, #18181b 75%), 
                                                    linear-gradient(-45deg, transparent 75%, #18181b 75%)`,
                                  backgroundSize: '20px 20px',
                                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                                }}
                              />
                            )}
                          </div>
                        )}

                        {/* Foreground (Main Clip) */}
                        <div className={`relative w-full h-full z-[5] ${((selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).bgRemoved || (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).chromaKey?.enabled) ? 'drop-shadow-2xl' : ''}`}>
                          { (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0]).isStatic ? (
                            <img 
                              src={selectedClipIndex !== null ? timeline[selectedClipIndex].url : timeline[0].url}
                              className="w-full h-full object-contain"
                              style={previewStyle}
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <video 
                              ref={videoRef}
                              key={selectedClipIndex !== null ? timeline[selectedClipIndex].url : 'empty'}
                              src={selectedClipIndex !== null ? timeline[selectedClipIndex].url : timeline[0].url}
                              controls={false}
                              onPlay={onPreviewPlay}
                              onPause={onPreviewPause}
                              onSeeked={onPreviewSeeked}
                              onTimeUpdate={onPreviewTimeUpdate}
                              onClick={togglePlayback}
                              className="w-full h-full object-contain cursor-pointer"
                              style={previewStyle}
                            />
                          )}
                        </div>

                        {/* Playback Controls Overlay */}
                        <div className="absolute inset-0 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <button 
                            onClick={togglePlayback}
                            className="w-14 h-14 bg-orange-500 text-white rounded-full flex items-center justify-center shadow-2xl shadow-orange-500/40 pointer-events-auto transform hover:scale-110 active:scale-95 transition-all"
                          >
                            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                          </button>
                        </div>

                        {/* Mini Progress Bar */}
                        <div className="absolute bottom-0 left-0 right-0 z-30 h-1 bg-white/10 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity">
                          <motion.div 
                            className="h-full bg-orange-500"
                            style={{ 
                              width: videoRef.current 
                                ? `${(previewCurrentTime / (videoRef.current.duration || 1)) * 100}%` 
                                : '0%' 
                            }}
                          />
                        </div>
                        {selectedClipIndex !== null && timeline[selectedClipIndex].voiceover && (
                          <audio id="preview-voiceover" src={timeline[selectedClipIndex].voiceover} className="hidden" />
                        )}
                        {selectedClipIndex !== null && timeline[selectedClipIndex].music && (
                          <audio id="preview-music" src={timeline[selectedClipIndex].music} className="hidden" loop />
                        )}

                        {selectedClipIndex !== null && timeline[selectedClipIndex].textOverlay?.text && (
                          <motion.div 
                            key={`${selectedClipIndex}-${timeline[selectedClipIndex].textOverlay.text}-${timeline[selectedClipIndex].textOverlay.animationType}-${timeline[selectedClipIndex].textOverlay.animationDuration}`}
                            initial={
                              timeline[selectedClipIndex].textOverlay.animationType === 'fade' 
                                ? { opacity: 0, x: "-50%", y: "-50%" } 
                                : timeline[selectedClipIndex].textOverlay.animationType === 'slide'
                                  ? { opacity: 0, x: "-50%", y: "0%" }
                                  : timeline[selectedClipIndex].textOverlay.animationType === 'typewriter'
                                    ? { clipPath: 'inset(0 100% 0 0)', x: "-50%", y: "-50%" }
                                    : { x: "-50%", y: "-50%" }
                            }
                            animate={
                              timeline[selectedClipIndex].textOverlay.animationType === 'fade' 
                                ? { opacity: 1, x: "-50%", y: "-50%" } 
                                : timeline[selectedClipIndex].textOverlay.animationType === 'slide'
                                  ? { opacity: 1, x: "-50%", y: "-50%" }
                                  : timeline[selectedClipIndex].textOverlay.animationType === 'typewriter'
                                    ? { clipPath: 'inset(0 0% 0 0)', x: "-50%", y: "-50%" }
                                    : { x: "-50%", y: "-50%" }
                            }
                            transition={{ 
                              duration: timeline[selectedClipIndex].textOverlay.animationDuration || 1,
                              ease: timeline[selectedClipIndex].textOverlay.animationType === 'typewriter' ? "linear" : "easeOut"
                            }}
                            className="absolute pointer-events-none select-none z-10"
                            style={{
                              left: `${timeline[selectedClipIndex].textOverlay.x}%`,
                              top: `${timeline[selectedClipIndex].textOverlay.y}%`,
                              fontSize: `${timeline[selectedClipIndex].textOverlay.size}px`,
                              color: timeline[selectedClipIndex].textOverlay.color,
                              fontFamily: timeline[selectedClipIndex].textOverlay.font || 'Inter',
                              textAlign: 'center',
                              textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                              whiteSpace: 'pre-wrap',
                              maxWidth: '80%',
                              fontWeight: 'bold',
                              // Ensure typewriter effect works correctly with text alignment
                              display: 'inline-block'
                            }}
                          >
                            {timeline[selectedClipIndex].textOverlay.text}
                          </motion.div>
                        )}

                        {/* Watermark */}
                        <div className="absolute bottom-6 left-8 pointer-events-none transition-opacity opacity-40 group-hover:opacity-70">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-black/40 backdrop-blur-md rounded-lg flex items-center justify-center border border-white/10">
                              <Video className="w-4 h-4 text-orange-500" />
                            </div>
                            <div className="text-left">
                              <div className="text-[10px] font-black tracking-[0.3em] uppercase text-white shadow-sm">
                                LUMINA <span className="text-orange-500">AI</span>
                              </div>
                              <div className="text-[8px] font-mono uppercase tracking-widest text-zinc-400 mt-0.5">
                                {new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Film Grain Simulation Overlay */}
                        <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat" />

                        {/* AI Processing Overlay */}
                        { (selectedClipIndex !== null ? timeline[selectedClipIndex] : timeline[0])?.isProcessing && (
                          <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute inset-0 z-[50] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md"
                          >
                            <div className="relative">
                              <div className="absolute inset-0 scale-150 blur-xl bg-orange-500/20 rounded-full animate-pulse" />
                              <Loader2 className="w-10 h-10 text-orange-500 animate-spin relative z-10" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500 mt-6 animate-pulse">
                              AI Neural Processing
                            </span>
                            <div className="flex gap-1 mt-3">
                              {[0, 1, 2].map(i => (
                                <motion.div 
                                  key={i}
                                  animate={{ scale: [1, 1.5, 1] }}
                                  transition={{ repeat: Infinity, delay: i * 0.2 }}
                                  className="w-1 h-1 bg-orange-500 rounded-full"
                                />
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600">
                        <Film className="w-12 h-12 mb-4 opacity-20" />
                        <p>No clips in timeline</p>
                      </div>
                    )}
                  </div>

                  {/* Timeline Track */}
                  <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-xl">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                          <Layers className="w-4 h-4" />
                          Main Track
                        </div>
                        <button 
                          onClick={togglePlayback}
                          className="flex items-center gap-2 py-1 px-3 bg-zinc-800 hover:bg-orange-500/10 hover:text-orange-500 rounded-lg text-[10px] font-bold uppercase transition-all border border-white/5"
                        >
                          {isPlaying ? (
                            <>
                              <Pause className="w-3 h-3 fill-current" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              Play
                            </>
                          )}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button className="p-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors">
                          <Scissors className="w-4 h-4" />
                        </button>
                        <button className="p-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors">
                          <Split className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide min-h-[100px]">
                      {timeline.map((clip, idx) => (
                        <motion.div
                          layoutId={`clip-${idx}`}
                          key={idx}
                          onClick={() => setSelectedClipIndex(idx)}
                          className={`flex-shrink-0 w-48 aspect-video rounded-xl overflow-hidden relative border-2 transition-all cursor-pointer group ${
                            selectedClipIndex === idx ? 'border-orange-500 scale-[1.02] shadow-lg shadow-orange-500/20' : 'border-transparent opacity-70 hover:opacity-100'
                          }`}
                        >
                          {clip.isProcessing && (
                            <div className="absolute inset-0 z-20 bg-black/60 flex items-center justify-center backdrop-blur-[1px]">
                              <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                            </div>
                          )}
                          {clip.isStatic || (clip.url && clip.url.startsWith('data:image')) ? (
                            <img src={clip.url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <video src={clip.url} className="w-full h-full object-cover" />
                          )}
                          <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-0.5 rounded text-[10px] font-mono">
                            0{idx + 1}
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              updateTimeline(prev => prev.filter((_, i) => i !== idx));
                              if (selectedClipIndex === idx) setSelectedClipIndex(null);
                            }}
                            className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-red-500/80 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </motion.div>
                      ))}
                      <div 
                        className="flex-shrink-0 w-48 aspect-video rounded-xl border border-dashed border-white/10 flex flex-col items-center justify-center text-zinc-700 hover:text-zinc-500 hover:border-white/20 transition-all cursor-pointer"
                        onClick={() => {
                          if (history.length > 0) {
                            updateTimeline(prev => [...prev, history[0]]);
                          }
                        }}
                      >
                        <Plus className="w-6 h-6 mb-2" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Add Clip</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Editor Controls */}
                <div className="space-y-6">
                  {selectedClipIndex !== null ? (
                    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 space-y-6 sticky top-24">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Inspector</h3>
                        <div className="flex bg-zinc-950 p-1 rounded-lg border border-white/5">
                          <button 
                            onClick={() => setInspectorTab('transform')}
                            className={`p-1.5 rounded-md transition-all ${inspectorTab === 'transform' ? 'bg-zinc-800 text-orange-500 shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                          >
                            <Layout className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setInspectorTab('effects')}
                            className={`p-1.5 rounded-md transition-all ${inspectorTab === 'effects' ? 'bg-zinc-800 text-orange-500 shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                          >
                            <Wand2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setInspectorTab('voice')}
                            className={`p-1.5 rounded-md transition-all ${inspectorTab === 'voice' ? 'bg-zinc-800 text-orange-500 shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                          >
                            <Mic className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setInspectorTab('music')}
                            className={`p-1.5 rounded-md transition-all ${inspectorTab === 'music' ? 'bg-zinc-800 text-orange-500 shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setInspectorTab('text')}
                            className={`p-1.5 rounded-md transition-all ${inspectorTab === 'text' ? 'bg-zinc-800 text-orange-500 shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                          >
                            <Type className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        {inspectorTab === 'transform' ? (
                          <>
                            <div className="space-y-4">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] uppercase font-bold text-zinc-500">Clip Duration</label>
                                <span className="text-[10px] font-mono text-orange-500">{(timeline[selectedClipIndex].duration || 6).toFixed(1)}s</span>
                              </div>
                              <input 
                                type="range"
                                min="1"
                                max="30"
                                step="0.5"
                                value={timeline[selectedClipIndex].duration || 6}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  updateTimeline(prev => {
                                    const next = [...prev];
                                    next[selectedClipIndex].duration = val;
                                    return next;
                                  }, false);
                                }}
                                onMouseUp={() => {
                                  updateTimeline(timeline);
                                }}
                                onTouchEnd={() => {
                                  updateTimeline(timeline);
                                }}
                                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-[10px] uppercase font-bold text-zinc-500">Trimming</label>
                              <div className="h-12 bg-zinc-950 rounded-lg relative flex items-center px-4">
                                <div className="absolute h-1 bg-orange-500 left-8 right-8 rounded-full" />
                                <div className="absolute w-3 h-8 bg-white rounded-md left-6 cursor-ew-resize" />
                                <div className="absolute w-3 h-8 bg-white rounded-md right-6 cursor-ew-resize" />
                              </div>
                              <div className="flex justify-between text-[10px] font-mono text-zinc-600">
                                <span>0.0s</span>
                                <span>{(timeline[selectedClipIndex].duration || 6).toFixed(1)}s</span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                  <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                    <ArrowRight className="w-3 h-3 text-orange-500 rotate-[-45deg]" />
                                    Fade In
                                  </label>
                                  <span className="text-[10px] font-mono text-orange-500">{(timeline[selectedClipIndex].fadeIn || 0).toFixed(1)}s</span>
                                </div>
                                <input 
                                  type="range"
                                  min="0"
                                  max="3"
                                  step="0.1"
                                  value={timeline[selectedClipIndex].fadeIn || 0}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    updateTimeline(prev => {
                                      const next = [...prev];
                                      next[selectedClipIndex].fadeIn = val;
                                      return next;
                                    }, false);
                                  }}
                                  onMouseUp={() => updateTimeline(timeline)}
                                  onTouchEnd={() => updateTimeline(timeline)}
                                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                />
                              </div>

                              <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                  <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                    <ArrowRight className="w-3 h-3 text-orange-500 rotate-[135deg]" />
                                    Fade Out
                                  </label>
                                  <span className="text-[10px] font-mono text-orange-500">{(timeline[selectedClipIndex].fadeOut || 0).toFixed(1)}s</span>
                                </div>
                                <input 
                                  type="range"
                                  min="0"
                                  max="3"
                                  step="0.1"
                                  value={timeline[selectedClipIndex].fadeOut || 0}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    updateTimeline(prev => {
                                      const next = [...prev];
                                      next[selectedClipIndex].fadeOut = val;
                                      return next;
                                    }, false);
                                  }}
                                  onMouseUp={() => updateTimeline(timeline)}
                                  onTouchEnd={() => updateTimeline(timeline)}
                                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                />
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Maximize className="w-3 h-3 text-orange-500" />
                                  Auto Reframe (AI)
                                </label>
                                <div className="flex gap-1">
                                  {['9:16', '1:1', '4:5'].map(ratio => (
                                    <button 
                                      key={ratio}
                                      onClick={() => {
                                        const clip = timeline[selectedClipIndex];
                                        showNotification(`Analyzing for ${ratio}...`, 'success');
                                        
                                        // Simulate AI analysis delay
                                        setTimeout(() => {
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            const c = { ...next[selectedClipIndex] };
                                            
                                            // Heuristic: For vertical formats, we usually need to zoom in
                                            // and potentially shift horizontally if the subject isn't centered.
                                            if (ratio === '9:16') {
                                              c.scale = 1.78; // 16/9 ≈ 1.78 to fill height
                                              c.x = 0; // Default center
                                            } else if (ratio === '1:1') {
                                              c.scale = 1.33; // 4/3 or similar
                                              c.x = 0;
                                            } else if (ratio === '4:5') {
                                              c.scale = 1.4;
                                              c.x = 0;
                                            }
                                            
                                            // Add a "smart" keyframe at the start if recording
                                            if (isRecordKeyframes) {
                                              const kf = {
                                                time: 0,
                                                x: c.x,
                                                y: c.y || 0,
                                                scale: c.scale,
                                                rotation: c.rotation || 0
                                              };
                                              c.keyframes = [kf, ...(c.keyframes || []).filter((k: any) => k.time > 0.1)];
                                            }
                                            
                                            next[selectedClipIndex] = c;
                                            return next;
                                          });
                                          showNotification(`Reframed to ${ratio}`);
                                        }, 800);
                                      }}
                                      className="px-2 py-1 bg-zinc-900 border border-white/5 rounded text-[9px] font-bold text-zinc-500 hover:text-orange-500 hover:border-orange-500/30 transition-all"
                                    >
                                      {ratio}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <p className="text-[9px] text-zinc-600 leading-tight">
                                Automatically identifies the main subject and optimizes composition for mobile-first formats.
                              </p>
                            </div>

                            <div className="space-y-6">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Key className="w-3 h-3 text-orange-500" />
                                  Motion Keyframes
                                </label>
                                <button 
                                  onClick={() => setIsRecordKeyframes(!isRecordKeyframes)}
                                  className={`flex items-center gap-2 px-3 py-1 rounded-full text-[9px] font-bold uppercase transition-all ${
                                    isRecordKeyframes ? 'bg-red-500/20 text-red-500 border border-red-500/20' : 'bg-zinc-900 text-zinc-500 border border-white/5'
                                  }`}
                                >
                                  <div className={`w-1.5 h-1.5 rounded-full ${isRecordKeyframes ? 'bg-red-500 animate-pulse' : 'bg-zinc-600'}`} />
                                  {isRecordKeyframes ? 'Recording' : 'Record'}
                                </button>
                              </div>

                              {timeline[selectedClipIndex].keyframes?.length > 0 && (
                                <div className="flex gap-1 overflow-x-auto pb-2 no-scrollbar">
                                  {timeline[selectedClipIndex].keyframes.map((k: any, i: number) => (
                                    <button 
                                      key={i}
                                      onClick={() => {
                                        const video = document.querySelector('video') as HTMLVideoElement;
                                        if (video) video.currentTime = k.time;
                                        setPreviewCurrentTime(k.time);
                                      }}
                                      className={`flex-shrink-0 px-2 py-1 rounded bg-zinc-900 border text-[9px] font-mono transition-all ${
                                        Math.abs(previewCurrentTime - k.time) < 0.1 ? 'border-orange-500 text-orange-500' : 'border-white/5 text-zinc-600'
                                      }`}
                                    >
                                      {k.time.toFixed(2)}s
                                    </button>
                                  ))}
                                </div>
                              )}

                              <div className="space-y-5 bg-zinc-950 p-4 rounded-xl border border-white/5">
                                {[
                                  { label: 'Position X', icon: Move, key: 'x', min: -500, max: 500, step: 1, unit: 'px' },
                                  { label: 'Position Y', icon: Move, key: 'y', min: -500, max: 500, step: 1, unit: 'px' },
                                  { label: 'Scale', icon: Maximize, key: 'scale', min: 0.1, max: 5, step: 0.1, unit: 'x' },
                                  { label: 'Rotation', icon: RotateCcw, key: 'rotation', min: -360, max: 360, step: 1, unit: '°' }
                                ].map((attr) => {
                                  const curVal = isRecordKeyframes 
                                    ? (interpolateKeyframes(timeline[selectedClipIndex].keyframes, previewCurrentTime)?.[attr.key] ?? (timeline[selectedClipIndex][attr.key] || (attr.key === 'scale' ? 1 : 0)))
                                    : (timeline[selectedClipIndex][attr.key] || (attr.key === 'scale' ? 1 : 0));

                                  return (
                                    <div key={attr.key} className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                          <attr.icon className="w-3 h-3 text-zinc-600" />
                                          <span className="text-[10px] text-zinc-500 uppercase font-bold">{attr.label}</span>
                                        </div>
                                        <span className="text-[10px] font-mono text-orange-500">{curVal.toFixed(attr.step < 1 ? 1 : 0)}{attr.unit}</span>
                                      </div>
                                      <input 
                                        type="range"
                                        min={attr.min}
                                        max={attr.max}
                                        step={attr.step}
                                        value={curVal}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value);
                                          if (isRecordKeyframes) {
                                            addOrUpdateKeyframe(selectedClipIndex, previewCurrentTime, { [attr.key]: val });
                                          } else {
                                            updateTimeline(prev => {
                                              const next = [...prev];
                                              next[selectedClipIndex][attr.key] = val;
                                              return next;
                                            }, false);
                                          }
                                        }}
                                        onMouseUp={() => updateTimeline(timeline)}
                                        onTouchEnd={() => updateTimeline(timeline)}
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                      />
                                    </div>
                                  );
                                })}
                                
                                {isRecordKeyframes && (
                                  <div className="pt-2 flex gap-2">
                                    <button 
                                      onClick={() => {
                                        const next = [...timeline];
                                        const clip = { ...next[selectedClipIndex] };
                                        const keyframes = clip.keyframes || [];
                                        const idx = keyframes.findIndex((k: any) => Math.abs(k.time - previewCurrentTime) < 0.1);
                                        if (idx !== -1) {
                                          keyframes.splice(idx, 1);
                                          clip.keyframes = [...keyframes];
                                          next[selectedClipIndex] = clip;
                                          updateTimeline(next);
                                        }
                                      }}
                                      disabled={!(timeline[selectedClipIndex].keyframes?.some((k: any) => Math.abs(k.time - previewCurrentTime) < 0.1))}
                                      className="flex-1 py-2 bg-zinc-900 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-2 border border-white/5"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      Remove Keyframe
                                    </button>
                                    <button 
                                      onClick={() => {
                                        const clip = timeline[selectedClipIndex];
                                        addOrUpdateKeyframe(selectedClipIndex, previewCurrentTime, {
                                          x: clip.x || 0,
                                          y: clip.y || 0,
                                          scale: clip.scale || 1,
                                          rotation: clip.rotation || 0
                                        });
                                      }}
                                      className="flex-1 py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-2 border border-orange-500/20"
                                    >
                                      <Plus className="w-3 h-3" />
                                      Add Keyframe
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        ) : inspectorTab === 'effects' ? (
                          <div className="space-y-6">
                            <div className="space-y-3">
                              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                <Palette className="w-3 h-3" />
                                Color Grading
                              </label>
                              <div className="grid grid-cols-3 gap-2">
                                {['Noir', 'Gold', 'Ocean', 'Lush', 'Fade', 'Cyber'].map(f => (
                                  <button 
                                    key={f}
                                      onClick={() => {
                                        const newTimeline = [...timeline];
                                        newTimeline[selectedClipIndex].filter = f;
                                        updateTimeline(newTimeline);
                                      }}
                                    className={`p-2 rounded-lg border text-[10px] font-bold uppercase transition-all ${
                                      timeline[selectedClipIndex].filter === f 
                                        ? 'border-orange-500 bg-orange-500/10 text-orange-500' 
                                        : 'border-white/5 bg-zinc-950 text-zinc-500 hover:border-white/20'
                                    }`}
                                  >
                                    {f}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-4">
                              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                <Waves className="w-3 h-3 text-orange-500" />
                                Motion Blur
                              </label>
                              
                              <div className="space-y-4 bg-zinc-950 p-4 rounded-xl border border-white/5">
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-zinc-600 uppercase font-bold">Intensity</span>
                                    <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].blurIntensity || 0}px</span>
                                  </div>
                                  <input 
                                    type="range"
                                    min="0"
                                    max="20"
                                    step="0.5"
                                    value={timeline[selectedClipIndex].blurIntensity || 0}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value);
                                      updateTimeline(prev => {
                                        const next = [...prev];
                                        next[selectedClipIndex].blurIntensity = val;
                                        return next;
                                      }, false);
                                    }}
                                    onMouseUp={() => {
                                      updateTimeline(timeline);
                                    }}
                                    onTouchEnd={() => {
                                      updateTimeline(timeline);
                                    }}
                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <span className="text-[10px] text-zinc-600 uppercase font-bold">Direction</span>
                                  <div className="grid grid-cols-3 gap-2">
                                    {[
                                      { name: 'Horiz', value: 0 },
                                      { name: 'Vert', value: 90 },
                                      { name: 'Diag', value: 45 }
                                    ].map(d => (
                                      <button 
                                        key={d.name}
                                        onClick={() => {
                                          const newTimeline = [...timeline];
                                          newTimeline[selectedClipIndex].blurDirection = d.value;
                                          updateTimeline(newTimeline);
                                        }}
                                        className={`p-1.5 rounded-md text-[9px] font-bold uppercase transition-all border ${
                                          (timeline[selectedClipIndex].blurDirection || 0) === d.value 
                                            ? 'border-orange-500 bg-orange-500/10 text-orange-500' 
                                            : 'border-white/5 bg-zinc-900 text-zinc-600 hover:border-white/20'
                                        }`}
                                      >
                                        {d.name}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                <Zap className="w-3 h-3 text-orange-500" />
                                Transitions
                              </label>
                              
                              <div className="space-y-4 bg-zinc-950 p-4 rounded-xl border border-white/5">
                                <div className="grid grid-cols-2 gap-2">
                                  {['None', 'Crossfade', 'Wipe', 'Slide'].map(type => (
                                    <button 
                                      key={type}
                                      onClick={() => {
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].transitionType = type.toLowerCase();
                                          if (type !== 'None' && !next[selectedClipIndex].transitionDuration) {
                                            next[selectedClipIndex].transitionDuration = 1;
                                          }
                                          return next;
                                        });
                                      }}
                                      className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-all border ${
                                        (timeline[selectedClipIndex].transitionType || 'none') === type.toLowerCase()
                                          ? 'border-orange-500 bg-orange-500/10 text-orange-500' 
                                          : 'border-white/5 bg-zinc-900 text-zinc-600 hover:text-zinc-400'
                                      }`}
                                    >
                                      {type}
                                    </button>
                                  ))}
                                </div>

                                {(timeline[selectedClipIndex].transitionType && timeline[selectedClipIndex].transitionType !== 'none') && (
                                  <div className="space-y-2 pt-2 border-t border-white/5">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-zinc-600 uppercase font-bold">Duration</span>
                                      <span className="text-[10px] font-mono text-orange-500">{(timeline[selectedClipIndex].transitionDuration || 1).toFixed(1)}s</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="0.2"
                                      max="2"
                                      step="0.1"
                                      value={timeline[selectedClipIndex].transitionDuration || 1}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].transitionDuration = val;
                                          return next;
                                        }, false);
                                      }}
                                      onMouseUp={() => updateTimeline(timeline)}
                                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Target className="w-3 h-3 text-orange-500" />
                                  Object Tracking (AI)
                                </label>
                                {timeline[selectedClipIndex].isTracking ? (
                                  <span className="text-[9px] font-bold text-orange-500 animate-pulse flex items-center gap-1 bg-orange-500/10 px-2 py-0.5 rounded">
                                    <Crosshair className="w-2.5 h-2.5" />
                                    Tracking...
                                  </span>
                                ) : (
                                  <div 
                                    onClick={() => {
                                      updateTimeline(prev => {
                                        const next = [...prev];
                                        next[selectedClipIndex].followCam = !next[selectedClipIndex].followCam;
                                        return next;
                                      });
                                    }}
                                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${timeline[selectedClipIndex].followCam ? 'bg-orange-500' : 'bg-zinc-800'}`}
                                  >
                                    <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${timeline[selectedClipIndex].followCam ? 'translate-x-4' : 'translate-x-0'}`} />
                                  </div>
                                )}
                              </div>

                              <div className="space-y-3 bg-zinc-950 p-4 rounded-xl border border-white/5">
                                {!timeline[selectedClipIndex].isTracking && !timeline[selectedClipIndex].trackingData ? (
                                  <button 
                                    onClick={() => {
                                      if (timeline[selectedClipIndex].isProcessing) return;
                                      showNotification("Initializing AI tracker...", "success");
                                      updateTimeline(prev => {
                                        const next = [...prev];
                                        next[selectedClipIndex].isTracking = true;
                                        next[selectedClipIndex].isProcessing = true;
                                        return next;
                                      });
                                      
                                      setTimeout(() => {
                                        showNotification("Object identified. Analyzing movement...", "success");
                                        setTimeout(() => {
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            const clip = { ...next[selectedClipIndex] };
                                            clip.isTracking = false;
                                            clip.isProcessing = false;
                                            // Mock tracking data: keyframes that follow a hypothetical object
                                            clip.trackingData = true;
                                            clip.followCam = true;
                                            
                                            // Generate a simple sinusoidal movement for demo
                                            const kfs = [];
                                            const duration = clip.duration || 5;
                                            for (let t = 0; t <= duration; t += 0.5) {
                                              kfs.push({
                                                time: t,
                                                x: Math.sin(t * 1.5) * 40,
                                                y: Math.cos(t * 1.2) * 20,
                                                scale: 1 + Math.sin(t * 0.8) * 0.1,
                                                rotation: 0
                                              });
                                            }
                                            clip.keyframes = kfs;
                                            next[selectedClipIndex] = clip;
                                            return next;
                                          });
                                          showNotification("Tracking complete. Follow-cam enabled.");
                                        }, 2000);
                                      }, 1000);
                                    }}
                                    disabled={timeline[selectedClipIndex].isProcessing}
                                    className={`w-full py-2.5 bg-zinc-900 hover:bg-orange-500/10 hover:text-orange-500 rounded-xl text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-2 border border-white/5 ${timeline[selectedClipIndex].isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  >
                                    <Crosshair className="w-3 h-3" />
                                    Select Object to Track
                                  </button>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-lg bg-orange-500/20 flex items-center justify-center">
                                          <Target className="w-3 h-3 text-orange-500" />
                                        </div>
                                        <span className="text-[10px] font-bold text-zinc-400">Subject #1 Optimized</span>
                                      </div>
                                      <button 
                                        onClick={() => {
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].trackingData = false;
                                            next[selectedClipIndex].followCam = false;
                                            next[selectedClipIndex].keyframes = [];
                                            return next;
                                          });
                                        }}
                                        className="text-[9px] text-red-500 font-bold uppercase hover:underline"
                                      >
                                        Reset
                                      </button>
                                    </div>

                                    <div className="flex items-center justify-between p-2 bg-zinc-900 rounded-lg">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Follow-Cam</span>
                                      </div>
                                      <div className="flex gap-2">
                                        {['static', 'dynamic', 'locked'].map(m => (
                                          <button 
                                            key={m}
                                            onClick={() => {
                                              updateTimeline(prev => {
                                                const next = [...prev];
                                                next[selectedClipIndex].followMode = m;
                                                return next;
                                              });
                                            }}
                                            className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${
                                              (timeline[selectedClipIndex].followMode || 'dynamic') === m 
                                                ? 'bg-orange-500 text-white' 
                                                : 'bg-zinc-800 text-zinc-500'
                                            }`}
                                          >
                                            {m}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <p className="text-[9px] text-zinc-600 leading-tight">
                                Select an object to lock the camera focus. The AI will automatically generate motion keyframes to follow the subject.
                              </p>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Palette className="w-3 h-3 text-orange-500" />
                                  AI Style Transfer
                                </label>
                                {timeline[selectedClipIndex].styleApplied && (
                                  <button 
                                    onClick={() => {
                                      updateTimeline(prev => {
                                        const next = [...prev];
                                        next[selectedClipIndex].styleApplied = false;
                                        next[selectedClipIndex].styleImage = null;
                                        return next;
                                      });
                                    }}
                                    className="text-[9px] font-bold text-red-500 hover:underline uppercase"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>

                              <div className="space-y-3 bg-zinc-950 p-4 rounded-xl border border-white/5">
                                {!timeline[selectedClipIndex].styleApplied ? (
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2 mb-3">
                                      {['Cyberpunk', 'Oil Painting', 'Sketch'].map(preset => (
                                        <button 
                                          key={preset}
                                          onClick={() => {
                                            showNotification(`Extracting features from ${preset} preset...`, "success");
                                            updateTimeline(prev => {
                                              const next = [...prev];
                                              next[selectedClipIndex].isProcessing = true;
                                              return next;
                                            });
                                            setTimeout(() => {
                                              updateTimeline(prev => {
                                                const next = [...prev];
                                                next[selectedClipIndex].isProcessing = false;
                                                next[selectedClipIndex].styleApplied = true;
                                                next[selectedClipIndex].styleImage = preset;
                                                next[selectedClipIndex].styleIntensity = 75;
                                                return next;
                                              });
                                              showNotification("Style applied successfully");
                                            }, 1000);
                                          }}
                                          className="py-2 bg-zinc-900 border border-white/5 rounded-lg text-[9px] font-bold text-zinc-500 hover:text-orange-500 hover:border-orange-500/30 transition-all uppercase"
                                        >
                                          {preset}
                                        </button>
                                      ))}
                                      <button 
                                        onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'image/*';
                                          input.onchange = (e) => {
                                            const file = (e.target as HTMLInputElement).files?.[0];
                                            if (file) {
                                              showNotification("Uploading style reference...", "success");
                                              setTimeout(() => {
                                                showNotification("Analyzing color palette and textures...", "success");
                                                setTimeout(() => {
                                                  updateTimeline(prev => {
                                                    const next = [...prev];
                                                    next[selectedClipIndex].styleApplied = true;
                                                    next[selectedClipIndex].styleImage = URL.createObjectURL(file);
                                                    next[selectedClipIndex].styleIntensity = 60;
                                                    return next;
                                                  });
                                                }, 1200);
                                              }, 800);
                                            }
                                          };
                                          input.click();
                                        }}
                                        className="py-2 bg-zinc-900 border border-dashed border-white/10 rounded-lg text-[9px] font-bold text-zinc-600 hover:text-orange-500 flex items-center justify-center gap-1"
                                      >
                                        <Upload className="w-3 h-3" />
                                        Custom
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                      {timeline[selectedClipIndex].styleImage?.startsWith('blob') || timeline[selectedClipIndex].styleImage?.startsWith('http') ? (
                                        <img 
                                          src={timeline[selectedClipIndex].styleImage} 
                                          className="w-10 h-10 rounded-lg object-cover border border-white/10" 
                                          alt="Style ref"
                                        />
                                      ) : (
                                        <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
                                          <Palette className="w-5 h-5 text-orange-500" />
                                        </div>
                                      )}
                                      <div>
                                        <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-tight">Style Active</p>
                                        <p className="text-[8px] text-zinc-500 font-mono">{timeline[selectedClipIndex].styleImage?.length > 15 ? 'Custom Reference' : timeline[selectedClipIndex].styleImage}</p>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[10px] text-zinc-600 uppercase font-bold">Transfer Intensity</span>
                                        <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].styleIntensity || 50}%</span>
                                      </div>
                                      <input 
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={timeline[selectedClipIndex].styleIntensity || 50}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value);
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].styleIntensity = val;
                                            return next;
                                          }, false);
                                        }}
                                        onMouseUp={() => updateTimeline(timeline)}
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <p className="text-[9px] text-zinc-600 leading-tight">
                                Merges the artistic style of your reference image with the structural content of the video.
                              </p>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Mic className="w-3 h-3 text-orange-500" />
                                  Voice Cloning (AI)
                                </label>
                                {timeline[selectedClipIndex].voiceCloned ? (
                                  <span className="text-[9px] font-bold text-green-500 flex items-center gap-1 bg-green-500/10 px-2 py-0.5 rounded">
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                    Active
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold text-zinc-600 uppercase">Beta</span>
                                )}
                              </div>

                              <div className="space-y-3 bg-zinc-950 p-4 rounded-xl border border-white/5">
                                {!timeline[selectedClipIndex].voiceCloned ? (
                                  <div className="space-y-3">
                                    <div 
                                      onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = 'audio/*';
                                        input.onchange = (e) => {
                                          const file = (e.target as HTMLInputElement).files?.[0];
                                          if (file) {
                                            showNotification("Uploading reference sample...", "success");
                                            updateTimeline(prev => {
                                              const next = [...prev];
                                              next[selectedClipIndex].isProcessing = true;
                                              return next;
                                            });
                                            setTimeout(() => {
                                              showNotification("Analyzing unique vocal characteristics...", "success");
                                              setTimeout(() => {
                                                updateTimeline(prev => {
                                                  const next = [...prev];
                                                  next[selectedClipIndex].isProcessing = false;
                                                  next[selectedClipIndex].voiceCloned = true;
                                                  next[selectedClipIndex].voiceRef = file.name;
                                                  return next;
                                                });
                                                showNotification("Voice cloned successfully!");
                                              }, 1500);
                                            }, 1000);
                                          }
                                        };
                                        input.click();
                                      }}
                                      className="border-2 border-dashed border-white/5 rounded-xl p-4 flex flex-col items-center gap-2 hover:border-orange-500/30 hover:bg-orange-500/5 transition-all cursor-pointer group"
                                    >
                                      <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <Upload className="w-4 h-4 text-zinc-500 group-hover:text-orange-500" />
                                      </div>
                                      <div className="text-center">
                                        <p className="text-[10px] font-bold text-zinc-400">Upload 3s Sample</p>
                                        <p className="text-[8px] text-zinc-600">Clone your voice for narration</p>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="flex items-center justify-between p-2 bg-zinc-900/50 rounded-lg border border-white/5">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                                          <Mic className="w-4 h-4 text-orange-500" />
                                        </div>
                                        <div>
                                          <p className="text-[10px] font-bold text-zinc-300">Personal Voice</p>
                                          <p className="text-[8px] text-zinc-500 font-mono uppercase tracking-widest">{timeline[selectedClipIndex].voiceRef || "cloned_profile_01.wav"}</p>
                                        </div>
                                      </div>
                                      <button 
                                        onClick={() => {
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].voiceCloned = false;
                                            next[selectedClipIndex].narrationText = "";
                                            return next;
                                          });
                                        }}
                                        className="p-2 hover:text-red-500 transition-colors"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>

                                    <div className="space-y-2">
                                      <label className="text-[10px] text-zinc-600 uppercase font-bold">Narration Text</label>
                                      <textarea 
                                        placeholder="Type what your cloned voice should say..."
                                        value={timeline[selectedClipIndex].narrationText || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].narrationText = val;
                                            return next;
                                          }, false);
                                        }}
                                        className="w-full bg-zinc-900 border border-white/5 rounded-xl p-3 text-xs text-zinc-400 placeholder:text-zinc-700 outline-none focus:border-orange-500/50 min-h-[80px] resize-none"
                                      />
                                    </div>

                                    <button 
                                      onClick={() => {
                                        if (!timeline[selectedClipIndex].narrationText) {
                                          showNotification("Please enter narration text first", "error");
                                          return;
                                        }
                                        showNotification("Synthesizing audio with cloned profile...", "success");
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].isProcessing = true;
                                          return next;
                                        });
                                        setTimeout(() => {
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].isProcessing = false;
                                            return next;
                                          });
                                          showNotification("Narration added to clip");
                                        }, 1500);
                                      }}
                                      className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 rounded-xl text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/10"
                                    >
                                      <Sparkles className="w-3 h-3" />
                                      Generate Narration
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Zap className="w-3 h-3 text-orange-500" />
                                  Video Stabilization
                                </label>
                                  <button 
                                    onClick={() => {
                                      if (timeline[selectedClipIndex].isProcessing) return;
                                      showNotification("Analyzing motion vectors...", "success");
                                      updateTimeline(prev => {
                                        const next = [...prev];
                                        next[selectedClipIndex].isProcessing = true;
                                        return next;
                                      });
                                      setTimeout(() => {
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].isProcessing = false;
                                          next[selectedClipIndex].stabilization = 75;
                                          next[selectedClipIndex].stabMode = 'cinematic';
                                          return next;
                                        });
                                        showNotification("Stabilization optimized");
                                      }, 1200);
                                    }}
                                    disabled={timeline[selectedClipIndex].isProcessing}
                                    className={`text-[9px] font-bold uppercase py-1 px-2 rounded flex items-center gap-1 transition-all ${
                                      timeline[selectedClipIndex].isProcessing 
                                        ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50' 
                                        : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 shadow-sm shadow-orange-500/5'
                                    }`}
                                  >
                                    <Sparkles className="w-2.5 h-2.5" />
                                    {timeline[selectedClipIndex].isProcessing ? 'Processing...' : 'Auto Fix'}
                                  </button>
                              </div>
                              
                              <div className="space-y-4 bg-zinc-950 p-4 rounded-xl border border-white/5">
                                <div className="space-y-3">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-zinc-600 uppercase font-bold">Smoothing Strength</span>
                                    <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].stabilization || 0}%</span>
                                  </div>
                                  <input 
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={timeline[selectedClipIndex].stabilization || 0}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      updateTimeline(prev => {
                                        const next = [...prev];
                                        next[selectedClipIndex].stabilization = val;
                                        return next;
                                      }, false);
                                    }}
                                    onMouseUp={() => updateTimeline(timeline)}
                                    onTouchEnd={() => updateTimeline(timeline)}
                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                  />
                                </div>

                                <div className="space-y-2 pt-2 border-t border-white/5">
                                  <span className="text-[10px] text-zinc-600 uppercase font-bold">Stabilization Mode</span>
                                  <div className="grid grid-cols-3 gap-2">
                                    {[
                                      { id: 'subtle', name: 'Subtle', icon: '🍃' },
                                      { id: 'cinematic', name: 'Cinematic', icon: '🎬' },
                                      { id: 'locked', name: 'Locked', icon: '🔒' }
                                    ].map(mode => (
                                      <button 
                                        key={mode.id}
                                        onClick={() => {
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].stabMode = mode.id;
                                            return next;
                                          });
                                        }}
                                        className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${
                                          (timeline[selectedClipIndex].stabMode || 'subtle') === mode.id
                                            ? 'border-orange-500 bg-orange-500/10 text-orange-500' 
                                            : 'border-white/5 bg-zinc-900 text-zinc-600 hover:text-zinc-400'
                                        }`}
                                      >
                                        <span className="text-xs">{mode.icon}</span>
                                        <span className="text-[8px] font-bold uppercase">{mode.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <p className="text-[9px] text-zinc-600 italic leading-tight">
                                  Uses AI-powered camera smoothing. Higher values will crop the image slightly to preserve frame integrity.
                                </p>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Scissors className="w-3 h-3 text-orange-500" />
                                  AI Scene Detection
                                </label>
                                <button 
                                  onClick={() => {
                                    if (timeline[selectedClipIndex].isProcessing) return;
                                    showNotification("Analyzing frame histograms...", "success");
                                    updateTimeline(prev => {
                                      const next = [...prev];
                                      next[selectedClipIndex].isProcessing = true;
                                      return next;
                                    });
                                    
                                    setTimeout(() => {
                                      showNotification("Detecting temporal boundaries...", "success");
                                      setTimeout(() => {
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          const original = { ...next[selectedClipIndex] };
                                          
                                          // Simulate splitting into 2 scenes
                                          const scene1 = { 
                                            ...original, 
                                            id: Math.random().toString(36).substr(2, 9),
                                            isProcessing: false,
                                            label: "Scene A"
                                          };
                                          const scene2 = { 
                                            ...original, 
                                            id: Math.random().toString(36).substr(2, 9),
                                            isProcessing: false,
                                            label: "Scene B"
                                          };
                                          
                                          next.splice(selectedClipIndex, 1, scene1, scene2);
                                          return next;
                                        });
                                        showNotification("Split complete: 2 scenes found", "success");
                                        setSelectedClipIndex(null); 
                                      }, 1500);
                                    }, 1000);
                                  }}
                                  disabled={timeline[selectedClipIndex].isProcessing}
                                  className={`text-[9px] font-bold uppercase py-1 px-2 rounded flex items-center gap-1 transition-all ${
                                    timeline[selectedClipIndex].isProcessing 
                                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50' 
                                      : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 shadow-sm shadow-orange-500/5'
                                  }`}
                                >
                                  <Sparkles className="w-2.5 h-2.5" />
                                  {timeline[selectedClipIndex].isProcessing ? 'Processing...' : 'Detect & Split'}
                                </button>
                              </div>
                              <p className="text-[9px] text-zinc-600 italic leading-tight">
                                Automatically identify and split transitions, cuts, and location changes into individual clips.
                              </p>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Sparkles className="w-3 h-3 text-orange-500" />
                                  AI Background Removal
                                </label>
                                <div 
                                  onClick={() => {
                                    updateTimeline(prev => {
                                      const next = [...prev];
                                      next[selectedClipIndex].bgRemoved = !next[selectedClipIndex].bgRemoved;
                                      if (!next[selectedClipIndex].replacementType) {
                                        next[selectedClipIndex].replacementType = 'transparent';
                                      }
                                      return next;
                                    });
                                    if (!timeline[selectedClipIndex].bgRemoved) {
                                      showNotification("Analyzing scene for background extraction...", "success");
                                    }
                                  }}
                                  className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${timeline[selectedClipIndex].bgRemoved ? 'bg-orange-500' : 'bg-zinc-800'}`}
                                >
                                  <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${timeline[selectedClipIndex].bgRemoved ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                              </div>

                              {timeline[selectedClipIndex].bgRemoved && (
                                <motion.div 
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="space-y-4 bg-zinc-950 p-4 rounded-xl border border-white/5 overflow-hidden"
                                >
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-zinc-600 uppercase font-bold">Mask Threshold</span>
                                      <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].maskThreshold || 50}%</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={timeline[selectedClipIndex].maskThreshold || 50}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].maskThreshold = val;
                                          return next;
                                        }, false);
                                      }}
                                      onMouseUp={() => updateTimeline(timeline)}
                                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <span className="text-[10px] text-zinc-600 uppercase font-bold">Replacement</span>
                                    <div className="grid grid-cols-3 gap-2">
                                      {['transparent', 'color', 'image', 'video'].map(type => (
                                        <button 
                                          key={type}
                                          onClick={() => {
                                            updateTimeline(prev => {
                                              const next = [...prev];
                                              next[selectedClipIndex].replacementType = type;
                                              if (type === 'color' && !next[selectedClipIndex].replacementValue) {
                                                next[selectedClipIndex].replacementValue = '#000000';
                                              }
                                              return next;
                                            });
                                          }}
                                          className={`px-2 py-1.5 rounded-md text-[9px] font-bold uppercase transition-all border ${
                                            timeline[selectedClipIndex].replacementType === type 
                                              ? 'border-orange-500 bg-orange-500/10 text-orange-500' 
                                              : 'border-white/5 bg-zinc-900 text-zinc-600'
                                          }`}
                                        >
                                          {type}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {timeline[selectedClipIndex].replacementType === 'video' && (
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                                        <button 
                                          onClick={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.accept = 'video/*';
                                            input.onchange = (e) => {
                                              const file = (e.target as HTMLInputElement).files?.[0];
                                              if (file) {
                                                const url = URL.createObjectURL(file);
                                                updateTimeline(prev => {
                                                  const next = [...prev];
                                                  next[selectedClipIndex].replacementValue = url;
                                                  return next;
                                                });
                                                showNotification("Background video uploaded");
                                              }
                                            };
                                            input.click();
                                          }}
                                          className="flex-shrink-0 w-12 h-12 rounded-lg border-2 border-dashed border-white/10 flex items-center justify-center hover:border-orange-500/50 hover:bg-orange-500/5 transition-all group"
                                        >
                                          <Upload className="w-4 h-4 text-zinc-600 group-hover:text-orange-500" />
                                        </button>
                                        {timeline.filter((_, i) => i !== selectedClipIndex).map((clip, i) => (
                                          <div 
                                            key={i}
                                            onClick={() => {
                                              updateTimeline(prev => {
                                                const next = [...prev];
                                                next[selectedClipIndex].replacementValue = clip.url;
                                                return next;
                                              });
                                            }}
                                            className={`flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                                              timeline[selectedClipIndex].replacementValue === clip.url ? 'border-orange-500' : 'border-transparent'
                                            }`}
                                          >
                                            {clip.isStatic ? <img src={clip.url} className="w-full h-full object-cover" /> : <video src={clip.url} className="w-full h-full object-cover" />}
                                          </div>
                                        ))}
                                      </div>
                                      <input 
                                        type="text"
                                        placeholder="Or Video URL..."
                                        value={timeline[selectedClipIndex].replacementValue || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].replacementValue = val;
                                            return next;
                                          }, false);
                                        }}
                                        className="w-full bg-zinc-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-zinc-400 placeholder:text-zinc-700 outline-none focus:border-orange-500/50"
                                      />
                                    </div>
                                  )}

                                  {timeline[selectedClipIndex].replacementType === 'color' && (
                                    <div className="flex items-center gap-3 p-2 bg-zinc-900 rounded-lg">
                                      <input 
                                        type="color"
                                        value={timeline[selectedClipIndex].replacementValue || '#000000'}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].replacementValue = val;
                                            return next;
                                          }, false);
                                        }}
                                        className="w-6 h-6 border-0 p-0 bg-transparent cursor-pointer"
                                      />
                                      <span className="text-[10px] font-mono text-zinc-500">{timeline[selectedClipIndex].replacementValue || '#000000'}</span>
                                    </div>
                                  )}

                                  {timeline[selectedClipIndex].replacementType === 'image' && (
                                    <input 
                                      type="text"
                                      placeholder="Image URL..."
                                      value={timeline[selectedClipIndex].replacementValue || ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].replacementValue = val;
                                          return next;
                                        }, false);
                                      }}
                                      className="w-full bg-zinc-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-zinc-400 placeholder:text-zinc-700 outline-none focus:border-orange-500/50"
                                    />
                                  )}
                                </motion.div>
                              )}
                            </div>

                            <div className="space-y-4 pt-4 border-t border-white/5">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                  <Filter className="w-3 h-3 text-orange-500" />
                                  Chroma Key (Green Screen)
                                </label>
                                <div 
                                  onClick={() => {
                                    updateTimeline(prev => {
                                      const next = [...prev];
                                      const isTurningOn = !next[selectedClipIndex].chromaKey?.enabled;
                                      next[selectedClipIndex].chromaKey = {
                                        enabled: isTurningOn,
                                        color: next[selectedClipIndex].chromaKey?.color || '#00ff00',
                                        tolerance: next[selectedClipIndex].chromaKey?.tolerance || 30,
                                        smoothness: next[selectedClipIndex].chromaKey?.smoothness || 10
                                      };
                                      if (isTurningOn) {
                                        showNotification("Optimizing chroma-key mask calculations...", "success");
                                      }
                                      return next;
                                    });
                                  }}
                                  className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${timeline[selectedClipIndex].chromaKey?.enabled ? 'bg-orange-500' : 'bg-zinc-800'}`}
                                >
                                  <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${timeline[selectedClipIndex].chromaKey?.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                              </div>

                              {timeline[selectedClipIndex].chromaKey?.enabled && (
                                <motion.div 
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="space-y-4 bg-zinc-950 p-4 rounded-xl border border-white/5 overflow-hidden"
                                >
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-zinc-600 uppercase font-bold">Key Color</span>
                                      <div className="flex items-center gap-2">
                                        <div 
                                          className="w-3 h-3 rounded" 
                                          style={{ backgroundColor: timeline[selectedClipIndex].chromaKey.color }} 
                                        />
                                        <span className="text-[10px] font-mono text-zinc-500">{timeline[selectedClipIndex].chromaKey.color}</span>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-5 gap-2">
                                      {['#00ff00', '#0000ff', '#ff0000', '#ffffff', '#000000'].map(c => (
                                        <button 
                                          key={c}
                                          onClick={() => {
                                            updateTimeline(prev => {
                                              const next = [...prev];
                                              next[selectedClipIndex].chromaKey.color = c;
                                              return next;
                                            });
                                          }}
                                          className={`h-6 rounded-md border transition-all ${
                                            timeline[selectedClipIndex].chromaKey.color === c ? 'border-orange-500' : 'border-white/10'
                                          }`}
                                          style={{ backgroundColor: c }}
                                        />
                                      ))}
                                    </div>
                                    <input 
                                      type="color" 
                                      value={timeline[selectedClipIndex].chromaKey.color}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].chromaKey.color = val;
                                          return next;
                                        }, false);
                                      }}
                                      className="w-full h-8 rounded-md bg-zinc-800 border-none cursor-pointer p-1"
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-zinc-600 uppercase font-bold">Tolerance</span>
                                      <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].chromaKey.tolerance}%</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="1"
                                      max="100"
                                      value={timeline[selectedClipIndex].chromaKey.tolerance}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].chromaKey.tolerance = val;
                                          return next;
                                        }, false);
                                      }}
                                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-zinc-600 uppercase font-bold">Smoothness</span>
                                      <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].chromaKey.smoothness}%</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="0"
                                      max="50"
                                      value={timeline[selectedClipIndex].chromaKey.smoothness}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].chromaKey.smoothness = val;
                                          return next;
                                        }, false);
                                      }}
                                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    />
                                  </div>
                                </motion.div>
                              )}
                            </div>

                            <div className="space-y-3">
                              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                <Layers className="w-3 h-3" />
                                Overlays
                              </label>
                              <div className="space-y-2">
                                {[
                                  { name: 'Film Grain', active: true },
                                  { name: 'Lens Flare', active: false },
                                  { name: 'VHS Glitch', active: false }
                                ].map(o => (
                                  <div key={o.name} className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-white/5">
                                    <span className="text-xs text-zinc-400">{o.name}</span>
                                    <div className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${o.active ? 'bg-orange-500' : 'bg-zinc-800'}`}>
                                      <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${o.active ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : inspectorTab === 'voice' ? (
                          <div className="space-y-6">
                            <div className="space-y-3">
                              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                <Volume2 className="w-3 h-3 text-orange-500" />
                                Clip Narration
                              </label>
                              
                              {timeline[selectedClipIndex].voiceover ? (
                                <div className="space-y-3">
                                  <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center">
                                        <Volume2 className="w-4 h-4 text-black" />
                                      </div>
                                      <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">Narration Ready</span>
                                    </div>
                                    <button 
                                      onClick={() => {
                                        const newTimeline = [...timeline];
                                        delete newTimeline[selectedClipIndex].voiceover;
                                        updateTimeline(newTimeline);
                                      }}
                                      className="p-1.5 hover:bg-red-500/20 rounded text-red-500 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <audio 
                                    src={timeline[selectedClipIndex].voiceover} 
                                    controls 
                                    className="w-full h-8 opacity-60 hover:opacity-100 transition-opacity"
                                  />
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <textarea 
                                    value={voicePrompt}
                                    onChange={(e) => setVoicePrompt(e.target.value)}
                                    placeholder="Enter text for the AI to speak..."
                                    className="w-full bg-zinc-950 border border-white/5 rounded-xl p-4 text-xs min-h-[100px] focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-none transition-all"
                                  />
                                  
                                  <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-bold text-zinc-600">Voice Persona</label>
                                    <div className="grid grid-cols-2 gap-2">
                                      {['Kore', 'Puck', 'Charon', 'Zephyr'].map(voice => (
                                        <button 
                                          key={voice}
                                          onClick={() => setSelectedVoice(voice)}
                                          className={`px-3 py-2 rounded-lg text-[10px] font-bold transition-all border ${
                                            selectedVoice === voice 
                                              ? 'border-orange-500 bg-orange-500/5 text-orange-500' 
                                              : 'border-white/5 bg-zinc-950 text-zinc-500 hover:border-white/10'
                                          }`}
                                        >
                                          {voice}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <button 
                                    disabled={isGeneratingVoice || !voicePrompt}
                                    onClick={handleGenerateVoiceover}
                                    className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                                  >
                                    {isGeneratingVoice ? (
                                      <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                                    ) : (
                                      <>
                                        <Mic className="w-3.5 h-3.5" />
                                        Generate Voiceover
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                            
                            <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/10 flex items-start gap-3">
                              <Info className="w-4 h-4 text-orange-500 mt-0.5" />
                              <p className="text-[10px] text-zinc-500 leading-relaxed italic">
                                Voiceover is synced to the start of the clip. Use "Studio Ghibli" vibe for better results.
                              </p>
                            </div>
                          </div>
                        ) : inspectorTab === 'music' ? (
                          <div className="space-y-6">
                            <div className="space-y-3">
                              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                <Sparkles className="w-3 h-3 text-orange-500" />
                                AI Music Generation
                              </label>

                              {timeline[selectedClipIndex].music ? (
                                <div className="space-y-3">
                                  <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center">
                                        <Volume2 className="w-4 h-4 text-black" />
                                      </div>
                                      <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">Atmosphere Active</span>
                                    </div>
                                    <button 
                                      onClick={() => {
                                        const newTimeline = [...timeline];
                                        delete newTimeline[selectedClipIndex].music;
                                        updateTimeline(newTimeline);
                                      }}
                                      className="p-1.5 hover:bg-red-500/20 rounded text-red-500 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <audio 
                                    src={timeline[selectedClipIndex].music} 
                                    controls 
                                    className="w-full h-8 opacity-60 hover:opacity-100 transition-opacity"
                                  />
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div className="grid grid-cols-2 gap-2">
                                    {['Cyberpunk', 'Lo-Fi', 'Epic Orchestral', 'Dark Synth'].map(genre => (
                                      <button 
                                        key={genre}
                                        onClick={() => setMusicPrompt(genre)}
                                        className={`px-3 py-2 rounded-lg text-[10px] font-bold transition-all border ${
                                          musicPrompt === genre 
                                            ? 'border-orange-500 bg-orange-500/5 text-orange-500' 
                                            : 'border-white/5 bg-zinc-950 text-zinc-500 hover:border-white/10'
                                        }`}
                                      >
                                        {genre}
                                      </button>
                                    ))}
                                  </div>

                                  <textarea 
                                    value={musicPrompt}
                                    onChange={(e) => setMusicPrompt(e.target.value)}
                                    placeholder="Describe the sound (e.g. 'Upbeat tropical house with steel drums')..."
                                    className="w-full bg-zinc-950 border border-white/5 rounded-xl p-4 text-xs min-h-[100px] focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-none transition-all"
                                  />

                                  <button 
                                    disabled={isGeneratingMusic || !musicPrompt}
                                    onClick={handleGenerateMusic}
                                    className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                                  >
                                    {isGeneratingMusic ? (
                                      <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                                    ) : (
                                      <>
                                        <Volume2 className="w-3.5 h-3.5" />
                                        Compose Music
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                            
                            <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/10 flex items-start gap-3">
                              <Info className="w-4 h-4 text-orange-500 mt-0.5" />
                              <p className="text-[10px] text-zinc-500 leading-relaxed italic">
                                Music will loop automatically to fill the duration of the clip.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            <div className="space-y-3">
                              <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                <Type className="w-3 h-3 text-orange-500" />
                                Text Overlay
                              </label>
                              
                              <div className="space-y-4">
                                <textarea 
                                  value={timeline[selectedClipIndex].textOverlay?.text || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    updateTimeline(prev => {
                                      const next = [...prev];
                                      next[selectedClipIndex].textOverlay = {
                                        ...(next[selectedClipIndex].textOverlay || { size: 48, color: '#ffffff', x: 50, y: 50, font: 'Inter' }),
                                        text: val
                                      };
                                      return next;
                                    }, false);
                                  }}
                                  onBlur={() => {
                                    updateTimeline(timeline);
                                  }}
                                  placeholder="Type your overlay text here..."
                                  className="w-full bg-zinc-950 border border-white/5 rounded-xl p-4 text-xs min-h-[80px] focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-none transition-all"
                                />

                                <div className="space-y-3">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-zinc-600 uppercase font-bold">Size</span>
                                    <span className="text-[10px] font-mono text-orange-500">{(timeline[selectedClipIndex].textOverlay?.size || 48)}px</span>
                                  </div>
                                  <input 
                                    type="range"
                                    min="12"
                                    max="120"
                                    value={timeline[selectedClipIndex].textOverlay?.size || 48}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      updateTimeline(prev => {
                                        const next = [...prev];
                                        next[selectedClipIndex].textOverlay = {
                                          ...(next[selectedClipIndex].textOverlay || { text: '', color: '#ffffff', x: 50, y: 50, font: 'Inter' }),
                                          size: val
                                        };
                                        return next;
                                      }, false);
                                    }}
                                    onMouseUp={() => {
                                      updateTimeline(timeline);
                                    }}
                                    onTouchEnd={() => {
                                      updateTimeline(timeline);
                                    }}
                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                  />
                                </div>

                                <div className="space-y-3">
                                  <span className="text-[10px] text-zinc-600 uppercase font-bold">Color</span>
                                  <div className="flex gap-2">
                                    {['#ffffff', '#000000', '#f97316', '#eab308', '#ef4444', '#3b82f6'].map(c => (
                                      <button 
                                        key={c}
                                        onClick={() => {
                                          const newTimeline = [...timeline];
                                          newTimeline[selectedClipIndex].textOverlay = {
                                            ...(newTimeline[selectedClipIndex].textOverlay || { text: '', size: 48, x: 50, y: 50, font: 'Inter' }),
                                            color: c
                                          };
                                          updateTimeline(newTimeline);
                                        }}
                                        style={{ backgroundColor: c }}
                                        className={`w-6 h-6 rounded-full border ${timeline[selectedClipIndex].textOverlay?.color === c ? 'border-orange-500 ring-2 ring-orange-500/20' : 'border-white/10'}`}
                                      />
                                    ))}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-zinc-600 uppercase font-bold">Pos X</span>
                                      <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].textOverlay?.x || 50}%</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={timeline[selectedClipIndex].textOverlay?.x || 50}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].textOverlay = {
                                            ...(next[selectedClipIndex].textOverlay || { text: '', size: 48, color: '#ffffff', y: 50, font: 'Inter' }),
                                            x: val
                                          };
                                          return next;
                                        }, false);
                                      }}
                                      onMouseUp={() => {
                                        updateTimeline(timeline);
                                      }}
                                      onTouchEnd={() => {
                                        updateTimeline(timeline);
                                      }}
                                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-zinc-600 uppercase font-bold">Pos Y</span>
                                      <span className="text-[10px] font-mono text-orange-500">{timeline[selectedClipIndex].textOverlay?.y || 50}%</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={timeline[selectedClipIndex].textOverlay?.y || 50}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateTimeline(prev => {
                                          const next = [...prev];
                                          next[selectedClipIndex].textOverlay = {
                                            ...(next[selectedClipIndex].textOverlay || { text: '', size: 48, color: '#ffffff', x: 50, font: 'Inter' }),
                                            y: val
                                          };
                                          return next;
                                        }, false);
                                      }}
                                      onMouseUp={() => {
                                        updateTimeline(timeline);
                                      }}
                                      onTouchEnd={() => {
                                        updateTimeline(timeline);
                                      }}
                                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    />
                                  </div>
                                </div>

                                <div className="space-y-4 pt-2 border-t border-white/5">
                                  <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                                    <Sparkles className="w-3 h-3 text-orange-500" />
                                    Text Animation
                                  </label>
                                  
                                  <div className="grid grid-cols-2 gap-2">
                                    {['None', 'Fade', 'Slide', 'Typewriter'].map(type => (
                                      <button 
                                        key={type}
                                        onClick={() => {
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].textOverlay = {
                                              ...(next[selectedClipIndex].textOverlay || { text: '', size: 48, color: '#ffffff', x: 50, y: 50 }),
                                              animationType: type.toLowerCase(),
                                              animationDuration: next[selectedClipIndex].textOverlay?.animationDuration || 1
                                            };
                                            return next;
                                          });
                                        }}
                                        className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-all border ${
                                          (timeline[selectedClipIndex].textOverlay?.animationType || 'none') === type.toLowerCase()
                                            ? 'border-orange-500 bg-orange-500/10 text-orange-500' 
                                            : 'border-white/5 bg-zinc-900 text-zinc-600 hover:text-zinc-400'
                                        }`}
                                      >
                                        {type}
                                      </button>
                                    ))}
                                  </div>

                                  {(timeline[selectedClipIndex].textOverlay?.animationType && timeline[selectedClipIndex].textOverlay.animationType !== 'none') && (
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[10px] text-zinc-600 uppercase font-bold">Anim Duration</span>
                                        <span className="text-[10px] font-mono text-orange-500">{(timeline[selectedClipIndex].textOverlay.animationDuration || 1).toFixed(1)}s</span>
                                      </div>
                                      <input 
                                        type="range"
                                        min="0.2"
                                        max="3"
                                        step="0.1"
                                        value={timeline[selectedClipIndex].textOverlay.animationDuration || 1}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value);
                                          updateTimeline(prev => {
                                            const next = [...prev];
                                            next[selectedClipIndex].textOverlay = {
                                              ...next[selectedClipIndex].textOverlay,
                                              animationDuration: val
                                            };
                                            return next;
                                          }, false);
                                        }}
                                        onMouseUp={() => updateTimeline(timeline)}
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                      />
                                    </div>
                                  )}
                                </div>

                                <div className="space-y-2">
                                  <label className="text-[10px] uppercase font-bold text-zinc-600">Font Style</label>
                                  <div className="grid grid-cols-2 gap-2">
                                    {['Inter', 'Space Grotesk', 'Outfit', 'JetBrains Mono'].map(f => (
                                      <button 
                                        key={f}
                                        onClick={() => {
                                          const newTimeline = [...timeline];
                                          newTimeline[selectedClipIndex].textOverlay = {
                                            ...(newTimeline[selectedClipIndex].textOverlay || { text: '', size: 48, color: '#ffffff', x: 50, y: 50 }),
                                            font: f
                                          };
                                          updateTimeline(newTimeline);
                                        }}
                                        className={`px-3 py-2 rounded-lg text-[10px] font-bold transition-all border ${
                                          (timeline[selectedClipIndex].textOverlay?.font || 'Inter') === f 
                                            ? 'border-orange-500 bg-orange-500/5 text-orange-500' 
                                            : 'border-white/5 bg-zinc-950 text-zinc-500 hover:border-white/10'
                                        }`}
                                        style={{ fontFamily: f }}
                                      >
                                        {f}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <button className="w-full py-4 bg-orange-500 text-black rounded-xl font-bold text-sm shadow-xl shadow-orange-500/20 active:scale-[0.98] transition-all">
                          Apply Changes
                        </button>

                        <div className="pt-4 border-t border-white/5 space-y-4">
                          <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                            <ImageIcon className="w-3 h-3 text-orange-500" />
                            GIF Export Options
                          </label>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <span className="text-[9px] text-zinc-600 uppercase font-bold pl-1">Resolution</span>
                              <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-white/5">
                                {['240p', '480p'].map(res => (
                                  <button 
                                    key={res}
                                    onClick={() => setGifConfig(prev => ({ ...prev, resolution: res }))}
                                    className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${gifConfig.resolution === res ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-600'}`}
                                  >
                                    {res}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[9px] text-zinc-600 uppercase font-bold pl-1">FPS</span>
                              <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-white/5">
                                {[10, 24].map(fps => (
                                  <button 
                                    key={fps}
                                    onClick={() => setGifConfig(prev => ({ ...prev, frameRate: fps }))}
                                    className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${gifConfig.frameRate === fps ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-600'}`}
                                  >
                                    {fps}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          <button 
                            disabled={isExportingGif}
                            onClick={handleExportGif}
                            className="w-full py-3 bg-zinc-800 hover:bg-white hover:text-black disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 relative overflow-hidden"
                          >
                            {isExportingGif ? (
                              <div className="flex items-center gap-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Exporting {Math.round(gifProgress)}%</span>
                                <div 
                                  className="absolute bottom-0 left-0 h-[2px] bg-orange-500 transition-all duration-300" 
                                  style={{ width: `${gifProgress}%` }}
                                />
                              </div>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                Export as GIF
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/5 rounded-3xl">
                      <Clock className="w-8 h-8 text-zinc-800 mb-4" />
                      <p className="text-xs text-zinc-600 leading-relaxed">Select a clip in the track to adjust properties and effects.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <>
              {/* Hero Prompt Section */}
              <div className="space-y-8">
            <header className="space-y-4">
              <motion.h2 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-6xl font-semibold tracking-tighter leading-[0.9]"
              >
                Create <span className="italic font-serif">anything</span><br />
                with AI Video.
              </motion.h2>
              <p className="text-zinc-400 max-w-md text-lg leading-relaxed">
                Transform your text into cinematic stories. Powered by Google Veo for unparalleled quality and motion.
              </p>
            </header>

            <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl space-y-6">
              <div className="flex flex-wrap gap-2">
                {['Cinematic', 'Anime', '3D Render', 'Cyberpunk', 'VHS Retro', 'Abstract'].map(v => (
                  <button
                    key={v}
                    onClick={() => setVibe(v)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wide uppercase transition-all ${
                      vibe === v 
                        ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' 
                        : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-white/5'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <div className="relative group">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A golden retriever astronaut floating in zero-gravity garden..."
                  className="w-full bg-zinc-950 border border-white/5 rounded-xl p-5 min-h-[140px] text-lg resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all placeholder:text-zinc-700"
                />
                <div className="absolute bottom-4 right-4 flex items-center gap-4">
                  <div className="flex bg-zinc-900 border border-white/10 rounded-lg p-1.5 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] uppercase font-bold text-zinc-600 pl-1">Ratio</span>
                      <select 
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        className="bg-zinc-800 text-white text-[10px] font-bold px-3 py-1.5 rounded-md border-none focus:ring-1 focus:ring-orange-500 cursor-pointer outline-none"
                      >
                        <option value="16:9">16:9 Cinematic</option>
                        <option value="9:16">9:16 Vertical</option>
                        <option value="1:1">1:1 Square</option>
                      </select>
                    </div>

                    <div className="w-[1px] h-8 bg-white/10 self-center" />

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] uppercase font-bold text-zinc-600 pl-1">Quality</span>
                      <select 
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        className="bg-zinc-800 text-white text-[10px] font-bold px-3 py-1.5 rounded-md border-none focus:ring-1 focus:ring-orange-500 cursor-pointer outline-none"
                      >
                        <option value="720p">720p HD</option>
                        <option value="1080p">1080p Full HD</option>
                        <option value="4k">4k Ultra HD</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      disabled={isGenerating || isGeneratingStill || !prompt}
                      onClick={handleGenerateStill}
                      className="group bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-700 text-zinc-300 px-5 py-3 rounded-lg font-bold flex items-center gap-2 transition-all active:scale-95 border border-white/5"
                    >
                      {isGeneratingStill ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <ImageIcon className="w-5 h-5 opacity-70 group-hover:opacity-100" />
                          Still
                        </>
                      )}
                    </button>

                    <button 
                      disabled={isGenerating || isGeneratingStill || !prompt}
                      onClick={handleGenerate}
                      className="group bg-orange-500 hover:bg-orange-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-orange-500/20"
                    >
                      {isGenerating ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          Generate
                          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-6 pt-2">
                <div className="flex items-center gap-2 text-zinc-500 text-xs">
                  <Zap className="w-3 h-3" />
                  <span>Cost: 5 Credits</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-500 text-xs">
                  <Play className="w-3 h-3" />
                  <span>Duration: 6s</span>
                </div>
                <div className="ml-auto flex items-center gap-2 text-zinc-600 text-[10px] uppercase font-bold tracking-widest cursor-help">
                  <Info className="w-3 h-3" />
                  Prompting Tips
                </div>
              </div>
            </div>
          </div>

          {/* Gallery of Ideas */}
          {!currentVideo && !isGenerating && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              {[
                { title: 'Dreamy Landscapes', prompt: 'A surreal floating island with pink waterfalls and glowing bioluminescent trees during golden hour.', vibeText: 'Cinematic' },
                { title: 'Cyberpunk Streets', prompt: 'Neon-drenched Tokyo street in 2077 with rain puddles and flying cars reflected in glass.', vibeText: 'Cyberpunk' },
                { title: 'Studio Ghibli Vibes', prompt: 'A peaceful meadow with a small cottage, puffy white clouds, and a gentle breeze blowing through the grass.', vibeText: 'Anime' },
                { title: 'Experimental Motion', prompt: 'Liquid chrome spheres colliding and merging in an infinitely white void.', vibeText: 'Abstract' }
              ].map((idea, i) => (
                <div 
                  key={i} 
                  className="group p-6 rounded-2xl bg-zinc-900/30 border border-white/5 hover:border-orange-500/30 hover:bg-zinc-900/50 transition-all cursor-pointer"
                  onClick={() => {
                    setPrompt(idea.prompt);
                    setVibe(idea.vibeText);
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-500">{idea.vibeText}</span>
                    <Plus className="w-4 h-4 text-zinc-700 group-hover:text-white transition-colors" />
                  </div>
                  <h4 className="text-lg font-medium mb-2 group-hover:text-orange-500 transition-colors">{idea.title}</h4>
                  <p className="text-xs text-zinc-500 line-clamp-2 italic">"{idea.prompt}"</p>
                </div>
              ))}
            </motion.div>
          )}

          {/* Result / Preview Section */}
          <AnimatePresence mode="wait">
            {(currentVideo || isGenerating) && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`relative ${
                  aspectRatio === '16:9' ? 'aspect-video w-full' : 
                  aspectRatio === '9:16' ? 'aspect-[9/16] h-[600px] mx-auto' : 
                  'aspect-square h-[600px] mx-auto'
                } rounded-3xl overflow-hidden bg-zinc-900 border border-white/10 shadow-2xl group transition-all duration-500`}
              >
                {isGenerating ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center space-y-6">
                    <div className="relative">
                      <div className="w-24 h-24 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles className="w-8 h-8 text-orange-500 animate-pulse" />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-xl font-medium">Baking your vision...</p>
                      <p className="text-zinc-500 text-sm">Processing cinematic motion ({Math.floor(progress)}%)</p>
                    </div>
                    <div className="w-64 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className="h-full bg-orange-500 shadow-[0_0_10px_orange]"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    {currentVideo && currentVideo.startsWith('data:image') ? (
                      <img 
                        src={currentVideo} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <video 
                        src={currentVideo!} 
                        controls 
                        autoPlay 
                        loop 
                        className="w-full h-full object-cover"
                      />
                    )}
                    
                    {/* Watermark */}
                    <div className="absolute bottom-6 left-8 pointer-events-none transition-opacity opacity-40 group-hover:opacity-70">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/40 backdrop-blur-md rounded-lg flex items-center justify-center border border-white/10">
                          <Video className="w-4 h-4 text-orange-500" />
                        </div>
                        <div className="text-left">
                          <div className="text-[10px] font-black tracking-[0.3em] uppercase text-white shadow-sm">
                            LUMINA <span className="text-orange-500">AI</span>
                          </div>
                          <div className="text-[8px] font-mono uppercase tracking-widest text-zinc-400 mt-0.5">
                            {new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-3 bg-black/50 backdrop-blur-md rounded-full hover:bg-black/80 transition-all border border-white/10">
                        <Download className="w-5 h-5" />
                      </button>
                      <button className="p-3 bg-black/50 backdrop-blur-md rounded-full hover:bg-black/80 transition-all border border-white/10">
                        <Share2 className="w-5 h-5" />
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </section>

        {/* Sidebar History/Stats */}
        <aside className="space-y-12">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">History</h3>
              <History className="w-4 h-4 text-zinc-600" />
            </div>
            
            <div className="space-y-4">
              {history.length === 0 ? (
                <div className="p-6 rounded-2xl border border-dashed border-white/5 text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center mx-auto">
                    <History className="w-5 h-5 text-zinc-600" />
                  </div>
                  <p className="text-xs text-zinc-600">No videos generated yet. Your studio is empty.</p>
                </div>
              ) : (
                history.map((item, idx) => (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={idx} 
                    className="p-3 rounded-xl bg-zinc-900/50 border border-white/5 hover:border-orange-500/30 transition-all cursor-pointer group"
                    onClick={() => {
                      setCurrentVideo(item.url);
                      if (isEditorOpen) {
                        updateTimeline(prev => [...prev, item]);
                      }
                    }}
                  >
                    <div className="aspect-video bg-zinc-950 rounded-lg overflow-hidden mb-3 relative">
                      {item.isStatic || item.url.startsWith('data:image') ? (
                        <img src={item.url} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" referrerPolicy="no-referrer" />
                      ) : (
                        <video src={item.url} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/60 backdrop-blur-[2px] gap-3">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(item.prompt);
                            showNotification("Prompt copied to clipboard");
                          }}
                          className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-white rounded-full transition-all"
                          title="Copy Prompt"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                        <button 
                          className="p-3 bg-orange-500 hover:bg-orange-400 text-black rounded-full shadow-lg transition-all active:scale-95"
                          onClick={() => {
                            setCurrentVideo(item.url);
                            if (isEditorOpen) {
                              updateTimeline(prev => [...prev, item]);
                              showNotification("Clip added to timeline");
                            }
                          }}
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                      {item.prompt}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-2 font-mono">{new Date(item.date).toLocaleTimeString()}</p>
                  </motion.div>
                ))
              )}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/10 space-y-4 relative overflow-hidden">
            <div className="absolute top-[-20%] right-[-20%] w-32 h-32 bg-orange-500/10 rounded-full blur-2xl" />
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-500" />
              Pro Features
            </h3>
            <ul className="space-y-3">
              {[
                { label: 'Longer Clips', value: 'Up to 30s' },
                { label: '4K Rendering', value: 'UNLOCKED', active: true },
                { label: 'Ad-Free', value: 'Forever' }
              ].map(f => (
                <li key={f.label} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{f.label}</span>
                  <span className={`font-mono ${f.active ? 'text-orange-500 font-bold' : 'text-zinc-300'}`}>{f.value}</span>
                </li>
              ))}
            </ul>
            <button className="w-full py-2 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-orange-500 transition-all active:scale-95">
              GET UNLIMITED ACCESS
            </button>
          </div>
        </aside>
      </main>

      {/* Floating Footer Stats */}
      <footer className="fixed bottom-0 left-0 right-0 p-6 z-20 pointer-events-none">
        <div className="max-w-7xl mx-auto flex items-center justify-between pointer-events-auto">
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full flex items-center gap-4 text-[10px] font-bold tracking-widest text-zinc-400">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              SYSTEMS ONLINE
            </div>
            <div className="w-[1px] h-3 bg-white/10" />
            <div className="text-orange-500 uppercase tracking-tighter">{resolution} ULTRA-HD ACTIVE</div>
            <div className="w-[1px] h-3 bg-white/10" />
            <div className="text-white">API V3.1 PRO (VEO)</div>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="bg-black/40 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400">
              <Sparkles className="w-3 h-3 text-orange-500" />
              BETA ACCESS: 2.1K/5K SLOTS
            </div>
          </div>
        </div>
      </footer>

      {/* Dynamic SVG Filters for Custom Effects */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          <filter id="motion-blur-filter">
            <feGaussianBlur 
              in="SourceGraphic" 
              stdDeviation={
                selectedClipIndex !== null ? (
                  timeline[selectedClipIndex].blurDirection === 0 ? `${timeline[selectedClipIndex].blurIntensity || 0} 0` :
                  timeline[selectedClipIndex].blurDirection === 90 ? `0 ${timeline[selectedClipIndex].blurIntensity || 0}` :
                  `${(timeline[selectedClipIndex].blurIntensity || 0) * 0.7} ${(timeline[selectedClipIndex].blurIntensity || 0) * 0.7}`
                ) : "0 0"
              } 
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
