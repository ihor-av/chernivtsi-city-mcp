import type { Env } from "../types";
import { normalizeText } from "../lib/text";

export interface LeaseQuery {
  query?: string;
  street?: string;
  tenant?: string;
  minDebt?: number;
  expiringBefore?: string;
  status?: string;
  limit?: number;
}

interface LeaseRow {
  lease_id: number;
  contract_number: string | null;
  tenant: string | null;
  legal_form: string | null;
  address: string | null;
  street: string | null;
  house: string | null;
  intended_use: string | null;
  area_m2: number | null;
  monthly_rent: number | null;
  paid: number | null;
  debt: number | null;
  rent_per_m2: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  lat: number | null;
  lon: number | null;
  snapshot_date: string | null;
  source_file: string | null;
}

function mapLease(row: LeaseRow) {
  return {
    id: row.lease_id,
    contractNumber: row.contract_number,
    tenant: row.tenant,
    legalForm: row.legal_form,
    address: row.address,
    street: row.street,
    house: row.house,
    intendedUse: row.intended_use,
    areaM2: row.area_m2,
    monthlyRentUah: row.monthly_rent,
    paidUah: row.paid,
    debtUah: row.debt,
    rentPerM2Uah: row.rent_per_m2,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    lat: row.lat,
    lon: row.lon,
    snapshotDate: row.snapshot_date,
    sourceFile: row.source_file,
  };
}

