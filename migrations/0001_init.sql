CREATE TABLE IF NOT EXISTS announcement (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  summary TEXT,
  source TEXT NOT NULL,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataset (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  page TEXT,
  modified TEXT,
  resource_count INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS resource (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  name TEXT,
  format TEXT,
  url TEXT,
  bytes INTEGER,
  status TEXT,
  file TEXT
);

CREATE INDEX IF NOT EXISTS idx_resource_dataset ON resource(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_source ON dataset(source);

CREATE TABLE IF NOT EXISTS address_point (
  id INTEGER PRIMARY KEY,
  street TEXT NOT NULL,
  house TEXT NOT NULL,
  settlement TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  search_text TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_address_search ON address_point(search_text);
CREATE INDEX IF NOT EXISTS idx_address_street ON address_point(street, house);

CREATE TABLE IF NOT EXISTS place (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lon REAL,
  phone TEXT,
  website TEXT,
  search_text TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_place_search ON place(search_text);
CREATE INDEX IF NOT EXISTS idx_place_category ON place(category);
CREATE INDEX IF NOT EXISTS idx_place_geo ON place(lat, lon);

CREATE TABLE IF NOT EXISTS transit_route (
  route_number TEXT PRIMARY KEY,
  route_name TEXT NOT NULL,
  route_type TEXT,
  description TEXT,
  work_hours TEXT,
  interval TEXT,
  length TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS transit_stop (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_number TEXT NOT NULL,
  stop_name TEXT NOT NULL,
  search_text TEXT NOT NULL,
  street TEXT,
  sequence INTEGER,
  lat REAL,
  lon REAL,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_transit_stop_search ON transit_stop(search_text);
CREATE INDEX IF NOT EXISTS idx_transit_stop_route ON transit_stop(route_number);

CREATE TABLE IF NOT EXISTS fact_building_lease (
  lease_id INTEGER PRIMARY KEY,
  contract_number TEXT,
  tenant TEXT,
  tenant_display TEXT,
  tenant_edrpou TEXT,
  legal_form TEXT,
  legal_form_en TEXT,
  address TEXT,
  street TEXT,
  house TEXT,
  intended_use TEXT,
  area_m2 REAL,
  monthly_rent REAL,
  annualized_rent REAL,
  paid REAL,
  debt REAL,
  penalty_accrual REAL,
  penalty_paid REAL,
  rent_per_m2 REAL,
  start_date TEXT,
  end_date TEXT,
  book_value REAL,
  net_book_value REAL,
  settlement TEXT,
  is_individual INTEGER,
  status TEXT,
  expiring_12m INTEGER,
  zero_rent INTEGER,
  lat REAL,
  lon REAL,
  match_score REAL,
  snapshot_date TEXT,
  source_file TEXT,
  quality_flags TEXT,
  search_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_lease_debt ON fact_building_lease(debt);
CREATE INDEX IF NOT EXISTS idx_lease_street ON fact_building_lease(street);
CREATE INDEX IF NOT EXISTS idx_lease_end ON fact_building_lease(end_date);

CREATE TABLE IF NOT EXISTS fact_land_lease (
  parcel_id INTEGER PRIMARY KEY,
  contract_key TEXT,
  contract_number TEXT,
  contract_date TEXT,
  tenant TEXT,
  tenant_edrpou TEXT,
  tenant_type TEXT,
  address TEXT,
  cadastral TEXT,
  area_ha REAL,
  area_m2 REAL,
  annual_rent REAL,
  normative_value REAL,
  rent_pct REAL,
  start_date TEXT,
  end_date TEXT,
  lease_type TEXT,
  lease_status TEXT,
  has_geom INTEGER,
  snapshot_date TEXT,
  source_file TEXT,
  quality_flags TEXT,
  search_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_land_tenant ON fact_land_lease(tenant);
CREATE INDEX IF NOT EXISTS idx_land_end ON fact_land_lease(end_date);

CREATE TABLE IF NOT EXISTS fact_building (
  building_id TEXT PRIMARY KEY,
  address TEXT,
  lot_num TEXT,
  floors INTEGER,
  apartments INTEGER,
  rooms INTEGER,
  entrances INTEGER,
  elevators INTEGER,
  year_built INTEGER,
  area_total REAL,
  area_apartments REAL,
  area_roof REAL,
  area_loft REAL,
  area_basement REAL,
  area_stairs REAL,
  type_foundation TEXT,
  type_wall TEXT,
  type_roof TEXT,
  type_chimney TEXT,
  year_repair INTEGER,
  type_repair TEXT,
  price_lighting REAL,
  price_water REAL,
  price_elevator REAL,
  territory TEXT,
  debt_1 REAL,
  debt_2 REAL,
  debt_total REAL,
  manager TEXT,
  manager_edrpou TEXT,
  manager_address TEXT,
  decision TEXT,
  has_geom INTEGER,
  source_file TEXT,
  quality_flags TEXT,
  search_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_building_manager ON fact_building(manager);

CREATE TABLE IF NOT EXISTS fact_housing_account (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  street_name TEXT,
  house_number TEXT,
  house_code TEXT,
  manager TEXT,
  manager_edrpou TEXT,
  month INTEGER,
  year INTEGER,
  invoice REAL,
  liability REAL,
  snapshot_date TEXT,
  source_file TEXT,
  quality_flags TEXT,
  search_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_housing_key ON fact_housing_account(street_name, house_number);

CREATE TABLE IF NOT EXISTS fact_tariff (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tariff_id INTEGER,
  snapshot_date TEXT,
  type TEXT,
  consumers_type TEXT,
  amount REAL,
  unit TEXT,
  status TEXT,
  provider TEXT,
  provider_id TEXT,
  valid_from TEXT,
  valid_through TEXT,
  legal_act_type TEXT,
  legal_act_title TEXT,
  legal_act_issued TEXT,
  legal_act_num TEXT,
  legal_act_url TEXT,
  source_file TEXT,
  quality_flags TEXT,
  search_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_tariff_provider ON fact_tariff(provider);
CREATE INDEX IF NOT EXISTS idx_tariff_type ON fact_tariff(type);

CREATE TABLE IF NOT EXISTS fact_road_project (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT,
  snapshot_date TEXT,
  owner TEXT,
  owner_id TEXT,
  area TEXT,
  project_type TEXT,
  description TEXT,
  address TEXT,
  work_period TEXT,
  cost_total REAL,
  negotiated_price REAL,
  cost_spent REAL,
  city_budget REAL,
  state_budget REAL,
  funded REAL,
  budget_program TEXT,
  tender_id TEXT,
  contractor TEXT,
  contractor_id TEXT,
  status TEXT,
  source_file TEXT,
  quality_flags TEXT,
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS fact_construction_project (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT,
  snapshot_date TEXT,
  owner TEXT,
  owner_id TEXT,
  area TEXT,
  project_type TEXT,
  description TEXT,
  address TEXT,
  work_period TEXT,
  cost_estimate REAL,
  cost_spent REAL,
  city_budget REAL,
  state_budget REAL,
  credit_funds REAL,
  budget_program TEXT,
  tender_link TEXT,
  contractor TEXT,
  contractor_id TEXT,
  source_file TEXT,
  quality_flags TEXT,
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS fact_social_payment (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER,
  snapshot_date TEXT,
  type TEXT,
  month INTEGER,
  year INTEGER,
  amount REAL,
  source_file TEXT,
  quality_flags TEXT
);

CREATE TABLE IF NOT EXISTS fact_charity (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  charity_id INTEGER,
  snapshot_date TEXT,
  date TEXT,
  title TEXT,
  purpose TEXT,
  quantity REAL,
  unit TEXT,
  value REAL,
  recipient_id TEXT,
  recipient TEXT,
  donor_id TEXT,
  donor TEXT,
  act_id TEXT,
  act_date TEXT,
  usage_status TEXT,
  source_file TEXT,
  quality_flags TEXT
);

CREATE TABLE IF NOT EXISTS fact_school_expense (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT,
  kekv TEXT,
  kod TEXT,
  year INTEGER,
  approved REAL,
  receipt REAL,
  cash_turnover REAL,
  balance_end REAL,
  snapshot_date TEXT,
  source_file TEXT,
  quality_flags TEXT
);

CREATE TABLE IF NOT EXISTS fact_parking_fine (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER,
  snapshot_date TEXT,
  authorized_body TEXT,
  month INTEGER,
  year INTEGER,
  violations INTEGER,
  percent REAL,
  accrued REAL,
  paid REAL,
  stop_violations INTEGER,
  stop_percent REAL,
  stop_accrued REAL,
  stop_paid REAL,
  collection_rate REAL,
  stop_collection_rate REAL,
  source_file TEXT,
  quality_flags TEXT
);

CREATE TABLE IF NOT EXISTS fact_payment (
  payment_id INTEGER PRIMARY KEY,
  contract_number TEXT,
  tenant TEXT,
  tenant_id TEXT,
  manager TEXT,
  manager_id TEXT,
  period_start TEXT,
  period_end TEXT,
  amount REAL,
  currency TEXT,
  payment_due TEXT,
  payment_date TEXT,
  paid REAL,
  penalty REAL,
  fine REAL,
  snapshot_date TEXT,
  source_file TEXT,
  quality_flags TEXT
);

CREATE TABLE IF NOT EXISTS event_fair (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  place TEXT,
  organizer TEXT,
  source_url TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS data_snapshot (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS page_cache (
  url TEXT PRIMARY KEY,
  title TEXT,
  body TEXT,
  attachments_json TEXT,
  updated_at TEXT,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_cache (
  id TEXT PRIMARY KEY,
  type TEXT,
  title TEXT,
  date TEXT,
  executor TEXT,
  download_url TEXT,
  additions_json TEXT,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_cache_type ON document_cache(type);
