import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactECharts from 'echarts-for-react';
import { 
  Upload, Music, Activity, Disc, Sparkles, Volume2, 
  VolumeX, Play, Pause, RefreshCw, Scissors, BarChart2 
} from 'lucide-react';

const API_BASE = "http://localhost:8000";

export default function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [analysis, setAnalysis] = useState(null);
  
  // Audio playback and mixing console states
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
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
    other: useRef(null)
  };
  
  const animationRef = useRef(null);

  // Sync playback trigger
  useEffect(() => {
    if (!analysis) return;
    
    const stems = ['vocals', 'drums', 'bass', 'other'];
    if (isPlaying) {
      // Play all stems in sync
      stems.forEach(stem => {
        const audio = audioRefs[stem].current;
        if (audio) {
          audio.volume = isStemMuted(stem) ? 0 : stemVolumes[stem];
          audio.play().catch(e => console.error("Playback error on stem:", stem, e));
        }
      });
      // Start animation loop for scrubber
      const updateScrubber = () => {
        // Use vocals stem as the master timer
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
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, analysis]);

  // Adjust volumes and mute states
  useEffect(() => {
    ['vocals', 'drums', 'bass', 'other'].forEach(stem => {
      const audio = audioRefs[stem].current;
      if (audio) {
        audio.volume = isStemMuted(stem) ? 0 : stemVolumes[stem];
      }
    });
  }, [stemVolumes, stemMutes, stemSolos]);

  // Generate Google FX Prompt automatically when analysis is loaded or events change
  useEffect(() => {
    if (!analysis) return;
    
    const { bpm, key, camelot, timbre, danceability, energy, valence, time_signature } = analysis.analysis;
    
    let text = `# =========================================================================\n`;
    text += `# GOOGLE FX / MUSICFX GENERATIVE PROMPT (EXTRACTED AUDIO DNA)\n`;
    text += `# =========================================================================\n\n`;
    
    text += `## GLOBAL IDENTITY\n`;
    text += `- Tempo: ${bpm} BPM (exact beat speed)\n`;
    text += `- Root Key & Scale: ${key} (Camelot Code: ${camelot})\n`;
    text += `- Meter: ${time_signature} time signature\n`;
    text += `- Overall Timbre: ${timbre}\n`;
    text += `- Danceability: ${danceability}% (rhythmic regularity & beat consistency)\n`;
    text += `- Energy Level: ${energy}% (perceived intensity and speed)\n`;
    text += `- Valence: ${valence}% (emotional color: ${valence > 50 ? 'positive/bright/cheerful' : 'sad/dark/moody'})\n\n`;
    
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
    });
    
    text += `\n# =========================================================================\n`;
    text += `# RAW PROMPT FOR MUSICFX INPUT FIELD\n`;
    text += `# =========================================================================\n`;
    text += `A high-quality track at ${bpm} BPM, key of ${key} (${camelot}), ${time_signature} time signature. `;
    text += `Timbre style is ${timbre.toLowerCase()} (danceability: ${danceability}%, energy: ${energy}%, valence: ${valence}%). `;
    
    // Condensed layout of events
    const eventSummaries = analysis.events.map(evt => {
      return `from ${formatTime(evt.start)} to ${formatTime(evt.end)} is a ${evt.label.toLowerCase()} (${evt.energy_state.toLowerCase()}, ${evt.percussiveness.toLowerCase()} drums)`;
    }).join(", ");
    
    text += `Structure progression: ${eventSummaries}.`;
    
    setPromptText(text);
  }, [analysis]);

  // Upload handler
  const handleUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    
    setFile(uploadedFile);
    setLoading(true);
    setLoadingStage('Starting analysis pipeline...');
    
    const formData = new FormData();
    formData.append("file", uploadedFile);
    
    try {
      setLoadingStage('Extracting features (BPM, Scale, Timbre)...');
      // Wait for analysis
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

  const handleScrubberChange = (e) => {
    const val = parseFloat(e.target.value);
    setPlaybackTime(val);
    ['vocals', 'drums', 'bass', 'other'].forEach(stem => {
      const audio = audioRefs[stem].current;
      if (audio) {
        audio.currentTime = val;
      }
    });
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
        textStyle: { color: '#fafafa' }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
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
            <label className="upload-zone">
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
          )}
        </div>
      )}

      {analysis && (
        <>
          {/* KPI Summary Cards */}
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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
              <div style={{ display: 'flex', justifyBetween: 'space-between', alignItems: 'center' }}>
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
              <div style={{ display: 'flex', justifyBetween: 'space-between', alignItems: 'center' }}>
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
              <div style={{ display: 'flex', justifyBetween: 'space-between', alignItems: 'center' }}>
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

          {/* Master Media Player Controls */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div className="player-container">
              <button className="btn btn-primary" onClick={() => setIsPlaying(!isPlaying)}>
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                {isPlaying ? "Pause" : "Play Stem Mix"}
              </button>
              
              <span className="time-display">{formatTime(playbackTime)}</span>
              <input 
                type="range" 
                min={0} 
                max={analysis.analysis.duration} 
                step={0.1}
                value={playbackTime} 
                onChange={handleScrubberChange}
                className="timeline-scrubber" 
              />
              <span className="time-display">{formatTime(analysis.analysis.duration)}</span>
            </div>
          </div>

          {/* Split Dashboard Content */}
          <div className="main-layout">
            
            {/* Left Panel: Analytics Charts, Waveforms & Stems */}
            <div className="panel-left">
              
              {/* Stem Mixing Lanes */}
              <div className="card">
                <h3 style={{ margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Scissors size={20} style={{ color: 'var(--accent-color)' }} /> Stem Mixing Console
                </h3>
                <div className="stem-lanes-container">
                  {['vocals', 'drums', 'bass', 'other'].map(stem => {
                    const timeline = analysis.stems[stem].timeline;
                    const maxRms = timeline.length > 0 ? Math.max(...timeline.map(t => t.rms)) : 1;
                    const frameIdx = Math.floor(playbackTime);
                    const currentRms = timeline[frameIdx] ? timeline[frameIdx].rms : 0;
                    
                    return (
                      <div className="stem-lane-row" key={stem}>
                        <div className="stem-info">
                          <span className="stem-title">{stem}</span>
                          <div className="stem-controls" style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
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
                        <div className="stem-visualizer">
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
                <div style={{ height: '350px' }}>
                  <ReactECharts option={getTimelineChartOption()} style={{ height: '100%' }} />
                </div>
              </div>

            </div>

            {/* Right Panel: Prompt Generator & Event Boundaries */}
            <div className="panel-right">
              
              {/* Real-time Chroma Analysis */}
              <div className="card">
                <h3 style={{ margin: '0 0 1rem 0' }}>Live Note Intensity (Chroma)</h3>
                <div style={{ height: '180px' }}>
                  <ReactECharts option={getRealtimeChartOption()} style={{ height: '100%' }} />
                </div>
              </div>

              {/* Event Boundaries list */}
              <div className="card">
                <h3 style={{ margin: '0 0 1rem 0' }}>Macro Event Segments</h3>
                <div className="event-list">
                  {analysis.events.map(evt => {
                    const isSelected = selectedEventId === evt.id;
                    return (
                      <div 
                        className="event-item" 
                        key={evt.id}
                        onClick={() => setSelectedEventId(evt.id)}
                        style={{ borderColor: isSelected ? 'var(--accent-color)' : '' }}
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

              {/* Generative Prompt Box */}
              <div className="card">
                <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', justifyBetween: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Sparkles size={18} style={{ color: '#f59e0b' }} /> Perfect Google FX Prompt
                  </span>
                </h3>
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

            </div>

          </div>
        </>
      )}
    </div>
  );
}
