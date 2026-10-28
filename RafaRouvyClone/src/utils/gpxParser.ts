import { GpxPoint, RouteData } from '../types/cycling';

/**
 * Calculates Haversine distance in kilometers between two GPS coordinates
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371.0; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180.0;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

/**
 * Parses GPX XML text into structured RouteData with smoothed elevations and instant slopes
 */
export function parseGpxXml(xmlText: string, routeName = 'Ruta Personalizada'): RouteData {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

  // Check parsing errors
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('El archivo no es un GPX XML válido: ' + parseError.textContent?.slice(0, 100));
  }

  // Extract track name if present
  const nameEl = xmlDoc.querySelector('trk > name') || xmlDoc.querySelector('metadata > name');
  const actualName = nameEl?.textContent?.trim() || routeName;

  // Extract all <trkpt> points (or <rtept> fallback)
  let ptNodes = Array.from(xmlDoc.querySelectorAll('trkpt'));
  if (ptNodes.length === 0) {
    ptNodes = Array.from(xmlDoc.querySelectorAll('rtept'));
  }

  if (ptNodes.length === 0) {
    throw new Error('El archivo GPX no contiene puntos de track (<trkpt> o <rtept>).');
  }

  const rawPts: { lat: number; lon: number; elevation: number; time?: string }[] = [];

  for (const node of ptNodes) {
    const lat = parseFloat(node.getAttribute('lat') || '0');
    const lon = parseFloat(node.getAttribute('lon') || '0');
    const eleNode = node.querySelector('ele');
    const elevation = eleNode ? parseFloat(eleNode.textContent || '0') : 0;
    const timeNode = node.querySelector('time');
    const time = timeNode?.textContent || undefined;

    if (!isNaN(lat) && !isNaN(lon)) {
      rawPts.push({ lat, lon, elevation: isNaN(elevation) ? 0 : elevation, time });
    }
  }

  if (rawPts.length === 0) {
    throw new Error('No se encontraron coordenadas válidas en el track GPX.');
  }

  // 1. Calculate cumulative distance for each raw point
  const cumDists: number[] = new Array(rawPts.length).fill(0);
  let cumDist = 0.0;
  for (let i = 1; i < rawPts.length; i++) {
    const d = haversineKm(
      rawPts[i - 1].lat,
      rawPts[i - 1].lon,
      rawPts[i].lat,
      rawPts[i].lon
    );
    cumDist += d;
    cumDists[i] = cumDist;
  }

  // 2. First Pass: Elevation Moving Average Smoothing (filtros de altitud)
  // Window of ~15-25 meters in each direction (removes micro-step GPS altimeter noise)
  const smoothedElevations: number[] = new Array(rawPts.length);
  for (let i = 0; i < rawPts.length; i++) {
    const curDist = cumDists[i];
    let sumEle = 0.0;
    let sumWeights = 0.0;

    // Search window backwards and forwards
    let j = i;
    while (j >= 0 && (curDist - cumDists[j]) <= 0.025) { // 25m lookback
      const distDiff = Math.abs(curDist - cumDists[j]);
      const weight = Math.max(0.1, 1.0 - (distDiff / 0.030));
      sumEle += rawPts[j].elevation * weight;
      sumWeights += weight;
      j--;
    }

    j = i + 1;
    while (j < rawPts.length && (cumDists[j] - curDist) <= 0.025) { // 25m lookahead
      const distDiff = Math.abs(cumDists[j] - curDist);
      const weight = Math.max(0.1, 1.0 - (distDiff / 0.030));
      sumEle += rawPts[j].elevation * weight;
      sumWeights += weight;
      j++;
    }

    smoothedElevations[i] = sumWeights > 0 ? (sumEle / sumWeights) : rawPts[i].elevation;
  }

  // 3. Second Pass: Distance-Windowed Slope Calculation (Ventana fija de 30-50m)
  // Avoids division by tiny GPS coordinate deltas (< 5m) that create bogus spikes
  const rawSlopes: number[] = new Array(rawPts.length).fill(0);
  for (let i = 0; i < rawPts.length; i++) {
    const curDist = cumDists[i];
    
    // Find point backwards at least 15m away (or start of track)
    let idxBack = i;
    while (idxBack > 0 && (curDist - cumDists[idxBack]) < 0.015) {
      idxBack--;
    }

    // Find point forwards at least 15m away (or end of track)
    let idxFwd = i;
    while (idxFwd < rawPts.length - 1 && (cumDists[idxFwd] - curDist) < 0.015) {
      idxFwd++;
    }

    const distSpanKm = cumDists[idxFwd] - cumDists[idxBack];
    if (distSpanKm >= 0.010) { // at least 10 meters span
      const eleDiffM = smoothedElevations[idxFwd] - smoothedElevations[idxBack];
      const slope = (eleDiffM / (distSpanKm * 1000.0)) * 100.0;
      // Clamp to realistic cycling grades (-20% to +22%)
      rawSlopes[i] = Math.max(-20.0, Math.min(22.0, slope));
    } else {
      rawSlopes[i] = i > 0 ? rawSlopes[i - 1] : 0.0;
    }
  }

  // 4. Third Pass: Moving Average Filter on Slopes (Elimina tirones bruscos en las piernas)
  // 5-point moving average to smooth gradient transitions
  const finalSlopes: number[] = new Array(rawPts.length);
  for (let i = 0; i < rawPts.length; i++) {
    let sum = 0.0;
    let count = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(rawPts.length - 1, i + 2); k++) {
      sum += rawSlopes[k];
      count++;
    }
    finalSlopes[i] = count > 0 ? sum / count : rawSlopes[i];
  }

  // 5. Build final points and compute realistic total ascent
  const points: GpxPoint[] = [];
  let totalAscent = 0.0;
  let maxSlope = 0.0;

  for (let i = 0; i < rawPts.length; i++) {
    if (i > 0) {
      const dEle = smoothedElevations[i] - smoothedElevations[i - 1];
      if (dEle > 0) {
        totalAscent += dEle;
      }
    }

    const slope = finalSlopes[i];
    if (slope > maxSlope) {
      maxSlope = slope;
    }

    points.push({
      distanceKm: Math.round(cumDists[i] * 10000) / 10000,
      elevationM: Math.round(smoothedElevations[i] * 10) / 10,
      slopePct: Math.round(slope * 10) / 10,
      lat: rawPts[i].lat,
      lon: rawPts[i].lon,
      time: rawPts[i].time,
    });
  }

  const totalDistanceKm = points[points.length - 1]?.distanceKm || 0;

  return {
    id: `route-${Date.now()}`,
    name: actualName,
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    totalElevationGainM: Math.round(totalAscent),
    maxSlopePct: Math.round(maxSlope * 10) / 10,
    points,
  };
}

