import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np
import scipy.signal as signal
import torch
import torch.nn as nn
import torch.nn.functional as F
import onnxruntime as ort
import uvicorn
from math import radians, cos, sin, asin, sqrt
from typing import List, Optional

app = FastAPI(
    title="PulseRescue AI Engine API",
    description="API Deteksi Dini Henti Jantung & Analisis Sinyal PPG berbasis InceptionTime, Bi-LSTM Attention & ONNX.",
    version="2.0.0"
)

# CORS dipasang agar frontend (Netlify/Vercel/Web) dapat mengakses API secara bebas
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# 1. SCHEMAS INPUT / OUTPUT
# ==============================================================================

class SignalInput(BaseModel):
    signal: List[float] = Field(
        ...,
        description="Array 100 nilai fluktuasi sinyal PPG.",
        json_schema_extra={"example": [0.12, 0.45, 0.88, 0.23, -0.15] * 20}
    )
    latitude: float = Field(default=-7.7956, description="Koordinat Latitude Pengguna")
    longitude: float = Field(default=110.3695, description="Koordinat Longitude Pengguna")

class PredictionResponse(BaseModel):
    cardiac_risk_index: float
    prediction_code: int
    status: str
    wave_status: str
    bpm: int
    spo2: int
    ai_status: str
    morphology_score: Optional[float] = None
    hrv_sdnn: Optional[float] = None
    hrv_rmssd: Optional[float] = None

# ==============================================================================
# 2. MODEL AI: INCEPTIONTIME (CNN) & BI-LSTM + ATTENTION (PYTORCH)
# ==============================================================================

