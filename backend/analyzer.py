import numpy as np
import librosa
import scipy.signal

# Krumhansl-Schmuckler profiles for Key detection
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Camelot Code mapping: (note_idx, is_minor) -> code
# Camelot wheel has 1-12 keys.
# Major is B, Minor is A.
CAMELOT_MAP = {
    # Major (B)
    ('B', False): '1B', ('F#', False): '2B', ('C#', False): '3B', ('G#', False): '4B',
    ('D#', False): '5B', ('A#', False): '6B', ('F', False): '7B', ('C', False): '8B',
    ('G', False): '9B', ('D', False): '10B', ('A', False): '11B', ('E', False): '12B',
    # Minor (A)
    ('G#', True): '1A', ('D#', True): '2A', ('A#', True): '3A', ('F', True): '4A',
    ('C', True): '5A', ('G', True): '6A', ('D', True): '7A', ('A', True): '8A',
    ('E', True): '9A', ('B', True): '10A', ('F#', True): '11A', ('C#', True): '12A'
}

# Standard aliases for enharmonic equivalents
ENHARMONIC_ALIASES = {
    'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
    'C#m': 'C#', 'D#m': 'D#', 'F#m': 'F#', 'G#m': 'G#', 'A#m': 'A#'
}

def get_camelot_code(key_name, is_minor):
    clean_key = ENHARMONIC_ALIASES.get(key_name, key_name)
    code = CAMELOT_MAP.get((clean_key, is_minor))
    if code:
        return code
    # Fallback/Safe-check mapping
    return "8B" if not is_minor else "5A"

