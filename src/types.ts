export interface Env {
  DB: D1Database;
  PUBLIC_BASE_URL?: string;
  UPSTREAM_USER_AGENT?: string;
}

export interface CityListItem {
  id: string;
  title: string;
  url: string;
  publishedAt?: string;
  image?: string;
  section: string;
}

export interface CityAttachment {
  name: string;
  url: string;
  type: string;
}

export interface CityArticle extends CityListItem {
  body: string;
  attachments: CityAttachment[];
  source: string;
}

export interface CityDocument {
  id: string;
  title: string;
  date?: string;
  executor?: string;
  downloadUrl?: string;
  additions: string[];
  type: string;
}

export interface CityListResult {
  section: string;
  page: number;
  totalPages?: number;
  items: CityListItem[];
  source: string;
}

export interface CityEvent {
  id: string;
  title: string;
  description?: string;
  start?: string;
  end?: string;
  venue?: string;
  address?: string;
  lat?: number;
  lon?: number;
  url: string;
  source: string;
  category: string;
  price?: string;
  status?: string;
  distanceKm?: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  label: string;
  source: string;
}

export interface RouteStep {
  instruction: string;
  road?: string;
  distanceM: number;
  durationS: number;
}

export interface RouteResult {
  mode: "driving" | "walking";
  from: GeoPoint;
  to: GeoPoint;
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
  source: string;
  disclaimer?: string;
}

export interface AddressPoint {
  id: number;
  street: string;
  house: string;
  settlement?: string;
  lat: number;
  lon: number;
  searchText: string;
}

export interface Place {
  id: number;
  category: string;
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  phone?: string;
  website?: string;
  source: string;
  distanceKm?: number;
}

export interface TransitRoute {
  routeNumber: string;
  routeName: string;
  routeType: string;
  description?: string;
  workHours?: string;
  interval?: string;
  length?: string;
  stops: string[];
}

export interface DatasetInfo {
  id: string;
  title: string;
  source: string;
  page?: string;
  modified?: string;
  resourceCount?: number;
  notes?: string;
}
