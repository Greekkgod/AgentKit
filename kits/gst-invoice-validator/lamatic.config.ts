export default {
  name: "GST Invoice Validator",
  description: "Send an Indian GST invoice PDF and get back its extracted fields plus a deterministic GST compliance check: GSTIN checksums, wrong buyer, IGST vs CGST/SGST, tax math, totals and Rule 46 invoice numbers, with whether input tax credit can be claimed.",
  version: "1.0.0",
  type: "template" as const,
  author: {"name":"Pradhumay Gaur","email":""},
  tags: ["finance","compliance","india","tax"],
  steps: [
    { id: "gst-invoice-validator", type: "mandatory" as const }
  ],
  links: {
    "github": "https://github.com/Lamatic/AgentKit/tree/main/kits/gst-invoice-validator",
    "docs": ""
  },
};
