import { asNumber } from "../utils.js";

export async function getCoordinatesFromZip(zip) {
  const response = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!response.ok) {
    throw new Error("Unable to find that ZIP code.");
  }

  const data = await response.json();
  const place = data.places?.[0];
  if (!place) {
    throw new Error("ZIP lookup returned no location.");
  }

  const lat = asNumber(place.latitude);
  const lon = asNumber(place.longitude);
  if (lat === null || lon === null) {
    throw new Error("ZIP lookup did not return valid coordinates.");
  }

  return {
    lat,
    lon,
    city: place["place name"],
    state: place["state abbreviation"],
  };
}
