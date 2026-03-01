# ============================================================
# app.py — UrbanPulse Flask Backend
# Features:
#   - Email/Password login
#   - Google OAuth login (Flask-Dance)
#   - Real-time AQI from WAQI API
#   - Synthetic traffic data (replace with TomTom for real data)
# ============================================================

from flask import Flask, jsonify, render_template, request, redirect, url_for, session
import pandas as pd
import numpy as np
from scipy.stats import pearsonr, spearmanr
from functools import wraps
import requests as http_requests
import os

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "urbanpulse_secret_2024")

# ════════════════════════════════════════════════════════════
# CONFIGURATION — PUT YOUR KEYS HERE
# ════════════════════════════════════════════════════════════

# 1. WAQI API key — get FREE at: https://aqicn.org/data-platform/token/
WAQI_TOKEN = "ffb82953b46303efe100b5bafd97560699637971"

# 2. Google OAuth — get FREE at: https://console.cloud.google.com/
#    Steps: Create Project → APIs & Services → OAuth 2.0 Client IDs
#    Authorized redirect URI: http://localhost:5000/login/google/authorized
GOOGLE_CLIENT_ID     = os.environ.get("GOOGLE_CLIENT_ID",     "YOUR_GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "YOUR_GOOGLE_CLIENT_SECRET")

# City to fetch real AQI for
CITY = "Pune"

# ════════════════════════════════════════════════════════════
# GOOGLE OAUTH SETUP
# ════════════════════════════════════════════════════════════
# Only enable Google OAuth if real credentials are provided
GOOGLE_OAUTH_ENABLED = (
    GOOGLE_CLIENT_ID     != "YOUR_GOOGLE_CLIENT_ID" and
    GOOGLE_CLIENT_SECRET != "YOUR_GOOGLE_CLIENT_SECRET"
)

if GOOGLE_OAUTH_ENABLED:
    try:
        from flask_dance.contrib.google import make_google_blueprint, google
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"  # Allow HTTP for localhost

        google_bp = make_google_blueprint(
            client_id     = GOOGLE_CLIENT_ID,
            client_secret = GOOGLE_CLIENT_SECRET,
            scope         = ["profile", "email"],
            redirect_url  = "/google/callback",
        )
        app.register_blueprint(google_bp, url_prefix="/login")
        print("✅ Google OAuth enabled")
    except ImportError:
        GOOGLE_OAUTH_ENABLED = False
        print("⚠️  flask-dance not installed. Run: pip install flask-dance")
else:
    print("ℹ️  Google OAuth not configured — using demo mode")


# ════════════════════════════════════════════════════════════
# USER DATABASE
# ════════════════════════════════════════════════════════════
USERS = {
    "admin@urbanpulse.com": {"password": "admin123", "name": "Admin User"},
    "student@test.com":     {"password": "test123",  "name": "Student"},
}


# ════════════════════════════════════════════════════════════
# REAL AQI — WAQI API
# ════════════════════════════════════════════════════════════

def fetch_real_aqi():
    """
    Fetch live AQI data from WAQI API for the configured city.
    WAQI covers 12,000+ stations globally including all Indian cities.

    Returns dict with aqi, pm25, no2, co, o3, station_name
    Returns None if API key not set or request fails.
    """
    if WAQI_TOKEN == "ffb82953b46303efe100b5bafd97560699637971":
        return None  # Fall back to synthetic data

    try:
        url      = f"https://api.waqi.info/feed/{CITY}/?token={WAQI_TOKEN}"
        response = http_requests.get(url, timeout=8)
        data     = response.json()

        if data.get("status") != "ok":
            return None

        d    = data["data"]
        iaqi = d.get("iaqi", {})

        return {
            "aqi":          d.get("aqi", 0),
            "pm25":         iaqi.get("pm25", {}).get("v", 0),
            "pm10":         iaqi.get("pm10", {}).get("v", 0),
            "no2":          iaqi.get("no2",  {}).get("v", 0),
            "co":           iaqi.get("co",   {}).get("v", 0),
            "o3":           iaqi.get("o3",   {}).get("v", 0),
            "station":      d.get("city", {}).get("name", CITY),
            "updated_at":   d.get("time", {}).get("s", ""),
            "is_real":      True,
        }
    except Exception as e:
        print(f"WAQI API error: {e}")
        return None


def fetch_multiple_stations():
    """
    Fetch AQI from multiple stations around the city bounding box.
    Uses WAQI map/bounds endpoint.
    Returns list of station readings.
    """
    if WAQI_TOKEN == "ffb82953b46303efe100b5bafd97560699637971":
        return []

    try:
        # Pune bounding box
        bounds = "18.40,73.72,18.65,73.95"
        url    = f"https://api.waqi.info/map/bounds/?token={WAQI_TOKEN}&latlng={bounds}"
        resp   = http_requests.get(url, timeout=10)
        data   = resp.json()

        stations = []
        for s in data.get("data", []):
            try:
                aqi = float(s.get("aqi", 0))
                if aqi <= 0:
                    continue
                stations.append({
                    "station": s.get("station", {}).get("name", "Unknown"),
                    "lat":     float(s.get("lat", 0)),
                    "lon":     float(s.get("lon", 0)),
                    "aqi":     aqi,
                    "is_real": True,
                })
            except (ValueError, TypeError):
                continue
        return stations
    except Exception as e:
        print(f"WAQI bounds error: {e}")
        return []


# ════════════════════════════════════════════════════════════
# SYNTHETIC DATA GENERATOR (fallback when no API key)
# ════════════════════════════════════════════════════════════
np.random.seed(42)

LOCATIONS = [
    {"name": "Shivajinagar",    "lat": 18.530, "lon": 73.844},
    {"name": "Hinjewadi IT Park","lat": 18.591, "lon": 73.738},
    {"name": "Koregaon Park",   "lat": 18.536, "lon": 73.893},
    {"name": "Kothrud",         "lat": 18.504, "lon": 73.808},
    {"name": "Hadapsar",        "lat": 18.503, "lon": 73.928},
    {"name": "Pimpri-Chinchwad","lat": 18.627, "lon": 73.800},
    {"name": "Swargate",        "lat": 18.502, "lon": 73.856},
    {"name": "Viman Nagar",     "lat": 18.562, "lon": 73.914},
]

def generate_data(n=500):
    rows = []
    for i in range(n):
        loc   = LOCATIONS[i % len(LOCATIONS)]
        hour  = (i * 1) % 24
        is_rush  = (8 <= hour <= 10) or (17 <= hour <= 20)
        is_night = hour <= 5 or hour >= 23
        base = 0.75 if is_rush else (0.10 if is_night else 0.35)
        traffic  = float(np.clip(base + np.random.normal(0, 0.05), 0, 1))
        vehicles = int(traffic * 300 + np.random.normal(0, 10))
        pm25     = float(max(5,  traffic * 80  + np.random.normal(0, 8)))
        no2      = float(max(0,  pm25   * 0.6  + np.random.normal(0, 3)))
        aqi      = float(max(10, pm25   * 1.5  + np.random.normal(0, 5)))
        rows.append({
            "hour": hour, "location": loc["name"],
            "lat": loc["lat"], "lon": loc["lon"],
            "traffic_density": round(traffic, 3),
            "vehicle_count":   vehicles,
            "pm25": round(pm25, 2),
            "no2":  round(no2, 2),
            "aqi":  round(aqi, 1),
        })
    return pd.DataFrame(rows)

DF = generate_data(500)


# ════════════════════════════════════════════════════════════
# AUTH DECORATORS
# ════════════════════════════════════════════════════════════

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated

def api_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return jsonify({"error": "Not logged in"}), 401
        return f(*args, **kwargs)
    return decorated


# ════════════════════════════════════════════════════════════
# AUTH ROUTES
# ════════════════════════════════════════════════════════════

@app.route("/")
def home():
    if "user" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login_page"))


@app.route("/login", methods=["GET", "POST"])
def login_page():
    if request.method == "POST":
        email    = request.form.get("email",    "").strip().lower()
        password = request.form.get("password", "").strip()

        if email in USERS and USERS[email]["password"] == password:
            session["user"]   = email
            session["name"]   = USERS[email]["name"]
            session["avatar"] = ""
            return redirect(url_for("dashboard"))
        else:
            return redirect(url_for("login_page") + "?error=Invalid+email+or+password")

    return render_template("login.html",
                           google_enabled=GOOGLE_OAUTH_ENABLED)


@app.route("/register", methods=["POST"])
def register():
    name     = request.form.get("name",     "").strip()
    email    = request.form.get("email",    "").strip().lower()
    password = request.form.get("password", "").strip()

    if not name or not email or not password:
        return redirect(url_for("login_page") + "?error=All+fields+required&signup=true")

    if email in USERS:
        return redirect(url_for("login_page") + "?error=Email+already+exists")

    USERS[email] = {"password": password, "name": name}
    session["user"]   = email
    session["name"]   = name
    session["avatar"] = ""
    return redirect(url_for("dashboard"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


# ── Google OAuth Routes ────────────────────────────────────

@app.route("/login/google")
def google_login():
    """Redirect to Google login page."""
    if not GOOGLE_OAUTH_ENABLED:
        return redirect(url_for("login_page") +
                        "?error=Google+login+not+configured+yet")
    return redirect(url_for("google.login"))


@app.route("/google/callback")
def google_callback():
    """Called by Google after user approves login."""
    if not GOOGLE_OAUTH_ENABLED:
        return redirect(url_for("login_page"))

    if not google.authorized:
        return redirect(url_for("login_page") + "?error=Google+login+failed")

    try:
        resp = google.get("/oauth2/v2/userinfo")
        info = resp.json()

        email  = info.get("email",   "")
        name   = info.get("name",    "Google User")
        avatar = info.get("picture", "")

        # Auto-register Google users
        if email not in USERS:
            USERS[email] = {"password": None, "name": name}

        session["user"]   = email
        session["name"]   = name
        session["avatar"] = avatar
        return redirect(url_for("dashboard"))

    except Exception as e:
        print(f"Google callback error: {e}")
        return redirect(url_for("login_page") + "?error=Google+login+error")


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("index.html",
                           username=session.get("name",   "User"),
                           avatar=session.get("avatar", ""))


# ════════════════════════════════════════════════════════════
# DATA API ROUTES
# ════════════════════════════════════════════════════════════

@app.route("/api/summary")
@api_login_required
def api_summary():
    # Try real AQI first
    real = fetch_real_aqi()

    return jsonify({
        "total_records":  len(DF),
        "locations":      len(LOCATIONS),
        "avg_aqi":        real["aqi"] if real else round(DF["aqi"].mean(), 1),
        "avg_traffic":    round(DF["traffic_density"].mean(), 3),
        "peak_aqi":       real["aqi"] if real else round(DF["aqi"].max(), 1),
        "peak_traffic":   round(DF["traffic_density"].max(), 3),
        "hotspots":       int(((DF["traffic_density"] > 0.70) & (DF["aqi"] > 100)).sum()),
        "is_real_aqi":    real is not None,
        "aqi_source":     real["station"] if real else "Synthetic Data",
        "aqi_updated":    real.get("updated_at", "") if real else "",
        "pm25":           real["pm25"] if real else round(DF["pm25"].mean(), 1),
        "no2":            real["no2"]  if real else round(DF["no2"].mean(),  1),
    })


@app.route("/api/realtime_aqi")
@api_login_required
def api_realtime_aqi():
    """
    Dedicated endpoint for real-time AQI.
    Frontend polls this every 5 minutes to refresh.
    """
    real = fetch_real_aqi()
    if real:
        return jsonify({
            "success":  True,
            "aqi":      real["aqi"],
            "pm25":     real["pm25"],
            "pm10":     real["pm10"],
            "no2":      real["no2"],
            "co":       real["co"],
            "o3":       real["o3"],
            "station":  real["station"],
            "updated":  real["updated_at"],
            "category": aqi_category(real["aqi"]),
            "color":    aqi_color(real["aqi"]),
        })
    else:
        # Return synthetic average as fallback
        return jsonify({
            "success":  False,
            "message":  "Add ffb82953b46303efe100b5bafd97560699637971 to get real data",
            "aqi":      round(DF["aqi"].mean(), 1),
            "pm25":     round(DF["pm25"].mean(), 1),
            "no2":      round(DF["no2"].mean(),  1),
            "station":  "Synthetic Data",
            "category": aqi_category(round(DF["aqi"].mean(), 1)),
            "color":    aqi_color(round(DF["aqi"].mean(), 1)),
        })


@app.route("/api/realtime_stations")
@api_login_required
def api_realtime_stations():
    """All real AQI stations in the city bounding box."""
    stations = fetch_multiple_stations()
    if stations:
        return jsonify({"success": True, "stations": stations})
    return jsonify({"success": False, "stations": [], "message": "Add ffb82953b46303efe100b5bafd97560699637971 for real data"})


def aqi_category(aqi):
    if aqi <= 50:  return "Good"
    if aqi <= 100: return "Moderate"
    if aqi <= 150: return "Sensitive"
    if aqi <= 200: return "Unhealthy"
    if aqi <= 300: return "Very Unhealthy"
    return "Hazardous"

def aqi_color(aqi):
    if aqi <= 50:  return "#22c55e"
    if aqi <= 100: return "#eab308"
    if aqi <= 150: return "#f97316"
    if aqi <= 200: return "#ef4444"
    if aqi <= 300: return "#a855f7"
    return "#7f1d1d"


@app.route("/api/correlation")
@api_login_required
def api_correlation():
    results = []
    pairs = [
        ("traffic_density", "aqi",  "Traffic Density vs AQI"),
        ("traffic_density", "pm25", "Traffic Density vs PM2.5"),
        ("traffic_density", "no2",  "Traffic Density vs NO2"),
        ("vehicle_count",   "aqi",  "Vehicle Count vs AQI"),
    ]
    for x_col, y_col, label in pairs:
        r,  p  = pearsonr(DF[x_col],  DF[y_col])
        sr, _  = spearmanr(DF[x_col], DF[y_col])
        strength = "Strong" if abs(r) >= 0.7 else ("Moderate" if abs(r) >= 0.4 else "Weak")
        results.append({
            "label":       label,
            "pearson_r":   round(r,  3),
            "spearman_r":  round(sr, 3),
            "p_value":     round(p,  6),
            "strength":    strength,
            "significant": bool(p < 0.05),
        })
    return jsonify(results)


@app.route("/api/hourly")
@api_login_required
def api_hourly():
    hourly = DF.groupby("hour")[["traffic_density", "aqi", "pm25"]].mean().reset_index()
    return jsonify(hourly.round(3).to_dict(orient="records"))


@app.route("/api/locations")
@api_login_required
def api_locations():
    summary = DF.groupby(["location", "lat", "lon"]).agg(
        avg_traffic=("traffic_density", "mean"),
        avg_aqi    =("aqi",             "mean"),
        avg_pm25   =("pm25",            "mean"),
        peak_aqi   =("aqi",             "max"),
    ).reset_index().round(2)

    def classify(row):
        if row["avg_traffic"] > 0.70 and row["avg_aqi"] > 120: return "CRITICAL"
        if row["avg_traffic"] > 0.55 and row["avg_aqi"] > 90:  return "HIGH"
        if row["avg_traffic"] > 0.35 and row["avg_aqi"] > 60:  return "MODERATE"
        return "LOW"

    summary["risk"] = summary.apply(classify, axis=1)
    return jsonify(summary.to_dict(orient="records"))


@app.route("/api/diversions")
@api_login_required
def api_diversions():
    summary = DF.groupby(["location", "lat", "lon"]).agg(
        avg_traffic=("traffic_density", "mean"),
        avg_aqi    =("aqi",             "mean"),
        avg_pm25   =("pm25",            "mean"),
    ).reset_index().round(2)

    def classify(row):
        if row["avg_traffic"] > 0.70 and row["avg_aqi"] > 120: return "CRITICAL"
        if row["avg_traffic"] > 0.55 and row["avg_aqi"] > 90:  return "HIGH"
        return "OK"

    summary["risk"] = summary.apply(classify, axis=1)
    hotspots = summary[summary["risk"].isin(["CRITICAL", "HIGH"])]
    safe     = summary[summary["risk"] == "OK"]

    recs = []
    for _, h in hotspots.iterrows():
        if safe.empty: continue
        s = safe.copy()
        s["dist"] = s.apply(lambda r: (
            ((r["lat"] - h["lat"]) * 111) ** 2 +
            ((r["lon"] - h["lon"]) * 95)  ** 2
        ) ** 0.5, axis=1)
        nearest = s.loc[s["dist"].idxmin()]
        recs.append({
            "from":            h["location"],
            "risk":            h["risk"],
            "current_aqi":     round(float(h["avg_aqi"]),  1),
            "traffic_pct":     f"{h['avg_traffic']:.0%}",
            "divert_to":       nearest["location"],
            "detour_km":       round(float(nearest["dist"]) * 1.3, 1),
            "est_improvement": round((float(h["avg_aqi"]) - float(nearest["avg_aqi"])) * 0.35, 1),
        })
    return jsonify(recs)


@app.route("/api/scatter")
@api_login_required
def api_scatter():
    sample = DF.sample(200, random_state=1)[
        ["traffic_density", "aqi", "pm25", "no2", "hour", "location"]
    ]
    return jsonify(sample.to_dict(orient="records"))


@app.route("/api/heatmap_data")
@api_login_required
def api_heatmap():
    cols  = ["traffic_density", "vehicle_count", "aqi", "pm25", "no2"]
    names = ["Traffic", "Vehicles", "AQI", "PM2.5", "NO2"]
    matrix = []
    for i, c1 in enumerate(cols):
        for j, c2 in enumerate(cols):
            r, _ = pearsonr(DF[c1], DF[c2])
            matrix.append({"x": names[j], "y": names[i], "value": round(r, 2)})
    return jsonify({"matrix": matrix, "labels": names})


@app.route("/api/piechart")
@api_login_required
def api_piechart():
    def classify_aqi(aqi):
        if aqi <= 50:  return "Good"
        if aqi <= 100: return "Moderate"
        if aqi <= 150: return "Sensitive"
        if aqi <= 200: return "Unhealthy"
        if aqi <= 300: return "Very Unhealthy"
        return "Hazardous"
    DF["aqi_cat"] = DF["aqi"].apply(classify_aqi)
    counts = DF["aqi_cat"].value_counts()
    order  = ["Good","Moderate","Sensitive","Unhealthy","Very Unhealthy","Hazardous"]
    labels = [o for o in order if o in counts.index]
    values = [int(counts[l]) for l in labels]
    return jsonify({"labels": labels, "values": values})


if __name__ == "__main__":
    print("=" * 55)
    print("  🚦 UrbanPulse — Traffic x AQI Web App")
    print("=" * 55)
    print("  URL      : http://localhost:5000")
    print()
    print("  Login    : admin@urbanpulse.com / admin123")
    print()
    print("  WAQI API :", "✅ Configured" if WAQI_TOKEN != "ffb82953b46303efe100b5bafd97560699637971" else "❌ Not set (get free key at aqicn.org)")
    print("  Google   :", "✅ Configured" if GOOGLE_OAUTH_ENABLED else "❌ Not set (get key at console.cloud.google.com)")
    print()
    print("  To enable real AQI:")
    print("    set WAQI_TOKEN=ffb82953b46303efe100b5bafd97560699637971")
    print("    python app.py")
    print("=" * 55)
    app.run(debug=True, port=5000)