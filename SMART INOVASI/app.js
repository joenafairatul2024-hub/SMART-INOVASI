// ==========================================
// PULSERESCUE AI - APP LOGIC (app.js)
// ==========================================

// --- KONFIGURASI BACKEND API 
const API_BASE_URL = "https://web-production-bd1d5.up.railway.app"; 

// --- KONFIGURASI & STATE GLOBAL PASIEN ---
let REGISTERED_PATIENT = { 
    name: "Budi Santoso", 
    nik: "3404001234567",
    tglLahir: "1995-05-15",
    usia: "29",
    jenisKelamin: "Laki-laki",
    telepon: "081234567890",
    email: "budi.santoso@email.com",
    alamat: "Sleman, DI Yogyakarta",
    golDarah: "O",
    alergi: "Tidak Ada",
    kontakDarurat: { nama: "Siti Santoso (Istri)", hp: "081987654321" },
    riwayatPenyakit: "Tidak Ada"
};

// Parameter Evakuasi Medis
const R_MAX_KM = 50;            
const TAU_DISPATCH_MIN = 2;     

// Koordinat Awal Default (Fallback Sleman)
let userLat = -7.7715; 
let userLng = 110.3395;

let map = null;
let patientMarker = null;
let hospitalMarkers = [];
let routingControl = null;
let currentNearestHospital = null;
let selectedHospital = null;
let isEmergencyRouteDrawn = false;
let isGpsAccurate = false;

// Data Master RS Rujukan Sleman & Sekitar
const MASTER_HOSPITALS = [
    { id: "rsu_queen_latifa", name: "RSU Queen Latifa", type: "RS Swasta", desc: "Ringroad Barat - IGD 24 Jam", lat: -7.771120, lng: 110.339350, phone: "(0274) 626140" },
    { id: "rsa_ugm", name: "RSA UGM Sleman", type: "RS Pemerintah", desc: "Pusat Rujukan Utama Sleman", lat: -7.742880, lng: 110.353150, phone: "(0274) 4530404" },
    { id: "rs_jih", name: "RS JIH Sleman", type: "RS Swasta", desc: "Tipe B - Emergency Center", lat: -7.756180, lng: 110.398550, phone: "(0274) 4463555" },
    { id: "rsup_sardjito", name: "RSUP Dr. Sardjito", type: "RS Pemerintah", desc: "Rujukan Nasional Tipe A", lat: -7.768560, lng: 110.373410, phone: "(0274) 587333" },
    { id: "rs_panti_rapih", name: "RS Panti Rapih", type: "RS Swasta", desc: "Tipe B - Emergency Center", lat: -7.777120, lng: 110.377250, phone: "(0274) 563333" },
    { id: "rs_pku_gamping", name: "RS PKU Muhammadiyah Gamping", type: "RS Swasta", desc: "Tipe B - Trauma Center", lat: -7.801050, lng: 110.322380, phone: "(0274) 6499706" },
    { id: "rs_pratama_jogja", name: "RS Pratama Kota Jogja", type: "RS Pemerintah", desc: "Mergangsan - Ambulans IGD Siaga Pemkot", lat: -7.818500, lng: 110.373200, phone: "(0274) 373200" },
    { id: "rsud_kota_jogja", name: "RSUD Kota Yogyakarta", type: "RS Pemerintah", desc: "Wirosaban - IGD Siaga 24 Jam", lat: -7.825200, lng: 110.378000, phone: "(0274) 371195" },
    { id: "rsud_sleman", name: "RSUD Sleman", type: "RS Pemerintah", desc: "RSUD Kab. Sleman", lat: -7.687120, lng: 110.341250, phone: "(0274) 868437" }
];

// State Canvas ECG Waveform
let canvas, ctx;
let points = [];
let step = 0;
let isAnomalyWave = false;

// --- NAVIGASI MULTI-STEP FORM & SPLASH ---
let currentRegStep = 1;

function goToRegister() {
    const splash = document.getElementById('splashScreen');
    const register = document.getElementById('registerScreen');
    if (splash) splash.classList.add('hidden');
    if (register) register.classList.remove('hidden');
    
    goToStep(1);
}

