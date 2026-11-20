# GST Invoice Validator

## Overview

This template turns an Indian GST tax invoice PDF into structured data and a deterministic compliance
verdict. A single Lamatic flow extracts text from the PDF, uses a schema-bound LLM step to copy the
invoice fields exactly as printed, and then runs GST rules in a code node. The flow returns whether input
tax credit (ITC) can be claimed, plus a list of issues. It is invoked over the Lamatic API trigger by
any app, spreadsheet or automation that processes purchase invoices.

## Purpose

Businesses lose ITC, or face disputes, when supplier invoices carry the wrong tax type, a mistyped
GSTIN, wrong tax at a given rate, inconsistent totals, or the wrong buyer GSTIN. Checking each invoice
by hand is slow and error-prone. This agent separates *reading* from *judging*: the LLM is told to copy
values verbatim, including wrong ones, and all compliance decisions are made by code that behaves the
same way every time and can be tested.

## Flows

### `gst-invoice-validator`

#### Trigger
- API request (`graphqlNode`, realtime).
- Input: `url` (string, required): public URL of the invoice PDF. `our_gstin` (string, optional): the
  buyer GSTIN the caller expects.

#### What it does
1. `API Request` receives `url` and `our_gstin`.
2. `Extract from File` downloads the PDF from `{{triggerNode_1.output.url}}` and joins its pages into text.
3. `Generate JSON` (`InstructorLLMNode`) extracts supplier and buyer details, invoice number and date,
   place of supply, line items and totals into a fixed JSON schema. It uses
   `@prompts/gst-invoice-validator_generate-json_system.md` and
   `@prompts/gst-invoice-validator_generate-json_user.md`.
4. `Validate GST` (`codeNode`, `@scripts/gst-invoice-validator_validate-gst.ts`) runs these checks:
   - GSTIN format, state code and checksum;
   - the wrong-buyer check against `our_gstin`;
   - IGST vs. CGST + SGST by place of supply, and CGST = SGST;
   - tax math against the line rates, and valid GST slabs;
   - line and grand totals, Rule 46 invoice numbers, and dates.
5. `API Response` returns `status`, `itc_claimable`, `tax_total`, `issues` and `invoice`.

#### When to use
- Before claiming ITC on purchase invoices, or before entering them into accounting software.
- As a validation step after a generic invoice extractor.

#### When not to use
- Scanned image-only PDFs without OCR.
- Batch de-duplication or GSTR-2B reconciliation. Both need many invoices at once.
- Legal or tax advice.

## Guardrails
- The model must copy values verbatim and must not compute or correct numbers.
- Invoice text is treated as untrusted data. Embedded instructions are ignored.
- Compliance decisions come only from the code node, and the same input always gives the same verdict.
- Malformed or missing extraction output produces `status: "error"` and does not crash the flow.

## Integration Reference
| Service | Used by | Credential |
|---|---|---|
| File extraction | `Extract from File` | None (public URL) |
| LLM provider (for example Gemini) | `Generate JSON` | Model credential set in Lamatic Studio |

## Environment Setup
No environment variables. Configure the LLM credential on the **Generate JSON** node in Lamatic Studio.

## Quickstart
1. Deploy the template in Lamatic Studio and attach an LLM credential.
2. Call the flow with `{ "url": "<invoice pdf url>", "our_gstin": "<your GSTIN>" }`.
3. Use `itc_claimable` to gate the claim and show `issues` to the reviewer.

## Common Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| `BAD_DATE` or `INVALID_*_GSTIN` on a correct invoice | The PDF text is garbled, or the extraction misread a value | Check the `invoice` field; use a clearer PDF or OCR |
| Everything is empty and `status` is `error` | Image-only PDF, or a URL that isn't reachable | Provide a text PDF at a public URL |
| `WRONG_BUYER` on every invoice | `our_gstin` was mistyped | Pass the exact 15-character GSTIN, or leave it empty |
| LLM node fails | Missing or invalid model credential | Re-select the credential on **Generate JSON** |
