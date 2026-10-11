import type { PlantLocation } from "@yacco/shared";

interface CoordinateStop {
  id: string;
  latitude: string | null;
  longitude: string | null;
}

interface LocatedStop extends CoordinateStop {
  latitude: string;
  longitude: string;
}

export interface GoogleMapsRouteLeg {
  stopIds: string[];
  url: string;
}

const EARTH_RADIUS_KILOMETERS = 6_371;
// Maps URLs accept nine waypoints on most platforms but only three in mobile
// browsers. Three keeps the same links valid on the driver's phone.
const MAXIMUM_WAYPOINTS = 3;
const MAXIMUM_NEW_STOPS_PER_LEG = MAXIMUM_WAYPOINTS + 1;

function isLocated(stop: CoordinateStop): stop is LocatedStop {
  return stop.latitude !== null && stop.longitude !== null;
}

function toRadians(value: string): number {
  return (Number(value) * Math.PI) / 180;
}

function distanceKilometers(from: PlantLocation, to: LocatedStop): number {
  const fromLatitude = toRadians(from.latitude!);
  const toLatitude = toRadians(to.latitude);
  const latitudeDifference = toLatitude - fromLatitude;
  const longitudeDifference = toRadians(to.longitude) - toRadians(from.longitude!);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDifference / 2) ** 2;
  return EARTH_RADIUS_KILOMETERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function proposeNearbyStopIds(
  plantLocation: PlantLocation,
  stops: CoordinateStop[],
): string[] {
  const remaining = stops.filter(isLocated);
  const ordered: LocatedStop[] = [];
  let current: PlantLocation = plantLocation;

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = distanceKilometers(current, remaining[0]!);
    for (let index = 1; index < remaining.length; index += 1) {
      const distance = distanceKilometers(current, remaining[index]!);
      // Strictly closer only: equal distances preserve the current order.
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    const [nearest] = remaining.splice(nearestIndex, 1);
    ordered.push(nearest!);
    current = nearest!;
  }

  return [
    ...ordered.map((stop) => stop.id),
    ...stops.filter((stop) => !isLocated(stop)).map((stop) => stop.id),
  ];
}

function coordinate(location: PlantLocation): string {
  return `${location.latitude!},${location.longitude!}`;
}

function googleMapsUrl(origin: PlantLocation, stops: LocatedStop[]): string {
  const destination = stops.at(-1)!;
  const parameters = new URLSearchParams({
    api: "1",
    origin: coordinate(origin),
    destination: coordinate(destination),
    travelmode: "driving",
  });
  const waypoints = stops.slice(0, -1);
  if (waypoints.length > 0) {
    parameters.set("waypoints", waypoints.map(coordinate).join("|"));
  }
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}

export function buildGoogleMapsRouteLegs(
  plantLocation: PlantLocation,
  stops: CoordinateStop[],
): GoogleMapsRouteLeg[] {
  const locatedStops = stops.filter(isLocated);
  const legs: GoogleMapsRouteLeg[] = [];
  let origin = plantLocation;

  for (let index = 0; index < locatedStops.length; index += MAXIMUM_NEW_STOPS_PER_LEG) {
    const legStops = locatedStops.slice(index, index + MAXIMUM_NEW_STOPS_PER_LEG);
    legs.push({
      stopIds: legStops.map((stop) => stop.id),
      url: googleMapsUrl(origin, legStops),
    });
    origin = legStops.at(-1)!;
  }

  return legs;
}
