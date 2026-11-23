import { describe, expect, it } from "vitest";
import {
  parseCityArticlePage,
  parseCityListPage,
  parseDocumentSearchPage,
} from "../src/city/client";
import { parseJsonLdEvents } from "../src/events/events";
import { parseCsv, toObjects } from "../src/lib/csv";
import { parseCityListDate, parseUkrainianDate } from "../src/lib/date";
import { normalizeStreet } from "../src/lib/text";

const listHtml = `
<main>
  <div class="row article-item">
    <a href="/press-center/ogoloshennia/5-listopada-vidbudutsya-gromadski-slukhannya-6958" class="col-3 article-image">
      <img src="/storage/press/notice/6958/photo.jpg">
    </a>
    <div class="col-9 sub-info-box">
      <a href="/press-center/ogoloshennia/5-listopada-vidbudutsya-gromadski-slukhannya-6958" class="advert-name">5 листопада відбудуться громадські слухання</a>
      <span class="publish-date"><span class="date">27 Жов, </span><span class="time">17:12</span></span>
    </div>
  </div>
  <div class="row article-item">
    <a href="/press-center/ogoloshennia/26-zhovtnya-pokhovannya-6957" class="col-3 article-image"></a>
    <div class="col-9 sub-info-box">
      <a href="/press-center/ogoloshennia/26-zhovtnya-pokhovannya-6957" class="advert-name">26 жовтня відбудеться поховання</a>
      <span class="publish-date"><span class="date">26 Жов, </span><span class="time">09:00</span></span>
    </div>
  </div>
  <a href="/press-center/ogoloshennia?page=2">2</a>
  <a href="/press-center/ogoloshennia?page=423">423</a>
</main>`;

const articleHtml = `
<title>5 листопада відбудуться громадські слухання. Оголошення Чернівецької міської ради</title>
<div class="last-edit"><span class="date">27 Жов, </span><span class="time">17:12</span></div>
<div class="artical">
  <div class="text">
    <article>
      <p>05 листопада 2026 року о 16:00 відбудуться громадські слухання.</p>
      <p>Місце: площа Центральна, 1.</p>
      <a href="/storage/files/Soc-ekonom/2026/program.docx">Програма</a>
    </article>
  </div>
</div>
<div class="bottom-share-block"></div>`;

const documentsHtml = `
<table>
  <tr scope="row">
    <td class="text-center">06</td>
    <td><div class="date">29.10.2026</div></td>
    <td>
      Про надання права на пільгове паркування
      <a href="https://city.cv.ua/search/documents/rmvk_1_06_20261029.docx">завантажити .doc</a>
      <a href="https://city.cv.ua/search/additions_download/104979">Додатки 2</a>
    </td>
    <td>Відділ паркування</td>
  </tr>
</table>
<a href="/search/documents?type=all&page=2">2</a>`;

const eventHtml = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "MusicEvent",
  "name": "Курган і Агрегат",
  "startDate": "2026-11-04T18:30:00+02:00",
  "endDate": "2026-11-04T20:30:00+02:00",
  "url": "https://chernivtsi.karabas.com/kurhan-ahrehat/",
  "description": "Концерт",
  "location": {
    "@type": "Place",
    "name": "Flora club",
    "address": {"streetAddress": "Головна 100", "addressLocality": "Чернівці"},
    "geo": {"latitude": 48.29, "longitude": 25.94}
  },
  "offers": {"lowPrice": 500, "highPrice": 900, "priceCurrency": "UAH"}
}
</script>`;

describe("city parsers", () => {
  it("parses list pages and pagination", () => {
    const parsed = parseCityListPage(listHtml, "announcements");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.totalPages).toBe(423);
    expect(parsed.items[0]?.title).toContain("громадські слухання");
    expect(parsed.items[0]?.publishedAt).toContain("2026-10-27");
  });

  it("parses article body and attachments", () => {
    const article = parseCityArticlePage(
      articleHtml,
      "https://city.cv.ua/press-center/ogoloshennia/5-listopada-6958",
    );
    expect(article.title).toContain("громадські слухання");
    expect(article.body).toContain("площа Центральна");
    expect(article.attachments[0]?.url).toContain("program.docx");
  });

  it("parses document search results", () => {
    const parsed = parseDocumentSearchPage(documentsHtml);
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0]?.date).toBe("29.10.2026");
    expect(parsed.documents[0]?.downloadUrl).toContain("rmvk_1_06_20261029.docx");
    expect(parsed.totalPages).toBe(2);
  });
});

describe("events", () => {
  it("extracts schema.org events", () => {
    const events = parseJsonLdEvents(eventHtml, "https://chernivtsi.karabas.com/");
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Курган і Агрегат");
    expect(events[0]?.venue).toBe("Flora club");
    expect(events[0]?.lat).toBe(48.29);
    expect(events[0]?.price).toContain("500");
  });
});

describe("helpers", () => {
  it("parses Ukrainian dates", () => {
    expect(parseUkrainianDate("5 листопада о 16:00", new Date("2026-10-01T00:00:00Z"))).toContain(
      "2026-11-05T16:00",
    );
    expect(parseCityListDate("27 Жов, 17:12", new Date("2026-10-31T00:00:00Z"))).toContain(
      "2026-10-27T17:12",
    );
  });

  it("normalizes street names", () => {
    expect(normalizeStreet("вул. Головна")).toBe("головна");
    expect(normalizeStreet("проспект Незалежності")).toBe("незалежності");
  });

  it("parses semicolon CSV", () => {
    const table = parseCsv("street;house\nГоловна;100\nРуська;1\n");
    expect(table.headers).toEqual(["street", "house"]);
    expect(toObjects(table)[1]).toEqual({ street: "Руська", house: "1" });
  });
});