export async function searchLeases(env: Env, options: LeaseQuery) {
  if (!env.DB) return { leases: [], note: "D1 database is not available." };
  const clauses: string[] = [];
  const values: unknown[] = [];
  const query = options.query ?? options.tenant ?? options.street;
  if (query) {
    clauses.push("search_text LIKE ?");
    values.push(`%${normalizeText(query)}%`);
  }
  if (options.street) {
    clauses.push("search_text LIKE ?");
    values.push(`%${normalizeText(options.street)}%`);
  }
  if (options.minDebt !== undefined) {
    clauses.push("coalesce(debt,0) >= ?");
    values.push(options.minDebt);
  }
  if (options.expiringBefore) {
    clauses.push("end_date IS NOT NULL AND end_date <= ?");
    values.push(options.expiringBefore);
  }
  if (options.status) {
    clauses.push("search_text LIKE ?");
    values.push(`%${normalizeText(options.status)}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(options.limit ?? 30, 100);
  const result = await env.DB.prepare(
    `SELECT lease_id, contract_number, tenant, legal_form, address, street, house,
            intended_use, area_m2, monthly_rent, paid, debt, rent_per_m2,
            start_date, end_date, status, lat, lon, snapshot_date, source_file
     FROM fact_building_lease
     ${where}
     ORDER BY coalesce(debt,0) DESC, monthly_rent DESC
     LIMIT ?`,
  )
    .bind(...values, limit)
    .all<LeaseRow>();
  return {
    count: result.results?.length ?? 0,
    leases: (result.results ?? []).map(mapLease),
    snapshotDate: result.results?.[0]?.snapshot_date ?? null,
    source: "Чернівецька міська рада open data (rent list, 2026-10-01 snapshot)",
  };
}

export async function getLease(env: Env, idOrContract: string) {
  if (!env.DB) return undefined;
  const numeric = Number(idOrContract);
  const row = Number.isFinite(numeric)
    ? await env.DB.prepare(
        `SELECT lease_id, contract_number, tenant, legal_form, address, street, house,
                intended_use, area_m2, monthly_rent, paid, debt, rent_per_m2,
                start_date, end_date, status, lat, lon, snapshot_date, source_file
         FROM fact_building_lease WHERE lease_id = ?`,
      )
        .bind(numeric)
        .first<LeaseRow>()
    : await env.DB.prepare(
        `SELECT lease_id, contract_number, tenant, legal_form, address, street, house,
                intended_use, area_m2, monthly_rent, paid, debt, rent_per_m2,
                start_date, end_date, status, lat, lon, snapshot_date, source_file
         FROM fact_building_lease WHERE contract_number = ? LIMIT 1`,
      )
        .bind(idOrContract)
        .first<LeaseRow>();
  return row ? mapLease(row) : undefined;
}

export async function arrearsRanking(env: Env, by: "tenant" | "street", limit = 10) {
  if (!env.DB) return { items: [], note: "D1 database is not available." };
  const column = by === "street" ? "street" : "tenant";
  const result = await env.DB.prepare(
    `SELECT ${column} AS label,
            count(*) AS leases,
            sum(coalesce(debt,0)) AS arrears,
            sum(coalesce(monthly_rent,0)) AS monthly_rent
     FROM fact_building_lease
     WHERE coalesce(debt,0) > 0
     GROUP BY ${column}
     ORDER BY arrears DESC
     LIMIT ?`,
  )
    .bind(Math.min(limit, 50))
    .all<{ label: string; leases: number; arrears: number; monthly_rent: number }>();
  return {
    by,
    items: (result.results ?? []).map((row) => ({
      label: row.label,
      leases: row.leases,
      arrearsUah: row.arrears,
      monthlyRentUah: row.monthly_rent,
    })),
    source: "Чернівецька міська рада open data (rent list, 2026-10-01 snapshot)",
  };
}

export async function searchLandLeases(
  env: Env,
  options: { query?: string; status?: string; limit?: number },
) {
  if (!env.DB) return { leases: [], note: "D1 database is not available." };
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.query) {
    clauses.push("search_text LIKE ?");
    values.push(`%${normalizeText(options.query)}%`);
  }
  if (options.status) {
    clauses.push("search_text LIKE ?");
    values.push(`%${normalizeText(options.status)}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.DB.prepare(
    `SELECT parcel_id, contract_number, contract_date, tenant, address, cadastral,
            area_m2, annual_rent, normative_value, rent_pct, start_date, end_date,
            lease_type, lease_status, snapshot_date
     FROM fact_land_lease ${where}
     ORDER BY annual_rent DESC LIMIT ?`,
  )
    .bind(...values, Math.min(options.limit ?? 30, 100))
    .all<{
      parcel_id: number;
      contract_number: string | null;
      contract_date: string | null;
      tenant: string | null;
      address: string | null;
      cadastral: string | null;
      area_m2: number | null;
      annual_rent: number | null;
      normative_value: number | null;
      rent_pct: number | null;
      start_date: string | null;
      end_date: string | null;
      lease_type: string | null;
      lease_status: string | null;
      snapshot_date: string | null;
    }>();
  return {
    leases: (result.results ?? []).map((row) => ({
      id: row.parcel_id,
      contractNumber: row.contract_number,
      contractDate: row.contract_date,
      tenant: row.tenant,
      address: row.address,
      cadastral: row.cadastral,
      areaM2: row.area_m2,
      annualRentUah: row.annual_rent,
      normativeValueUah: row.normative_value,
      rentPct: row.rent_pct,
      startDate: row.start_date,
      endDate: row.end_date,
      leaseType: row.lease_type,
      status: row.lease_status,
      snapshotDate: row.snapshot_date,
    })),
    source: "Чернівецька міська рада / geoportal land lease data",
  };
}

export async function housingLookup(env: Env, street: string, house?: string) {
  if (!env.DB) return { buildings: [], accounts: [], note: "D1 database is not available." };
  const streetLike = `%${normalizeText(street)}%`;
  const buildings = await env.DB.prepare(
    `SELECT building_id, address, manager, manager_edrpou, manager_address,
            floors, apartments, year_built, area_total, debt_total
     FROM fact_building
     WHERE search_text LIKE ? ${house ? "AND search_text LIKE ?" : ""}
     LIMIT 10`,
  )
    .bind(...(house ? [streetLike, `%${normalizeText(house)}%`] : [streetLike]))
    .all<{
      building_id: string;
      address: string;
      manager: string | null;
      manager_edrpou: string | null;
      manager_address: string | null;
      floors: number | null;
      apartments: number | null;
      year_built: number | null;
      area_total: number | null;
      debt_total: number | null;
    }>();

  const accounts = await env.DB.prepare(
    `SELECT street_name, house_number, manager, month, year, invoice, liability
     FROM fact_housing_account
     WHERE search_text LIKE ? ${house ? "AND house_number = ?" : ""}
     ORDER BY year DESC, month DESC LIMIT 12`,
  )
    .bind(...(house ? [streetLike, house] : [streetLike]))
    .all<{
      street_name: string;
      house_number: string;
      manager: string | null;
      month: number;
      year: number;
      invoice: number | null;
      liability: number | null;
    }>();

  return {
    buildings: (buildings.results ?? []).map((row) => ({
      id: row.building_id,
      address: row.address,
      manager: row.manager,
      managerEdrpou: row.manager_edrpou,
      managerAddress: row.manager_address,
      floors: row.floors,
      apartments: row.apartments,
      yearBuilt: row.year_built,
      areaTotalM2: row.area_total,
      debtTotalUah: row.debt_total,
    })),
    accounts: (accounts.results ?? []).map((row) => ({
      street: row.street_name,
      house: row.house_number,
      manager: row.manager,
      period: `${row.year}-${String(row.month).padStart(2, "0")}`,
      invoiceUah: row.invoice,
      liabilityUah: row.liability,
    })),
    source: "Чернівецька міська рада housing open data",
  };
}

export async function searchTariffs(
  env: Env,
  options: { query?: string; provider?: string; activeOn?: string; limit?: number },
) {
  if (!env.DB) return { tariffs: [], note: "D1 database is not available." };
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.query) {
    clauses.push("search_text LIKE ?");
    values.push(`%${normalizeText(options.query)}%`);
  }
  if (options.provider) {
    clauses.push("search_text LIKE ?");
    values.push(`%${normalizeText(options.provider)}%`);
  }
  if (options.activeOn) {
    clauses.push("(valid_from IS NULL OR valid_from <= ?) AND (valid_through IS NULL OR valid_through >= ?)");
    values.push(options.activeOn, options.activeOn);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.DB.prepare(
    `SELECT tariff_id, type, consumers_type, amount, unit, status, provider,
            valid_from, valid_through, legal_act_type, legal_act_title,
            legal_act_issued, legal_act_num, legal_act_url, snapshot_date
     FROM fact_tariff ${where}
     ORDER BY snapshot_date DESC, provider, type LIMIT ?`,
  )
    .bind(...values, Math.min(options.limit ?? 40, 100))
    .all<{
      tariff_id: number;
      type: string;
      consumers_type: string | null;
      amount: number | null;
      unit: string | null;
      status: string | null;
      provider: string | null;
      valid_from: string | null;
      valid_through: string | null;
      legal_act_type: string | null;
      legal_act_title: string | null;
      legal_act_issued: string | null;
      legal_act_num: string | null;
      legal_act_url: string | null;
      snapshot_date: string | null;
    }>();
  return {
    tariffs: (result.results ?? []).map((row) => ({
      id: row.tariff_id,
      type: row.type,
      consumersType: row.consumers_type,
      amount: row.amount,
      unit: row.unit,
      status: row.status,
      provider: row.provider,
      validFrom: row.valid_from,
      validThrough: row.valid_through,
      legalAct: {
        type: row.legal_act_type,
        title: row.legal_act_title,
        issued: row.legal_act_issued,
        number: row.legal_act_num,
        url: row.legal_act_url,
      },
      snapshotDate: row.snapshot_date,
    })),
    source: "Чернівецька міська рада tariff open data",
  };
}

export async function searchBudgetProjects(
  env: Env,
  options: { query?: string; type?: "road" | "construction" | "all"; limit?: number },
) {
  if (!env.DB) return { projects: [], note: "D1 database is not available." };
  const type = options.type ?? "all";
  const limit = Math.min(options.limit ?? 20, 50);
  const needle = options.query ? normalizeText(options.query) : undefined;
  const projects: Array<Record<string, unknown>> = [];

  if (type === "road" || type === "all") {
    const result = await env.DB.prepare(
      `SELECT project_key, project_type, description, address, work_period,
              cost_total, cost_spent, city_budget, state_budget, contractor, status, snapshot_date
       FROM fact_road_project
       ${needle ? "WHERE search_text LIKE ?" : ""}
       ORDER BY snapshot_date DESC, cost_total DESC LIMIT ?`,
    )
      .bind(...(needle ? [`%${needle}%`, limit] : [limit]))
      .all<Record<string, unknown>>();
    for (const row of result.results ?? []) {
      projects.push({ ...row, table: "road" });
    }
  }
  if (type === "construction" || type === "all") {
    const result = await env.DB.prepare(
      `SELECT project_key, project_type, description, address, work_period,
              cost_estimate, cost_spent, city_budget, state_budget, contractor, snapshot_date
       FROM fact_construction_project
       ${needle ? "WHERE search_text LIKE ?" : ""}
       ORDER BY snapshot_date DESC, cost_estimate DESC LIMIT ?`,
    )
      .bind(...(needle ? [`%${needle}%`, limit] : [limit]))
      .all<Record<string, unknown>>();
    for (const row of result.results ?? []) {
      projects.push({ ...row, table: "construction" });
    }
  }

  return {
    projects: projects.slice(0, limit),
    source: "Чернівецька міська рада road/construction project open data",
  };
}
