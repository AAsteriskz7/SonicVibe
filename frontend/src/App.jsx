import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactECharts from 'echarts-for-react';
import { 
  Upload, Music, Activity, Disc, Sparkles, Volume2, 
  VolumeX, Play, Pause, RefreshCw, Scissors, BarChart2,
  History, Trash2
} from 'lucide-react';

const API_BASE = "http://localhost:8000";

export default function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [lyricsInput, setLyricsInput] = useState("");
  const [enableLyrics, setEnableLyrics] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState("lyrics");
  const [showRawLyrics, setShowRawLyrics] = useState(false);
  const [history, setHistory] = useState([]);

  const fetchHistory = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/history`);
      setHistory(res.data);
    } catch (err) {
      console.error("Error fetching history:", err);
    }
  };

  useEffect(() => {
    if (!analysis) {
      fetchHistory();
    }
  }, [analysis]);

  const handleLoadHistoryItem = async (sessionId) => {
    setLoading(true);
    setLoadingStage("Loading cached analysis...");
    try {
      const res = await axios.get(`${API_BASE}/api/history/${sessionId}`);
      setAnalysis(res.data);
      setFile({ name: res.data.filename });
    } catch (err) {
      alert("Failed to load saved analysis: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteHistoryItem = async (e, sessionId) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this analysis session? This will remove all audio files from disk.")) return;
    try {
      await axios.delete(`${API_BASE}/api/history/${sessionId}`);
      fetchHistory();
    } catch (err) {
      alert("Failed to delete analysis session: " + err.message);
    }
  };
  
  // Audio playback and mixing console states
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [activePlaybackMode, setActivePlaybackMode] = useState("master"); // "master" or stem name
  const [individualPlaying, setIndividualPlaying] = useState({
    vocals: false,
    drums: false,
    bass: false,
    other: false
  });
  const [individualTimes, setIndividualTimes] = useState({
    vocals: 0,
    drums: 0,
    bass: 0,
    other: 0
  });

  // Prompt customization toggles
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [includeEvents, setIncludeEvents] = useState(true);
  const [includeStems, setIncludeStems] = useState(true);
  const [includeLyrics, setIncludeLyrics] = useState(true);

  const [stemVolumes, setStemVolumes] = useState({
    vocals: 0.8,
    drums: 0.8,
    bass: 0.8,
    other: 0.8
  });
  const [stemMutes, setStemMutes] = useState({
    vocals: false,
    drums: false,
    bass: false,
    other: false
  });
  const [stemSolos, setStemSolos] = useState({
    vocals: false,
    drums: false,
    bass: false,
    other: false
  });

  const isStemMuted = (stem) => {
    // If in individual playback mode, mute all except the actively selected stem
    if (activePlaybackMode !== "master") {
      return activePlaybackMode !== stem;
    }
    const hasActiveSolo = Object.values(stemSolos).some(v => v);
    if (hasActiveSolo) {
      return !stemSolos[stem];
    }
    return stemMutes[stem];
  };
  
  const [selectedEventId, setSelectedEventId] = useState(0);
  const [promptText, setPromptText] = useState("");
  
  // Refs for HTML5 Audio elements
  const audioRefs = {
    vocals: useRef(null),
    drums: useRef(null),
    bass: useRef(null),
    other: useRef(null),
    original: useRef(null)
  };
  
  const animationRef = useRef(null);

  // Sync or individual playback trigger
  useEffect(() => {
    if (!analysis) return;
    
    const stems = ['vocals', 'drums', 'bass', 'other'];

    if (activePlaybackMode === "master") {
      // Pause original audio if it exists
      if (audioRefs.original.current) audioRefs.original.current.pause();

      if (isPlaying) {
        // Play all stems in sync
        stems.forEach(stem => {
          const audio = audioRefs[stem].current;
          if (audio) {
            audio.volume = isStemMuted(stem) ? 0 : stemVolumes[stem];
            if (Math.abs(audio.currentTime - playbackTime) > 0.15) {
              audio.currentTime = playbackTime;
            }
            audio.play().catch(e => console.error("Playback error on stem:", stem, e));
          }
        });
        
        // Start animation loop for master scrubber
        const updateScrubber = () => {
          const master = audioRefs.vocals.current;
          if (master) {
            setPlaybackTime(master.currentTime);
            if (master.ended) {
              setIsPlaying(false);
            } else {
              animationRef.current = requestAnimationFrame(updateScrubber);
            }
          }
        };
        animationRef.current = requestAnimationFrame(updateScrubber);
      } else {
        // Pause all stems
        stems.forEach(stem => {
          const audio = audioRefs[stem].current;
          if (audio) audio.pause();
        });
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      }
    } else if (activePlaybackMode === "original") {
      // Pause all stems
      stems.forEach(stem => {
        const audio = audioRefs[stem].current;
        if (audio) audio.pause();
      });

      const orig = audioRefs.original.current;
      if (orig) {
        if (isPlaying) {
          if (Math.abs(orig.currentTime - playbackTime) > 0.15) {
            orig.currentTime = playbackTime;
          }
          orig.play().catch(e => console.error("Playback error on original:", e));

          const updateOrigScrubber = () => {
            if (orig) {
              setPlaybackTime(orig.currentTime);
              if (orig.ended) {
                setIsPlaying(false);
              } else {
                animationRef.current = requestAnimationFrame(updateOrigScrubber);
              }
            }
          };
          animationRef.current = requestAnimationFrame(updateOrigScrubber);
        } else {
          orig.pause();
          if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }
      }
    } else {
      // Pause original audio if it exists
      if (audioRefs.original.current) audioRefs.original.current.pause();

      // Individual playback mode
      const activeStem = activePlaybackMode;
      const activeAudio = audioRefs[activeStem].current;
      
      // Pause other stems
      stems.forEach(stem => {
        if (stem !== activeStem) {
          const audio = audioRefs[stem].current;
          if (audio) audio.pause();
        }
      });

      if (individualPlaying[activeStem]) {
        if (activeAudio) {
          activeAudio.volume = stemVolumes[activeStem]; // bypass mutes for solo individual play
          activeAudio.play().catch(e => {});
          
          const updateStemScrubber = () => {
            if (activeAudio) {
              setIndividualTimes(prev => ({ ...prev, [activeStem]: activeAudio.currentTime }));
              if (activeAudio.ended) {
                setIndividualPlaying(prev => ({ ...prev, [activeStem]: false }));
              } else {
                animationRef.current = requestAnimationFrame(updateStemScrubber);
              }
            }
          };
          animationRef.current = requestAnimationFrame(updateStemScrubber);
        }
      } else {
        if (activeAudio) activeAudio.pause();
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      }
    }
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, activePlaybackMode, individualPlaying, analysis]);

  // Adjust volumes and mute states
  useEffect(() => {
    ['vocals', 'drums', 'bass', 'other'].forEach(stem => {
      const audio = audioRefs[stem].current;
      if (audio) {
        audio.volume = isStemMuted(stem) ? 0 : stemVolumes[stem];
      }
    });
  }, [stemVolumes, stemMutes, stemSolos, activePlaybackMode]);

  // Generate Google FX Prompt automatically when analysis is loaded or toggles change
  useEffect(() => {
    if (!analysis) return;
    
    const { bpm, key, camelot, timbre, danceability, energy, valence, time_signature } = analysis.analysis;
    
    let text = `# =========================================================================\n`;
    text += `# GOOGLE FX / MUSICFX GENERATIVE PROMPT (EXTRACTED AUDIO DNA)\n`;
    text += `# =========================================================================\n\n`;
    
    if (includeGlobal) {
      text += `## GLOBAL IDENTITY\n`;
      text += `- Tempo: ${bpm} BPM (exact beat speed)\n`;
      text += `- Root Key & Scale: ${key} (Camelot Code: ${camelot})\n`;
      text += `- Meter: ${time_signature} time signature\n`;
      text += `- Overall Timbre: ${timbre}\n`;
      text += `- Danceability: ${danceability}% (rhythmic regularity & beat consistency)\n`;
      text += `- Energy Level: ${energy}% (perceived intensity and speed)\n`;
      text += `- Valence: ${valence}% (emotional color: ${valence > 50 ? 'positive/bright/cheerful' : 'sad/dark/moody'})\n\n`;
    }
    
    if (includeEvents) {
      text += `## TIME-SERIES TIMELINE & SEGMENT ACTION MAP\n`;
      
      analysis.events.forEach(evt => {
        text += `\n### [${formatTime(evt.start)} - ${formatTime(evt.end)}] Section ${evt.id + 1}: ${evt.label}\n`;
        text += `- Energy Profile: ${evt.energy_state} (Loudness level: ${(evt.average_loudness * 100).toFixed(0)}%)\n`;
        text += `- Rhythm & Texture: ${evt.percussiveness} percussiveness\n`;
        
        // Calculate dynamic average values for this segment
        const range = analysis.timeline.slice(evt.start, evt.end);
        if (range.length > 0) {
          const avgRolloff = range.reduce((sum, r) => sum + r.rolloff, 0) / range.length;
          const avgFlux = range.reduce((sum, r) => sum + r.flux, 0) / range.length;
          const avgCentroid = range.reduce((sum, r) => sum + r.centroid, 0) / range.length;
          
          // Dynamic Rolloff Descriptor
          let freqDesc = "Balanced frequency spectrum";
          if (avgRolloff > 3500) freqDesc = "Crisp, bright high frequencies dominate (vocals, high-hats, sharp synths)";
          else if (avgRolloff < 1200) freqDesc = "Deep, warm low frequencies dominate (sub bass, sub kicks, warm pads)";
          text += `- Frequency Distribution: ${freqDesc} (Spectral centroid: ${avgCentroid.toFixed(0)} Hz)\n`;
          
          // Dynamic Flux Descriptor
          let transitionDesc = "Stable, steady arrangement";
          if (avgFlux > 0.35) transitionDesc = "High flux: sudden energy transitions, active instrumentation changes";
          text += `- Arrangement Activity: ${transitionDesc}\n`;
          
          // Pitch/Harmonics
          const meanChroma = range[0].chroma.map((_, colIdx) => 
            range.reduce((sum, row) => sum + row.chroma[colIdx], 0) / range.length
          );
          const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          const dominantNotes = meanChroma
            .map((val, idx) => ({ note: pitchClasses[idx], val }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 3)
            .map(n => n.note)
            .join(', ');
          text += `- Dominant Harmonics: [${dominantNotes}]\n`;
        }
        
        if (includeStems) {
          // Dynamic Stem Balance analysis for this segment
          const stems = ['vocals', 'drums', 'bass', 'other'];
          const stemAverages = {};
          stems.forEach(stem => {
            const stemTimeline = analysis.stems[stem]?.timeline || [];
            const segmentStemPoints = stemTimeline.slice(evt.start, evt.end);
            if (segmentStemPoints.length > 0) {
              const avgRms = segmentStemPoints.reduce((sum, p) => sum + p.rms, 0) / segmentStemPoints.length;
              stemAverages[stem] = avgRms;
            } else {
              stemAverages[stem] = 0;
            }
          });
          
          text += `- Stem Balances:\n`;
          text += `  * Vocals Volume: ${(stemAverages.vocals * 100).toFixed(0)}%\n`;
          text += `  * Drums Volume: ${(stemAverages.drums * 100).toFixed(0)}%\n`;
          text += `  * Bass Volume: ${(stemAverages.bass * 100).toFixed(0)}%\n`;
          text += `  * Other Instruments: ${(stemAverages.other * 100).toFixed(0)}%\n`;
        }
      });
    }
    
    if (includeLyrics && analysis.lyrics && analysis.lyrics.length > 0) {
      text += `\n# =========================================================================\n`;
      text += `# TRANSCRIBED LYRICS TIMELINE (SYNCED TO VOCALS)\n`;
      text += `# =========================================================================\n`;
      analysis.lyrics.forEach(line => {
        text += `[${formatTime(line.start)} - ${formatTime(line.end)}]: "${line.text}"\n`;
      });
    }
    
    text += `\n# =========================================================================\n`;
    text += `# RAW PROMPT FOR MUSICFX INPUT FIELD\n`;
    text += `# =========================================================================\n`;
    text += `A high-quality track at ${bpm} BPM, key of ${key} (${camelot}), ${time_signature} time signature. `;
    text += `Timbre style is ${timbre.toLowerCase()} (danceability: ${danceability}%, energy: ${energy}%, valence: ${valence}%). `;
    
    if (includeEvents) {
      const eventSummaries = analysis.events.map(evt => {
        return `from ${formatTime(evt.start)} to ${formatTime(evt.end)} is a ${evt.label.toLowerCase()} (${evt.energy_state.toLowerCase()}, ${evt.percussiveness.toLowerCase()} drums)`;
      }).join(", ");
      text += `Structure progression: ${eventSummaries}.`;
    }
    
    setPromptText(text);
  }, [analysis, includeGlobal, includeEvents, includeStems, includeLyrics]);

  // Upload handler
  const triggerUpload = async (uploadedFile) => {
    setFile(uploadedFile);
    setLoading(true);
    setLoadingStage('Starting analysis pipeline...');
    
    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("enable_lyrics", enableLyrics ? "true" : "false");
    if (enableLyrics && lyricsInput) {
      formData.append("lyrics", lyricsInput);
    }
    
    try {
      setLoadingStage('Splitting stems and extracting MIR features...');
      const res = await axios.post(`${API_BASE}/api/analyze`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (res.data.success) {
        setAnalysis(res.data);
      }
    } catch (err) {
      console.error(err);
      alert("Error parsing audio. Make sure the backend server is running.");
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  };

  const handleUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (uploadedFile) {
      triggerUpload(uploadedFile);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('audio/')) {
      triggerUpload(droppedFile);
    } else {
      alert("Please drop a valid audio file.");
    }
  };

  const seekToTime = (newTime) => {
    setPlaybackTime(newTime);
    if (activePlaybackMode === "master") {
      ['vocals', 'drums', 'bass', 'other'].forEach(s => {
        const audio = audioRefs[s].current;
        if (audio) audio.currentTime = newTime;
      });
    } else if (activePlaybackMode === "original") {
      if (audioRefs.original.current) {
        audioRefs.original.current.currentTime = newTime;
      }
    } else {
      const audio = audioRefs[activePlaybackMode].current;
      if (audio) audio.currentTime = newTime;
      setIndividualTimes(prev => ({ ...prev, [activePlaybackMode]: newTime }));
    }
  };

  const handleSwitchPlaybackMode = (mode) => {
    // Pause everything first
    ['vocals', 'drums', 'bass', 'other'].forEach(stem => {
      if (audioRefs[stem].current) audioRefs[stem].current.pause();
    });
    if (audioRefs.original.current) audioRefs.original.current.pause();

    setActivePlaybackMode(mode);
    
    // Sync playheads to current playbackTime
    if (mode === "master") {
      ['vocals', 'drums', 'bass', 'other'].forEach(stem => {
        if (audioRefs[stem].current) audioRefs[stem].current.currentTime = playbackTime;
      });
    } else if (mode === "original") {
      if (audioRefs.original.current) audioRefs.original.current.currentTime = playbackTime;
    }
  };

  const handleScrubberChange = (e) => {
    const val = parseFloat(e.target.value);
    seekToTime(val);
  };

  const handleStemScrubberChange = (stem, val) => {
    if (activePlaybackMode === stem) {
      const audio = audioRefs[stem].current;
      if (audio) audio.currentTime = val;
      setIndividualTimes(prev => ({ ...prev, [stem]: val }));
    } else {
      seekToTime(val);
    }
  };

  const handleMasterPlayToggle = () => {
    if (activePlaybackMode !== "master" && activePlaybackMode !== "original") {
      setIndividualPlaying({ vocals: false, drums: false, bass: false, other: false });
      ['vocals', 'drums', 'bass', 'other'].forEach(stem => {
        const audio = audioRefs[stem].current;
        if (audio) audio.currentTime = playbackTime;
      });
      setActivePlaybackMode("master");
    }
    setIsPlaying(!isPlaying);
  };

  const handleStemPlayToggle = (stem) => {
    if (isPlaying) {
      setIsPlaying(false);
    }
    if (activePlaybackMode === "master" || activePlaybackMode !== stem) {
      setIndividualPlaying({ vocals: false, drums: false, bass: false, other: false });
      const audio = audioRefs[stem].current;
      if (audio) {
        audio.currentTime = playbackTime;
        setIndividualTimes(prev => ({ ...prev, [stem]: playbackTime }));
      }
      setActivePlaybackMode(stem);
      setIndividualPlaying(prev => ({ ...prev, [stem]: true }));
    } else {
      setIndividualPlaying(prev => ({ ...prev, [stem]: !individualPlaying[stem] }));
    }
  };

  const toggleMute = (stem) => {
    setStemMutes(prev => ({ ...prev, [stem]: !prev[stem] }));
  };

  const toggleSolo = (stem) => {
    setStemSolos(prev => ({ ...prev, [stem]: !prev[stem] }));
  };

  const adjustVolume = (stem, val) => {
    setStemVolumes(prev => ({ ...prev, [stem]: val }));
  };

  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  // Timeline chart configs (Loudness, Spectral Flux, Zero Crossing)
  const getTimelineChartOption = () => {
    if (!analysis) return {};
    const seconds = analysis.timeline.map(t => t.second);
    const rms = analysis.timeline.map(t => t.rms);
    const flux = analysis.timeline.map(t => t.flux);
    const zcr = analysis.timeline.map(t => t.zcr);
    
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0c0c0f',
        borderColor: '#1e1e24',
        textStyle: { color: '#fafafa' }
      },
      legend: {
        data: ['Loudness (RMS)', 'Spectral Flux', 'Zero Crossing Rate'],
        textStyle: { color: '#fafafa' },
        bottom: 0,
        orient: 'horizontal'
      },
      grid: {
        left: '3%',
        right: '4%',
        top: '12%',
        bottom: '15%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: seconds.map(s => formatTime(s)),
        axisLine: { lineStyle: { color: '#1e1e24' } },
        axisLabel: { color: '#71717a' }
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#1e1e24' } },
        axisLabel: { color: '#71717a' },
        splitLine: { lineStyle: { color: '#1e1e24' } }
      },
      series: [
        {
          name: 'Loudness (RMS)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          color: '#3b82f6',
          lineStyle: { width: 3 },
          data: rms
        },
        {
          name: 'Spectral Flux',
          type: 'line',
          smooth: true,
          showSymbol: false,
          color: '#8b5cf6',
          lineStyle: { width: 2 },
          data: flux
        },
        {
          name: 'Zero Crossing Rate',
          type: 'line',
          smooth: true,
          showSymbol: false,
          color: '#10b981',
          lineStyle: { width: 2 },
          data: zcr
        }
      ]
    };
  };

  // Real-time MFCC/Chroma chart at current playback time
  const getRealtimeChartOption = () => {
    if (!analysis) return {};
    const currSec = Math.floor(playbackTime);
    const frame = analysis.timeline[currSec] || analysis.timeline[0];
    
    if (!frame) return {};
    
    const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0c0c0f',
        borderColor: '#1e1e24',
        textStyle: { color: '#fafafa' }
      },
      grid: {
        top: '15%',
        left: '5%',
        right: '5%',
        bottom: '15%'
      },
      xAxis: {
        type: 'category',
        data: pitchClasses,
        axisLine: { lineStyle: { color: '#1e1e24' } },
        axisLabel: { color: '#71717a' }
      },
      yAxis: {
        type: 'value',
        max: 1.0,
        axisLine: { lineStyle: { color: '#1e1e24' } },
        splitLine: { lineStyle: { color: '#1e1e24' } }
      },
      series: [
        {
          type: 'bar',
          data: frame.chroma,
          color: '#8b5cf6',
          itemStyle: {
            borderRadius: [4, 4, 0, 0]
          }
        }
      ]
    };
  };

  return (
    <div className="app-container">
      {/* Dynamic Hidden Audio Elements */}
      {analysis && (
        <>
          <audio ref={audioRefs.vocals} src={`${API_BASE}${analysis.stems.vocals.url}`} loop />
          <audio ref={audioRefs.drums} src={`${API_BASE}${analysis.stems.drums.url}`} loop />
          <audio ref={audioRefs.bass} src={`${API_BASE}${analysis.stems.bass.url}`} loop />
          <audio ref={audioRefs.other} src={`${API_BASE}${analysis.stems.other.url}`} loop />
          {analysis.stems.original && (
            <audio ref={audioRefs.original} src={`${API_BASE}${analysis.stems.original.url}`} loop />
          )}
        </>
      )}

      {/* Header */}
      <header className="app-header">
        <div className="app-title-container">
          <h1>SonicVibe</h1>
          <p>Local Music Analysis Pipeline, Stem Splitter & Prompt Generator</p>
        </div>
        {analysis && (
          <button className="btn btn-secondary" onClick={() => { setAnalysis(null); setFile(null); setIsPlaying(false); }}>
            <RefreshCw size={16} /> Analyze New Song
          </button>
        )}
      </header>

      {/* Main Upload / Loader Area */}
      {!analysis && (
        <>
          <div className="card" style={{ padding: '4rem 2rem' }}>
            {loading ? (
              <div className="loading-container">
                <div className="spinner"></div>
                <div style={{ textAlign: 'center' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0' }}>Analyzing Audio Track</h3>
                  <p style={{ color: '#71717a', margin: 0 }}>{loadingStage}</p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '600px', margin: '0 auto' }}>
                <label 
                  className={`upload-zone ${isDragging ? 'drag-active' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input type="file" accept="audio/*" onChange={handleUpload} style={{ display: 'none' }} />
                  <Upload className="upload-icon" />
                  <div className="upload-text">
                    <h3>Drag & Drop your audio file here</h3>
                    <p>Supports MP3, WAV, FLAC, M4A up to 50MB</p>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: '1rem' }}>
                    Choose File
                  </button>
                </label>

                <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0e0e12', padding: '0.75rem 1.25rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>Enable Vocal Lyric Alignment (Uses Whisper ASR)</span>
                  <input 
                    type="checkbox" 
                    checked={enableLyrics} 
                    onChange={(e) => setEnableLyrics(e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </div>

                {enableLyrics && (
                  <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: '#0e0e12', textAlign: 'left' }}>
                    <label className="kpi-label" style={{ fontSize: '0.8rem' }}>Paste Lyrics (Optional - Guides timing alignment accuracy)</label>
                    <textarea 
                      placeholder="Paste your lyrics here to help Whisper align the timings perfectly..." 
                      value={lyricsInput} 
                      onChange={(e) => setLyricsInput(e.target.value)}
                      style={{
                        width: '100%',
                        height: '100px',
                        background: '#07070a',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        padding: '0.5rem 0.75rem',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        fontSize: '0.85rem',
                        resize: 'none',
                        outline: 'none'
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* History Dashboard */}
          {!loading && history && history.length > 0 && (
            <div style={{ maxWidth: '600px', margin: '2rem auto 0 auto', textAlign: 'left' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                <History size={18} style={{ color: 'var(--accent-color)' }} /> Previously Analyzed Tracks
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {history.map((item) => (
                  <div 
                    key={item.session_id} 
                    className="card animate-in" 
                    onClick={() => handleLoadHistoryItem(item.session_id)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '1rem 1.25rem', 
                      cursor: 'pointer',
                      border: '1px solid var(--border-color)',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-color)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0, flex: 1, paddingRight: '1rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.filename}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Key: {item.analysis?.key} • {item.analysis?.bpm} BPM • {item.analysis?.timbre}
                      </span>
                      <span style={{ fontSize: '0.65rem', color: '#52525b', fontFamily: 'var(--font-mono)' }}>
                        Analyzed: {new Date(item.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
                        onClick={() => handleLoadHistoryItem(item.session_id)}
                      >
                        Load
                      </button>
                      <button 
                        className="btn" 
                        style={{ 
                          padding: '0.45rem', 
                          background: 'rgba(239, 68, 68, 0.08)', 
                          color: '#f87171',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: 'none',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.16)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.08)'}
                        onClick={(e) => handleDeleteHistoryItem(e, item.session_id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {analysis && (
        <>
          {/* KPI Summary Cards */}
          <div className="kpi-grid">
            <div className="card kpi-card">
              <div className="kpi-info">
                <span className="kpi-label">Tempo</span>
                <span className="kpi-value">{analysis.analysis.bpm} BPM</span>
                <span className="kpi-desc">Global track tempo</span>
              </div>
              <div className="kpi-icon"><Activity size={20} /></div>
            </div>
            
            <div className="card kpi-card">
              <div className="kpi-info">
                <span className="kpi-label">Harmonic Key</span>
                <span className="kpi-value">{analysis.analysis.key}</span>
                <span className="kpi-desc">Chroma template matched</span>
              </div>
              <div className="kpi-icon"><Disc size={20} /></div>
            </div>
            
            <div className="card kpi-card">
              <div className="kpi-info">
                <span className="kpi-label">Camelot Code</span>
                <span className="kpi-value">{analysis.analysis.camelot}</span>
                <span className="kpi-desc">DJ friendly transition key</span>
              </div>
              <div className="kpi-icon"><Music size={20} /></div>
            </div>
            
            <div className="card kpi-card">
              <div className="kpi-info">
                <span className="kpi-label">Overall Timbre</span>
                <span className="kpi-value" style={{ fontSize: '1.15rem' }}>{analysis.analysis.timbre.split(' (')[0]}</span>
                <span className="kpi-desc">Brightness centroid match</span>
              </div>
              <div className="kpi-icon"><Sparkles size={20} /></div>
            </div>

            <div className="card kpi-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="kpi-info">
                  <span className="kpi-label">Danceability</span>
                  <span className="kpi-value">{analysis.analysis.danceability}%</span>
                </div>
                <div className="kpi-icon" style={{ background: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent-purple)' }}><Sparkles size={18} /></div>
              </div>
              <div style={{ background: '#18181b', height: '6px', borderRadius: '3px', overflow: 'hidden', marginTop: '0.25rem' }}>
                <div style={{ background: 'var(--accent-purple)', height: '100%', width: `${analysis.analysis.danceability}%` }}></div>
              </div>
            </div>

            <div className="card kpi-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="kpi-info">
                  <span className="kpi-label">Energy</span>
                  <span className="kpi-value">{analysis.analysis.energy}%</span>
                </div>
                <div className="kpi-icon" style={{ background: 'rgba(244, 63, 94, 0.1)', color: 'var(--accent-rose)' }}><Activity size={18} /></div>
              </div>
              <div style={{ background: '#18181b', height: '6px', borderRadius: '3px', overflow: 'hidden', marginTop: '0.25rem' }}>
                <div style={{ background: 'var(--accent-rose)', height: '100%', width: `${analysis.analysis.energy}%` }}></div>
              </div>
            </div>

            <div className="card kpi-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="kpi-info">
                  <span className="kpi-label">Valence</span>
                  <span className="kpi-value">{analysis.analysis.valence}%</span>
                </div>
                <div className="kpi-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-emerald)' }}><Sparkles size={18} /></div>
              </div>
              <div style={{ background: '#18181b', height: '6px', borderRadius: '3px', overflow: 'hidden', marginTop: '0.25rem' }}>
                <div style={{ background: 'var(--accent-emerald)', height: '100%', width: `${analysis.analysis.valence}%` }}></div>
              </div>
            </div>

            <div className="card kpi-card">
              <div className="kpi-info">
                <span className="kpi-label">Meter</span>
                <span className="kpi-value">{analysis.analysis.time_signature}</span>
                <span className="kpi-desc">Estimated time signature</span>
              </div>
              <div className="kpi-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-color)' }}><Disc size={20} /></div>
            </div>
          </div>

          {/* Split Dashboard Content */}
          <div className="main-layout">
            
            {/* Left Panel: Analytics Charts, Waveforms & Stems */}
            <div className="panel-left">
              
              {/* Stem Mixing Lanes */}
              <div className="card">
                <h3 style={{ margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Scissors size={20} style={{ color: 'var(--accent-color)' }} /> Stem Mixing Console
                  </span>
                  
                  {/* Playback Mode Switcher */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className={`btn ${activePlaybackMode !== 'original' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                      onClick={() => handleSwitchPlaybackMode("master")}
                    >
                      Stems Mix
                    </button>
                    {analysis.stems.original && (
                      <button 
                        className={`btn ${activePlaybackMode === 'original' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                        onClick={() => handleSwitchPlaybackMode("original")}
                      >
                        original Audio
                      </button>
                    )}
                  </div>
                </h3>
                <div className="stem-lanes-container" style={{ position: 'relative' }}>
                  {activePlaybackMode === "original" && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'rgba(12, 12, 15, 0.88)',
                      backdropFilter: 'blur(3px)',
                      zIndex: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                      borderRadius: '8px',
                      gap: '0.5rem',
                      border: '1px solid var(--border-color)',
                      textAlign: 'center',
                      padding: '1rem'
                    }}>
                      <Disc size={32} className="spin" style={{ color: 'var(--accent-color)', marginBottom: '0.25rem' }} />
                      <span style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                        Playing original Audio Track
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Faders and solo controls are disabled in original playback mode.
                      </span>
                    </div>
                  )}
                  {['vocals', 'drums', 'bass', 'other'].map(stem => {
                    const timeline = analysis.stems[stem].timeline;
                    const maxRms = timeline.length > 0 ? Math.max(...timeline.map(t => t.rms)) : 1;
                    const currentTime = activePlaybackMode === stem ? individualTimes[stem] : playbackTime;
                    const frameIdx = Math.floor(currentTime);
                    
                    return (
                      <div className="stem-lane-row" key={stem}>
                        <div className="stem-info">
                          <span className="stem-title" style={{ color: activePlaybackMode === stem ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {stem} {activePlaybackMode === stem && "(Solo Play)"}
                          </span>
                          <div className="stem-controls" style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                            <button 
                              className="btn btn-secondary" 
                              style={{ 
                                padding: '0.2rem 0.4rem', 
                                fontSize: '0.7rem', 
                                background: activePlaybackMode === stem && individualPlaying[stem] ? 'var(--accent-emerald)' : '#27272a',
                                border: 'none'
                              }} 
                              onClick={() => handleStemPlayToggle(stem)}
                              title="Play Stem Independently"
                            >
                              {activePlaybackMode === stem && individualPlaying[stem] ? <Pause size={12} /> : <Play size={12} />}
                            </button>
                            <button 
                              className="btn btn-secondary" 
                              style={{ 
                                padding: '0.2rem 0.4rem', 
                                fontSize: '0.7rem', 
                                background: isStemMuted(stem) ? '#f43f5e' : '#27272a',
                                border: 'none'
                              }} 
                              onClick={() => toggleMute(stem)}
                              title="Mute"
                            >
                              <VolumeX size={12} />
                            </button>
                            <button 
                              className="btn btn-secondary" 
                              style={{ 
                                padding: '0.2rem 0.4rem', 
                                fontSize: '0.7rem', 
                                background: stemSolos[stem] ? '#f59e0b' : '#27272a',
                                color: stemSolos[stem] ? '#000' : '#fff',
                                fontWeight: 'bold',
                                border: 'none'
                              }} 
                              onClick={() => toggleSolo(stem)}
                              title="Solo"
                            >
                              S
                            </button>
                            <a 
                              href={`${API_BASE}${analysis.stems[stem].url}`} 
                              download={`${stem}.wav`}
                              className="btn btn-secondary"
                              style={{ 
                                padding: '0.2rem 0.4rem', 
                                fontSize: '0.7rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                border: 'none'
                              }}
                              title="Download Stem"
                            >
                              ↓
                            </a>
                            <input 
                              type="range" 
                              min={0} 
                              max={1} 
                              step={0.05} 
                              value={isStemMuted(stem) ? 0 : stemVolumes[stem]} 
                              onChange={(e) => adjustVolume(stem, parseFloat(e.target.value))}
                              style={{ width: '45px', height: '4px', margin: 'auto 0' }}
                            />
                          </div>
                        </div>

                        {/* Interactive Lane energy visualizer */}
                        <div 
                          className="stem-visualizer"
                          style={{ position: 'relative', cursor: 'pointer' }}
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const clickX = e.clientX - rect.left;
                            const pct = clickX / rect.width;
                            const newTime = pct * analysis.analysis.duration;
                            handleStemScrubberChange(stem, newTime);
                          }}
                        >
                          {/* Sync / Playhead cursor line */}
                          <div 
                            style={{ 
                              position: 'absolute', 
                              top: 0, 
                              bottom: 0, 
                              width: '2px', 
                              background: '#ffffff', 
                              boxShadow: '0 0 6px #fff',
                              left: `${(currentTime / analysis.analysis.duration) * 100}%`,
                              zIndex: 10,
                              pointerEvents: 'none',
                              transition: 'left 0.1s linear'
                            }} 
                          />
                          {timeline.map((point, idx) => {
                            const barHeight = (point.rms / (maxRms + 1e-8)) * 100;
                            const isCurrent = idx === frameIdx;
                            return (
                              <div 
                                key={idx} 
                                className="stem-wave-bar" 
                                style={{ 
                                  height: `${Math.max(4, barHeight)}%`, 
                                  left: `${(idx / timeline.length) * 100}%`,
                                  width: `${100 / timeline.length - 0.2}%`,
                                  background: isCurrent ? 'var(--text-primary)' : stem === 'vocals' ? 'var(--accent-color)' : stem === 'drums' ? 'var(--accent-rose)' : stem === 'bass' ? 'var(--accent-emerald)' : 'var(--accent-purple)'
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Time Series Feature Chart */}
              <div className="card">
                <h3 style={{ margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <BarChart2 size={20} style={{ color: 'var(--accent-purple)' }} /> Time-Series Dynamics
                </h3>
                <div style={{ height: '260px' }}>
                  <ReactECharts option={getTimelineChartOption()} style={{ height: '100%' }} />
                </div>
              </div>

            </div>

            {/* Right Panel: Prompt Generator & Timelines */}
            <div className="panel-right">
              
              {/* Real-time Chroma Analysis */}
              <div className="card">
                <h3 style={{ margin: '0 0 1rem 0' }}>Live Note Intensity (Chroma)</h3>
                <div style={{ height: '130px' }}>
                  <ReactECharts option={getRealtimeChartOption()} style={{ height: '100%' }} />
                </div>
              </div>
              
              {/* Generative Prompt Box */}
              <div className="card">
                <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Sparkles size={18} style={{ color: '#f59e0b' }} /> Perfect Google FX Prompt
                  </span>
                </h3>
                
                {/* Prompt Customizer Checkboxes */}
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(2, 1fr)', 
                  gap: '0.5rem', 
                  marginBottom: '1rem', 
                  background: '#07070a', 
                  padding: '0.75rem', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border-color)' 
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', cursor: 'pointer', color: '#a1a1aa' }}>
                    <input type="checkbox" checked={includeGlobal} onChange={(e) => setIncludeGlobal(e.target.checked)} />
                    <span>Global Info</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', cursor: 'pointer', color: '#a1a1aa' }}>
                    <input type="checkbox" checked={includeEvents} onChange={(e) => setIncludeEvents(e.target.checked)} />
                    <span>Timeline Events</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', cursor: 'pointer', color: '#a1a1aa' }}>
                    <input type="checkbox" checked={includeStems} onChange={(e) => setIncludeStems(e.target.checked)} />
                    <span>Stem Balances</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', cursor: 'pointer', color: '#a1a1aa' }}>
                    <input type="checkbox" checked={includeLyrics} onChange={(e) => setIncludeLyrics(e.target.checked)} />
                    <span>ASR Lyrics</span>
                  </label>
                </div>

                <textarea 
                  className="prompt-area" 
                  value={promptText} 
                  onChange={(e) => setPromptText(e.target.value)} 
                />
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', marginTop: '1rem' }} 
                  onClick={() => {
                    navigator.clipboard.writeText(promptText);
                    alert("Prompt copied to clipboard!");
                  }}
                >
                  Copy Prompt
                </button>
              </div>

              {/* Tabbed Interactive Timelines */}
              {analysis.lyrics && analysis.lyrics.length > 0 ? (
                <div className="card">
                  {/* Tab Selector Headers */}
                  <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', pb: '0.75rem', marginBottom: '1rem' }}>
                    <button 
                      onClick={() => setActiveTab("lyrics")}
                      style={{
                        background: 'none',
                        border: 'none',
                        borderBottom: activeTab === 'lyrics' ? '2px solid var(--accent-emerald)' : '2px solid transparent',
                        color: activeTab === 'lyrics' ? 'var(--text-primary)' : 'var(--text-muted)',
                        paddingBottom: '0.5rem',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Aligned Lyrics
                    </button>
                    <button 
                      onClick={() => setActiveTab("segments")}
                      style={{
                        background: 'none',
                        border: 'none',
                        borderBottom: activeTab === 'segments' ? '2px solid var(--accent-color)' : '2px solid transparent',
                        color: activeTab === 'segments' ? 'var(--text-primary)' : 'var(--text-muted)',
                        paddingBottom: '0.5rem',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Macro Segments
                    </button>
                  </div>

                  {/* Tab Contents */}
                  {activeTab === "lyrics" ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                      {analysis.lyrics_input && (
                        <div style={{ marginBottom: '0.25rem' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                            onClick={() => setShowRawLyrics(!showRawLyrics)}
                          >
                            {showRawLyrics ? "Hide Uploaded Lyrics" : "View Uploaded Lyrics"}
                          </button>
                          
                          {showRawLyrics && (
                            <pre style={{ 
                              whiteSpace: 'pre-wrap', 
                              fontFamily: 'inherit', 
                              fontSize: '0.85rem', 
                              color: 'var(--text-muted)', 
                              background: '#07070a', 
                              padding: '0.75rem', 
                              borderRadius: '8px', 
                              border: '1px solid var(--border-color)',
                              marginTop: '0.5rem',
                              maxHeight: '150px',
                              overflowY: 'auto',
                              textAlign: 'left'
                            }}>
                              {analysis.lyrics_input}
                            </pre>
                          )}
                        </div>
                      )}
                      
                      <div className="event-list" style={{ maxHeight: '280px' }}>
                        {analysis.lyrics.map((line, idx) => {
                          const isCurrent = playbackTime >= line.start && playbackTime <= line.end;
                          return (
                            <div 
                              key={idx} 
                              className="event-item"
                              onClick={() => seekToTime(line.start)}
                            style={{
                              borderColor: isCurrent ? 'var(--accent-emerald)' : '',
                              background: isCurrent ? 'rgba(16, 185, 129, 0.05)' : '',
                              transform: isCurrent ? 'scale(1.01)' : '',
                              transition: 'all 0.2s ease',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <span style={{ 
                                fontSize: '0.9rem', 
                                fontWeight: isCurrent ? '700' : '400',
                                color: isCurrent ? 'var(--text-primary)' : 'var(--text-muted)'
                              }}>
                                {line.text}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#52525b' }}>
                                {formatTime(line.start)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  ) : (
                    <div className="event-list" style={{ maxHeight: '280px' }}>
                      {analysis.events.map(evt => {
                        const isSelected = selectedEventId === evt.id;
                        return (
                          <div 
                            className="event-item" 
                            key={evt.id}
                            onClick={() => setSelectedEventId(evt.id)}
                            style={{ borderColor: isSelected ? 'var(--accent-color)' : '', cursor: 'pointer' }}
                          >
                            <div className="event-details">
                              <div className="event-label-row">
                                <span className="event-label">{evt.label}</span>
                                <span className="event-time">{formatTime(evt.start)} - {formatTime(evt.end)}</span>
                              </div>
                              <span className="event-desc">{evt.energy_state} • {evt.percussiveness} percussion</span>
                            </div>
                            <div className="event-meta">
                              <span className={`event-tag ${evt.average_loudness > 0.6 ? 'tag-high' : evt.average_loudness > 0.3 ? 'tag-medium' : 'tag-low'}`}>
                                Loud: {(evt.average_loudness * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Fallback if no lyrics: just display the Macro Segments directly */
                <div className="card">
                  <h3 style={{ margin: '0 0 1rem 0' }}>Macro Event Segments</h3>
                  <div className="event-list" style={{ maxHeight: '280px' }}>
                    {analysis.events.map(evt => {
                      const isSelected = selectedEventId === evt.id;
                      return (
                        <div 
                          className="event-item" 
                          key={evt.id}
                          onClick={() => setSelectedEventId(evt.id)}
                          style={{ borderColor: isSelected ? 'var(--accent-color)' : '', cursor: 'pointer' }}
                        >
                          <div className="event-details">
                            <div className="event-label-row">
                              <span className="event-label">{evt.label}</span>
                              <span className="event-time">{formatTime(evt.start)} - {formatTime(evt.end)}</span>
                            </div>
                            <span className="event-desc">{evt.energy_state} • {evt.percussiveness} percussion</span>
                          </div>
                          <div className="event-meta">
                            <span className={`event-tag ${evt.average_loudness > 0.6 ? 'tag-high' : evt.average_loudness > 0.3 ? 'tag-medium' : 'tag-low'}`}>
                              Loud: {(evt.average_loudness * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

          </div>

          {/* Floating Bottom Media Bar */}
          <div className="floating-player">
            <div className="floating-player-info">
              <Disc size={28} className={isPlaying ? "spin" : ""} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
              <div className="floating-player-text">
                <span className="floating-player-title">{file?.name || "Master Audio Mix"}</span>
                <span className="floating-player-subtitle">
                  {activePlaybackMode === "master" ? "Synced Master Mix" : `Soloing ${activePlaybackMode.toUpperCase()}`}
                </span>
              </div>
            </div>

            <div className="floating-player-controls">
              <button className="btn btn-primary" style={{ padding: '0.5rem 0.75rem', borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={handleMasterPlayToggle}>
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>

              <span className="time-display">{formatTime(activePlaybackMode === "master" ? playbackTime : individualTimes[activePlaybackMode])}</span>
              <input 
                type="range" 
                min={0} 
                max={analysis.analysis.duration} 
                step={0.1}
                value={activePlaybackMode === "master" ? playbackTime : individualTimes[activePlaybackMode]} 
                onChange={handleScrubberChange}
                className="timeline-scrubber" 
              />
              <span className="time-display">{formatTime(analysis.analysis.duration)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