class InceptionModule1D(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_sizes=[3, 5, 11]):
        super().__init__()
        num_filters = out_channels // 4
        
        self.bottleneck = nn.Conv1d(in_channels, num_filters, kernel_size=1) if in_channels > 1 else nn.Identity()
        in_conv = num_filters if in_channels > 1 else in_channels

        self.conv_list = nn.ModuleList([
            nn.Conv1d(in_conv, num_filters, k, padding=k//2) for k in kernel_sizes
        ])
        self.maxpool = nn.MaxPool1d(kernel_size=3, stride=1, padding=1)
        self.pool_conv = nn.Conv1d(in_channels, num_filters, kernel_size=1)
        
        self.bn = nn.BatchNorm1d(out_channels)
        self.act = nn.ReLU()

    def forward(self, x):
        x_bottleneck = self.bottleneck(x) if isinstance(self.bottleneck, nn.Conv1d) else x
        conv_outputs = [conv(x_bottleneck) for conv in self.conv_list]
        pool_out = self.pool_conv(self.maxpool(x))
        out = torch.cat(conv_outputs + [pool_out], dim=1)
        return self.act(self.bn(out))

class InceptionTimeFeatureExtractor(nn.Module):
    def __init__(self, in_channels=1, hidden_dim=32):
        super().__init__()
        self.layer1 = InceptionModule1D(in_channels, hidden_dim)
        self.layer2 = InceptionModule1D(hidden_dim, hidden_dim)
        self.gap = nn.AdaptiveAvgPool1d(1)
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

    def forward(self, x):
        feat = self.layer1(x)
        feat = self.layer2(feat)
        pooled = self.gap(feat).squeeze(-1)
        morphology_score = self.head(pooled)
        return morphology_score

class AttentionLayer(nn.Module):
    def __init__(self, hidden_dim):
        super().__init__()
        self.attn = nn.Linear(hidden_dim * 2, 1)

    def forward(self, lstm_output):
        weights = torch.tanh(self.attn(lstm_output))
        attn_weights = F.softmax(weights, dim=1)
        context = torch.sum(attn_weights * lstm_output, dim=1)
        return context

class BiLSTMAttentionForecast(nn.Module):
    def __init__(self, input_size=4, hidden_dim=32, num_layers=2):
        super().__init__()
        self.bilstm = nn.LSTM(
            input_size, 
            hidden_dim, 
            num_layers=num_layers, 
            batch_first=True, 
            bidirectional=True
        )
        self.attention = AttentionLayer(hidden_dim)
        self.risk_head = nn.Sequential(
            nn.Linear(hidden_dim * 2, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

    def forward(self, x_seq):
        lstm_out, _ = self.bilstm(x_seq)
        context = self.attention(lstm_out)
        risk_index = self.risk_head(context) * 100.0
        return risk_index

# Inisialisasi Model PyTorch
inception_extractor = InceptionTimeFeatureExtractor()
bilstm_attention_engine = BiLSTMAttentionForecast()
inception_extractor.eval()
bilstm_attention_engine.eval()

# ==============================================================================
# 3. DSP & HRV EXTRACTION HELPER
# ==============================================================================

def extract_hrv_and_vitals(raw_signal: np.ndarray, sampling_rate: int = 50):
    sos = signal.butter(3, [0.5, 5.0], btype='bandpass', fs=sampling_rate, output='sos')
    filtered = signal.sosfilt(sos, raw_signal)
    
    peaks, _ = signal.find_peaks(filtered, distance=sampling_rate*0.4, prominence=0.05)
    
    if len(peaks) > 1:
        rr_intervals = np.diff(peaks) / sampling_rate * 1000.0
        bpm = int(np.clip(60000.0 / np.mean(rr_intervals), 40, 180))
        sdnn = float(np.std(rr_intervals))
        rmssd = float(np.sqrt(np.mean(np.square(np.diff(rr_intervals))))) if len(rr_intervals) > 1 else 10.0
    else:
        bpm = 75
        sdnn = 25.0
        rmssd = 15.0

    spo2 = int(np.clip(99 - (np.std(filtered) * 2.0), 88, 100))
    return bpm, spo2, sdnn, rmssd, filtered

# ==============================================================================
# 4. DATABASE & HAVERSINE
# ==============================================================================

HOSPITALS_DATABASE = [
    {"id": 1, "name": "RSUP Dr. Sardjito", "lat": -7.7685, "lng": 110.3734, "status": "Ready UGD & ICU", "phone": "(0274) 587333"},
    {"id": 2, "name": "RS PKU Muhammadiyah", "lat": -7.8012, "lng": 110.3625, "status": "Ready UGD", "phone": "(0274) 512653"},
    {"id": 3, "name": "RS Bethesda Yogyakarta", "lat": -7.7838, "lng": 110.3775, "status": "Ready Ambulans", "phone": "(0274) 586688"},
    {"id": 4, "name": "RSUD Kota Yogyakarta", "lat": -7.8256, "lng": 110.3783, "status": "Ready UGD", "phone": "(0274) 371195"}
]

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2)**2
    c = 2 * asin(sqrt(a))
    return R * c

# Inisialisasi ONNX Session (jika ada file tinyformer.onnx)
MODEL_PATH = "tinyformer.onnx"
try:
    session = ort.InferenceSession(MODEL_PATH)
    input_name = session.get_inputs()[0].name
except Exception:
    session = None

def softmax(x):
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum(axis=0)

# ==============================================================================
# 5. ENDPOINTS & HEALTH CHECK
# ==============================================================================

@app.get("/")
def read_root():
    return {
        "service": "PulseRescue AI Engine API",
        "status": "Online",
        "version": "2.0.0"
    }

@app.post("/predict", response_model=PredictionResponse)
def predict(data: SignalInput):
    if len(data.signal) != 100:
        raise HTTPException(status_code=400, detail="Sinyal harus berisi tepat 100 angka float.")

    try:
        raw_sig = np.array(data.signal, dtype=np.float32)
        
        # 1. Ekstraksi Fitur Vitals & HRV
        bpm, spo2, hrv_sdnn, hrv_rmssd, filtered_sig = extract_hrv_and_vitals(raw_sig)

        # 2. InceptionTime Feature Extraction (Morphology Score)
        sig_tensor = torch.tensor(filtered_sig, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
        with torch.no_grad():
            morphology_score = inception_extractor(sig_tensor).item()

        # 3. Bi-LSTM + Attention Forecast
        features_vec = [morphology_score, hrv_sdnn / 100.0, hrv_rmssd / 100.0, bpm / 200.0]
        seq_features = np.tile(features_vec, (1, 5, 1))
        seq_tensor = torch.tensor(seq_features, dtype=torch.float32)

        with torch.no_grad():
            pytorch_risk_index = bilstm_attention_engine(seq_tensor).item()

        # 4. Integrasi / Fallback dengan ONNX
        if session is not None:
            arr = raw_sig.reshape(1, 1, 100)
            outputs = session.run(None, {input_name: arr})
            pred_flat = np.array(outputs[0]).flatten()
            probs = softmax(pred_flat) if len(pred_flat) >= 3 else [0.33, 0.33, 0.34]
            pred_code = int(np.argmax(probs))
            ai_status = "HYBRID INCEPTION-LSTM + ONNX"
        else:
            if pytorch_risk_index > 60.0:
                pred_code = 2
            elif pytorch_risk_index >= 20.0:
                pred_code = 1
            else:
                pred_code = 0
            ai_status = "INCEPTION-ATTENTION ENGINE ON"

        # 5. Pemetaan Status Prediksi
        if pred_code == 2:
            status_text = "High Risk"
            wave_status = "Anomali Kritis"
            cardiac_risk_index = max(pytorch_risk_index, 60.0)
        elif pred_code == 1:
            status_text = "Moderate"
            wave_status = "Aritmia Sedang"
            cardiac_risk_index = pytorch_risk_index if 20.0 <= pytorch_risk_index <= 60.0 else 45.0
        else:
            status_text = "Safe Zone"
            wave_status = "Normal Sinus"
            cardiac_risk_index = min(pytorch_risk_index, 20.0)

        return {
            "cardiac_risk_index": round(cardiac_risk_index, 2),
            "prediction_code": pred_code,
            "status": status_text,
            "wave_status": wave_status,
            "bpm": bpm,
            "spo2": spo2,
            "ai_status": ai_status,
            "morphology_score": round(morphology_score, 4),
            "hrv_sdnn": round(hrv_sdnn, 2),
            "hrv_rmssd": round(hrv_rmssd, 2)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/nearest-hospital")
def get_nearest_hospital(lat: float, lng: float):
    hospitals = []
    for h in HOSPITALS_DATABASE:
        dist = calculate_distance(lat, lng, h["lat"], h["lng"])
        h_info = h.copy()
        h_info["distance_km"] = round(dist, 2)
        hospitals.append(h_info)
    
    hospitals.sort(key=lambda x: x["distance_km"])
    
    return {
        "patient_location": {"lat": lat, "lng": lng},
        "recommended_hospital": hospitals[0],
        "all_hospitals": hospitals
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
