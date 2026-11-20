// Tests for the Validate GST code node.  Run:  node --test kits/gst-invoice-validator/tests/
// The script uses Lamatic template variables, so the harness substitutes them with JSON
// (as Lamatic does at runtime) and reads the `output` the script assigns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SCRIPT = readFileSync(new URL("../scripts/gst-invoice-validator_validate-gst.ts", import.meta.url), "utf8");

function run(invoice, ourGstin = null) {
  const code = SCRIPT
    .replace("{{InstructorLLMNode_1.output}}", JSON.stringify(invoice))
    .replace("{{triggerNode_1.output.our_gstin}}", JSON.stringify(ourGstin));
  assert.ok(!code.includes("{{"), "every template variable must be substituted");
  return new Function(`let output; ${code}; return output;`)();
}
const codes = (r) => r.issues.map((i) => i.code).sort();

const BUYER = "29AABCN4821K1ZA";      // Karnataka
const INTRA = "29AAFCK3310P1Z9";      // Karnataka supplier
const INTER = "27AAKFD7720Q1ZT";      // Maharashtra supplier

function invoice(supplier = INTRA, totals = {}) {
  const intra = supplier.slice(0, 2) === BUYER.slice(0, 2);
  return {
    supplier_name: "S", supplier_gstin: supplier, buyer_name: "B", buyer_gstin: BUYER,
    invoice_number: "INV/001", invoice_date: "2026-10-01", place_of_supply_code: "",
    line_items: [{ description: "x", hsn: "1", quantity: 10, unit_price: 1000, taxable_value: 10000, gst_rate: 18 }],
    totals: { taxable_value: 10000, cgst: intra ? 900 : 0, sgst: intra ? 900 : 0, igst: intra ? 0 : 1800,
              round_off: 0, total: 11800, ...totals },
  };
}

test("clean intra- and inter-state invoices pass", () => {
  for (const s of [INTRA, INTER]) {
    const r = run(invoice(s), BUYER);
    assert.deepEqual(r.issues, []);
    assert.equal(r.status, "ok");
    assert.equal(r.itc_claimable, true);
    assert.equal(r.tax_total, 1800);
  }
});

test("real GSTINs pass the checksum; typos fail", () => {
  for (const g of ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "33AAACH7409R1Z8"]) {
    assert.deepEqual(codes(run({ ...invoice(), supplier_gstin: g, place_of_supply_code: g.slice(0, 2),
      totals: { taxable_value: 10000, cgst: 900, sgst: 900, igst: 0, round_off: 0, total: 11800 } })), []);
  }
  const r = run({ ...invoice(), supplier_gstin: "27AAPFU0939G1ZV" });
  assert.ok(r.issues.find((i) => i.code === "INVALID_SUPPLIER_GSTIN").message.includes("checksum"));
  assert.equal(r.itc_claimable, false);
});

test("wrong tax type both ways", () => {
  assert.deepEqual(codes(run(invoice(INTRA, { cgst: 0, sgst: 0, igst: 1800 }))), ["WRONG_TAX_TYPE"]);
  assert.deepEqual(codes(run(invoice(INTER, { cgst: 900, sgst: 900, igst: 0 }))), ["WRONG_TAX_TYPE"]);
});

test("printed place of supply overrides the buyer's state", () => {
  const inv = { ...invoice(INTER), place_of_supply_code: "27" };
  assert.ok(codes(run(inv)).includes("WRONG_TAX_TYPE"));
  const padded = { ...invoice(INTRA), place_of_supply_code: "29" };
  assert.deepEqual(codes(run(padded)), []);
});

test("tax at the wrong rate, total typo, rounding allowed", () => {
  assert.deepEqual(codes(run(invoice(INTER, { igst: 1200, total: 11200 }))), ["TAX_MISMATCH"]);
  assert.deepEqual(codes(run(invoice(INTRA, { total: 12300 }))), ["TOTAL_MISMATCH"]);
  assert.deepEqual(codes(run(invoice(INTRA, { total: 11800.4 }))), []);
});

test("unequal CGST/SGST, invalid rate and line math", () => {
  assert.deepEqual(codes(run(invoice(INTRA, { cgst: 1000, sgst: 800 }))), ["CGST_SGST_UNEQUAL"]);
  const inv = invoice(INTER);
  inv.line_items[0] = { ...inv.line_items[0], gst_rate: 15, quantity: 9 };
  const found = codes(run(inv));
  assert.ok(found.includes("INVALID_RATE") && found.includes("LINE_MATH"));
});

test("wrong buyer, future date, long invoice number", () => {
  const inv = { ...invoice(), invoice_date: "2999-01-01", invoice_number: "A".repeat(17) };
  assert.deepEqual(codes(run(inv, "27AABCN4821K2ZD")), ["FUTURE_DATE", "INVOICE_NUMBER_FORMAT", "WRONG_BUYER"]);
  assert.equal(run(invoice(), "").issues.length, 0, "blank our_gstin skips the buyer check");
});

test("bad dates are caught, including impossible days", () => {
  assert.deepEqual(codes(run({ ...invoice(), invoice_date: "01/10/2026" })), ["BAD_DATE"]);
  assert.deepEqual(codes(run({ ...invoice(), invoice_date: "2026-02-30" })), ["BAD_DATE"]);
});

test("warnings alone keep ITC claimable", () => {
  const r = run({ ...invoice(), invoice_number: "SC-26-27-EXPORT-3398" });
  assert.equal(r.status, "warning");
  assert.equal(r.itc_claimable, true);
});

test("garbage from the LLM does not crash the node", () => {
  for (const bad of [null, {}, { totals: null, line_items: "nope" }]) {
    const r = run(bad);
    assert.equal(r.status, "error");
  }
});

test("hostile text in fields stays data", () => {
  const r = run({ ...invoice(), invoice_number: '"); process.exit(1); ("' }, '"); throw 1; ("');
  assert.ok(codes(r).includes("INVOICE_NUMBER_FORMAT"));
});