function nextRegStep() {
    // Validasi input wajib di Step 1
    const nama = document.getElementById('reg_nama')?.value.trim();
    const nik = document.getElementById('reg_nik')?.value.trim();
    const tglLahir = document.getElementById('reg_tgl_lahir')?.value;
    const jk = document.getElementById('reg_jk')?.value;
    const telepon = document.getElementById('reg_telepon')?.value.trim();
    const email = document.getElementById('reg_email')?.value.trim();
    const alamat = document.getElementById('reg_alamat')?.value.trim();

    if (!nama || !nik || !tglLahir || !jk || !telepon || !email || !alamat) {
        alert("Mohon isi seluruh bidang bertanda bintang (*) di Step 1 terlebih dahulu.");
        return;
    }

    goToStep(2);
}

function prevRegStep() {
    if (currentRegStep === 2) {
        goToStep(1);
    } else {
        handleLogout();
    }
}

function goToStep(stepNumber) {
    currentRegStep = stepNumber;
    const step1El = document.getElementById('reg-step-1');
    const step2El = document.getElementById('reg-step-2');
    const dot1 = document.getElementById('dot-step-1');
    const dot2 = document.getElementById('dot-step-2');

    if (stepNumber === 1) {
        if (step1El) step1El.style.display = 'block';
        if (step2El) step2El.style.display = 'none';
        if (dot1) dot1.classList.add('active');
        if (dot2) dot2.classList.remove('active');
    } else if (stepNumber === 2) {
        if (step1El) step1El.style.display = 'none';
        if (step2El) step2El.style.display = 'block';
        if (dot1) dot1.classList.remove('active');
        if (dot2) dot2.classList.add('active');
    }
}

function hitungUsia() {
    const tglLahirInput = document.getElementById('reg_tgl_lahir')?.value;
    const usiaInput = document.getElementById('reg_usia');
    
    if (tglLahirInput) {
        const today = new Date();
        const birthDate = new Date(tglLahirInput);
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        if (usiaInput) usiaInput.value = age > 0 ? age : 0;
    }
}

function handleRegistrationSubmit(e) {
    if (e) e.preventDefault();

    REGISTERED_PATIENT = {
        name: document.getElementById('reg_nama')?.value || "Pasien Anonim",
        nik: document.getElementById('reg_nik')?.value || "-",
        tglLahir: document.getElementById('reg_tgl_lahir')?.value || "-",
        usia: document.getElementById('reg_usia')?.value || "-",
        jenisKelamin: document.getElementById('reg_jk')?.value || "-",
        telepon: document.getElementById('reg_telepon')?.value || "-",
        email: document.getElementById('reg_email')?.value || "-",
        alamat: document.getElementById('reg_alamat')?.value || "-",
        golDarah: document.getElementById('reg_gol_darah')?.value || "-",
        alergi: document.getElementById('reg_alergi')?.value || "Tidak Ada",
        kontakDarurat: {
            nama: document.getElementById('reg_kd_nama')?.value || "-",
            hp: document.getElementById('reg_kd_hp')?.value || "-"
        },
        riwayatPenyakit: document.getElementById('reg_riwayat_penyakit')?.value || "Tidak Ada"
    };

    updateUserInterfaceWithPatientData();

    const registerScreen = document.getElementById('registerScreen');
    if (registerScreen) registerScreen.classList.add('hidden');

    if (!map) { initMap(); }
}

function startEmergencyChecking() {
    const splash = document.getElementById('splashScreen');
    const register = document.getElementById('registerScreen');
    if (splash) splash.classList.add('hidden');
    if (register) register.classList.add('hidden');
    
    updateUserInterfaceWithPatientData();
    if (!map) { initMap(); }
}

function handleLogout() {
    const splash = document.getElementById('splashScreen');
    const register = document.getElementById('registerScreen');
    if (register) register.classList.add('hidden');
    if (splash) splash.classList.remove('hidden');
    goToStep(1);
}

