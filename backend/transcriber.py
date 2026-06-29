import os
import re
from faster_whisper import WhisperModel

def align_lyrics(provided_text, segments):
    """
    Aligns the copy-pasted lyrics with the transcribed segments using word-level timings.
    This guarantees 100% accurate text (preserving user line splits, capitalization, 
    and punctuation) while aligning each line to the exact audio timestamps.
    """
    # Split the provided text into clean lines
    provided_lines = [line.strip() for line in provided_text.split('\n') if line.strip()]
    if not provided_lines:
        return []
        
    # Flatten all words from Whisper segments into a single list of word timings
    words_timeline = []
    for segment in segments:
        if hasattr(segment, 'words') and segment.words is not None:
            for w in segment.words:
                words_timeline.append({
                    "word": re.sub(r'[^\w]', '', w.word.strip().lower()),
                    "start": w.start,
                    "end": w.end
                })
        else:
            # Fallback if word_timestamps failed or is not present
            seg_words = segment.text.strip().split()
            if not seg_words:
                continue
            dur = (segment.end - segment.start) / len(seg_words)
            for i, w in enumerate(seg_words):
                words_timeline.append({
                    "word": re.sub(r'[^\w]', '', w.lower()),
                    "start": segment.start + i * dur,
                    "end": segment.start + (i + 1) * dur
                })
                
    if not words_timeline:
        return []
        
    aligned_lines = []
    word_idx = 0
    num_words = len(words_timeline)
    
    for line in provided_lines:
        # Split line into words
        line_words = [re.sub(r'[^\w]', '', w.strip().lower()) for w in line.split() if w.strip()]
        if not line_words:
            continue
            
        start_time = None
        end_time = None
        
        # Look ahead to find the first word of this line in the transcribed timeline
        first_word = line_words[0]
        found_first = False
        
        # Scan next 25 words in the timeline to find a match
        for search_idx in range(word_idx, min(word_idx + 25, num_words)):
            timeline_w = words_timeline[search_idx]["word"]
            if timeline_w == first_word or first_word in timeline_w or timeline_w in first_word:
                word_idx = search_idx
                found_first = True
                break
                
        if found_first:
            start_time = words_timeline[word_idx]["start"]
            # Consume timeline words to cover all words of this line
            line_word_ptr = 0
            while word_idx < num_words and line_word_ptr < len(line_words):
                end_time = words_timeline[word_idx]["end"]
                word_idx += 1
                line_word_ptr += 1
        else:
            # Fallback interpolation if match not found
            start_time = words_timeline[word_idx]["start"] if word_idx < num_words else (aligned_lines[-1]["end"] if aligned_lines else 0)
            # Advance word index by length of this line
            word_idx = min(word_idx + len(line_words), num_words)
            end_time = words_timeline[word_idx - 1]["end"] if word_idx - 1 < num_words else start_time + 3.0
            
        aligned_lines.append({
            "start": round(start_time, 2),
            "end": round(end_time, 2),
            "text": line
        })
        
    return aligned_lines

def transcribe_vocals(audio_path, initial_prompt=None):
    """
    Transcribes isolated vocals using a local faster-whisper model.
    Passes initial_prompt if available to guide spelling and alignment.
    If lyrics text is provided, aligns it word-for-word to Whisper word timestamps.
    """
    if not os.path.exists(audio_path):
        return []
        
    try:
        # Load base model (140MB). High accuracy for vocals, runs fast on CPU.
        # compute_type="int8" ensures fast quantized inference on CPU.
        print("Initializing local Whisper ASR model...")
        model = WhisperModel("base", device="cpu", compute_type="int8")
        
        print("Transcribing isolated vocals track with word-level timestamps...")
        segments_generator, info = model.transcribe(
            audio_path,
            beam_size=5,
            initial_prompt=initial_prompt,
            word_timestamps=True
        )
        
        # Convert generator to a list to fetch segments
        segments = list(segments_generator)
        
        # If the user provided copy-pasted lyrics, align them exactly!
        if initial_prompt and initial_prompt.strip():
            print("Aligning pasted lyrics with word-level audio timestamps...")
            aligned = align_lyrics(initial_prompt, segments)
            if aligned:
                return aligned
        
        # Fallback default transcription if no lyrics were provided
        results = []
        for segment in segments:
            results.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": segment.text.strip()
            })
        print(f"ASR transcription complete: {len(results)} lines transcribed.")
        return results
    except Exception as e:
        print(f"Whisper transcription failed: {e}")
        import traceback
        traceback.print_exc()
        return []