/**
 * Fast binary search interpolation to find elevation, slope, and position at a given distance
 */
export function interpolateRoutePoint(points: GpxPoint[], distanceKm: number): {
  elevationM: number;
  slopePct: number;
  lat: number;
  lon: number;
  progressPct: number;
  remainingKm: number;
} {
  if (!points || points.length === 0) {
    return { elevationM: 0, slopePct: 0, lat: 0, lon: 0, progressPct: 0, remainingKm: 0 };
  }

  const totalDist = points[points.length - 1].distanceKm;
  const clampedDist = Math.max(0, Math.min(totalDist, distanceKm));
  const progressPct = totalDist > 0 ? (clampedDist / totalDist) * 100 : 0;
  const remainingKm = Math.max(0, totalDist - clampedDist);

  let low = 0;
  let high = points.length - 1;
  let idx = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].distanceKm <= clampedDist) {
      idx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const p1 = points[idx];
  const p2 = points[Math.min(idx + 1, points.length - 1)];

  if (p2.distanceKm > p1.distanceKm) {
    const t = (clampedDist - p1.distanceKm) / (p2.distanceKm - p1.distanceKm);
    const ele = p1.elevationM + t * (p2.elevationM - p1.elevationM);
    const slope = p1.slopePct + t * (p2.slopePct - p1.slopePct);
    const lat = p1.lat + t * (p2.lat - p1.lat);
    const lon = p1.lon + t * (p2.lon - p1.lon);
    return {
      elevationM: Math.round(ele * 10) / 10,
      slopePct: Math.round(slope * 10) / 10,
      lat,
      lon,
      progressPct: Math.round(progressPct * 10) / 10,
      remainingKm: Math.round(remainingKm * 100) / 100,
    };
  }

  return {
    elevationM: p1.elevationM,
    slopePct: p1.slopePct,
    lat: p1.lat,
    lon: p1.lon,
    progressPct: Math.round(progressPct * 10) / 10,
    remainingKm: Math.round(remainingKm * 100) / 100,
  };
}
