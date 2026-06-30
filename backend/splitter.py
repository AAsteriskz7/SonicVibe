import os
import numpy as np
import librosa
import soundfile as sf
import scipy.signal

# ──────────────────────────────────────────────────────────────────────────────
# DSP Utility Filters (used by DSP fallback only)
# ──────────────────────────────────────────────────────────────────────────────

def butter_bandpass(lowcut, highcut, fs, order=5):
    nyq = 0.5 * fs
    low = lowcut / nyq
    high = highcut / nyq
    b, a = scipy.signal.butter(order, [low, high], btype='band')
    return b, a

def butter_bandpass_filter(data, lowcut, highcut, fs, order=5):
    b, a = butter_bandpass(lowcut, highcut, fs, order=order)
    y = scipy.signal.lfilter(b, a, data)
    return y

def butter_lowpass(cutoff, fs, order=5):
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = scipy.signal.butter(order, normal_cutoff, btype='low', analog=False)
    return b, a

def butter_lowpass_filter(data, cutoff, fs, order=5):
    b, a = butter_lowpass(cutoff, fs, order=order)
    y = scipy.signal.lfilter(b, a, data)
    return y

def butter_highpass(cutoff, fs, order=5):
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = scipy.signal.butter(order, normal_cutoff, btype='high', analog=False)
    return b, a

def butter_highpass_filter(data, cutoff, fs, order=5):
    b, a = butter_highpass(cutoff, fs, order=order)
    y = scipy.signal.lfilter(b, a, data)
    return y


# ──────────────────────────────────────────────────────────────────────────────
# DSP Fallback Separator (used when Demucs is not available)
# ──────────────────────────────────────────────────────────────────────────────