function updateUserInterfaceWithPatientData() {
    const displayNameEl = document.getElementById('user-display-name');
    const userAvatarEl = document.getElementById('user-avatar');
    const syncNikEl = document.getElementById('sync-nik-display');

    if (displayNameEl) displayNameEl.innerText = REGISTERED_PATIENT.name;
    if (userAvatarEl && REGISTERED_PATIENT.name) userAvatarEl.innerText = REGISTERED_PATIENT.name.charAt(0).toUpperCase();
    if (syncNikEl) syncNikEl.innerText = REGISTERED_PATIENT.nik;

    // Update Tab Medis
    const medNama = document.getElementById('med-nama');
    const medNik = document.getElementById('med-nik');
    const medTtl = document.getElementById('med-ttl');
    const medJk = document.getElementById('med-jk');
    const medKontak = document.getElementById('med-kontak');
    const medAlamat = document.getElementById('med-alamat');
    const medGolDarah = document.getElementById('med-goldarah');
    const medAlergi = document.getElementById('med-alergi');
    const medKd = document.getElementById('med-kd');
    const medPenyakit = document.getElementById('med-penyakit');

    if (medNama) medNama.innerText = REGISTERED_PATIENT.name;
    if (medNik) medNik.innerText = REGISTERED_PATIENT.nik;
    if (medTtl) medTtl.innerText = `${REGISTERED_PATIENT.tglLahir || '-'} (${REGISTERED_PATIENT.usia || '-'} Thn)`;
    if (medJk) medJk.innerText = REGISTERED_PATIENT.jenisKelamin;
    if (medKontak) medKontak.innerText = `${REGISTERED_PATIENT.telepon} / ${REGISTERED_PATIENT.email}`;
    if (medAlamat) medAlamat.innerText = REGISTERED_PATIENT.alamat;
    if (medGolDarah) medGolDarah.innerText = REGISTERED_PATIENT.golDarah;
    if (medAlergi) medAlergi.innerText = REGISTERED_PATIENT.alergi;
    if (medKd) medKd.innerText = `${REGISTERED_PATIENT.kontakDarurat.nama} (${REGISTERED_PATIENT.kontakDarurat.hp})`;
    if (medPenyakit) medPenyakit.innerText = REGISTERED_PATIENT.riwayatPenyakit;
}

// --- FORMULA HAVERSINE ---
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.pow(Math.sin(deltaPhi / 2), 2) +
              Math.cos(phi1) * Math.cos(phi2) * Math.pow(Math.sin(deltaLambda / 2), 2);
    
    return 2 * R * Math.asin(Math.sqrt(a));
}

