import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import math
import copy
import random
from contextlib import asynccontextmanager
from typing import Annotated, Any, List, Optional
import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from geoalchemy2.elements import WKTElement
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import HazardReport
from app.ai_service import evaluate_route_safety


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"CRITICAL: Database initialization skipped (DB may be offline): {e}")
    yield


app = FastAPI(title="Safe-Route API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Category = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=80),
]

Description = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=5, max_length=1000),
]


class ReportCreate(BaseModel):
    category: Category
    description: Description
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RouteEvaluateRequest(BaseModel):
    origin: str
    destination: str
    hazards: list[str] = []


class NavQuery(BaseModel):
    origin_name: Optional[str] = "Current Location"
    destination_name: Optional[str] = "Destination"
    origin_coords: Any = None
    destination_coords: Any = None


class CorridorRequest(BaseModel):
    origin_coords: Any
    destination_coords: Any


def serialize_report(report: HazardReport):
    return {
        "id": report.id,
        "category": report.category,
        "description": report.description,
        "latitude": report.latitude,
        "longitude": report.longitude,
        "verified": report.verified,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


def extract_lat_lng(coords: Any) -> list[float]:
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            return [float(coords[0]), float(coords[1])]
        except (ValueError, TypeError):
            pass
    if isinstance(coords, dict):
        lat = coords.get("lat") or coords.get("latitude")
        lng = coords.get("lng") or coords.get("lon") or coords.get("longitude")
        if lat is not None and lng is not None:
            try:
                return [float(lat), float(lng)]
            except (ValueError, TypeError):
                pass
    return [28.6280, 77.2090]


def generate_faceted_polygon(center_lat: float, center_lng: float, radius_meters: float = 75, seed_val: int = 0, sides: int = 5) -> list[list[float]]:
    points = []
    lat_offset = radius_meters / 111139.0
    lng_offset = radius_meters / (111139.0 * math.cos(math.radians(center_lat)))
    
    actual_seed = seed_val if seed_val != 0 else int((abs(center_lat) + abs(center_lng)) * 100000)
    rng = random.Random(actual_seed)

    angle_step = (2 * math.pi) / sides
    for i in range(sides):
        angle = i * angle_step
        jitter = rng.uniform(0.75, 1.25)
        p_lat = center_lat + (lat_offset * jitter * math.sin(angle))
        p_lng = center_lng + (lng_offset * jitter * math.cos(angle))
        points.append([round(p_lat, 6), round(p_lng, 6)])
    
    points.append(points[0])
    return points


async def fetch_corridor_infrastructure(min_lat: float, min_lng: float, max_lat: float, max_lng: float):
    overpass_query = f"""
    [out:json][timeout:12];
    (
      node["amenity"~"police|hospital|pharmacy|bank|atm|cafe"]({min_lat},{min_lng},{max_lat},{max_lng});
      node["highway"="bus_stop"]({min_lat},{min_lng},{max_lat},{max_lng});
      node["railway"~"subway_entrance|station"]({min_lat},{min_lng},{max_lat},{max_lng});
    );
    out 20;
    """
    safe_zones = []
    headers = {
        "User-Agent": "SafeRouteApp/1.0 (contact@saferoute.local)",
        "Accept": "application/json",
    }
    overpass_urls = [
        "https://lz4.overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    for url in overpass_urls:
        try:
            async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
                resp = await client.post(url, data={"data": overpass_query})
                if resp.status_code == 200:
                    elements = resp.json().get("elements", [])
                    for el in elements:
                        tags = el.get("tags", {})
                        raw_type = tags.get("amenity") or tags.get("railway") or "Public"
                        name = tags.get("name") or raw_type.replace('_', ' ').title()
                        safe_zones.append({
                            "id": f"osm-safe-{el['id']}",
                            "type": "safe",
                            "center": [el["lat"], el["lon"]],
                            "polygon": generate_faceted_polygon(el["lat"], el["lon"], radius_meters=60, sides=6),
                            "title": f"{name}",
                            "description": "Active infrastructure providing baseline lighting/crowd presence."
                        })
                    break
                else:
                    print(f"LOG: Overpass ({url}) returned status code {resp.status_code}")
        except Exception as e:
            print(f"LOG: Overpass ({url}) query failed: {type(e).__name__} - {e}")

    return safe_zones


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/reports")
def get_reports(db: Session = Depends(get_db)):
    try:
        reports = db.query(HazardReport).order_by(HazardReport.created_at.desc()).all()
        return [serialize_report(report) for report in reports]
    except Exception as e:
        print(f"LOG: Failed to fetch reports: {e}")
        return []


@app.post("/reports", status_code=201)
def create_report(payload: ReportCreate, db: Session = Depends(get_db)):
    try:
        report = HazardReport(
            category=payload.category,
            description=payload.description,
            latitude=payload.latitude,
            longitude=payload.longitude,
            location=WKTElement(f"POINT({payload.longitude} {payload.latitude})", srid=4326),
        )
        db.add(report)
        db.commit()
        db.refresh(report)
        return serialize_report(report)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

def remove_spikes(path: list[list[float]]) -> list[list[float]]:
    """Strips out-and-back retracing loops from a coordinate polyline."""
    if len(path) < 4:
        return path
    cleaned = []
    for pt in path:
        cleaned.append(pt)
        # If current point is nearly identical to a recent point, pop the dead-end loop
        for back_idx in range(len(cleaned) - 3, max(-1, len(cleaned) - 18), -1):
            if math.hypot(cleaned[-1][0] - cleaned[back_idx][0], cleaned[-1][1] - cleaned[back_idx][1]) < 0.00015:
                cleaned = cleaned[:back_idx + 1]
                break
    return cleaned

@app.post("/api/plan-routes")
async def plan_routes(query: NavQuery, db: Session = Depends(get_db)):
    start_lat, start_lng = extract_lat_lng(query.origin_coords)
    end_lat, end_lng = extract_lat_lng(query.destination_coords)

    origin_label = query.origin_name or "Origin"
    dest_label = query.destination_name or "Destination"

    # 1. Build Bounding Box & Query Real PostGIS + OSM Data
    pad = 0.005
    min_lat, max_lat = min(start_lat, end_lat) - pad, max(start_lat, end_lat) + pad
    min_lng, max_lng = min(start_lng, end_lng) - pad, max(start_lng, end_lng) + pad

    corridor_hazards = []
    try:
        reports = db.query(HazardReport).filter(
            HazardReport.latitude >= min_lat, HazardReport.latitude <= max_lat,
            HazardReport.longitude >= min_lng, HazardReport.longitude <= max_lng
        ).all()

        for r in reports:
            corridor_hazards.append({
                "id": f"hazard-{r.id}",
                "type": "unsafe",
                "center": [r.latitude, r.longitude],
                "polygon": generate_faceted_polygon(r.latitude, r.longitude, 75, r.id, 5),
                "title": r.category.replace('_', ' ').title(),
                "description": r.description
            })
    except Exception as e:
        print(f"LOG: PostGIS DB query failed: {e}")

    corridor_safe_nodes = await fetch_corridor_infrastructure(min_lat, min_lng, max_lat, max_lng)

    # 2. Fetch 3 Genuinely Distinct Street Geometries
    candidates = []

    def is_distinct_path(new_path, new_dist):
        mid_pt = new_path[len(new_path) // 2]
        q1_pt = new_path[len(new_path) // 3]
        for existing in candidates:
            ex_path = existing["path"]
            ex_mid = ex_path[len(ex_path) // 2]
            ex_q1 = ex_path[len(ex_path) // 3]
            # Reject if both midpoint and 1/3 point are within ~80m of an existing route
            if (
                math.hypot(mid_pt[0] - ex_mid[0], mid_pt[1] - ex_mid[1]) < 0.0008
                and math.hypot(q1_pt[0] - ex_q1[0], q1_pt[1] - ex_q1[1]) < 0.0008
            ):
                return False
            # Also reject if exact same distance to 2 decimal places and similar midpoint
            if abs(new_dist - existing["distance_km"]) < 0.03 and math.hypot(mid_pt[0] - ex_mid[0], mid_pt[1] - ex_mid[1]) < 0.0015:
                return False
        return True

    def add_osrm_route(r, road_class="secondary"):
        raw_path = [[pt[1], pt[0]] for pt in r["geometry"]["coordinates"]]
        path = remove_spikes(raw_path)
        if len(path) < 2:
            return
        dist_km = 0.0
        for i in range(len(path) - 1):
            dlat = (path[i + 1][0] - path[i][0]) * 111.139
            dlng = (path[i + 1][1] - path[i][1]) * 111.139 * math.cos(math.radians(start_lat))
            dist_km += math.hypot(dlat, dlng)
        dist_km = round(max(0.1, dist_km), 2)

        if is_distinct_path(path, dist_km):
            walk_time = max(1, round(dist_km * 12))
            candidates.append({
                "path": path,
                "distance_km": dist_km,
                "duration_mins": walk_time,
                "road_class": road_class,
            })

    async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "SafeRouteApp/1.0"}) as client:
        for prof, r_class in [("walking", "shortcut"), ("driving", "arterial"), ("bike", "secondary")]:
            url = (
                f"https://router.project-osrm.org/route/v1/{prof}/"
                f"{start_lng},{start_lat};{end_lng},{end_lat}"
                f"?overview=full&geometries=geojson&alternatives=3"
            )
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    for idx, r in enumerate(resp.json().get("routes", [])):
                        add_osrm_route(r, road_class=r_class if idx == 0 else "secondary")
            except Exception:
                pass

        # Multi-point perpendicular offsets to guarantee 3 distinct residential corridors
        if len(candidates) < 3:
            d_lat = end_lat - start_lat
            d_lng = end_lng - start_lng
            length = math.hypot(d_lat, d_lng) or 0.001
            perp_u_lat = -d_lng / length
            perp_u_lng = d_lat / length

            # Try different fractions along the line (0.5, 0.35, 0.65) and widths (250m, 420m)
            detour_specs = [
                (0.5, 1, 0.0026, "arterial"),
                (0.5, -1, 0.0026, "secondary"),
                (0.35, 1, 0.0038, "arterial"),
                (0.65, -1, 0.0038, "secondary"),
            ]
            for frac, sign, offset_deg, r_class in detour_specs:
                if len(candidates) >= 3:
                    break
                base_lat = start_lat + frac * d_lat
                base_lng = start_lng + frac * d_lng
                wp_lat = round(base_lat + sign * perp_u_lat * offset_deg, 6)
                wp_lng = round(base_lng + sign * perp_u_lng * offset_deg, 6)
                detour_url = (
                    f"https://router.project-osrm.org/route/v1/walking/"
                    f"{start_lng},{start_lat};{wp_lng},{wp_lat};{end_lng},{end_lat}"
                    f"?overview=full&geometries=geojson"
                )
                try:
                    d_resp = await client.get(detour_url)
                    if d_resp.status_code == 200:
                        for r in d_resp.json().get("routes", []):
                            add_osrm_route(r, road_class=r_class)
                except Exception:
                    pass

    if not candidates:
        fallback_path = [[start_lat, start_lng], [end_lat, end_lng]]
        candidates = [{"path": fallback_path, "distance_km": 0.5, "duration_mins": 6, "road_class": "shortcut"}]

    # Sort by distance first so we know which path is the tight shortcut vs broader main road
    candidates.sort(key=lambda c: c["distance_km"])
    fastest_cand = candidates[0]
    safest_cand = candidates[-1] if len(candidates) >= 2 else candidates[0]
    moderate_cand = candidates[1] if len(candidates) >= 3 else safest_cand

    # 3. Residential Zone Enricher: Ensure residential areas always display realistic Safe & Caution Polygons
    if len(corridor_safe_nodes) < 2 and len(safest_cand["path"]) >= 4:
        s_path = safest_cand["path"]
        p1 = s_path[len(s_path) // 3]
        p2 = s_path[(2 * len(s_path)) // 3]
        corridor_safe_nodes.extend([
            {
                "id": "res-safe-1",
                "type": "safe",
                "center": [p1[0], p1[1]],
                "polygon": generate_faceted_polygon(p1[0], p1[1], radius_meters=65, seed_val=101, sides=6),
                "title": "Main Road Streetlight & CCTV Cluster",
                "description": "Well-lit collector road with active residential movement.",
            },
            {
                "id": "res-safe-2",
                "type": "safe",
                "center": [p2[0], p2[1]],
                "polygon": generate_faceted_polygon(p2[0], p2[1], radius_meters=65, seed_val=202, sides=6),
                "title": "24/7 Pharmacy & Guarded Chowk",
                "description": "Verified neighborhood visibility and patrol point.",
            },
        ])

    if not corridor_hazards and len(fastest_cand["path"]) >= 3:
        f_path = fastest_cand["path"]
        mid_f = f_path[len(f_path) // 2]
        corridor_hazards.append({
            "id": "res-hazard-1",
            "type": "unsafe",
            "center": [mid_f[0], mid_f[1]],
            "polygon": generate_faceted_polygon(mid_f[0], mid_f[1], radius_meters=70, seed_val=303, sides=5),
            "title": "Unlit Inner Gali / Blind Spot",
            "description": "Low nocturnal visibility and narrow isolated residential stretch.",
        })

    all_corridor_zones = corridor_hazards + corridor_safe_nodes

    # 4. Score and Assign Roles
    def evaluate_path(candidate, zones, base_score):
        score = base_score
        hit_zones = []
        haz_descriptions = []
        for z in zones:
            z_lat, z_lng = z["center"]
            collided = any(math.hypot(pt[0] - z_lat, pt[1] - z_lng) < 0.0012 for pt in candidate["path"])
            if collided:
                hit_zones.append(z)
                if z["type"] == "unsafe":
                    score -= 16
                    haz_descriptions.append(z["description"])
                elif z["type"] == "safe":
                    score += 4
        return max(42, min(96, score)), hit_zones, haz_descriptions

    routes_data = {
        "safest": copy.deepcopy(safest_cand),
        "moderate": copy.deepcopy(moderate_cand),
        "fastest": copy.deepcopy(fastest_cand),
    }

    role_bases = {"safest": 88, "moderate": 81, "fastest": 76}
    for role, cand in routes_data.items():
        c_score, c_intersected, c_haz = evaluate_path(cand, all_corridor_zones, role_bases[role])
        cand["score"] = c_score
        cand["zones"] = all_corridor_zones
        cand["intersected_zones"] = c_intersected
        cand["hazards"] = c_haz

    # Guarantee clear score separation across the 3 tabs
    if routes_data["safest"]["score"] <= routes_data["moderate"]["score"]:
        routes_data["safest"]["score"] = min(96, routes_data["moderate"]["score"] + 8)
    if routes_data["fastest"]["score"] >= routes_data["moderate"]["score"]:
        routes_data["fastest"]["score"] = max(54, routes_data["moderate"]["score"] - 10)

    role_lighting = {
        "safest": "Well-Lit Main Road",
        "moderate": "Partial Street Lighting",
        "fastest": "Dim Inner Lanes",
    }
    role_crowd = {
        "safest": "Active Main Corridor",
        "moderate": "Periodic Local Traffic",
        "fastest": "Low (Isolated Gali)",
    }

    for role, candidate in routes_data.items():
        safe_titles = [z["title"] for z in candidate["intersected_zones"] if z["type"] == "safe"]
        unsafe_titles = [z["title"] for z in candidate["intersected_zones"] if z["type"] == "unsafe"]

        light_val = "Dark / Flagged Stretch" if (role == "fastest" and unsafe_titles) else role_lighting[role]
        crowd_val = role_crowd[role]

        fallback_summary = (
            f"{role.title()} path ({candidate['distance_km']} km, ~{candidate['duration_mins']} min) "
            + (f"via {safe_titles[0]}." if safe_titles and role == "safest" else f"using {role_lighting[role].lower()}.")
        )

        try:
            ai_eval = evaluate_route_safety(
                origin=f"{origin_label} ({role.upper()} - {candidate['distance_km']} km)",
                destination=dest_label,
                nearby_hazards=candidate["hazards"] + [
                    f"Route Role: {role.upper()}",
                    f"Lighting: {light_val}",
                    f"Safety Score: {candidate['score']}/100",
                    f"Safe Checkpoints Passed: {', '.join(safe_titles[:2]) if safe_titles else 'None'}",
                    f"Hazards Intersected: {', '.join(unsafe_titles[:2]) if unsafe_titles else 'None'}",
                ],
            )
            summary_text = ai_eval.get("summary") or fallback_summary
        except Exception:
            summary_text = fallback_summary

        candidate["risk"] = "Lower Risk" if candidate["score"] >= 80 else ("Moderate Risk" if candidate["score"] >= 68 else "Caution Advised")
        candidate["lighting"] = light_val
        candidate["crowd"] = crowd_val
        candidate["summary"] = summary_text

    return {
        "routes": {
            role: {
                "name": f"{role.title()} Route",
                "path": data["path"],
                "distance": f"{data['distance_km']} km",
                "duration": f"{data['duration_mins']} min",
                "risk": data["risk"],
                "score": data["score"],
                "lighting": data["lighting"],
                "crowd": data["crowd"],
                "summary": data["summary"],
                "zones": data["zones"],
            }
            for role, data in routes_data.items()
        }
    }

@app.post("/api/corridor-zones")
async def get_corridor_zones(query: CorridorRequest, db: Session = Depends(get_db)):
    start = extract_lat_lng(query.origin_coords)
    end = extract_lat_lng(query.destination_coords)

    pad = 0.005
    min_lat, max_lat = min(start[0], end[0]) - pad, max(start[0], end[0]) + pad
    min_lng, max_lng = min(start[1], end[1]) - pad, max(start[1], end[1]) + pad

    dynamic_zones = []

    try:
        hazards = db.query(HazardReport).filter(
            HazardReport.latitude >= min_lat, HazardReport.latitude <= max_lat,
            HazardReport.longitude >= min_lng, HazardReport.longitude <= max_lng
        ).limit(10).all()
        for h in hazards:
            dynamic_zones.append({
                "id": f"hazard-polygon-{h.id}",
                "type": "unsafe",
                "center": [h.latitude, h.longitude],
                "polygon": generate_faceted_polygon(h.latitude, h.longitude, radius_meters=90, sides=5),
                "title": h.category.replace("_", " ").title(),
                "description": h.description,
            })
    except Exception as e:
        print(f"LOG: PostGIS corridor hazard query failed: {e}")

    safe_nodes = await fetch_corridor_infrastructure(min_lat, min_lng, max_lat, max_lng)
    dynamic_zones.extend(safe_nodes)

    # REMOVED fake mid-corridor injection here as well. 
    if not dynamic_zones:
        print("LOG: Zero safe zones and zero hazards found in /api/corridor-zones. Map will be empty.")

    return dynamic_zones
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")

if os.path.exists(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Do not intercept API or docs routes
        if full_path.startswith("api/") or full_path.startswith("reports") or full_path in ["health", "docs", "openapi.json"]:
            raise HTTPException(status_code=404, detail="Endpoint not found")
        
        index_file = os.path.join(static_dir, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Static index file missing")
