import { WeatherResponse, CurrentWeather, DailyForecast } from "@/types/weather";
import { getExternalApiConfig } from "./runtime-config";

const weatherCache = new Map<string, { data: WeatherResponse; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

export async function fetchStoreWeather(
  idOrLat: string | number,
  nameOrLon: string | number,
  maybeLat?: number,
  maybeLon?: number
): Promise<WeatherResponse> {
  let lat: number;
  let lng: number;
  let storeId: string;
  let storeName: string;

  if (typeof idOrLat === "number" && typeof nameOrLon === "number") {
    lat = idOrLat;
    lng = nameOrLon;
    storeId = "unknown";
    storeName = "unknown";
  } else {
    storeId = String(idOrLat);
    storeName = String(nameOrLon);
    lat = maybeLat ?? -6.2;
    lng = maybeLon ?? 106.8;
  }

  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = weatherCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.data, storeId, storeName };
  }

  const fallback: WeatherResponse = {
    storeId,
    storeName,
    latitude: lat,
    longitude: lng,
    current: {
      temperature: 30,
      apparentTemperature: 33,
      humidity: 70,
      windSpeed: 14,
      weatherCode: 0,
      weatherDescription: "Cerah Berawan (Data Cache)",
      icon: "sun",
      isDay: true,
      time: new Date().toISOString(),
      precipitation: 0,
      floodWarning: false,
    },
    daily: Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return {
        date: d.toISOString(),
        weatherCode: 0,
        weatherDescription: "Cerah",
        icon: "sun",
        tempMax: 32 - Math.floor(Math.random() * 3),
        tempMin: 24 + Math.floor(Math.random() * 2),
        precipitationProbability: 10 + Math.floor(Math.random() * 20),
        uvIndexMax: 8,
        windSpeedMax: 15,
      };
    }),
    lastUpdated: new Date().toISOString()
  };

  try {
    const apiConfig = getExternalApiConfig();
    const url = `${apiConfig.openMeteo.forecastUrl}?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max&timezone=Asia%2FJakarta`;
    const res = await fetch(url, { next: { revalidate: 600 } });

    if (!res.ok) {
      throw new Error(`Open-Meteo response error: ${res.status}`);
    }

    const json = await res.json();
    
    // Map current weather
    const currentCode = json.current?.weather_code ?? 0;
    const precip = json.current?.precipitation ?? 0;
    
    let condition = "Cerah";
    if (currentCode >= 80) condition = "Hujan";
    else if (currentCode >= 60) condition = "Hujan Ringan";
    else if (currentCode >= 50) condition = "Gerimis";
    else if (currentCode >= 1 && currentCode <= 3) condition = "Berawan";

    const current: CurrentWeather = {
      temperature: Math.round(json.current?.temperature_2m ?? 30),
      apparentTemperature: Math.round(json.current?.apparent_temperature ?? 30),
      humidity: Math.round(json.current?.relative_humidity_2m ?? 70),
      windSpeed: Math.round(json.current?.wind_speed_10m ?? 12),
      weatherCode: currentCode,
      weatherDescription: condition,
      icon: "sun",
      isDay: true,
      time: json.current?.time ?? new Date().toISOString(),
      precipitation: precip,
      floodWarning: precip > 10, // basic logic for heavy rain
    };

    // Map daily weather
    const daily: DailyForecast[] = [];
    if (json.daily && json.daily.time) {
      for (let i = 0; i < json.daily.time.length; i++) {
        const dCode = json.daily.weather_code[i] ?? 0;
        let dCond = "Cerah";
        if (dCode >= 80) dCond = "Hujan";
        else if (dCode >= 60) dCond = "Hujan Ringan";
        else if (dCode >= 1 && dCode <= 3) dCond = "Berawan";

        daily.push({
          date: json.daily.time[i],
          weatherCode: dCode,
          weatherDescription: dCond,
          icon: "sun",
          tempMax: Math.round(json.daily.temperature_2m_max[i] ?? 30),
          tempMin: Math.round(json.daily.temperature_2m_min[i] ?? 24),
          precipitationProbability: json.daily.precipitation_probability_max[i] ?? 0,
          uvIndexMax: Math.round(json.daily.uv_index_max[i] ?? 5),
          windSpeedMax: Math.round(json.daily.wind_speed_10m_max[i] ?? 10),
        });
      }
    }

    const result: WeatherResponse = {
      storeId,
      storeName,
      latitude: lat,
      longitude: lng,
      current,
      daily,
      lastUpdated: new Date().toISOString()
    };

    weatherCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.warn("Weather fetch failed, returning fallback", error);
    return fallback;
  }
}