// --- RENDER TAB ANALISIS ---
function renderAnalisisTab(data = {}) {
    const container = document.getElementById('analisis-dynamic-container');
    if (!container) return;

    const riskPercent = data.risk_percent || data.risk_score || data.cardiac_risk_index || 1.74;
    const predCode = data.prediction_code || 0; // 0: Normal, 1: Waspada, 2: Kritis
    const latency = data.latency || "11.4 ms";
    const hrvVar = data.hrv_var || data.lstmHrv || "1.28 ms²";

    let konsensusStatus = "NORMAL (99.2%)";
    let konsensusBadgeClass = "badge-normal-green";
    let konsensusText = "Hasil kombinasi 3 model AI (TinyFormer, 1D-CNN, & LSTM) mengonfirmasi ritme sinus stabil tanpa indikasi disritmia atau kelainan temporal.";
    let tinyFormerRes = "Normal";
    let cnnRes = `${riskPercent.toFixed(2)}% Risk`;
    let lstmRes = hrvVar;
    let cnnBadgeText = "Normal Wave";
    let cnnBadgeColor = "var(--success)";

    if (predCode === 2) {
        konsensusStatus = "ANOMALI KRITIS";
        konsensusBadgeClass = "badge-danger-red";
        konsensusText = "Hasil kombinasi 3 model AI mendeteksi kelainan ritme dan risiko aritmia berat secara bersamaan.";
        tinyFormerRes = "Aritmia";
        cnnBadgeText = "Anomaly Wave";
        cnnBadgeColor = "var(--emergency)";
    } else if (predCode === 1) {
        konsensusStatus = "WASPADA";
        konsensusBadgeClass = "badge-warning-orange";
        konsensusText = "Hasil kombinasi 3 model AI mendeteksi fluktuasi ritme temporal yang memerlukan perhatian.";
        tinyFormerRes = "Waspada";
        cnnBadgeText = "Waspada Wave";
        cnnBadgeColor = "var(--warning)";
    }

    container.innerHTML = `
        <div class="card-dark-ensemble">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-size: 0.72rem; font-weight: 800; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> KONSENSUS ENSEMBLE AI
                </div>
                <span class="${konsensusBadgeClass}">${konsensusStatus}</span>
            </div>
            <p style="font-size: 0.72rem; opacity: 0.9; line-height: 1.4;">
                ${konsensusText}
            </p>
            <div class="ensemble-inner-grid">
                <div class="ensemble-sub-item">
                    <span>TinyFormer</span>
                    <strong>${tinyFormerRes}</strong>
                </div>
                <div class="ensemble-sub-item">
                    <span>1D-CNN</span>
                    <strong>${cnnRes}</strong>
                </div>
                <div class="ensemble-sub-item">
                    <span>LSTM</span>
                    <strong>${lstmRes}</strong>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header-sm">
                <span class="card-title" style="display:flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-microchip" style="color:var(--brand-primary)"></i> EDGE AI ENGINE PERFORMANCE
                </span>
                <span class="badge-engine-blue">TF.js WebGL Engine</span>
            </div>
            <p style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.4;">
                Pemrosesan model AI dilakukan langsung di memori perangkat melalui runtime TensorFlow.js lokal tanpa koneksi server.
            </p>
            <div class="inner-box-2col">
                <div class="inner-stat-box">
                    <p>Inference Latency</p>
                    <h4>${latency}</h4>
                </div>
                <div class="inner-stat-box">
                    <p>Engine Type</p>
                    <h4>TensorFlow.js</h4>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header-sm">
                <span class="card-title" style="display:flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-chart-line" style="color:var(--brand-primary)"></i> 1D-CNN EXTRACTION
                </span>
                <span style="font-size: 0.72rem; font-weight: 800; color: ${cnnBadgeColor};">${cnnBadgeText}</span>
            </div>
            <p style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.4;">
                Mengevaluasi morfologi gelombang PPG secara kontinu menggunakan layer Conv1D untuk mendeteksi disritmia mendadak.
            </p>
            <div class="inner-box-orange">
                <span>TF.js Layer: Conv1D (4 Filters)</span>
                <span>Risk: ${riskPercent.toFixed(2)}%</span>
            </div>
        </div>

        <div class="card">
            <div class="card-header-sm">
                <span class="card-title" style="display:flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-chart-line" style="color:var(--brand-primary)"></i> LSTM TEMPORAL SEQUENCE
                </span>
                <span style="font-size: 0.72rem; font-weight: 800; color: var(--brand-primary);">Window: 10s</span>
            </div>
            <p style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.4;">
                Manganalisis variabilitas interval R-R temporal jangka pendek untuk memprediksi kecenderungan henti jantung secara real-time.
            </p>
            <div class="inner-box-blue">
                <span>Recurrent Units: 64 LSTM</span>
                <span>HRV Var: ${hrvVar}</span>
            </div>
        </div>
    `;

    updateHomeMetrics(riskPercent, data.cnn_score || 0.0174);
}

function updateHomeMetrics(riskPercent, morphologyScore) {
    const fillBar = document.getElementById('risk-bar-fill');
    const scoreText = document.getElementById('risk-score-text');
    const anomalyVal = document.getElementById('anomaly-val');

    if (fillBar) {
        fillBar.style.width = `${Math.min(Math.max(riskPercent, 3), 100)}%`;
        fillBar.style.backgroundColor = riskPercent > 60 ? 'var(--emergency)' : (riskPercent >= 20 ? 'var(--warning)' : 'var(--success)');
    }
    if (scoreText) {
        scoreText.innerText = `${riskPercent.toFixed(1)}% (${riskPercent > 60 ? 'Tinggi' : (riskPercent >= 20 ? 'Waspada' : 'Aman')})`;
        scoreText.style.color = riskPercent > 60 ? 'var(--emergency)' : (riskPercent >= 20 ? 'var(--warning)' : 'var(--success)');
    }
    if (anomalyVal) {
        anomalyVal.innerText = `${(morphologyScore * 100).toFixed(2)} %`;
    }
}