def separate_stems_dsp(file_path, output_dir):
    """
    DSP Fallback splitter using STFT Frequency Soft Masking.
    Splits audio into: vocals, drums, bass, other.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    y, sr = librosa.load(file_path, sr=22050, mono=True)
    
    D = librosa.stft(y, n_fft=2048, hop_length=512)
    mag, phase = librosa.magphase(D)
    
    H_mag, P_mag = librosa.decompose.hpss(mag, margin=(1.0, 4.0))
    H_stft = H_mag * phase
    P_stft = P_mag * phase
    H = H_mag
    P = P_mag
    
    frequencies = librosa.fft_frequencies(sr=sr, n_fft=2048)
    
    # Drums
    drums_mask = np.ones_like(P)
    for idx, f in enumerate(frequencies):
        if f < 40:
            drums_mask[idx, :] = 0.0
        elif f < 60:
            drums_mask[idx, :] = (f - 40) / 20.0
        elif f > 8000:
            drums_mask[idx, :] = 0.0
        elif f > 6000:
            drums_mask[idx, :] = 1.0 - (f - 6000) / 2000.0
    drums_stft = P_stft * drums_mask
    
    # Bass
    bass_mask = np.zeros_like(H)
    for idx, f in enumerate(frequencies):
        if f < 140:
            bass_mask[idx, :] = 1.0
        elif f < 220:
            bass_mask[idx, :] = 1.0 - (f - 140) / 80.0
    bass_stft = H_stft * bass_mask
    
    # Vocals
    vocals_mask = np.zeros_like(H)
    for idx, f in enumerate(frequencies):
        if f >= 220 and f <= 3000:
            vocals_mask[idx, :] = 1.0
        elif f >= 150 and f < 220:
            vocals_mask[idx, :] = (f - 150) / 70.0
        elif f > 3000 and f <= 4500:
            vocals_mask[idx, :] = 1.0 - (f - 3000) / 1500.0
    vocals_stft = H_stft * vocals_mask
    
    # Other
    other_mask = 1.0 - bass_mask - 0.75 * vocals_mask
    other_mask = np.clip(other_mask, 0.0, 1.0)
    other_stft = H_stft * other_mask
    
    drums_y = librosa.istft(drums_stft)
    bass_y = librosa.istft(bass_stft)
    vocals_y = librosa.istft(vocals_stft)
    other_y = librosa.istft(other_stft)
    
    target_len = len(y)
    stems = {
        "vocals": librosa.util.fix_length(vocals_y, size=target_len),
        "drums": librosa.util.fix_length(drums_y, size=target_len),
        "bass": librosa.util.fix_length(bass_y, size=target_len),
        "other": librosa.util.fix_length(other_y, size=target_len)
    }
    
    saved_paths = {}
    for name, signal in stems.items():
        max_val = np.max(np.abs(signal))
        if max_val > 0:
            signal = signal / max_val * 0.9
        stem_filename = f"{name}.wav"
        stem_path = os.path.join(output_dir, stem_filename)
        sf.write(stem_path, signal, sr)
        saved_paths[name] = stem_filename
        
    return saved_paths


# ──────────────────────────────────────────────────────────────────────────────
# Demucs 6-Stem Separator (htdemucs_6s)
# ──────────────────────────────────────────────────────────────────────────────

def separate_stems_demucs(file_path, output_dir):
    """
    Uses htdemucs_6s (6-stem deep-learning model) to separate into:
      vocals, drums, bass, guitar, piano, other
    Then merges guitar + piano + other into a single clean 'other' stem.
    Falls back to htdemucs_ft (fine-tuned 4-stem) if 6s fails.
    Returns None if Demucs is not available.
    """
    import subprocess
    import sys
    import shutil

    MODELS_BY_PREFERENCE = [
        ("htdemucs_6s", ["vocals", "drums", "bass", "guitar", "piano", "other"]),
        ("htdemucs_ft",  ["vocals", "drums", "bass", "other"]),
        ("htdemucs",     ["vocals", "drums", "bass", "other"]),
    ]

    song_name = os.path.splitext(os.path.basename(file_path))[0]

    # Pre-convert to WAV so torchaudio can load it without torchcodec (MP3 codec not required for WAV)
    wav_input_path = os.path.join(output_dir, "_input_converted.wav")
    try:
        print("Pre-converting input to WAV for Demucs compatibility...")
        y_raw, sr_raw = librosa.load(file_path, sr=44100, mono=False)
        # librosa always returns mono unless mono=False; if mono, reshape for soundfile
        if y_raw.ndim == 1:
            y_raw = y_raw[np.newaxis, :]
        sf.write(wav_input_path, y_raw.T, sr_raw, subtype="PCM_16")
        print(f"  Converted → {wav_input_path}")
        demucs_input = wav_input_path
        song_name_for_folder = "_input_converted"
    except Exception as conv_err:
        print(f"  WAV conversion failed ({conv_err}), using original file.")
        demucs_input = file_path
        song_name_for_folder = song_name

    for model_name, model_stems in MODELS_BY_PREFERENCE:
        print(f"Trying Demucs model: {model_name}...")
        cmd = [
            sys.executable, "-m", "demucs.separate",
            "-n", model_name,
            "-o", output_dir,
            demucs_input
        ]
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            demucs_folder = os.path.join(output_dir, model_name, song_name_for_folder)
            # Fallback: try the original song name in case conversion path didn't match
            if not os.path.exists(demucs_folder):
                demucs_folder = os.path.join(output_dir, model_name, song_name)

            if not os.path.exists(demucs_folder):
                print(f"  Output folder not found for {model_name}, trying next...")
                continue

            # Verify all expected stems are present
            missing = [s for s in model_stems if not os.path.exists(os.path.join(demucs_folder, f"{s}.wav"))]
            if missing:
                print(f"  Missing stems {missing} for {model_name}, trying next...")
                continue

            print(f"  {model_name} succeeded! Stems: {model_stems}")

            # If this is the 6-stem model, merge guitar + piano + other → other
            if model_name == "htdemucs_6s":
                print("  Merging guitar, piano, other → combined other stem...")
                mix_stems_to_file(
                    stem_paths=[
                        os.path.join(demucs_folder, "guitar.wav"),
                        os.path.join(demucs_folder, "piano.wav"),
                        os.path.join(demucs_folder, "other.wav"),
                    ],
                    output_path=os.path.join(demucs_folder, "other_merged.wav"),
                    gain=0.85  # Slightly reduce gain to avoid clipping when summing 3 sources
                )
                # Replace other.wav with the merged version
                os.replace(
                    os.path.join(demucs_folder, "other_merged.wav"),
                    os.path.join(demucs_folder, "other.wav")
                )

            # Move the 4 core stems (vocals, drums, bass, other) to the session root
            saved_paths = {}
            for stem in ["vocals", "drums", "bass", "other"]:
                src = os.path.join(demucs_folder, f"{stem}.wav")
                dst = os.path.join(output_dir, f"{stem}.wav")
                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    shutil.move(src, dst)
                    saved_paths[stem] = f"{stem}.wav"

            # Clean up the demucs subfolder tree
            model_root = os.path.join(output_dir, model_name)
            if os.path.exists(model_root):
                shutil.rmtree(model_root, ignore_errors=True)

            # Clean up temp WAV conversion
            if os.path.exists(wav_input_path):
                os.remove(wav_input_path)

            return saved_paths

        except subprocess.CalledProcessError as e:
            print(f"  {model_name} failed: {e.stderr[-500:] if e.stderr else e}")
            continue
        except Exception as e:
            print(f"  {model_name} error: {e}")
            continue

    # Clean up temp WAV conversion even if all models failed
    if os.path.exists(wav_input_path):
        os.remove(wav_input_path)

    return None  # All models failed


def mix_stems_to_file(stem_paths, output_path, gain=1.0):
    """
    Mix multiple mono/stereo wav files together and write to output_path.
    """
    mixed = None
    sr_out = None

    for path in stem_paths:
        if not os.path.exists(path):
            continue
        y, sr = librosa.load(path, sr=None, mono=True)
        if mixed is None:
            mixed = np.zeros(len(y), dtype=np.float32)
            sr_out = sr
        # Align lengths
        if len(y) > len(mixed):
            mixed = np.pad(mixed, (0, len(y) - len(mixed)))
        elif len(y) < len(mixed):
            y = np.pad(y, (0, len(mixed) - len(y)))
        mixed += y

    if mixed is None:
        return

    mixed *= gain
    # Soft clip to prevent clipping
    peak = np.max(np.abs(mixed))
    if peak > 0.95:
        mixed = mixed / peak * 0.95

    sf.write(output_path, mixed, sr_out)


# ──────────────────────────────────────────────────────────────────────────────
# Wiener-Filter Vocal De-Bleeder
# ──────────────────────────────────────────────────────────────────────────────

def wiener_debleed(vocals_path, target_path, beta=0.55, floor=0.08, smoothing_frames=5):
    """
    Applies a time-smoothed Wiener suppression mask to remove vocal bleed
    from a target stem.

    Parameters
    ----------
    vocals_path : str   – Path to the clean vocals stem (reference signal)
    target_path : str   – Path to the target stem (will be overwritten)
    beta        : float – Suppression strength (0 = none, 1 = full suppress)
    floor       : float – Minimum mask value (prevents musical noise artifacts)
    smoothing_frames : int – Temporal smoothing window (reduces musical noise)
    """
    try:
        y_v, sr = librosa.load(vocals_path, sr=None, mono=True)
        y_t, _  = librosa.load(target_path, sr=sr, mono=True)

        min_len = min(len(y_v), len(y_t))
        y_v = y_v[:min_len]
        y_t = y_t[:min_len]

        n_fft     = 2048
        hop       = 512

        D_v = librosa.stft(y_v, n_fft=n_fft, hop_length=hop)
        D_t = librosa.stft(y_t, n_fft=n_fft, hop_length=hop)

        mag_v = np.abs(D_v)
        mag_t = np.abs(D_t)

        # Wiener-like mask: suppress frequencies where vocal energy is dominant
        ratio = mag_v / (mag_t + 1e-8)

        # Temporal median smoothing to reduce musical noise
        if smoothing_frames > 1:
            from scipy.ndimage import median_filter
            ratio = median_filter(ratio, size=(1, smoothing_frames))

        mask = np.clip(1.0 - beta * ratio, floor, 1.0)

        D_t_clean = D_t * mask
        y_t_clean = librosa.istft(D_t_clean, hop_length=hop, length=min_len)

        # Match original loudness (LUFS-style normalisation via peak)
        peak_orig  = np.max(np.abs(y_t))
        peak_clean = np.max(np.abs(y_t_clean))
        if peak_clean > 0 and peak_orig > 0:
            y_t_clean = y_t_clean / peak_clean * peak_orig

        sf.write(target_path, y_t_clean, sr)
        print(f"  Wiener de-bleeding done: {os.path.basename(target_path)}")

    except Exception as e:
        print(f"  De-bleeding failed for {target_path}: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# Main Entry Point
# ──────────────────────────────────────────────────────────────────────────────

def separate_stems(file_path, output_dir):
    """
    Main stem separation handler.
    1. Tries htdemucs_6s (best isolation) → htdemucs_ft → htdemucs
    2. Falls back to DSP if Demucs is unavailable
    3. Applies Wiener-filter vocal de-bleeding to drums, bass, and other
    """
    saved_paths = None

    # Try Demucs first
    try:
        import demucs.separate  # noqa: just verify Demucs is installed
        saved_paths = separate_stems_demucs(file_path, output_dir)
    except ImportError:
        print("Demucs/PyTorch not installed. Using DSP fallback...")
    except Exception as e:
        print(f"Demucs setup error: {e}. Using DSP fallback...")

    # DSP fallback
    if not saved_paths:
        print("Running DSP separator...")
        saved_paths = separate_stems_dsp(file_path, output_dir)

    # Post-process: Wiener de-bleed vocals from every non-vocal stem
    if saved_paths and "vocals" in saved_paths:
        vocals_path = os.path.join(output_dir, saved_paths["vocals"])
        for stem in ["drums", "bass", "other"]:
            if stem in saved_paths:
                target_path = os.path.join(output_dir, saved_paths[stem])
                print(f"Running Wiener vocal de-bleeder on '{stem}' stem...")
                # Use lighter suppression for drums/bass (vocals rarely bleed there)
                beta = 0.55 if stem == "other" else 0.30
                wiener_debleed(vocals_path, target_path, beta=beta)

    return saved_paths
