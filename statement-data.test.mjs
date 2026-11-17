import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildCashFlow } from './cash-flow.js';
import { quarterlyStatements } from './financial-reports.js';
import { fiscalYearFromPeriod } from './market.js';
import { parseStatementPages } from './financial-reports.js';

const manifest = JSON.parse(await readFile(new URL("./statement-data.json", import.meta.url), "utf8"));
const verified = JSON.parse(await readFile(new URL("./test-fixtures/official-statements.json", import.meta.url), "utf8"));

test("国内の上場四輪メーカー10社を登録し、追加9社の公式決算と未解析資料の状態を保存する", async () => {
  const expected={nissan:'7201',honda:'7267',suzuki:'7269',mazda:'7261',subaru:'7270','mitsubishi-motors':'7211',isuzu:'7202',archion:'543A','nissan-shatai':'7222'};
  const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.equal([...html.matchAll(/data-company="/g)].length,30);
  const switchers=[...html.matchAll(/<section class="company-switcher"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.equal(switchers.length,1);
  assert.equal([...switchers[0][1].matchAll(/data-company="/g)].length,30);
  assert.ok(!html.includes('aria-label="追加の自動車メーカー"'));
  for(const [code,ticker] of Object.entries(expected)) {
    assert.ok(config.additionalCompanies.some(row=>row.code===code&&row.stock_code===ticker),code);
    assert.match(html,new RegExp(`data-company="${code}"`));
    const reports=manifest.reportsByCompany[code];
    assert.ok(reports.length>0,code);
    assert.ok(manifest.documentsByCompany[code].every(doc=>new URL(doc.discoveredFrom).origin===new URL(doc.officialIrUrl).origin));
    assert.equal(reports.at(-1).periodEnd,code==='subaru'?'2025-12-31':'2026-06-30',code);
  }
  assert.ok(manifest.failures.subaru.some(row=>row.url.includes('/AS07355/')));
});

test("JTの2022年度から2026年度中間期まで18原本と単独四半期が出典付きで揃う", async () => {
  const reports = manifest.reportsByCompany.jt;
  assert.equal(reports.length, 18);
  assert.equal(manifest.failures.jt, undefined);
  const quarters = quarterlyStatements(reports);
  assert.equal(quarters.length, 18);
  assert.equal(quarters.at(-1).periodEnd, "2026-06-30");
  const pages = JSON.parse(await readFile(new URL("./test-fixtures/jt-2026-q2-pages.json", import.meta.url), "utf8"));
  const latest = reports.at(-1);
  assert.equal(latest.revenue, 1986070);
  assert.equal(latest.operatingIncome, 644940);
  assert.equal(latest.netIncome, 431829);
  assert.deepEqual(latest.statementRows, parseStatementPages(pages, "jt", latest.sourceUrl, "2914").statementRows);
  for (const report of reports) {
    assert.equal(new URL(report.sourceUrl).hostname, "www.jti.co.jp");
    assert.ok(report.statementRows.length > 0);
    assert.ok(manifest.documentsByCompany.jt.some(doc => doc.url === report.sourceUrl && doc.companyCode === "jt"));
  }
});

test("10月16日時点の時価総額順で全30社を掲載し、番号は表示順の連番になる", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const buttons = [...html.matchAll(/data-company="([^"]+)"[^>]*><span class="company-rank">(\d+)<\/span>[\s\S]*?<small>([0-9A-Z]{4})<\/small>/g)];
  assert.deepEqual(buttons.slice(0, 20).map(match => match[3]), ["7203","8306","9984","6098","6501","6857","8316","8035","9983","6758","285A","8411","6861","8001","8058","8766","9432","2914","8031","6981"]);
  assert.deepEqual(buttons.slice(0, 20).map(match => Number(match[2])), Array.from({length:20}, (_,i) => i + 1));
  assert.equal(buttons[20][1], "shin-etsu");
  assert.equal(buttons.length,30);
  assert.deepEqual(buttons.map(match=>Number(match[2])),Array.from({length:30},(_,i)=>i+1));
  assert.deepEqual(buttons.slice(20).map(match=>match[1]),['shin-etsu','honda','suzuki','subaru','isuzu','nissan','archion','mazda','mitsubishi-motors','nissan-shatai']);
  assert.match(html, /2026\/10\/16時点/);
});

test("全保存原本の年度・四半期は公表時期ではなく実績期間に一致する", () => {
  for (const report of Object.values(manifest.reportsByCompany).flat()) {
    assert.equal(report.fiscalYear, fiscalYearFromPeriod(report.periodEnd, report.quarter), report.sourceUrl);
    assert.equal(report.quarter, report.months / 3, report.sourceUrl);
    assert.equal(Number(report.periodStart.slice(0,4)), report.fiscalYear, report.sourceUrl);
  }
});

test("2022年度の13社の4四半期は出典付きの原本から作られ、未取得企業の値は作らない", () => {
  const companies=["toyota","mufg","softbank-group","fast-retailing","advantest","smfg","mizuho","keyence","itochu","shin-etsu","mitsubishi-corp","hitachi","ntt"];
  for (const code of companies) {
    const reports=manifest.reportsByCompany[code];
    assert.deepEqual(quarterlyStatements(reports).filter(row=>row.fiscalYear===2022).map(row=>row.quarter),[1,2,3,4],code);
    assert.deepEqual(manifest.coverageByCompany[code].years[2022],[1,2,3,4],code);
    const documents=new Map(manifest.documentsByCompany[code].map(document=>[document.url,document]));
    for (const report of reports.filter(row=>row.fiscalYear===2022)) {
      const document=documents.get(report.sourceUrl);
      assert.ok(document,code);
      assert.equal(new URL(document.discoveredFrom).origin,new URL(document.officialIrUrl).origin);
      assert.ok(report.statementRows.length>0);
      assert.ok(report.sourcePages.every(page=>Number.isInteger(page)&&page>0));
    }
  }
  const toyota=manifest.reportsByCompany.toyota.find(row=>row.fiscalYear===2022&&row.quarter===1);
  assert.equal(toyota.revenue,8491116);
  assert.equal(toyota.netIncome,736820);
  assert.deepEqual(manifest.coverageByCompany["tokio-marine"].years[2022],[]);
});

test("配信用内訳の主要値と原本ページは照合済み6社の2026年度原本に一致する", () => {
  assert.equal(manifest.version,1);
  for (const expected of verified) {
    const actual = manifest.reportsByCompany[expected.companyCode]?.find((row) => row.sourceUrl === expected.sourceUrl);
    assert.ok(actual,`${expected.companyCode}の公式原本`);
    for (const key of ["revenue","operatingIncome","pretaxIncome","netIncome","fiscalYear","periodStart","periodEnd"]) {
      assert.equal(actual[key],expected[key],`${expected.companyCode}: ${key}`);
    }
    assert.deepEqual(actual.statementRows,expected.statementRows);
    assert.deepEqual(actual.sourcePages,expected.sourcePages);
  }
});

test('配信用CFは原本行と主要値が一致し、期首から期末の誤差が丸め範囲に収まる',()=>{
 const reports=Object.values(manifest.reportsByCompany).flat().filter(report=>report.cashFlow);
 assert.ok(reports.length>=27);
 for (const report of reports) {
   const cash=report.cashFlow;
   assert.ok(Math.abs(cash.residual)<=3,`${report.companyCode}/${report.periodEnd}: ${cash.residual}`);
   assert.equal(cash.periodEnd,report.periodEnd);
   assert.ok(cash.rows.every(row=>Number.isFinite(row.value)&&row.page>0));
   assert.ok(cash.rows.some(row=>row.value===cash.opening&&/期首/.test(row.label)));
   assert.ok(cash.rows.some(row=>row.value===cash.closing&&/期末/.test(row.label)));
   const flow=buildCashFlow(cash);
   assert.equal(flow.total,flow.targets.reduce((sum,row)=>sum+row.value,0));
 }
});
