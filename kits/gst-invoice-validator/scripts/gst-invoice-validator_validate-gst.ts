// Code: Validate GST
// Flow: gst-invoice-validator
//
// Deterministic GST checks on the invoice the LLM extracted. The model only reads the
// document; every rule that decides whether input tax credit (ITC) can be claimed is
// checked here in code. Amounts are compared with a Rs 1 tolerance for rounding.

const extracted = {{InstructorLLMNode_1.output}};
const ourGstinInput = {{triggerNode_1.output.our_gstin}};

const TOLERANCE = 1;
const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40];
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/;
const INVOICE_NO = /^[A-Za-z0-9\/-]{1,16}$/; // CGST Rule 46: max 16 chars, letters, digits, - and /
const STATES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory"
};

function checkChar(first14) {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (total % 36)) % 36];
}

function gstinError(gstin) {
  if (!gstin) return "missing";
  const g = String(gstin).trim().toUpperCase();
  if (!GSTIN_PATTERN.test(g)) return "wrong format";
  if (!STATES[g.slice(0, 2)]) return "unknown state code " + g.slice(0, 2);
  const expected = checkChar(g.slice(0, 14));
  if (expected !== g[14]) return "checksum fails (expected " + expected + ", got " + g[14] + ")";
  return null;
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const close = (a, b) => Math.abs(num(a) - num(b)) <= TOLERANCE;
const inr = (v) => num(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function validateGstInvoice(inv, ourGstin, today) {
  const issues = [];
  const add = (code, severity, message) => issues.push({ code, severity, message });
  inv = inv && typeof inv === "object" ? inv : {};

  let err = gstinError(inv.supplier_gstin);
  if (err) add("INVALID_SUPPLIER_GSTIN", "error", "Supplier GSTIN " + JSON.stringify(inv.supplier_gstin || "") + ": " + err);
  err = gstinError(inv.buyer_gstin);
  if (err) {
    add("INVALID_BUYER_GSTIN", "error", "Buyer GSTIN " + JSON.stringify(inv.buyer_gstin || "") + ": " + err);
  } else if (ourGstin && inv.buyer_gstin.toUpperCase() !== ourGstin.toUpperCase()) {
    add("WRONG_BUYER", "error", "Billed to " + inv.buyer_gstin + ", not your GSTIN " + ourGstin + ". ITC cannot be claimed on it.");
  }

  const no = inv.invoice_number || "";
  if (!INVOICE_NO.test(no)) {
    add("INVOICE_NUMBER_FORMAT", "warning", "Invoice number " + JSON.stringify(no) + " breaks Rule 46 (1-16 chars, letters, digits, - or /)");
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inv.invoice_date || "");
  const d = dateMatch ? new Date(Date.UTC(+dateMatch[1], +dateMatch[2] - 1, +dateMatch[3])) : null;
  if (!d || d.getUTCDate() !== +dateMatch[3]) {
    add("BAD_DATE", "error", "Invoice date " + JSON.stringify(inv.invoice_date || "") + " is not a valid date");
  } else if (d > today) {
    add("FUTURE_DATE", "error", "Invoice date " + inv.invoice_date + " is in the future");
  }

  const lines = Array.isArray(inv.line_items) ? inv.line_items : [];
  if (!lines.length) {
    // Fail closed: without line rates the tax charged cannot be verified.
    add("NO_LINE_ITEMS", "error", "No line items were extracted, so the tax charged cannot be verified");
  }
  let expectedTax = 0;
  lines.forEach((li, i) => {
    const rate = num(li.gst_rate);
    if (!GST_RATES.includes(rate)) add("INVALID_RATE", "error", "Line " + (i + 1) + ": GST rate " + rate + "% is not a valid GST slab");
    if (li.quantity != null && li.unit_price != null && !close(num(li.quantity) * num(li.unit_price), li.taxable_value)) {
      add("LINE_MATH", "warning", "Line " + (i + 1) + ": " + li.quantity + " x " + li.unit_price + " = " +
        inr(num(li.quantity) * num(li.unit_price)) + ", invoice says " + inr(li.taxable_value));
    }
    expectedTax += num(li.taxable_value) * rate / 100;
  });

  const t = inv.totals || {};
  const cgst = num(t.cgst), sgst = num(t.sgst), igst = num(t.igst), taxable = num(t.taxable_value);

  if (lines.length && !close(lines.reduce((s, li) => s + num(li.taxable_value), 0), taxable)) {
    add("TAXABLE_MISMATCH", "error", "Line items do not add up to the taxable value");
  }

  const supplierState = (inv.supplier_gstin || "").slice(0, 2);
  // Place of supply decides intra vs inter-state; fall back to the buyer's state when not printed.
  const posPrinted = String(inv.place_of_supply_code || "").trim();
  const pos = posPrinted ? posPrinted.padStart(2, "0") : (inv.buyer_gstin || "").slice(0, 2);
  if (supplierState && pos) {
    if (supplierState === pos && igst > TOLERANCE) {
      add("WRONG_TAX_TYPE", "error", "Intra-state supply charged IGST; it should be CGST + SGST. ITC will be disputed.");
    } else if (supplierState !== pos && cgst + sgst > TOLERANCE) {
      add("WRONG_TAX_TYPE", "error", "Inter-state supply charged CGST + SGST; it should be IGST. ITC will be disputed.");
    } else if (supplierState === pos && !close(cgst, sgst)) {
      add("CGST_SGST_UNEQUAL", "error", "CGST " + inr(cgst) + " and SGST " + inr(sgst) + " should be equal");
    }
  }

  if (lines.length && !close(cgst + sgst + igst, expectedTax)) {
    add("TAX_MISMATCH", "error", "Tax charged " + inr(cgst + sgst + igst) + " but line rates give " + inr(expectedTax));
  }

  const grand = taxable + cgst + sgst + igst + num(t.round_off);
  if (!close(grand, t.total)) {
    add("TOTAL_MISMATCH", "error", "Taxable + tax = " + inr(grand) + ", invoice total says " + inr(t.total));
  }

  const status = issues.some((i) => i.severity === "error") ? "error" : issues.length ? "warning" : "ok";
  return {
    status,
    itc_claimable: status !== "error",
    tax_total: Math.round((cgst + sgst + igst) * 100) / 100,
    issues,
    invoice: inv
  };
}

const ourGstin = typeof ourGstinInput === "string" && ourGstinInput.trim() ? ourGstinInput.trim() : null;
output = validateGstInvoice(extracted, ourGstin, new Date());
