# GST Invoice Validator

Send an Indian GST tax invoice (PDF) and get back its extracted fields plus a **deterministic GST
compliance check**. The check says whether input tax credit (ITC) can be claimed on the invoice, and
explains every problem it finds.

## Why

Indian businesses claim ITC on the GST charged by their suppliers, but only on invoices that are correct.
Common mistakes cost real money:

- IGST charged on an intra-state supply, or CGST + SGST on an inter-state one, so the credit gets disputed;
- a mistyped GSTIN, tax worked out at the wrong rate, or totals that don't add up;
- an invoice billed to a different branch's GSTIN, so this entity can't claim it.

This template pairs with [`invoice-summariser`](../invoice-summariser/): instead of a free-form summary,
it returns a fixed schema and runs the GST rules **in code**. The LLM only reads the document; it never
decides what's compliant.

## How it works

```
API Request ──► Extract from File ──► Generate JSON ──► Validate GST ──► API Response
  (url,           (PDF → text)         (schema-bound      (code node:       (status, issues,
   our_gstin)                           extraction)        GST rules)        invoice)
```

| Check | Rule |
|---|---|
| GSTIN | Format, state code and mod-36 checksum, for supplier and buyer |
| Wrong buyer | Billed to `our_gstin`, if you pass it |
| Tax type | Same state → CGST + SGST (equal); different state → IGST, using the printed place of supply |
| Tax math | Tax charged = Σ line taxable value × rate; each rate must be a valid GST slab |
| Totals | Lines add up to the taxable value; taxable + tax + round-off = invoice total |
| Invoice number | CGST Rule 46: 1–16 characters, letters, digits, `-` and `/` |
| Date | Valid, and not in the future |

Amounts are compared with a ₹1 tolerance for rounding.

## Input

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Public URL of the invoice PDF |
| `our_gstin` | string | No | Your company's GSTIN. When set, invoices billed to any other GSTIN are flagged |

## Output

```json
{
  "status": "error",
  "itc_claimable": false,
  "tax_total": 5175,
  "issues": [
    {
      "code": "WRONG_TAX_TYPE",
      "severity": "error",
      "message": "Intra-state supply charged IGST; it should be CGST + SGST. ITC will be disputed."
    }
  ],
  "invoice": { "supplier_gstin": "29AAFCK3310P1Z9", "invoice_number": "KPI/2026/0451", "...": "..." }
}
```

- `status`: `ok`, `warning` (for example a Rule 46 invoice-number issue) or `error`.
- `itc_claimable`: `false` whenever any error-level issue is found.

## Setup

1. Deploy the template from Lamatic Studio and attach a Gemini (or other) credential to **Generate JSON**.
2. Call the flow with `url` (and optionally `our_gstin`) from the API trigger.
3. Read `itc_claimable` and `issues` in your app, spreadsheet or automation.

## Tests

The Validate GST code node is plain JavaScript with tests. They include real GSTINs, each rule, rounding
tolerance, malformed LLM output and hostile field values:

```bash
node --test kits/gst-invoice-validator/tests/validate-gst.test.mjs
```

## Limits

- One invoice per call, so duplicate invoices across a batch are not detected.
- Scanned image-only PDFs need OCR before **Extract from File** can read them.
- Reverse charge, credit and debit notes, and blocked credits under Section 17(5) are not handled.
- GSTR-2B reconciliation is out of scope. The author's standalone
  [GST Invoice Agent](https://github.com/Greekkgod/gst-invoice-agent) adds it.

## Author

Pradhumay Gaur ([GitHub](https://github.com/Greekkgod))