def estimate_key(y, sr):
    """Estimate the key and scale of the audio."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)
    
    best_corr = -1
    best_key = None
    is_minor = False
    
    for i in range(12):
        # Rotate major template
        rotated_major = np.roll(MAJOR_PROFILE, i)
        corr_major = np.corrcoef(chroma_mean, rotated_major)[0, 1]
        if corr_major > best_corr:
            best_corr = corr_major
            best_key = PITCH_CLASSES[i]
            is_minor = False
            
        # Rotate minor template
        rotated_minor = np.roll(MINOR_PROFILE, i)
        corr_minor = np.corrcoef(chroma_mean, rotated_minor)[0, 1]
        if corr_minor > best_corr:
            best_corr = corr_minor
            best_key = PITCH_CLASSES[i]
            is_minor = True
            
    key_str = f"{best_key} {'Minor' if is_minor else 'Major'}"
    camelot = get_camelot_code(best_key, is_minor)
    return key_str, camelot

def analyze_audio(file_path):
    """Deep analysis of audio file returning global and time-series metrics."""
    # Load audio (downsample to 22050 Hz for speed and compatibility)
    y, sr = librosa.load(file_path, sr=22050)
    duration = librosa.get_duration(y=y, sr=sr)
    
    # --- 1. Global Identity Features ---
    # BPM (Tempo)
    tempo_array, _ = librosa.beat.beat_track(y=y, sr=sr)
    if isinstance(tempo_array, np.ndarray):
        tempo = float(tempo_array[0]) if len(tempo_array) > 0 else 120.0
    else:
        tempo = float(tempo_array)
    tempo = round(tempo, 1)
    
    # Root Key & scale
    key_scale, camelot_code = estimate_key(y, sr)
    
    # Global Spectral Centroid
    spectral_centroids = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    global_centroid = float(np.mean(spectral_centroids))
    if global_centroid > 2300:
        timbre_desc = "Bright & Crisp (Modern Pop/Electronic)"
    elif global_centroid < 1100:
        timbre_desc = "Dark & Warm (Lofi/Vintage/Hip-Hop)"
    else:
        timbre_desc = "Balanced (Acoustic/Standard Mix)"
        
    # Estimate Danceability using Onset Strength
    onset_envelope = librosa.onset.onset_strength(y=y, sr=sr)
    onset_mean = float(np.mean(onset_envelope))
    onset_std = float(np.std(onset_envelope))
    danceability = min(98.0, max(12.0, (onset_mean + 0.5 * onset_std) * 20.0))
    danceability = round(danceability, 1)
    
    # Estimate Energy using RMS and spectral centroid
    rms_temp = librosa.feature.rms(y=y)[0]
    rms_mean = float(np.mean(rms_temp))
    energy_score = (rms_mean * 75.0) + (global_centroid / 5000.0 * 25.0)
    energy = min(99.0, max(10.0, energy_score * 100.0 / 30.0))
    energy = round(energy, 1)
    
    # Estimate Valence (Happiness) based on key scale, tempo, and centroid
    base_valence = 60.0 if "Major" in key_scale else 35.0
    valence_score = base_valence + (tempo - 120.0) * 0.12 + (global_centroid - 1500.0) * 0.006
    valence = min(98.0, max(5.0, valence_score))
    valence = round(valence, 1)
    
    # Estimate Time Signature using autocorrelation
    time_sig = "4/4"
    try:
        r = librosa.autocorrelate(onset_envelope, max_size=int(sr / 512 * 4))
        beat_period = sr / 512 * (60.0 / tempo)
        three_beats = int(beat_period * 3)
        four_beats = int(beat_period * 4)
        if three_beats < len(r) and four_beats < len(r):
            if r[three_beats] > r[four_beats] * 1.15:
                time_sig = "3/4"
    except Exception:
        pass

    # --- 2. Time-Series Analysis (1-second windows) ---
    # Calculate frames per second
    hop_length = 512
    n_fft = 2048
    
    # Calculate features at audio frame-level
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=hop_length)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=n_fft, hop_length=hop_length)[0]
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, n_fft=n_fft, hop_length=hop_length, roll_percent=0.85)[0]
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop_length)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop_length)
    
    # Spectral Flux (Frame-by-frame diff of spectral magnitude)
    stft_mag = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length))
    flux = np.zeros(stft_mag.shape[1])
    flux[1:] = np.sqrt(np.sum((stft_mag[:, 1:] - stft_mag[:, :-1])**2, axis=0))
    
    # Normalize features
    rms_norm = rms / (np.max(rms) + 1e-8)
    flux_norm = flux / (np.max(flux) + 1e-8)
    
    # Downsample features to 1-second resolution
    frames_per_sec = sr / hop_length
    total_seconds = int(np.ceil(duration))
    
    timeline = []
    for sec in range(total_seconds):
        start_frame = int(sec * frames_per_sec)
        end_frame = min(int((sec + 1) * frames_per_sec), len(rms))
        
        if start_frame >= len(rms):
            break
            
        # Get slice metrics
        sec_rms = float(np.mean(rms_norm[start_frame:end_frame]))
        sec_flux = float(np.mean(flux_norm[start_frame:end_frame]))
        sec_rolloff = float(np.mean(rolloff[start_frame:end_frame]))
        sec_zcr = float(np.mean(zcr[start_frame:end_frame]))
        sec_centroid = float(np.mean(centroid[start_frame:end_frame]))
        
        sec_chroma = [float(x) for x in np.mean(chroma[:, start_frame:end_frame], axis=1)]
        sec_mfcc = [float(x) for x in np.mean(mfcc[:, start_frame:end_frame], axis=1)]
        
        timeline.append({
            "second": sec,
            "rms": round(sec_rms, 3),
            "flux": round(sec_flux, 3),
            "rolloff": round(sec_rolloff, 1),
            "zcr": round(sec_zcr, 3),
            "centroid": round(sec_centroid, 1),
            "chroma": [round(c, 2) for c in sec_chroma],
            "mfcc": [round(m, 2) for m in sec_mfcc]
        })
        
    # --- 3. Event Detection Layer ---
    # Detect transitions by searching for peaks in spectral flux & changes in RMS
    events = []
    # Smooth RMS to find trends
    rms_smoothed = scipy.signal.savgol_filter([t["rms"] for t in timeline], min(11, len(timeline) | 1), 3) if len(timeline) >= 11 else np.array([t["rms"] for t in timeline])
    
    # Basic segmentation by looking for thresholds
    segments = []
    curr_seg_start = 0
    
    for i in range(1, len(timeline)):
        # Check for significant changes in RMS or flux (e.g. drop/raise > 0.25)
        rms_diff = abs(rms_smoothed[i] - rms_smoothed[i-1])
        flux_spike = timeline[i]["flux"] > 0.4
        
        # Segment boundary criteria
        if rms_diff > 0.15 or flux_spike or (i - curr_seg_start) >= 30: # Max segment length 30s
            segments.append((curr_seg_start, i))
            curr_seg_start = i
    segments.append((curr_seg_start, len(timeline)))
    
    # Process segments into labeled macro events
    for idx, (start, end) in enumerate(segments):
        if start >= end:
            continue
        seg_rms = np.mean([t["rms"] for t in timeline[start:end]])
        seg_zcr = np.mean([t["zcr"] for t in timeline[start:end]])
        seg_flux = np.mean([t["flux"] for t in timeline[start:end]])
        
        # Decide structural role
        if idx == 0:
            label = "Intro"
        elif idx == len(segments) - 1:
            label = "Outro"
        elif seg_rms < 0.25:
            label = "Breakdown / Bridge"
        elif seg_rms > 0.6 and seg_zcr > 0.1:
            label = "Drop / Main Hook"
        elif seg_flux > 0.3:
            label = "Build-up / Transition"
        else:
            label = f"Verse / Section {idx}"
            
        events.append({
            "id": idx,
            "start": start,
            "end": end,
            "duration": end - start,
            "label": label,
            "average_loudness": round(float(seg_rms), 2),
            "percussiveness": "High" if seg_zcr > 0.08 else "Medium" if seg_zcr > 0.04 else "Low",
            "energy_state": "High Energy" if seg_rms > 0.55 else "Ambient/Muted" if seg_rms < 0.3 else "Steady"
        })
        
    return {
        "global": {
            "bpm": tempo,
            "key": key_scale,
            "camelot": camelot_code,
            "spectral_centroid": round(global_centroid, 1),
            "timbre": timbre_desc,
            "duration": round(duration, 1),
            "danceability": danceability,
            "energy": energy,
            "valence": valence,
            "time_signature": time_sig
        },
        "timeline": timeline,
        "events": events
    }