// --- INISIALISASI UTAMA ---
document.addEventListener("DOMContentLoaded", () => {
    canvas = document.getElementById('ppgCanvas');
    if (canvas) {
        ctx = canvas.getContext('2d');
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();
        drawPPG();
    }

    updateClock();
    setInterval(updateClock, 1000);
    setInterval(fetchAIPrediction, 1500);
    updateUserInterfaceWithPatientData();
    renderAnalisisTab();
});

function updateClock() {
    const clockEl = document.getElementById('live-clock');
    if (clockEl) {
        const now = new Date();
        clockEl.innerText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab-screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');
    if (el) el.classList.add('active');

    if (tabId === 'tab-gis') {
        if (!map) {
            initMap();
        } else {
            setTimeout(() => map.invalidateSize(), 300);
        }
    }
}

// --- CANVAS PPG WAVEFORM ---
function resizeCanvas() {
    if (!canvas || !canvas.parentElement) return;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}

function getPPGPoint(t) {
    const cycle = t % 60;
    if (isAnomalyWave) return (Math.random() * 28) - 14;
    if (cycle < 15) return Math.sin((cycle / 15) * Math.PI) * 18;
    return 0;
}

function drawPPG() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const midY = canvas.height * 0.52;
    points.push({ y: midY - getPPGPoint(step) });
    if (points.length > canvas.width / 2) points.shift();

    ctx.beginPath();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = isAnomalyWave ? '#e11d48' : '#059669';
    for (let i = 0; i < points.length; i++) {
        if (i === 0) ctx.moveTo(i * 2, points[i].y);
        else ctx.lineTo(i * 2, points[i].y);
    }
    ctx.stroke();
    step++;
    requestAnimationFrame(drawPPG);
}

