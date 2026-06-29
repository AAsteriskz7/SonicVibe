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
    DSP Fallback splitter using HPSS and frequency filtering.
    Splits audio into: vocals, drums, bass, other.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    y, sr = librosa.load(file_path, sr=22050, mono=True)
    
    # 1. Drums (Percussive component of HPSS)
    # Using Librosa's Harmonic-Percussive Source Separation
    harmonic, percussive = librosa.effects.hpss(y)
    
    # Drums are primarily percussive. Let's filter out very low rumble and high hiss to keep it crisp.
    drums = butter_bandpass_filter(percussive, 50, 8000, sr, order=4)
    
    # 2. Bass (Lowpass filter on the harmonic part)
    # Bass lives in the low frequencies of the harmonic track (below 180 Hz)
    bass = butter_lowpass_filter(harmonic, 160, sr, order=4)
    
    # 3. Vocals (Mid-range frequencies on the original signal)
    # Vocals have a strong presence between 250 Hz and 3500 Hz.
    # Let's filter the original mix to capture vocals, including transients like consonants.
    vocals = butter_bandpass_filter(y, 250, 4000, sr, order=4)
    # Attenuate drums inside vocals by subtracting a portion of percussive
    vocals = vocals - 0.2 * percussive
    
    # 4. Other (Harmonics in mid-high range: guitars, synths, piano)
    # Highpass the harmonic component above 180 Hz to remove bass
    other_harmonic = butter_highpass_filter(harmonic, 180, sr, order=4)
    # Mute the main vocal band slightly so it's mostly instrumental other
    other = other_harmonic - 0.3 * vocals
    
    # Normalize each stem to prevent clipping
    stems = {
        "vocals": vocals,
        "drums": drums,
        "bass": bass,
        "other": other
    }
    
    saved_paths = {}
    for name, signal in stems.items():
        # Prevent clipping
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
