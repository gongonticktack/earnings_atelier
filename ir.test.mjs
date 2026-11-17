import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverIrDocuments, extractIrLinks } from "./ir.js";

test("日産の空の先頭見出しがある表から決算短信名を読み、コメント内の未公表リンクを除外する", async () => {
  const html = '<title>IR資料室</title><tr><th></th><th>決算短信</th><td><a href="/JP/IR/FINANCIAL_RESULTS/20261st_financialresult_172_j.pdf"></a></td><!--<td><a href="/20262nd_financialresult.pdf"></a></td>--></tr>';
  const docs = await discoverIrDocuments({code:"nissan", ir_url:"https://www.nissan-global.com/JP/IR/FINANCIAL_RESULTS/"}, async () => new Response(html));
  assert.equal(docs.length, 1);
  assert.match(docs[0].title, /決算短信/);
});

test("マツダの公式ページに紐づく配信会社の決算PDFだけを収集する", async () => {
  const root = 'https://www.mazda.com/ja/investors/library/result/';
  const docs = await discoverIrDocuments({code:'mazda',ir_url:root}, async url => {
    if (url === root) return new Response('<script src="https://www.xj-storage.jp/resources/AS07797a/XJ_results.js"></script>');
    assert.match(url,/company=AS07797a/);
    return Response.json({items:[
      {title:'2027年3月期 第1四半期決算短信',publishDate:'2026/08/04 13:30:00',files:[{type:'PDF-GENERAL',url:'https://contents.xj-storage.jp/xcontents/AS07797a/results.pdf'}]},
      {title:'決算短信',files:[{type:'PDF-GENERAL',url:'https://contents.xj-storage.jp/xcontents/OTHER/results.pdf'}]},
    ]});
  });
  assert.equal(docs.length,1);
  assert.equal(docs[0].publishedAt,'2026-08-04');
  assert.equal(docs[0].discoveredFrom,root);
});

test("ARCHIONの公式ローダーと会社識別子を確認し、JSONPを実行せず決算書を収集する", async () => {
  const root='https://archion.co.jp/ir/library/financial-results/';
  const docs=await discoverIrDocuments({code:'archion',ir_url:root},async url=>{
    if(url===root)return new Response('<script src="/dist/js/ir/eir/eir_v5.js"></script>');
    if(url.endsWith('eir_v5.js'))return new Response("const eirCode = '543A'; const uniCodeEir = '20260615';");
    if(url.endsWith('common_conf.js'))return new Response('_e.json="http://v4.eir-parts.net/V4Public/eir/543A/ja/announcement/announcement_0.js";');
    return new Response('eolparts_announcement_0('+JSON.stringify({header:[{customer_code:'543A'}],item:[
      {title:'2027年3月期 第1四半期決算短信',date:'2026/08/12 15:30:00',link:'https://ssl4.eir-parts.net/doc/543A/tdnet/1/00.pdf'},
      {title:'決算短信',link:'https://ssl4.eir-parts.net/doc/OTHER/tdnet/1/00.pdf'},
    ]})+');');
  });
  assert.equal(docs.length,1);
  assert.equal(docs[0].companyCode,'archion');
  assert.equal(docs[0].discoveredFrom,root);
});

test("履歴同期では公式アーカイブの年度別ページまでたどり、別サイトへ移らない", async () => {
  const pages = new Map([
    ["https://example.co.jp/ir/results/", '<a href="/ir/results/archive/">過去の決算資料</a><a href="https://other.test/ir/results/">決算資料</a>'],
    ["https://example.co.jp/ir/results/archive/", '<a href="/ir/results/archive/2023/">2023年3月期</a>'],
    ["https://example.co.jp/ir/results/archive/2023/", '<a href="/pdf/2023_tanshin.pdf">決算短信</a>'],
  ]);
  const visited = [];
  const documents = await discoverIrDocuments({code:"sample",ir_url:[...pages.keys()][0]}, async (url) => {
    visited.push(url); return new Response(pages.get(url), {status:pages.has(url)?200:404});
  }, {history:true});
  assert.deepEqual(visited,[...pages.keys()]);
  assert.equal(documents[0].discoveredFrom,[...pages.keys()][2]);
});

test("公式ページの相対PDFリンクを解決し、決算資料だけを選ぶ", async () => {
  const html = `
    <h2>2027年3月期</h2><h3>第1四半期決算情報</h3>
    <a href="/pages/2027_1q_summary_jp.pdf">決算要旨</a>
    <a href="/pages/governance.pdf">コーポレートガバナンス</a>`;
  const links = extractIrLinks(html, "https://global.toyota/jp/ir/financial-results/");
  assert.equal(links[0].url, "https://global.toyota/pages/2027_1q_summary_jp.pdf");
  const documents = await discoverIrDocuments(
    { code: "toyota", ir_url: "https://global.toyota/jp/ir/financial-results/" },
    async () => new Response(html),
  );
  assert.equal(documents.length, 1);
  assert.equal(documents[0].sourceName, "official_ir");
});

test("IRトップから同じサイトの決算ページを1段たどる", async () => {
  const pages = new Map([
    ["https://example.co.jp/ir/", '<a href="/ir/financial/results.html">決算関連資料</a>'],
    ["https://example.co.jp/ir/financial/results.html", '<a href="/files/tanshin2027.pdf">決算短信</a>'],
  ]);
  const visited = [];
  const documents = await discoverIrDocuments(
    { code: "sample", ir_url: "https://example.co.jp/ir/" },
    async (url) => { visited.push(url); return new Response(pages.get(url) ?? "", { status: pages.has(url) ? 200 : 404 }); },
  );
  assert.deepEqual(visited, [...pages.keys()]);
  assert.equal(documents[0].url, "https://example.co.jp/files/tanshin2027.pdf");
});

test("HTTP以外のリンクは採用しない", () => {
  const links = extractIrLinks('<a href="javascript:alert(1)">決算短信</a><a href="http://example.test/report.pdf">決算短信</a>', "https://example.test/ir/");
  assert.equal(links.length, 0);
});

test("年度の選択先URLとPDFを返すashx形式を収集し、数値だけの選択値はURLにしない", async () => {
  const links=extractIrLinks('<select><option value="/ir/results/fs2022.html">2022年度</option><option value="2021">2021年度</option></select>',"https://official.test/ir/");
  assert.deepEqual(links.map(link=>link.url),["https://official.test/ir/results/fs2022.html"]);
  const documents=await discoverIrDocuments({code:"murata",ir_url:"https://official.test/ir/"},async()=>new Response('<title>決算短信</title><a href="/media/2023.ashx?la=ja">2023年3月期 第1四半期 (PDF)</a>'));
  assert.equal(documents.length,1);
  assert.match(documents[0].title,/決算短信/);
});

test("追加ページが失敗しても最初のページで見つけた資料を残す", async () => {
  const documents = await discoverIrDocuments(
    { code: "sample", ir_url: "https://example.co.jp/ir/" },
    async (url) => url.endsWith("/ir/")
      ? new Response('<a href="/report.pdf">決算短信</a><a href="/ir/financial/archive.html">決算資料アーカイブ</a>')
      : new Response("missing", { status: 404 }),
  );
  assert.equal(documents.length, 1);
});