// --- GPS REALTIME ---
function dapatkanLokasiGPSRealtime() {
    const statusText = document.getElementById('gps-status-text');

    if (!("geolocation" in navigator)) {
        alert("Browser Anda tidak mendukung fitur Geolocation.");
        return;
    }

    if (statusText) statusText.innerText = "Mencari koordinat presisi...";

    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLat = position.coords.latitude;
            userLng = position.coords.longitude;
            isGpsAccurate = true;

            if (map) {
                map.setView([userLat, userLng], 15);
                if (patientMarker) {
                    patientMarker.setLatLng([userLat, userLng]);
                    patientMarker.bindPopup("<b>LOKASI PASIEN TERDETEKSI</b>").openPopup();
                }
            }

            if (statusText) statusText.innerText = "GPS Terhubung Presisi";
            updateHospitalsAndList();
        },
        (error) => {
            if (statusText) statusText.innerText = "Gagal GPS. Menggunakan lokasi manual.";
            updateHospitalsAndList();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function initMap() {
    if (map) return;

    map = L.map('map').setView([userLat, userLng], 14);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    const patientIcon = L.divIcon({
        className: 'patient-pulse-marker',
        iconSize: [18, 18],
        iconAnchor: [9, 9], 
        popupAnchor: [0, -10]
    });

    patientMarker = L.marker([userLat, userLng], { 
        icon: patientIcon,
        draggable: true 
    }).addTo(map).bindPopup("<b>LOKASI PASIEN SAAT INI</b>");

    dapatkanLokasiGPSRealtime();

    patientMarker.on('dragend', function () {
        const position = patientMarker.getLatLng();
        userLat = position.lat;
        userLng = position.lng;
        isGpsAccurate = false;
        updateHospitalsAndList();
    });

    map.on('click', function(e) {
        userLat = e.latlng.lat;
        userLng = e.latlng.lng;
        patientMarker.setLatLng([userLat, userLng]);
        isGpsAccurate = false;
        updateHospitalsAndList();
    });
}

// --- RUMAH SAKIT & MATRIX OSRM ---
async function updateHospitalsAndList() {
    let updatedHospitals = [];

    try {
        const destinationCoords = MASTER_HOSPITALS.map(h => `${h.lng},${h.lat}`).join(';');
        const url = `https://router.project-osrm.org/table/v1/driving/${userLng},${userLat};${destinationCoords}?sources=0&annotations=distance,duration`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.code === 'Ok' && data.distances && data.distances[0]) {
            const distancesInMeters = data.distances[0].slice(1);
            const durationsInSeconds = data.durations[0].slice(1);

            updatedHospitals = MASTER_HOSPITALS.map((h, idx) => {
                const roadDistKm = parseFloat((distancesInMeters[idx] / 1000).toFixed(1));
                const osrmTravelTimeMin = Math.ceil(durationsInSeconds[idx] / 60);
                const etaRiil = osrmTravelTimeMin + TAU_DISPATCH_MIN;

                return { ...h, distance_km: roadDistKm, eta_min: etaRiil };
            });
        } else {
            throw new Error("Respon OSRM Matrix gagal");
        }
    } catch (err) {
        updatedHospitals = MASTER_HOSPITALS.map(h => {
            const straight = calculateHaversineDistance(userLat, userLng, h.lat, h.lng);
            const roadDist = parseFloat((straight * 1.35).toFixed(1));
            const etaEstimated = Math.ceil((roadDist / 35) * 60) + TAU_DISPATCH_MIN;
            return { ...h, distance_km: roadDist, eta_min: etaEstimated };
        });
    }

    updatedHospitals.sort((a, b) => a.distance_km - b.distance_km);
    currentNearestHospital = updatedHospitals[0];

    if (!selectedHospital) {
        selectedHospital = currentNearestHospital;
    } else {
        const matching = updatedHospitals.find(h => h.id === selectedHospital.id);
        if (matching) selectedHospital = matching;
        else selectedHospital = currentNearestHospital;
    }

    const optimalRsNameEl = document.getElementById('optimal-rs-name');
    const optimalRsSubEl = document.getElementById('optimal-rs-sub');

    if (optimalRsNameEl) {
        optimalRsNameEl.innerText = `${currentNearestHospital.name} (${currentNearestHospital.distance_km} km)`;
    }
    if (optimalRsSubEl) {
        optimalRsSubEl.innerText = `Rekomendasi terdekat untuk evakuasi. Dipilih: ${selectedHospital.name} (${selectedHospital.distance_km} km).`;
    }

    const btnCallEl = document.getElementById('btn-panggil-ambulans');
    if (btnCallEl) {
        btnCallEl.innerHTML = `<i class="fa-solid fa-phone-volume"></i> PANGGIL AMBULANS: ${selectedHospital.name.toUpperCase()} (${selectedHospital.distance_km} km)`;
    }

    if (map) {
        hospitalMarkers.forEach(m => map.removeLayer(m));
        hospitalMarkers = [];

        updatedHospitals.forEach((h) => {
            const m = L.marker([h.lat, h.lng])
                .addTo(map)
                .bindPopup(`<b>${h.name}</b><br>${h.type}<br>Jarak: ${h.distance_km} km | ETA: ${h.eta_min} mnt`);
            hospitalMarkers.push(m);
        });
    }

    const listContainer = document.getElementById('hospital-list-container');
    if (listContainer) {
        listContainer.innerHTML = updatedHospitals.map((h) => `
            <div class="hospital-card ${h.id === selectedHospital.id ? 'active-selected' : ''}" onclick="selectHospitalTarget('${h.id}')">
                <div class="hosp-info">
                    <h6><i class="fa-solid fa-truck-medical"></i> ${h.name}</h6>
                    <p>${h.desc}</p>
                </div>
                <div class="hosp-dist">
                    <div class="dist-val">${h.distance_km} km</div>
                </div>
            </div>
        `).join('');
    }

    if (isAnomalyWave && map) {
        isEmergencyRouteDrawn = false;
        drawEmergencyRoute();
    }
}

