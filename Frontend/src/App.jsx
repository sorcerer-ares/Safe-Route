import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Circle, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Shield,
  AlertTriangle,
  PhoneCall,
  ArrowLeft,
  CornerUpRight,
  X,
  User,
  Home,
  Map as MapIcon,
  Bell,
  MoreHorizontal,
  Crosshair,
  Layers,
  CheckCircle2,
  Lightbulb,
  Radio,
  Info
} from 'lucide-react';

// Custom Map Helper to smoothly fly to new coordinates
// Custom Map Helper: fixes grey tiles on mount & smoothly frames active routes
function MapController({ center, availableRoutes, navState }) {
  const map = useMap();

  // Fix grey tiles on mount and view transitions only
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);
    return () => clearTimeout(timer);
  }, [map, navState]);

  // Fly to user center when in explore mode
  useEffect(() => {
    if (navState === 'explore' && center) {
      map.invalidateSize();
      map.flyTo(center, 15, { animate: true, duration: 1.0 });
    }
  }, [center, navState, map]);

  // Frame the routes ONCE when a new search completes (not on every tab click!)
  useEffect(() => {
    if (availableRoutes && availableRoutes.safest?.path?.length > 1) {
      map.invalidateSize();
      const allPoints = [
        ...(availableRoutes.safest?.path || []),
        ...(availableRoutes.moderate?.path || []),
        ...(availableRoutes.fastest?.path || []),
      ];
      const bounds = L.latLngBounds(allPoints);
      map.flyToBounds(bounds, { padding: [45, 45], maxZoom: 16, duration: 0.8 });
    }
  }, [availableRoutes, map]);

  return null;
}

