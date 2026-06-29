import os
import numpy as np
import librosa
import soundfile as sf
import scipy.signal

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

def separate_stems_dsp(file_path, output_dir):
    """
    DSP Fallback splitter using STFT Frequency Soft Masking.
    Splits audio into: vocals, drums, bass, other.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Load audio (mono, 22050Hz for performance)
    y, sr = librosa.load(file_path, sr=22050, mono=True)
    
    # Short-Time Fourier Transform
    D = librosa.stft(y, n_fft=2048, hop_length=512)
    
    # Run Harmonic-Percussive Source Separation (HPSS) in STFT domain
    # This separates drums (percussive transients) from tonal content (harmonics)
    H_stft, P_stft = librosa.effects.hpss(D)
    H = np.abs(H_stft)
    P = np.abs(P_stft)
    
    frequencies = librosa.fft_frequencies(sr=sr, n_fft=2048)
    
    # 1. Drums: Reconstructed directly from the percussive STFT layer
    # Apply soft bandpass to avoid low sub-rumble and high sibilance hiss
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
    
    # 2. Bass: Low frequencies of the harmonic layer (<160 Hz)
    bass_mask = np.zeros_like(H)
    for idx, f in enumerate(frequencies):
        if f < 140:
            bass_mask[idx, :] = 1.0
        elif f < 220:
            # Linear roll-off
            bass_mask[idx, :] = 1.0 - (f - 140) / 80.0
    bass_stft = H_stft * bass_mask
    
    # 3. Vocals: Mid-high range of the harmonic layer (200 Hz to 3500 Hz)
    vocals_mask = np.zeros_like(H)
    for idx, f in enumerate(frequencies):
        if f >= 220 and f <= 3000:
            vocals_mask[idx, :] = 1.0
        elif f >= 150 and f < 220:
            vocals_mask[idx, :] = (f - 150) / 70.0
        elif f > 3000 and f <= 4500:
            vocals_mask[idx, :] = 1.0 - (f - 3000) / 1500.0
    vocals_stft = H_stft * vocals_mask
    
    # 4. Other (Melodies, guitars, synths): Remaining harmonic content
    # We take the harmonic layer and mask out the bass and vocal layers to isolate instruments
    other_mask = 1.0 - bass_mask - 0.75 * vocals_mask
    other_mask = np.clip(other_mask, 0.0, 1.0)
    other_stft = H_stft * other_mask
    
    # Reconstruct time-domain signals using inverse STFT (preserving phase)
    drums_y = librosa.istft(drums_stft)
    bass_y = librosa.istft(bass_stft)
    vocals_y = librosa.istft(vocals_stft)
    other_y = librosa.istft(other_stft)
    
    # Truncate/pad to original signal length to match exactly
    target_len = len(y)
    stems = {
        "vocals": librosa.util.fix_length(vocals_y, size=target_len),
        "drums": librosa.util.fix_length(drums_y, size=target_len),
        "bass": librosa.util.fix_length(bass_y, size=target_len),
        "other": librosa.util.fix_length(other_y, size=target_len)
    }
    
    saved_paths = {}
    for name, signal in stems.items():
        # Prevent clipping and normalize to -1dB
        max_val = np.max(np.abs(signal))
        if max_val > 0:
            signal = signal / max_val * 0.9
            
        stem_filename = f"{name}.wav"
        stem_path = os.path.join(output_dir, stem_filename)
        sf.write(stem_path, signal, sr)
        saved_paths[name] = stem_filename
        
    return saved_paths

def separate_stems(file_path, output_dir):
    """
    Main stem separation handler.
    Tries to use Demucs if installed, otherwise falls back to DSP.
    """
    try:
        # Check if demucs can be imported
        import demucs.separate
        import subprocess
        import sys
        
        print("Demucs detected. Attempting deep-learning stem separation...")
        # Since demucs is best called via CLI or its API:
        # We can call demucs via CLI subprocess to run it cleanly
        cmd = [
            sys.executable, "-m", "demucs.separate",
            "-n", "htdemucs",
            "-o", output_dir,
            "--two-stems", "vocals", # optional: htdemucs splits vocals, drums, bass, other by default
            file_path
        ]
        # Let's just call it
        subprocess.run(cmd, check=True)
        
        # Demucs output is structured as: output_dir/htdemucs/song_name/vocals.wav, etc.
        song_name = os.path.splitext(os.path.basename(file_path))[0]
        demucs_folder = os.path.join(output_dir, "htdemucs", song_name)
        
        if os.path.exists(demucs_folder):
            saved_paths = {}
            for stem in ["vocals", "drums", "bass", "other"]:
                src = os.path.join(demucs_folder, f"{stem}.wav")
                dst = os.path.join(output_dir, f"{stem}.wav")
                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    os.rename(src, dst)
                    saved_paths[stem] = f"{stem}.wav"
            return saved_paths
            
    except ImportError:
        print("Demucs/PyTorch not installed. Falling back to High-Quality DSP Separator...")
        
    except Exception as e:
        print(f"Demucs separation failed ({e}). Falling back to DSP Separator...")
        
    return separate_stems_dsp(file_path, output_dir)