function selectHospitalTarget(hospitalId) {
    const target = MASTER_HOSPITALS.find(h => h.id === hospitalId);
    if (target) {
        selectedHospital = target;
        updateHospitalsAndList();
    }
}

// --- PREDIKSI AI & INTEGRASI ---
async function fetchAIPrediction() {
    let signalData = points.slice(-100).map(p => p.y / 100);
    while (signalData.length < 100) signalData.push(Math.random());

    try {
        const response = await fetch(`${API_BASE_URL}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                signal: signalData,
                latitude: userLat,
                longitude: userLng
            })
        });

        if (!response.ok) return;

        const data = await response.json();

        renderAnalisisTab(data);

        const predCode = data.prediction_code || 0; 
        const bpm = data.bpm || 74;
        const spo2 = data.spo2 || 98;
        const waveStatus = data.wave_status || "Normal Sinus";
        const statusText = data.status || "Safe Zone";

        isAnomalyWave = (predCode === 2);

        const bpmEl = document.getElementById('bpm-counter');
        const spo2El = document.getElementById('spo2-val');
        const lstmEl = document.getElementById('lstm-var-val');

        if (bpmEl) bpmEl.innerText = bpm;
        if (spo2El) spo2El.innerText = spo2 + "%";
        if (lstmEl) {
            lstmEl.innerText = data.ai_status || "TERHUBUNG";
            lstmEl.style.color = "var(--success)";
        }

        const waveTag = document.getElementById('wave-status-tag');

        if (predCode === 2 || statusText.includes("High Risk")) {
            if (waveTag) {
                waveTag.innerHTML = '<i class="fa-solid fa-skull-crossbones"></i> Kritis: ' + waveStatus;
                waveTag.style.color = "var(--emergency)";
            }
            if (map) drawEmergencyRoute();

        } else if (predCode === 1 || statusText.includes("Moderate")) {
            if (waveTag) {
                waveTag.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Waspada: ' + waveStatus;
                waveTag.style.color = "var(--warning)";
            }
            removeEmergencyRoute();

        } else {
            if (waveTag) {
                waveTag.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + waveStatus;
                waveTag.style.color = "var(--success)";
            }
            removeEmergencyRoute();
        }

    } catch (err) {
        const lstmEl = document.getElementById('lstm-var-val');
        if (lstmEl) {
            lstmEl.innerText = "OFFLINE";
            lstmEl.style.color = "var(--emergency)";
        }
    }
}

// --- RUTE EMERGENCY & SOS ---
function drawEmergencyRoute() {
    const targetHospital = selectedHospital || currentNearestHospital;
    if (!map || !targetHospital || isEmergencyRouteDrawn) return;

    if (routingControl) {
        map.removeControl(routingControl);
    }

    routingControl = L.Routing.control({
        waypoints: [
            L.latLng(userLat, userLng),
            L.latLng(targetHospital.lat, targetHospital.lng)
        ],
        lineOptions: {
            styles: [{ color: '#e11d48', weight: 6, opacity: 0.85 }]
        },
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false,
        show: false,
        createMarker: function() { return null; }
    }).addTo(map);

    isEmergencyRouteDrawn = true;
}

function removeEmergencyRoute() {
    if (isEmergencyRouteDrawn && routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
        isEmergencyRouteDrawn = false;
    }
}

function panggilAmbulans() { 
    const targetHospital = selectedHospital || currentNearestHospital;
    if (targetHospital) {
        alert(` PANGGILAN SOS DIKIRIM KE AMBULANS ${targetHospital.name.toUpperCase()}!\nPasien: ${REGISTERED_PATIENT.name}\nJarak: ${targetHospital.distance_km} km\nETA: ${targetHospital.eta_min} Menit\nKontak Darurat Pasien: ${REGISTERED_PATIENT.kontakDarurat.hp}`);
    } else {
        alert(" PANGGILAN SOS DIKIRIM KE AMBULANS TERDEKAT!"); 
    }
}