// Map Click Handler for both Hazard Placement and Destination Tap
function MapClickHandler({ 
  isReportingMode, 
  setIsReportingMode, 
  setHazardLoc, 
  setReportModal,
  isPickingDest,
  setIsPickingDest,
  setDestCoords,
  setDestination
}) {
  useMapEvents({
    click(e) {
      if (isReportingMode) {
        setHazardLoc(e.latlng);
        setReportModal(true);
        setIsReportingMode(false);
      } else if (isPickingDest) {
        setDestCoords([e.latlng.lat, e.latlng.lng]);
        setDestination(`${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
        setIsPickingDest(false);
      }
    },
  });
  return null;
}

// Leaflet marker icon asset fixes
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom HTML Icons for the Polygon Centers
const createZoneIcon = (type) =>
  L.divIcon({
    className: 'custom-zone-icon',
    html: `<div style="
      background: ${type === 'safe' ? '#10b981' : '#ef4444'};
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 10px ${type === 'safe' ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'};
      border: 2px solid #ffffff;
      color: #ffffff;
      font-size: 11px;
      font-weight: 900;
    ">${type === 'safe' ? '✓' : '!'}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
// Pulsing Live GPS Dot for User Location
const userPulseIcon = L.divIcon({
  className: 'user-pulse-icon',
  html: `
    <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 24px; height: 24px; border-radius: 50%; background: rgba(16, 185, 129, 0.4); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: relative; width: 12px; height: 12px; border-radius: 50%; background: #10b981; border: 2.5px solid #ffffff; box-shadow: 0 0 12px #10b981;"></div>
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Sleek Destination Marker
const destPinIcon = L.divIcon({
  className: 'dest-pin-icon',
  html: `
    <div style="position: relative; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background: rgba(244, 63, 94, 0.35); animation: ping 2s infinite;"></div>
      <div style="position: relative; width: 14px; height: 14px; border-radius: 50%; background: #f43f5e; border: 2.5px solid #ffffff; box-shadow: 0 0 14px #f43f5e;"></div>
    </div>
  `,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

export default function App() {
  const [navState, setNavState] = useState('explore'); 

  // Dynamic GPS & Destination states
  const [userCoords, setUserCoords] = useState([28.5635, 77.2450]);
  const [destCoords, setDestCoords] = useState(null);
  const [origin, setOrigin] = useState('(Demo Location)');
  const [destination, setDestination] = useState('Tap on Map or Select');
  const [isPickingDest, setIsPickingDest] = useState(false);

  // Modals & Reporting
  const [reportModal, setReportModal] = useState(false);
  const [hazardText, setHazardText] = useState('');
  const [hazardLoc, setHazardLoc] = useState(null);
  const [isReportingMode, setIsReportingMode] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [reports, setReports] = useState([]);
  const [zones, setZones] = useState([]);
  const [reportError, setReportError] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  
  // Corridors & Routing State
  const [corridorZones, setCorridorZones] = useState([]);
  const [routePath, setRoutePath] = useState([]);
  const [routeStats, setRouteStats] = useState({ distance: '0 km', duration: '0 min' });
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [availableRoutes, setAvailableRoutes] = useState(null);
  const [selectedRouteKey, setSelectedRouteKey] = useState('safest');
  // Gemini / AI Data
  const [aiData, setAiData] = useState({
    safety_score: 91,
    verdict: "Safest Path Verified",
    lighting_rating: "Well lit streets",
    police_presence: "CCTV & Police coverage",
    summary: "Clear arterial sidewalks prioritized"
  });

  const API_URL = window.location.port === '5173' ? 'http://127.0.0.1:8000' : '';

  useEffect(() => {
    // if ('geolocation' in navigator) {
    //   navigator.geolocation.getCurrentPosition(
    //     (pos) => {
    //       const coords = [pos.coords.latitude, pos.coords.longitude];
    //       setUserCoords(coords);
    //       setOrigin('Current GPS Location');
    //     },
    //     (err) => {
    //       console.warn('Geolocation fallback to Delhi:', err.message);
    //     },
    //     { enableHighAccuracy: true, timeout: 10000 }
    //   );
    // } commenting for demo purposes

    fetch(`${API_URL}/api/zones`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setZones)
      .catch((err) => console.error('Failed to load zones:', err));

    fetch(`${API_URL}/reports`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setReports)
      .catch((err) => console.error('Failed to load reports:', err));
  }, []);

  // HACKATHON DEMO MAGIC: Simulate walking along the route when navigation starts
  useEffect(() => {
    let interval;
    if (navState === 'navigating' && routePath.length > 0) {
      let step = 0;
      
      interval = setInterval(() => {
        if (step < routePath.length) {
          // Move the GPS radar dot to the next coordinate on the path
          setUserCoords(routePath[step]);
          step += 1; 
        } else {
          // Arrived at destination
          clearInterval(interval);
          setTimeout(() => {
            alert("You have arrived safely at your destination!");
            setNavState('explore');
            setRoutePath([]);
            setCorridorZones([]);
            setDestCoords(null);
            setDestination('Tap on Map or Select');
            // Reset position back to start for the next demo run
            setUserCoords(routePath[0]); 
          }, 500);
        }
      }, 600); // Moves the dot every 600 milliseconds
    }
    
    return () => clearInterval(interval);
  }, [navState, routePath]);
  
  const selectPresetDestination = (name, coords) => {
    setDestination(name);
    setDestCoords(coords);
    setIsPickingDest(false);
  };

  const handleFindSafeRoute = async () => {
    if (!destCoords) return;
    setIsLoadingRoute(true);
    setAvailableRoutes(null);
    setRoutePath([]);
    setCorridorZones([]);

    const cleanOrigin = Array.isArray(userCoords)
      ? [parseFloat(userCoords[0]), parseFloat(userCoords[1])]
      : [parseFloat(userCoords.lat), parseFloat(userCoords.lng)];

    const cleanDest = Array.isArray(destCoords)
      ? [parseFloat(destCoords[0]), parseFloat(destCoords[1])]
      : [parseFloat(destCoords.lat), parseFloat(destCoords.lng)];

    try {
      // We removed the raw frontend OSRM fetch here

      const backendRes = await fetch(`${API_URL}/api/plan-routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_name: origin || "My Location",
          destination_name: destination || "Selected Point",
          origin_coords: cleanOrigin,
          destination_coords: cleanDest
        })
      });

      if (backendRes.ok) {
        const data = await backendRes.json();
        if (data && data.routes) {
          setAvailableRoutes(data.routes);
          setSelectedRouteKey('safest');
          
          const activeRoute = data.routes['safest'];
          if (activeRoute.path && activeRoute.path.length > 1) {
            setRoutePath(activeRoute.path);
            setRouteStats({ distance: activeRoute.distance, duration: activeRoute.duration });
          }
          if (activeRoute.zones) setCorridorZones(activeRoute.zones);
          
          setAiData({
            safety_score: activeRoute.score,
            lighting_rating: activeRoute.lighting,
            crowd_level: activeRoute.crowd, 
            summary: activeRoute.summary
          });
        }
      }
      setNavState('routes');
    } catch (err) {
      console.error('Route calculation failed:', err);
      setNavState('routes');
    } finally {
      setIsLoadingRoute(false);
    }
  };

  const handleReportSubmit = async () => {
    if (!hazardLoc) return;
    if (hazardText.trim().length < 5) {
      setReportError('Please enter at least 5 characters.');
      return;
    }

    setReportSubmitting(true);
    setReportError('');
    try {
      const res = await fetch(`${API_URL}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'safety_hazard',
          description: hazardText.trim(),
          latitude: parseFloat(hazardLoc.lat),
          longitude: parseFloat(hazardLoc.lng),
        }),
      });

      if (res.ok) {
        const item = await res.json();
        setReports((prev) => [item, ...prev]);
        fetch(`${API_URL}/api/zones`).then((r) => r.ok && r.json()).then(setZones);
        setReportModal(false);
        setHazardText('');
        setHazardLoc(null);
      } else {
        throw new Error("Report creation failed");
      }
    } catch (err) {
      setReportError('Could not submit report.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleSos = () => {
    setSosActive(true);
    setTimeout(() => {
      alert('EMERGENCY ALERT: Real-time telemetry broadcasted.');
      setSosActive(false);
    }, 400);
  };

  return (
    <div className="w-screen h-screen bg-[#07090E] flex items-center justify-center font-sans antialiased select-none">
      <div className="relative w-full max-w-[420px] h-full sm:h-[92vh] bg-[#0c121e] sm:rounded-[40px] overflow-hidden border border-white/10 shadow-2xl flex flex-col">

        {/* 1. TOP STATUS BAR: EXPLORE */}
        {navState === 'explore' && (
          <div className="absolute top-0 inset-x-0 z-[1000] p-4 bg-gradient-to-b from-[#0c121e] via-[#0c121e]/80 to-transparent space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Shield className="w-4 h-4 fill-emerald-400/20" />
                </div>
                <h1 className="text-base font-bold text-white tracking-tight">SafeRoute</h1>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  Live GPS
                </span>
                <div className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-gray-300">
                  <User className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* Quick Pick Presets */}
            <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => selectPresetDestination('Connaught Place', [28.6315, 77.2167])}
                className="px-3 py-1.5 rounded-full bg-[#131b2e] border border-white/10 text-[11px] text-gray-300 hover:border-emerald-500 whitespace-nowrap"
              >
                📍 Connaught Place
              </button>
              <button
                onClick={() => selectPresetDestination('Mandi House', [28.6250, 77.2340])}
                className="px-3 py-1.5 rounded-full bg-[#131b2e] border border-white/10 text-[11px] text-gray-300 hover:border-emerald-500 whitespace-nowrap"
              >
                🚇 Mandi House
              </button>
              <button
                onClick={() => selectPresetDestination('Janpath Market', [28.6250, 77.2185])}
                className="px-3 py-1.5 rounded-full bg-[#131b2e] border border-white/10 text-[11px] text-gray-300 hover:border-emerald-500 whitespace-nowrap"
              >
                🛍️ Janpath
              </button>
            </div>
          </div>
        )}

        {/* 2. TOP HEADER: ROUTES */}
        {navState === 'routes' && (
          <div className="absolute top-0 inset-x-0 z-[1000] p-4 bg-[#0c121e] border-b border-white/10 space-y-3 shadow-xl">
            <div className="flex items-center space-x-3">
              <button onClick={() => {
                    setNavState('explore');
                    setRoutePath([]);        // Clears the green line
                    setCorridorZones([]);    // Clears the red/green polygons
                    setDestCoords(null);     // Clears the destination pin
                    setDestination('Tap on Map or Select');
                    }} 
                    className="p-1 rounded-full text-gray-300 hover:text-white"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
              <h2 className="text-sm font-bold text-white">Safe Route Selected</h2>
            </div>
          </div>
        )}

        {/* 3. TOP BANNER: NAVIGATING */}
        {navState === 'navigating' && (
          <div className="absolute top-4 inset-x-4 z-[1000] bg-[#131b2e]/95 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl flex items-center space-x-3.5">
            <div className="p-2.5 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-400">
              <CornerUpRight className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <p className="text-sm font-bold text-white tracking-wide">Continue Along Route</p>
              <p className="text-xs text-gray-400">{routeStats.distance} • ~{routeStats.duration} remaining</p>
            </div>
          </div>
        )}

        {/* MAP VIEWPORT */}
        <div className="relative flex-1 w-full z-0">
          <MapContainer
            center={userCoords}
            zoom={15}
            zoomControl={false}
            attributionControl={false}
            className="w-full h-full bg-[#07090E]"
          >
            {/* BULLETPROOF DARK MODE: Standard OSM with CSS inversion */}
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              className="dark-tiles"
              maxZoom={19}
            />

            <MapController center={userCoords} availableRoutes={availableRoutes} navState={navState} />

            <MapClickHandler
              isReportingMode={isReportingMode}
              setIsReportingMode={setIsReportingMode}
              setHazardLoc={setHazardLoc}
              setReportModal={setReportModal}
              isPickingDest={isPickingDest}
              setIsPickingDest={setIsPickingDest}
              setDestCoords={setDestCoords}
              setDestination={setDestination}
            />

            {/* GLOBAL POSTGIS ZONES */}
            {zones.map((zone) => (
              <Circle
                key={zone.id}
                center={zone.coords}
                radius={zone.radius}
                pathOptions={{
                  color: zone.type === 'safe' ? '#10b981' : '#ef4444',
                  fillColor: zone.type === 'safe' ? '#10b981' : '#ef4444',
                  fillOpacity: 0.14,
                  weight: 1,
                  dashArray: '2, 4',
                }}
              >
                <Popup>
                  <span className={`text-xs font-bold ${zone.type === 'safe' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {zone.title}
                  </span>
                </Popup>
              </Circle>
            ))}

            {/* DYNAMIC RED & GREEN CORRIDOR ZONES */}
            {corridorZones.map((zone) => (
              <React.Fragment key={zone.id}>
                <Polygon
                  positions={zone.polygon}
                  pathOptions={{
                    color: zone.type === 'safe' ? '#34d399' : '#f87171',
                    fillColor: zone.type === 'safe' ? '#10b981' : '#ef4444',
                    fillOpacity: zone.type === 'safe' ? 0.18 : 0.24,
                    weight: 1.5,
                  }}
                >
                  <Popup>
                    <div className="text-xs space-y-0.5">
                      <p className={`font-bold ${zone.type === 'safe' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {zone.title}
                      </p>
                      <p className="text-gray-300 text-[10px]">{zone.description}</p>
                    </div>
                  </Popup>
                </Polygon>
                <Marker position={zone.center} icon={createZoneIcon(zone.type)}>
                  <Popup>
                    <span className="text-xs font-semibold">{zone.title}</span>
                  </Popup>
                </Marker>
              </React.Fragment>
            ))}

            {/* NEON GLOW ROAD POLYLINE (Outer Halo + Inner Core) */}
            {routePath.length > 0 && (
              <React.Fragment key={selectedRouteKey}>
                {/* Outer Glow Halo */}
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color:
                      selectedRouteKey === 'safest' ? '#10b981' :
                      selectedRouteKey === 'moderate' ? '#3b82f6' :
                      '#f43f5e',
                    weight: 14,
                    opacity: 0.25,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
                {/* Crisp Inner Core */}
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color:
                      selectedRouteKey === 'safest' ? '#34d399' :
                      selectedRouteKey === 'moderate' ? '#60a5fa' :
                      '#fb7185',
                    weight: 5,
                    opacity: 1,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </React.Fragment>
            )}

            {/* LIVE USER GPS RADAR MARKER */}
            <Marker position={userCoords} icon={userPulseIcon}>
              <Popup>
                <span className="text-xs font-bold text-emerald-600">You are here</span>
              </Popup>
            </Marker>

            {/* DESTINATION MARKER */}
            {destCoords && (
              <Marker position={destCoords} icon={destPinIcon}>
                <Popup>
                  <span className="text-xs font-bold text-rose-600">{destination}</span>
                </Popup>
              </Marker>
            )}
          </MapContainer>

          {/* Tap Prompt */}
          {isPickingDest && (
            <div className="absolute top-24 inset-x-6 z-[1000] bg-emerald-600/90 border border-emerald-400 text-white rounded-2xl p-3 text-center text-xs font-semibold shadow-2xl backdrop-blur-md animate-pulse">
              📍 Tap anywhere on the map to set destination
            </div>
          )}

          {/* Center GPS button */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-[1000] flex flex-col space-y-2 pointer-events-auto">
            <button 
              onClick={() => {
                if ('geolocation' in navigator) {
                  navigator.geolocation.getCurrentPosition((pos) => {
                    setUserCoords([pos.coords.latitude, pos.coords.longitude]);
                  });
                }
              }}
              title="Locate Me"
              className="p-2.5 rounded-full bg-[#131b2e]/90 border border-white/10 text-emerald-400 shadow-lg hover:bg-white/10"
            >
              <Crosshair className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* BOTTOM PANELS */}

        {/* STATE 1: EXPLORE PANEL */}
        {navState === 'explore' && (
          <div className="relative z-[1000] p-4 bg-[#0c121e]/95 border-t border-white/10 space-y-3">
            <div className="bg-[#131b2e] border border-white/10 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center space-x-2.5">
                <div className="w-2.5 h-2.5 rounded-full border-2 border-blue-400 bg-transparent"></div>
                <span className="text-xs text-white font-medium">{origin}</span>
              </div>
              <div className="h-[1px] bg-white/10 ml-5"></div>
              <div 
                onClick={() => setIsPickingDest(true)}
                className={`flex items-center justify-between cursor-pointer group p-1 rounded-xl transition ${isPickingDest ? 'bg-emerald-500/20 border border-emerald-500/50' : ''}`}
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
                  <span className="text-xs text-gray-300 group-hover:text-white font-medium">
                    {destination}
                  </span>
                </div>
                <span className="text-[10px] text-emerald-400 font-semibold underline">
                  {isPickingDest ? 'Click Map...' : 'Tap to Pick Pin'}
                </span>
              </div>
            </div>

            <button
              disabled={!destCoords || isLoadingRoute}
              onClick={handleFindSafeRoute}
              className="w-full py-3 rounded-2xl bg-emerald-500 text-gray-950 font-bold text-xs hover:bg-emerald-400 active:scale-98 shadow-lg shadow-emerald-500/20 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-1.5"
            >
              <span>
                {isLoadingRoute ? 'Calculating Road Route...' : destCoords ? 'Find Safe Route' : 'Select Destination on Map First'}
              </span>
            </button>

            {/* Bottom Tab Bar */}
            <div className="flex items-center justify-around pt-2 border-t border-white/5 text-gray-400">
              <div className="flex flex-col items-center space-y-1 text-emerald-400 cursor-pointer">
                <Home className="w-4 h-4" />
                <span className="text-[9px] font-medium">Home</span>
              </div>
              <div 
                onClick={() => setIsReportingMode(!isReportingMode)}
                className={`flex flex-col items-center space-y-1 cursor-pointer transition ${isReportingMode ? 'text-amber-400 animate-pulse' : 'hover:text-white'}`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span className="text-[9px] font-medium">{isReportingMode ? 'Drop Hazard' : 'Report'}</span>
              </div>
              <div onClick={handleSos} className="flex flex-col items-center space-y-1 text-rose-500 cursor-pointer hover:text-rose-400">
                <PhoneCall className="w-4 h-4 animate-pulse" />
                <span className="text-[9px] font-bold">SOS</span>
              </div>
            </div>
          </div>
        )}

        {/* STATE 2: ROUTES SELECTION PANEL */}
        {navState === 'routes' && availableRoutes && (
          <div className="relative z-[1000] p-4 bg-[#0c121e]/98 border-t border-white/10 space-y-3 shrink-0">
            
            {/* Multi-Route Tabs */}
            <div className="flex bg-[#131b2e] p-1 rounded-xl border border-white/5">
              {['fastest', 'safest', 'moderate'].map((key) => {
                const isActive = selectedRouteKey === key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setSelectedRouteKey(key);
                      const route = availableRoutes[key];
                      if (!route) return;
                      setRoutePath(route.path);
                      setRouteStats({ distance: route.distance, duration: route.duration });
                      if (route.zones) setCorridorZones(route.zones);

                      setAiData({
                        safety_score: route.score,
                        lighting_rating: route.lighting,
                        crowd_level: route.crowd,
                        summary: route.summary
                      });
                    }}
                    className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-colors capitalize ${
                      isActive 
                        ? (key === 'safest' ? 'bg-emerald-500 text-gray-950 shadow-md' : key === 'moderate' ? 'bg-blue-500 text-white shadow-md' : 'bg-rose-500 text-white shadow-md') 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>

            {/* Route Card with Locked Height (No Layout Shift) */}
            <div className={`p-3.5 rounded-2xl border transition-colors duration-200 shadow-xl space-y-2.5 ${
              aiData.safety_score >= 80 
                ? 'bg-emerald-500/10 border-emerald-500/50' 
                : aiData.safety_score >= 65 
                  ? 'bg-blue-500/10 border-blue-500/40' 
                  : 'bg-amber-500/10 border-amber-500/50'
            }`}>
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 ${
                    aiData.safety_score >= 80 ? 'bg-emerald-500/20 text-emerald-400' : aiData.safety_score >= 65 ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {aiData.safety_score >= 75 ? <Shield className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-white tracking-wide truncate">
                      {selectedRouteKey === 'safest'
                        ? 'Safest Path (Main Roads)'
                        : selectedRouteKey === 'moderate'
                        ? 'Moderate Path (Balanced)'
                        : 'Fastest Shortcut'}
                    </h3>
                    <p className="text-[11px] text-gray-400 font-medium truncate">{routeStats.distance} • ~{routeStats.duration}</p>
                  </div>
                </div>

                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border whitespace-nowrap shrink-0 ${
                  aiData.safety_score >= 80 
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                    : aiData.safety_score >= 65 
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' 
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                }`}>
                  Safety Score: {aiData.safety_score}/100
                </span>
              </div>

              {/* Single-Line Truncated Assessment Badges */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10 text-xs">
                <div className="flex items-center space-x-2 bg-white/5 p-2 rounded-xl min-w-0">
                  <Lightbulb className={`w-3.5 h-3.5 shrink-0 ${aiData.safety_score < 70 ? 'text-amber-400' : 'text-emerald-400'}`} />
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Lighting</p>
                    <p className="text-white text-[11px] font-bold truncate">{aiData.lighting_rating}</p>
                  </div>
                </div>
            
                <div className="flex items-center space-x-2 bg-white/5 p-2 rounded-xl min-w-0">
                  <Radio className={`w-3.5 h-3.5 shrink-0 ${aiData.safety_score < 70 ? 'text-rose-400' : 'text-emerald-400'}`} />
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Crowd</p>
                    <p className="text-white text-[11px] font-bold truncate">{aiData.crowd_level}</p>
                  </div>
                </div>
              </div>

              {/* Fixed-Height Summary Box */}
              <div className="bg-[#0b101b] border border-white/5 rounded-xl p-2.5 h-[48px] flex items-start space-x-2 overflow-hidden">
                <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-gray-300 leading-snug font-medium line-clamp-2">
                  {aiData.summary}
                </p>
              </div>
            </div>

            <button
              onClick={() => setNavState('navigating')}
              className={`w-full py-3 rounded-2xl font-bold text-xs active:scale-98 shadow-lg transition-colors flex items-center justify-center space-x-1.5 ${
                aiData.safety_score >= 70
                  ? 'bg-emerald-500 text-gray-950 hover:bg-emerald-400 shadow-emerald-500/20'
                  : 'bg-amber-500 text-gray-950 hover:bg-amber-400 shadow-amber-500/20'
              }`}
            >
              <span>Start Navigation</span>
            </button>
          </div>
        )}

        {/* STATE 3: NAVIGATING PANEL */}
        {navState === 'navigating' && (
          <div className="relative z-[1000] p-4 bg-[#0c121e]/98 border-t border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{routeStats.distance} • {routeStats.duration}</h3>
                  <p className="text-[11px] text-emerald-400 font-semibold">Low risk route active</p>
                </div>
              </div>
              <button
                onClick={() => setNavState('routes')}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <button
                onClick={() => setIsReportingMode(!isReportingMode)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-300 hover:bg-white/10 transition flex items-center justify-center space-x-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Report Incident</span>
              </button>

              <button
                onClick={handleSos}
                className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-rose-950/50 hover:bg-rose-500 active:scale-95 transition"
              >
                <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
                <span>Emergency SOS</span>
              </button>
            </div>
          </div>
        )}

        {/* HAZARD MODAL */}
        {reportModal && (
          <div className="absolute inset-0 z-[2000] bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center">
            <div className="w-full bg-[#131b2e] border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" /> Report Hazard At Selected Location
                </h3>
                <button onClick={() => setReportModal(false)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <textarea
                rows={3}
                value={hazardText}
                onChange={(e) => setHazardText(e.target.value)}
                placeholder="e.g. Broken street lights, dark corner..."
                className="w-full bg-[#0b0f19] border border-white/10 rounded-xl p-2.5 text-xs text-white outline-none focus:border-emerald-500 resize-none"
              />
              <div className="flex justify-end space-x-2">
                <button onClick={() => setReportModal(false)} className="px-3 py-1.5 rounded-lg text-[11px] bg-white/5 text-gray-300">
                  Cancel
                </button>
                <button
                  onClick={handleReportSubmit}
                  disabled={reportSubmitting}
                  className="px-3 py-1.5 rounded-lg text-[11px] bg-emerald-600 text-white font-medium hover:bg-emerald-500 disabled:opacity-50"
                >
                  {reportSubmitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
