import os
import shutil
import uuid
import numpy as np
import librosa
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.analyzer import analyze_audio
from backend.splitter import separate_stems
from backend.transcriber import transcribe_vocals

app = FastAPI(title="Music Analyzer & Splitter API")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory Setup
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "temp_uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "output_stems")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Mount outputs for serving wavs
app.mount("/stems", StaticFiles(directory=OUTPUT_DIR), name="stems")

def analyze_stem_timeline(file_path):
    """Simple 1-second resolution RMS and Centroid analysis for stems."""
    try:
        y, sr = librosa.load(file_path, sr=22050, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        hop_length = 512
        
        rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]
        
        # Normalize RMS
        max_rms = np.max(rms) if len(rms) > 0 else 1
        rms_norm = rms / (max_rms + 1e-8)
        
        frames_per_sec = sr / hop_length
        total_seconds = int(np.ceil(duration))
        
        timeline = []
        for sec in range(total_seconds):
            start_frame = int(sec * frames_per_sec)
            end_frame = min(int((sec + 1) * frames_per_sec), len(rms))
            
            if start_frame >= len(rms):
                break
                
            sec_rms = float(np.mean(rms_norm[start_frame:end_frame]))
            sec_centroid = float(np.mean(centroid[start_frame:end_frame]))
            
            timeline.append({
                "second": sec,
                "rms": round(sec_rms, 3),
                "centroid": round(sec_centroid, 1)
            })
        return timeline
    except Exception as e:
        print(f"Error analyzing stem timeline {file_path}: {e}")
        return []

@app.post("/api/analyze")
async def api_analyze_audio(file: UploadFile = File(...), lyrics: str = Form(None), enable_lyrics: str = Form("false")):
    # Create unique session directory
    session_id = str(uuid.uuid4())
    session_upload_path = os.path.join(UPLOAD_DIR, f"{session_id}_{file.filename}")
    session_output_dir = os.path.join(OUTPUT_DIR, session_id)
    os.makedirs(session_output_dir, exist_ok=True)
    
    # Save uploaded file
    try:
        with open(session_upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}")
        
    try:
        # 1. Analyze master audio
        print(f"Analyzing master track: {file.filename}")
        analysis = analyze_audio(session_upload_path)
        
        # 2. Split into stems
        print("Splitting audio stems...")
        stem_files = separate_stems(session_upload_path, session_output_dir)
        
        # 3. Analyze each stem lane
        stem_lanes = {}
        for stem_name, filename in stem_files.items():
            full_stem_path = os.path.join(session_output_dir, filename)
            stem_timeline = analyze_stem_timeline(full_stem_path)
            
            stem_lanes[stem_name] = {
                "url": f"/stems/{session_id}/{filename}",
                "timeline": stem_timeline
            }
            
        # 4. Transcribe lyrics using faster-whisper (Only if enabled)
        lyrics_timeline = []
        if enable_lyrics == "true" and "vocals" in stem_files:
            vocals_path = os.path.join(session_output_dir, stem_files["vocals"])
            lyrics_timeline = transcribe_vocals(vocals_path, initial_prompt=lyrics)
            
        # Move original upload to the session folder instead of deleting it
        file_ext = os.path.splitext(file.filename)[1]
        original_filename = f"original{file_ext}"
        original_output_path = os.path.join(session_output_dir, original_filename)
        if os.path.exists(session_upload_path):
            shutil.move(session_upload_path, original_output_path)
            
        stem_lanes["original"] = {
            "url": f"/stems/{session_id}/{original_filename}"
        }
            
        import json
        from datetime import datetime

        result = {
            "success": True,
            "session_id": session_id,
            "filename": file.filename,
            "created_at": datetime.now().isoformat(),
            "lyrics_input": lyrics,
            "enable_lyrics_alignment": enable_lyrics == "true",
            "analysis": analysis["global"],
            "timeline": analysis["timeline"],
            "events": analysis["events"],
            "stems": stem_lanes,
            "lyrics": lyrics_timeline
        }
        
        # Save analysis JSON
        analysis_json_path = os.path.join(session_output_dir, "analysis.json")
        with open(analysis_json_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
            
        return result
        
    except Exception as e:
        # Cleanup
        if os.path.exists(session_upload_path):
            os.remove(session_upload_path)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/api/history")
def get_analysis_history():
    import json
    history = []
    if not os.path.exists(OUTPUT_DIR):
        return []
        
    for session_id in os.listdir(OUTPUT_DIR):
        session_dir = os.path.join(OUTPUT_DIR, session_id)
        if not os.path.isdir(session_dir):
            continue
            
        json_path = os.path.join(session_dir, "analysis.json")
        if os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    history.append({
                        "session_id": data.get("session_id"),
                        "filename": data.get("filename"),
                        "created_at": data.get("created_at"),
                        "analysis": data.get("analysis")
                    })
            except Exception as e:
                print(f"Error reading history for {session_id}: {e}")
                
    # Sort history by created_at descending (newest first)
    history.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return history

@app.get("/api/history/{session_id}")
def get_analysis_item(session_id: str):
    import json
    json_path = os.path.join(OUTPUT_DIR, session_id, "analysis.json")
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="Analysis session not found")
        
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read analysis session: {e}")

@app.delete("/api/history/{session_id}")
def delete_analysis_item(session_id: str):
    session_dir = os.path.join(OUTPUT_DIR, session_id)
    if not os.path.exists(session_dir):
        raise HTTPException(status_code=404, detail="Analysis session not found")
        
    try:
        shutil.rmtree(session_dir)
        return {"success": True, "message": f"Deleted session {session_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete session directory: {e}")

@app.get("/api/health")
def health():
    return {"status": "ok"}
